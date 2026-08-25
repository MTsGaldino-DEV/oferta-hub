import type { GroupMetadata } from '@whiskeysockets/baileys';
import { ModerationAction, ModerationReason } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { carregarConfig, salvarConfig, removerParticipante, registrar, DDI_PERMITIDO } from '../services/moderacao.js';
import { decidir, normalizarNumero, numeroDoJid } from '../services/protecao.js';
import { formasDoParticipante, jidVisivelDoParticipante, semSufixoDispositivo, whatsapp } from '../whatsapp/baileys.js';
import { logger } from '../lib/logger.js';

const DESCONECTADO = 'WhatsApp desconectado. Conecte em Configurações › Canais para {acao}.';

// TTL do cache de metadata por grupo dentro de um lote de remocao -- um lote
// grande demora minutos (moderacaoIntervaloSegundos entre cada remocao), e
// reusar a mesma foto de admins do inicio ao fim do lote inteiro arrisca agir
// sobre um admin que so foi promovido depois que o lote comecou.
const TTL_METADATA_MS = 60_000;

/**
 * Quantos participantes dos grupos conhecidos tem numero visivel (JID
 * @s.whatsapp.net) vs LID -- o Escudo e o Filtro de DDI so avaliam quem tem
 * numero. Calculado ao vivo (poucos grupos, e barato) em vez de guardado,
 * pra sempre refletir o estado atual dos grupos, nao uma foto do ultimo sync.
 * Sem conexao com o WhatsApp agora, devolve zerado com medido:false -- a
 * tela precisa distinguir "0 porque medimos e deu zero" de "nao conseguimos medir".
 */
async function medirAvaliabilidade(
  grupos: { jid: string }[],
): Promise<{ comNumeroVisivel: number; comLid: number; medido: boolean }> {
  if (whatsapp.status !== 'connected') return { comNumeroVisivel: 0, comLid: 0, medido: false };

  let comNumeroVisivel = 0;
  let comLid = 0;
  for (const grupo of grupos) {
    const meta = await whatsapp.groupMetadata(grupo.jid);
    if (!meta) continue;
    for (const p of meta.participants) {
      // p.id sozinho SUBESTIMA: groups.js preenche p.jid com o numero mesmo
      // quando p.id veio em LID (mesmo achado do jidPreenchido em
      // syncGroups) -- reusa jidVisivelDoParticipante em vez de repetir a
      // mesma comparacao so com p.id.
      if (jidVisivelDoParticipante(p).toLowerCase().endsWith('@s.whatsapp.net')) comNumeroVisivel++;
      else comLid++;
    }
  }
  return { comNumeroVisivel, comLid, medido: true };
}

