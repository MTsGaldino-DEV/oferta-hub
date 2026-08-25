/**
 * Moderacao de entrada em grupo -- ritmo, teto diario e registro de auditoria.
 *
 * Liga a decisao pura de protecao.ts ao WhatsApp de verdade: daqui pra frente
 * este modulo pode remover gente de grupo real. Por isso ritmo (intervalo
 * minimo entre remocoes) e teto diario existem -- remocao em rajada e o
 * padrao que o WhatsApp associa a bot, e o numero do usuario e o ganha-pao
 * dele.
 */
import { ModerationAction, ModerationReason } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { createMutex } from '../lib/mutex.js';
import { semSufixoDispositivo, whatsapp } from '../whatsapp/baileys.js';
import { decidir, normalizarNumero, type Decisao } from './protecao.js';

type MotivoRemocao = Extract<Decisao, { remover: true }>['motivo'];
type MotivoNaoRemovido = Extract<Decisao, { remover: false }>['motivo'];

// O produto e brasileiro e o cartao "Filtro de DDI" na tela (ver spec da fase)
// so tem liga-desliga -- nao existe campo pra digitar outro DDI. Por isso o
// permitido fica fixo aqui, e nao numa chave de AppSetting que ninguem
// preenche.
const DDI_PERMITIDO = '55';

const CHAVE_ESCUDO = 'protecao_escudo';
const CHAVE_DDI = 'protecao_ddi';

async function lerBooleano(key: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value === 'true';
}

/** Le as duas protecoes. Ambas nascem desligadas -- ver salvarConfig. */
export async function carregarConfig(): Promise<{ escudo: boolean; ddi: boolean }> {
  const [escudo, ddi] = await Promise.all([lerBooleano(CHAVE_ESCUDO), lerBooleano(CHAVE_DDI)]);
  return { escudo, ddi };
}

/**
 * Grava so as chaves presentes em `parcial`. Padrao de leitura (ausente =
 * "false", ver lerBooleano) ja cobre o caso de nunca ter sido salvo -- e o
 * que garante que a protecao chega desligada sem precisar de um seed.
 */
export async function salvarConfig(parcial: { escudo?: boolean; ddi?: boolean }): Promise<void> {
  const escrever = (key: string, valor: boolean) =>
    prisma.appSetting.upsert({
      where: { key },
      create: { key, value: String(valor) },
      update: { value: String(valor) },
    });

  await Promise.all([
    parcial.escudo !== undefined ? escrever(CHAVE_ESCUDO, parcial.escudo) : undefined,
    parcial.ddi !== undefined ? escrever(CHAVE_DDI, parcial.ddi) : undefined,
  ]);
}

// Contador diario de remocoes, mesmo espirito do SendLog (dia na chave, sem
// tabela nova -- AppSetting.value e texto livre, guarda o numero como string).
function chaveContadorHoje(): string {
  return `protecao_remocoes_${new Date().toISOString().slice(0, 10)}`;
}

async function contadorHoje(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: chaveContadorHoje() } });
  return row ? Number(row.value) || 0 : 0;
}

async function setContadorHoje(valor: number): Promise<void> {
  const key = chaveContadorHoje();
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: String(valor) },
    update: { value: String(valor) },
  });
}

async function registrar(
  groupJid: string,
  participant: string,
  action: ModerationAction,
  reason: ModerationReason,
  detail: string | null,
): Promise<void> {
  await prisma.moderationLog.create({ data: { groupJid, participant, action, reason, detail } });
}

/**
 * ModerationReason do schema so tem BLOCKLIST | FOREIGN_DDI | MANUAL (Task 1
 * ja fechou o schema), mas decidir() produz quatro motivos de nao-remocao e
 * so dois cabem nessas categorias. Mapeamento, com o motivo real sempre
 * preservado no detail:
 *   - NAO_AVALIAVEL e PERMITIDO nascem da mesma guarda -- a que olha numero
 *     visivel pra decidir DDI (NAO_AVALIAVEL e literalmente "essa guarda nao
 *     tinha o que avaliar"). FOREIGN_DDI.
 *   - PROPRIO e ADMIN sao guardas de seguranca que nao vem de nenhuma
 *     configuracao do usuario -- nao sao decisao de blocklist nem de DDI.
 *     MANUAL, o mais neutro dos tres.
 */
function reasonDoSkip(motivo: MotivoNaoRemovido): ModerationReason {
  if (motivo === 'NAO_AVALIAVEL' || motivo === 'PERMITIDO') return ModerationReason.FOREIGN_DDI;
  return ModerationReason.MANUAL;
}

let ultimaRemocaoEm = 0;

async function aguardarIntervalo(): Promise<void> {
  const min = env.wa.moderacaoIntervaloSegundos * 1000;
  const gap = Date.now() - ultimaRemocaoEm;
  if (ultimaRemocaoEm && gap < min) {
    await new Promise((resolve) => setTimeout(resolve, min - gap));
  }
}

