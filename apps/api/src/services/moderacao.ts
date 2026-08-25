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
import {
  formasDoParticipante,
  jidVisivelDoParticipante,
  RemocaoSemConfirmacaoError,
  semSufixoDispositivo,
  whatsapp,
} from '../whatsapp/baileys.js';
import { decidir, normalizarNumero, type Decisao } from './protecao.js';

type MotivoRemocao = Extract<Decisao, { remover: true }>['motivo'];

// O produto e brasileiro e o cartao "Filtro de DDI" na tela (ver spec da fase)
// so tem liga-desliga -- nao existe campo pra digitar outro DDI. Por isso o
// permitido fica fixo aqui, e nao numa chave de AppSetting que ninguem
// preenche. Exportado: a rota de escanear (protecao.ts) precisa do mesmo
// valor pra nao duplicar o "55" como uma segunda fonte da verdade.
export const DDI_PERMITIDO = '55';

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

/**
 * Incrementa o contador atomicamente entre PROCESSOS, nao so dentro de um --
 * o mutex `lock` la embaixo so serializa chamadas no mesmo processo Node, e
 * ha copias do dev-server rodando no host alem do container (achado da
 * verificacao anterior). `AppSetting.value` e String (schema fechado nesta
 * fase), entao nao da pra usar o `{ increment }` nativo do Prisma como
 * `SendLog.count` usa. Compare-and-swap via `updateMany` com o valor lido no
 * WHERE e o equivalente sem escrever SQL cru: o UPDATE so aplica se ninguem
 * escreveu entre a leitura e agora; se alguem escreveu, tenta de novo.
 */
async function incrementarContadorHoje(): Promise<void> {
  const key = chaveContadorHoje();
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const atual = await prisma.appSetting.findUnique({ where: { key } });
    if (!atual) {
      try {
        await prisma.appSetting.create({ data: { key, value: '1' } });
        return;
      } catch {
        continue; // outro processo criou a linha primeiro -- tenta de novo como update
      }
    }
    const novoValor = String((Number(atual.value) || 0) + 1);
    const resultado = await prisma.appSetting.updateMany({
      where: { key, value: atual.value },
      data: { value: novoValor },
    });
    if (resultado.count === 1) return; // ninguem mexeu entre a leitura e a escrita
  }
  throw new Error('nao consegui incrementar o contador diario de remocoes (contencao demais)');
}