export async function protecaoRoutes(app: FastifyInstance) {
  app.get('/api/protecao', async () => {
    const [config, bloqueados, grupos] = await Promise.all([
      carregarConfig(),
      prisma.blockedNumber.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.whatsappGroup.findMany({ orderBy: { name: 'asc' } }),
    ]);

    const avaliabilidade = await medirAvaliabilidade(grupos);

    return {
      escudo: config.escudo,
      ddi: config.ddi,
      bloqueados,
      grupos: grupos.map((g) => ({ jid: g.jid, name: g.name, botIsAdmin: g.botIsAdmin })),
      avaliabilidade,
    };
  });

  app.put<{ Body: { escudo?: boolean; ddi?: boolean } }>('/api/protecao', async (req) => {
    const parcial = z
      .object({ escudo: z.boolean().optional(), ddi: z.boolean().optional() })
      .parse(req.body);
    await salvarConfig(parcial);
    return carregarConfig();
  });

  app.post<{ Body: { numero: string; note?: string } }>('/api/protecao/bloqueados', async (req, reply) => {
    const { numero, note } = z
      .object({
        numero: z.string().min(1, 'Número obrigatório.'),
        note: z.string().trim().optional(),
      })
      .parse(req.body);

    const digitos = numero.replace(/\D/g, '');
    // normalizarNumero e pura e nao inventa DDI -- um numero de 10-11 digitos
    // (DDD + numero, sem o "55") nunca bate com JID nenhum, que sempre traz
    // DDI. Como o produto e so pra Brasil (mesma premissa de DDI_PERMITIDO em
    // moderacao.ts), assume BR e prefixa antes de normalizar -- senao o
    // usuario cadastra, a tela confirma, e o bloqueio nunca funciona.
    const ddiAssumido = digitos.length >= 10 && digitos.length <= 11 && !digitos.startsWith('55');
    const normalizado = normalizarNumero(ddiAssumido ? `55${digitos}` : numero);

    if (!normalizado) {
      return reply.code(400).send({ error: 'Número inválido. Informe DDD + número, com ou sem o DDI do país.' });
    }

    const existente = await prisma.blockedNumber.findUnique({ where: { phone: normalizado } });
    if (existente) return { ...existente, ddiAssumido };

    const criado = await prisma.blockedNumber.create({ data: { phone: normalizado, note: note || null } });
    return { ...criado, ddiAssumido };
  });

  app.delete<{ Params: { id: string } }>('/api/protecao/bloqueados/:id', async (req, reply) => {
    // deleteMany em vez de delete: nao lanca quando o id nao existe, e o
    // count diz se algo foi de fato apagado -- {ok:true} pra um id inexistente
    // esconderia um bug de frontend (id errado) atras de sucesso falso.
    const { count } = await prisma.blockedNumber.deleteMany({ where: { id: req.params.id } });
    if (count === 0) return reply.code(404).send({ error: 'Número não encontrado na blocklist.' });
    return { ok: true };
  });

  /**
   * Le os participantes de cada grupo pelo Baileys e aplica decidir() -- NAO
   * remove ninguem. Grupo sem admin nao entra em achados: mostrar alguem que
   * nao da pra remover e prometer o que a Guilhotina nao cumpre.
   */
  app.post<{ Body: { blocklist: boolean; ddi: boolean } }>('/api/protecao/escanear', async (req, reply) => {
    const { blocklist, ddi } = z
      .object({ blocklist: z.boolean(), ddi: z.boolean() })
      .parse(req.body);

    // Escanear desconectado le zero grupos e devolve achados:[] -- a tela
    // mostraria "ninguem se encaixa" como se os grupos estivessem limpos,
    // quando na verdade nada foi lido. Falha explicita em vez disso.
    if (whatsapp.status !== 'connected') {
      return reply.code(400).send({ error: DESCONECTADO.replace('{acao}', 'escanear') });
    }

    if (!blocklist && !ddi) {
      return reply.code(400).send({ error: 'Marque pelo menos um critério (Na blocklist ou DDI estrangeiro) para escanear.' });
    }

    const grupos = await prisma.whatsappGroup.findMany();
    const gruposComAdmin = grupos.filter((g) => g.botIsAdmin);
    const gruposSemAdmin = grupos.filter((g) => !g.botIsAdmin).map((g) => ({ jid: g.jid, name: g.name }));

    // bloqueados so entra na decisao se o criterio blocklist foi marcado
    // nesse escaneamento -- decidir() e pura, sempre avalia o que recebe.
    const bloqueados = blocklist
      ? new Set(
          (await prisma.blockedNumber.findMany({ select: { phone: true } }))
            .map((b) => normalizarNumero(b.phone))
            .filter((n): n is string => n !== null),
        )
      : new Set<string>();

    // meuJid/meuLid (nao so um): mesma razao das outras duas rotas -- a
    // propria conta pode nao ter numero visivel no grupo. O fallback ''
    // que existia aqui antes desligava a guarda PROPRIO em silencio (ver
    // mesmoParticipante em services/protecao.ts); melhor falhar explicito.
    const meuJid = whatsapp.me ? semSufixoDispositivo(whatsapp.me) : null;
    const meuLid = whatsapp.meLid ? semSufixoDispositivo(whatsapp.meLid) : null;
    if (!meuJid && !meuLid) {
      return reply.code(400).send({ error: 'Não foi possível confirmar a própria conta no WhatsApp. Tente novamente.' });
    }

    const achados: {
      groupJid: string;
      groupName: string;
      jid: string;
      numero: string | null;
      motivo: 'BLOCKLIST' | 'FOREIGN_DDI';
    }[] = [];
    let naoAvaliaveis = 0;

    for (const grupo of gruposComAdmin) {
      const meta = await whatsapp.groupMetadata(grupo.jid);
      if (!meta) continue; // sem conexao agora -- nao da pra ler este grupo, nao inventa dado

      // cada participante pode ter ate tres formas (id/jid/lid) -- juntar
      // todas no Set e o mesmo defeito e a mesma correcao do botIsAdmin em
      // baileys.ts e do admins de avaliarEntrada em moderacao.ts. So com
      // p.id, um admin de verdade num grupo com endereçamento LID passaria
      // pela guarda ADMIN e apareceria como removivel por engano.
      const admins = new Set(
        meta.participants
          .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
          .flatMap((p) => formasDoParticipante(p)),
      );

      for (const p of meta.participants) {
        // jidVisivelDoParticipante: avalia pelo jid que carrega o numero
        // quando existe, nao por p.id sozinho -- e o que faz decidir()
        // achar o DDI de quem entrou por endereçamento LID (mesma correcao
        // de jidPreenchido em syncGroups). numero exibido usa o mesmo jid.
        const jidAvaliar = jidVisivelDoParticipante(p);
        // Mesma escolha por formato de avaliarEntrada: usa a forma da propria
        // conta que combina com o jid avaliado, caindo pra outra so quando a
        // preferida nao existe (garantido nao-nula pelo guard acima).
        const jidProprio = (jidAvaliar.toLowerCase().endsWith('@lid') ? meuLid ?? meuJid : meuJid ?? meuLid) as string;
        const decisao = decidir({
          jid: jidAvaliar,
          bloqueados,
          filtroDdiLigado: ddi,
          ddiPermitido: DDI_PERMITIDO,
          jidProprio,
          admins,
        });

        if (decisao.remover) {
          achados.push({
            groupJid: grupo.jid,
            groupName: grupo.name,
            jid: p.id,
            numero: numeroDoJid(jidAvaliar),
            motivo: decisao.motivo,
          });
        } else if (decisao.motivo === 'NAO_AVALIAVEL') {
          naoAvaliaveis++;
        }
      }
    }

    return { achados, naoAvaliaveis, gruposSemAdmin };
  });

  /**
   * Recebe a lista explicita de alvos que o usuario marcou na tela -- nunca
   * "remova tudo que se encaixa". O que ele viu e exatamente o que sai, sem
   * janela pra alguem novo entrar na conta entre o escaneamento e a remocao.
   */
  app.post<{ Body: { alvos: { groupJid: string; jid: string }[] } }>('/api/protecao/remover', async (req, reply) => {
    const { alvos } = z
      .object({
        alvos: z
          .array(
            z.object({
              groupJid: z.string().min(1, 'groupJid obrigatorio.'),
              jid: z.string().min(1, 'jid obrigatorio.'),
            }),
          )
          .min(1, 'Informe pelo menos um alvo.'),
      })
      .parse(req.body);

    // Mesmo problema do escanear, do lado destrutivo: sem isso, remover
    // desconectado devolveria "Pulados: N" sem dizer que a causa e a conexao.
    if (whatsapp.status !== 'connected') {
      return reply.code(400).send({ error: DESCONECTADO.replace('{acao}', 'remover') });
    }

    let removidos = 0;
    let falhas = 0;
    let pulados = 0;
    const detalhes: {
      groupJid: string;
      jid: string;
      resultado: 'REMOVED' | 'FAILED' | 'SKIPPED';
      motivo?: 'PROPRIO' | 'ADMIN' | 'SEM_METADATA' | 'TETO_DIARIO';
    }[] = [];

    // escanear ja filtra PROPRIO/ADMIN antes de oferecer o alvo na tela, mas
    // isso e barreira do lado da tela -- um bug de frontend ou uma requisicao
    // montada a mao chegaria direto aqui. Reafirma a guarda com metadata
    // fresca no momento em que a remocao de fato aconteceria, reusando
    // decidir() em vez de escrever uma terceira comparacao de identidade.
    // buscadoEm por grupo: TTL_METADATA_MS evita reusar a mesma foto de
    // admins do inicio ao fim de um lote grande (minutos, dado o intervalo
    // entre remocoes) -- sem isso, alguem promovido a admin no meio do lote
    // continuaria avaliado com dado velho ate o fim.
    const metaPorGrupo = new Map<string, { meta: GroupMetadata | null; buscadoEm: number }>();
    // meuJid/meuLid (nao so um): mesma razao de avaliarEntrada em
    // moderacao.ts -- a propria conta pode nao ter numero visivel naquele
    // grupo especifico, e essa e a ultima barreira antes de uma remocao
    // irreversivel, entao vale a mesma robustez. O fallback '' que existia
    // aqui antes desligava a guarda PROPRIO em silencio.
    const meuJid = whatsapp.me ? semSufixoDispositivo(whatsapp.me) : null;
    const meuLid = whatsapp.meLid ? semSufixoDispositivo(whatsapp.meLid) : null;
    if (!meuJid && !meuLid) {
      return reply.code(400).send({ error: 'Não foi possível confirmar a própria conta no WhatsApp. Tente novamente.' });
    }

    for (const alvo of alvos) {
      // Por alvo: uma falha inesperada (ex: groupMetadata derrubou por erro
      // de rede) nao pode abortar o lote inteiro e descartar os detalhes de
      // quem ja saiu antes dela.
      try {
        let entrada = metaPorGrupo.get(alvo.groupJid);
        if (!entrada || Date.now() - entrada.buscadoEm > TTL_METADATA_MS) {
          entrada = { meta: await whatsapp.groupMetadata(alvo.groupJid), buscadoEm: Date.now() };
          metaPorGrupo.set(alvo.groupJid, entrada);
        }
        const meta = entrada.meta;

        if (!meta) {
          // Sem metadata agora nao da pra reafirmar a guarda -- na duvida, nao
          // remove. removerParticipante tambem falharia sozinho se o WhatsApp
          // estiver desconectado, mas nao vale arriscar a janela em que o
          // socket existe e so a consulta de metadata falhou.
          await registrar(
            alvo.groupJid,
            alvo.jid,
            ModerationAction.SKIPPED,
            ModerationReason.MANUAL,
            'sem metadata do grupo -- nao consegui reafirmar propria conta/admin',
          );
          detalhes.push({ ...alvo, resultado: 'SKIPPED', motivo: 'SEM_METADATA' });
          pulados++;
          continue;
        }

        const admins = new Set(
          meta.participants
            .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
            .flatMap((p) => formasDoParticipante(p)),
        );
        // Mesma escolha por formato do escanear/avaliarEntrada -- garantido
        // nao-nula pelo guard de meuJid/meuLid acima.
        const jidProprio = (alvo.jid.toLowerCase().endsWith('@lid') ? meuLid ?? meuJid : meuJid ?? meuLid) as string;

        // bloqueados vazio e filtroDdi desligado: a remocao manual nao deve
        // ser barrada por BLOCKLIST/FOREIGN_DDI (o usuario ja decidiu o alvo
        // na tela) -- so PROPRIO/ADMIN interessam aqui, e sao as duas unicas
        // guardas que decidir() aplica antes de olhar bloqueados/DDI.
        const guarda = decidir({
          jid: alvo.jid,
          bloqueados: new Set(),
          filtroDdiLigado: false,
          ddiPermitido: DDI_PERMITIDO,
          jidProprio,
          admins,
        });

        if (guarda.motivo === 'PROPRIO' || guarda.motivo === 'ADMIN') {
          await registrar(
            alvo.groupJid,
            alvo.jid,
            ModerationAction.SKIPPED,
            ModerationReason.MANUAL,
            `guarda reafirmada no momento da remocao: ${guarda.motivo}`,
          );
          detalhes.push({ ...alvo, resultado: 'SKIPPED', motivo: guarda.motivo });
          pulados++;
          continue;
        }

        const { resultado, tetoDiario } = await removerParticipante(alvo.groupJid, alvo.jid, 'MANUAL');
        detalhes.push({ ...alvo, resultado, motivo: tetoDiario ? 'TETO_DIARIO' : undefined });
        if (resultado === 'REMOVED') removidos++;
        else if (resultado === 'FAILED') falhas++;
        else pulados++;
      } catch (err) {
        logger.error(
          { err, groupJid: alvo.groupJid, jid: alvo.jid },
          'falha inesperada ao processar alvo da remocao manual',
        );
        await registrar(alvo.groupJid, alvo.jid, ModerationAction.FAILED, ModerationReason.MANUAL, String(err));
        detalhes.push({ ...alvo, resultado: 'FAILED' });
        falhas++;
      }
    }

    return { removidos, falhas, pulados, detalhes };
  });

  /**
   * Historico de moderacao paginado, mais recente primeiro -- unica forma de
   * auditar o que a protecao fez sem abrir o db:studio. Sem filtro nem busca
   * de proposito: uma lista simples ja responde "o que essa ferramenta fez".
   */
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/protecao/historico', async (req) => {
    const { limit, offset } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.query);

    const take = limit ?? 20;
    const skip = offset ?? 0;

    const [itens, total] = await Promise.all([
      prisma.moderationLog.findMany({ orderBy: { occurredAt: 'desc' }, take, skip }),
      prisma.moderationLog.count(),
    ]);

    const gruposEnvolvidos = await prisma.whatsappGroup.findMany({
      where: { jid: { in: [...new Set(itens.map((i) => i.groupJid))] } },
      select: { jid: true, name: true },
    });
    const nomePorJid = new Map(gruposEnvolvidos.map((g) => [g.jid, g.name]));

    return {
      total,
      itens: itens.map((i) => ({
        id: i.id,
        groupJid: i.groupJid,
        groupName: nomePorJid.get(i.groupJid) ?? null,
        participant: i.participant,
        action: i.action,
        reason: i.reason,
        detail: i.detail,
        occurredAt: i.occurredAt,
      })),
    };
  });
}