// Duas entradas em grupos diferentes podem chegar quase juntas (o listener do
// Baileys nao serializa handlers assincronos entre eventos). Sem isso, as duas
// leriam o mesmo contador diario antes de qualquer uma escrever, e o teto
// furaria -- mesmo problema que sendOffer resolve com lock em baileys.ts.
const lock = createMutex();

/**
 * Remove um participante, respeitando teto diario e intervalo minimo, e
 * registra o resultado em ModerationLog. Nunca repete uma remocao que falhou
 * -- insistir numa remocao que o WhatsApp recusou e o padrao que queima o
 * numero do usuario, entao uma falha simplesmente devolve 'FAILED' e segue.
 */
export async function removerParticipante(
  groupJid: string,
  jid: string,
  motivo: MotivoRemocao,
): Promise<'REMOVED' | 'FAILED' | 'SKIPPED'> {
  const reason = motivo === 'BLOCKLIST' ? ModerationReason.BLOCKLIST : ModerationReason.FOREIGN_DDI;

  return lock(async () => {
    const usados = await contadorHoje();
    if (usados >= env.wa.moderacaoTetoDiario) {
      logger.warn({ groupJid, jid, usados }, 'teto diario de remocoes atingido, pulando');
      await registrar(
        groupJid,
        jid,
        ModerationAction.SKIPPED,
        reason,
        `teto diario de ${env.wa.moderacaoTetoDiario} remocoes atingido`,
      );
      return 'SKIPPED';
    }

    await aguardarIntervalo();

    try {
      await whatsapp.removerDoGrupo(groupJid, jid);
    } catch (err) {
      // Nao mexe em ultimaRemocaoEm nem no contador -- essa tentativa nao
      // consumiu o ritmo nem o teto, so falhou. Nao ha laco de retry aqui: o
      // participante segue no grupo ate a proxima avaliacao real (proxima
      // entrada, ou o usuario rodar a Guilhotina).
      await registrar(groupJid, jid, ModerationAction.FAILED, reason, String(err));
      return 'FAILED';
    }

    ultimaRemocaoEm = Date.now();
    await setContadorHoje(usados + 1);
    await registrar(groupJid, jid, ModerationAction.REMOVED, reason, null);
    return 'REMOVED';
  });
}

/**
 * Chamada pelo listener de entrada (baileys.ts) pra cada leva de participantes
 * que acabou de entrar num grupo. Avalia cada um e age -- remove, ou registra
 * SKIPPED com o motivo real. Registrar SKIPPED pra quem nao foi avaliavel e o
 * ponto: e o que deixa o usuario descobrir, pela tela, o quanto o Filtro de
 * DDI realmente enxerga (participante em LID nao carrega numero).
 */
export async function avaliarEntrada(groupJid: string, jids: string[]): Promise<void> {
  const config = await carregarConfig();
  if (!config.escudo && !config.ddi) return; // nenhuma protecao ligada -- nao toca no banco

  const grupo = await prisma.whatsappGroup.findUnique({ where: { jid: groupJid } });
  if (!grupo?.botIsAdmin) {
    for (const jid of jids) {
      await registrar(
        groupJid,
        jid,
        ModerationAction.SKIPPED,
        ModerationReason.MANUAL,
        'bot nao e admin deste grupo -- nao ha como remover ninguem',
      );
    }
    return;
  }

  const meta = await whatsapp.groupMetadata(groupJid);
  if (!meta) {
    // Sem conexao agora pra buscar quem e admin nem confirmar a propria
    // conta -- melhor nao avaliar do que decidir com dado velho/ausente.
    for (const jid of jids) {
      await registrar(
        groupJid,
        jid,
        ModerationAction.SKIPPED,
        ModerationReason.MANUAL,
        'sem conexao com o WhatsApp no momento da entrada',
      );
    }
    return;
  }

  const eu = whatsapp.me ? semSufixoDispositivo(whatsapp.me) : '';
  const admins = new Set(
    meta.participants.filter((p) => p.admin === 'admin' || p.admin === 'superadmin').map((p) => p.id),
  );

  // bloqueados so entra na decisao se o Escudo estiver ligado -- decidir() e
  // puro e nao sabe de config nenhuma, sempre avalia contra o que recebe.
  // Passar a blocklist real com o Escudo desligado removeria gente sem o
  // usuario ter pedido isso.
  const bloqueados = config.escudo
    ? new Set(
        (await prisma.blockedNumber.findMany({ select: { phone: true } }))
          .map((b) => normalizarNumero(b.phone))
          .filter((n): n is string => n !== null),
      )
    : new Set<string>();

  for (const jid of jids) {
    const decisao = decidir({
      jid,
      bloqueados,
      filtroDdiLigado: config.ddi,
      ddiPermitido: DDI_PERMITIDO,
      jidProprio: eu,
      admins,
    });

    if (decisao.remover) {
      await removerParticipante(groupJid, jid, decisao.motivo);
    } else {
      await registrar(
        groupJid,
        jid,
        ModerationAction.SKIPPED,
        reasonDoSkip(decisao.motivo),
        `nao removido: ${decisao.motivo}`,
      );
    }
  }
}