// Exportada: a rota de remocao manual (protecao.ts) reafirma a guarda de
// PROPRIO/ADMIN no momento da remocao e precisa registrar o SKIPPED com o
// mesmo formato de auditoria, em vez de escrever uma segunda funcao de log.
export async function registrar(
  groupJid: string,
  participant: string,
  action: ModerationAction,
  reason: ModerationReason,
  detail: string | null,
): Promise<void> {
  await prisma.moderationLog.create({ data: { groupJid, participant, action, reason, detail } });
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
  // 'MANUAL' alem dos dois motivos que decidir() produz: a rota de remocao
  // explicita (usuario marcou a lista na tela, nao um escaneamento por
  // criterio) usa esse motivo pra nao inventar BLOCKLIST/FOREIGN_DDI onde
  // nao houve essa decisao automatica.
  motivo: MotivoRemocao | 'MANUAL',
): Promise<'REMOVED' | 'FAILED' | 'SKIPPED'> {
  const reason =
    motivo === 'BLOCKLIST'
      ? ModerationReason.BLOCKLIST
      : motivo === 'MANUAL'
        ? ModerationReason.MANUAL
        : ModerationReason.FOREIGN_DDI;

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
      // O relogio do ritmo avanca em QUALQUER tentativa, sucesso ou falha --
      // senao uma sequencia de recusas (ex: botIsAdmin desatualizado no
      // banco, bot foi rebaixado) dispara em rajada, sem esperar entre uma
      // e outra, exatamente o padrao que o intervalo existe pra evitar.
      ultimaRemocaoEm = Date.now();

      if (err instanceof RemocaoSemConfirmacaoError) {
        // Resposta sem eco nao e recusa (ver removerDoGrupo) -- na duvida, o
        // conservador e assumir que a remocao ocorreu: consome o teto do
        // mesmo jeito que um sucesso confirmado, senao o contador fica
        // sistematicamente atrasado em relacao ao que aconteceu de verdade.
        await incrementarContadorHoje();
        await registrar(groupJid, jid, ModerationAction.REMOVED, reason, 'resposta sem confirmacao, assumido como removido');
        return 'REMOVED';
      }

      // Nao ha laco de retry aqui: o participante segue no grupo ate a
      // proxima avaliacao real (proxima entrada, ou o usuario rodar a
      // Guilhotina). Insistir numa remocao que o WhatsApp recusou e o
      // padrao que queima o numero do usuario.
      await registrar(groupJid, jid, ModerationAction.FAILED, reason, String(err));
      return 'FAILED';
    }

    ultimaRemocaoEm = Date.now();
    await incrementarContadorHoje();
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
  // Ja leu AppSetting duas vezes acima (carregarConfig) -- o que essa saida
  // evita e o resto: fetch de metadados, blocklist, e qualquer escrita em
  // ModerationLog.
  if (!config.escudo && !config.ddi) return;

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

  if (!whatsapp.me) {
    // Sem isso nao da pra garantir que o bot nao removeria a si mesmo -- o
    // fallback '' que existia aqui antes desligava a guarda em silencio
    // (mesmoParticipante(jid, '') e sempre falso). Melhor nao avaliar.
    for (const jid of jids) {
      await registrar(
        groupJid,
        jid,
        ModerationAction.SKIPPED,
        ModerationReason.MANUAL,
        'conta propria desconhecida no momento -- nao avalio pra nao arriscar remover o proprio bot',
      );
    }
    return;
  }

  // `meuJid`/`meuLid` (nao so um): a propria conta tem duas identidades
  // possiveis (sock.user.id e sock.user.lid -- ver baileys.ts), e o
  // participante avaliado no loop abaixo pode chegar em qualquer uma das
  // duas formas dependendo do endereçamento do grupo. decidir() so aceita
  // um jidProprio por chamada, entao escolhe por iteracao a forma que
  // combina com o jid sendo avaliado.
  const meuJid = semSufixoDispositivo(whatsapp.me);
  const meuLid = whatsapp.meLid ? semSufixoDispositivo(whatsapp.meLid) : null;

  // admins: cada participante pode ter ate tres formas (id/jid/lid) -- juntar
  // todas no Set e o mesmo defeito e a mesma correcao do botIsAdmin em
  // baileys.ts. Sem isso, um admin de verdade num grupo com endereçamento
  // LID passaria pela guarda ADMIN e seria removido por engano.
  const admins = new Set(
    meta.participants
      .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
      .flatMap((p) => formasDoParticipante(p)),
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
    // messageStubParameters (o listener ao vivo) so traz o identificador cru
    // que o WhatsApp anunciou na entrada -- sem o campo companheiro que
    // carrega o numero (ver formasDoParticipante/jidVisivelDoParticipante em
    // baileys.ts). meta.participants, ja buscado acima, tem os tres campos;
    // casa pelo identificador do evento pra achar quem acabou de entrar.
    const participante = meta.participants.find((p) => formasDoParticipante(p).includes(jid));
    if (!participante) {
      // Entrou e saiu antes da consulta ao metadata, ou o identificador do
      // evento nao bate com nenhum participante atual -- nao da pra avaliar,
      // e remover por suposicao expulsaria alguem por engano.
      await registrar(
        groupJid,
        jid,
        ModerationAction.SKIPPED,
        ModerationReason.MANUAL,
        'participante nao encontrado no metadata do grupo -- nao avaliavel',
      );
      continue;
    }

    // Avalia pelo jid que carrega o numero quando existe (jidVisivelDoParticipante),
    // nao pelo identificador cru do evento -- e o que destrava o Filtro de DDI pra
    // quem entrou em grupo com endereçamento LID. jidProprio escolhido pelo
    // FORMATO desse jid avaliado (nao mais o do evento), pra mesmoParticipante()
    // comparar formas compativeis dos dois lados.
    const jidAvaliar = jidVisivelDoParticipante(participante);
    const jidProprio = jidAvaliar.toLowerCase().endsWith('@lid') && meuLid ? meuLid : meuJid;
    const decisao = decidir({
      jid: jidAvaliar,
      bloqueados,
      filtroDdiLigado: config.ddi,
      ddiPermitido: DDI_PERMITIDO,
      jidProprio,
      admins,
    });

    if (decisao.remover) {
      // jid original (o que o WhatsApp anunciou na entrada), nao jidAvaliar --
      // e o identificador que o grupo reconhece pra remocao de verdade.
      await removerParticipante(groupJid, jid, decisao.motivo);
    } else {
      // ModerationReason so tem BLOCKLIST | FOREIGN_DDI | MANUAL, e
      // FOREIGN_DDI so pode significar remocao por DDI, tentada ou barrada
      // pelo teto -- nunca "nao removido". Um PERMITIDO (brasileiro, tudo
      // certo) gravado como FOREIGN_DDI faria consulta agrupada por reason
      // contar gente legitima como estrangeira. Todo remover:false vira
      // MANUAL; o motivo real de decidir() (inclusive NAO_AVALIAVEL, o que
      // importa pra medir o alcance do Filtro de DDI) fica no detail.
      await registrar(groupJid, jid, ModerationAction.SKIPPED, ModerationReason.MANUAL, `nao removido: ${decisao.motivo}`);
    }
  }
}
