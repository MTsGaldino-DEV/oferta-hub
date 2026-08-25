import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { carregarConfig, salvarConfig, removerParticipante, DDI_PERMITIDO } from '../services/moderacao.js';
import { decidir, normalizarNumero, numeroDoJid } from '../services/protecao.js';
import { semSufixoDispositivo, whatsapp } from '../whatsapp/baileys.js';

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
      if (p.id.endsWith('@s.whatsapp.net')) comNumeroVisivel++;
      else if (p.id.endsWith('@lid')) comLid++;
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
        numero: z.string().min(1, 'Numero obrigatorio.'),
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
      return reply.code(400).send({ error: 'Numero invalido. Informe DDD + numero, com ou sem o DDI do pais.' });
    }

    const existente = await prisma.blockedNumber.findUnique({ where: { phone: normalizado } });
    if (existente) return { ...existente, ddiAssumido };

    const criado = await prisma.blockedNumber.create({ data: { phone: normalizado, note: note || null } });
    return { ...criado, ddiAssumido };
  });

  app.delete<{ Params: { id: string } }>('/api/protecao/bloqueados/:id', async (req) => {
    await prisma.blockedNumber.delete({ where: { id: req.params.id } }).catch(() => undefined);
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

    if (!blocklist && !ddi) {
      return reply.code(400).send({ error: 'Marque pelo menos um criterio (Escudo ou Filtro de DDI) para escanear.' });
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

    const eu = whatsapp.me ? semSufixoDispositivo(whatsapp.me) : '';

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

      const admins = new Set(
        meta.participants.filter((p) => p.admin === 'admin' || p.admin === 'superadmin').map((p) => p.id),
      );

      for (const p of meta.participants) {
        const decisao = decidir({
          jid: p.id,
          bloqueados,
          filtroDdiLigado: ddi,
          ddiPermitido: DDI_PERMITIDO,
          jidProprio: eu,
          admins,
        });

        if (decisao.remover) {
          achados.push({
            groupJid: grupo.jid,
            groupName: grupo.name,
            jid: p.id,
            numero: numeroDoJid(p.id),
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
  app.post<{ Body: { alvos: { groupJid: string; jid: string }[] } }>('/api/protecao/remover', async (req) => {
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

    let removidos = 0;
    let falhas = 0;
    let pulados = 0;
    const detalhes: { groupJid: string; jid: string; resultado: 'REMOVED' | 'FAILED' | 'SKIPPED' }[] = [];

    for (const alvo of alvos) {
      const resultado = await removerParticipante(alvo.groupJid, alvo.jid, 'MANUAL');
      detalhes.push({ ...alvo, resultado });
      if (resultado === 'REMOVED') removidos++;
      else if (resultado === 'FAILED') falhas++;
      else pulados++;
    }

    return { removidos, falhas, pulados, detalhes };
  });
}
