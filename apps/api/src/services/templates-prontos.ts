import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';

/**
 * Modelos que ja vem montados no sistema, pra ninguem comecar de textarea
 * vazia. Semeados por `upsert` na chave `name`, entao o texto que o usuario
 * editar depois nao e sobrescrito no boot seguinte.
 *
 * `{PRECO_ANTIGO}` some sozinho quando o produto nao tem preco de comparacao
 * -- ver services/template.ts. Por isso o "de/por" pode aparecer solto aqui.
 */
export const TEMPLATES_PRONTOS: { name: string; body: string; isDefault: boolean }[] = [
  {
    name: 'Direto e agressivo',
    isDefault: true,
    body: `🚨 *BAIXOU AGORA*

*{TITULO}*

~{PRECO_ANTIGO}~ ➡️ *{PRECO}*

{LINK}`,
  },
  {
    name: 'Curto (volume)',
    isDefault: false,
    body: `🔥 *ACHADINHO DO DIA*

*{TITULO}*

~{PRECO_ANTIGO}~ ➡️ *{PRECO}* 🤯

👉 {LINK}`,
  },
  {
    name: 'Vendedor e humanizado',
    isDefault: false,
    body: `💛 *Esse achado vale a pena conferir!*

📦 *{TITULO}*

O preço caiu de ~{PRECO_ANTIGO}~ para apenas *{PRECO}* 🔥

Pra quem já estava querendo comprar, essa pode ser uma boa hora 👀

👉 Veja a oferta:
{LINK}`,
  },
  {
    name: 'Urgência e escassez',
    isDefault: false,
    body: `⚠️ *PREÇO BAIXOU!*

🔥 *{TITULO}*

Era ~{PRECO_ANTIGO}~
Agora está saindo por apenas *{PRECO}* 😱

⏳ Não sei até quando esse preço fica disponível.

👉 Pegue aqui:
{LINK}`,
  },
  {
    name: 'Sensação de achado',
    isDefault: false,
    body: `👀 *OLHA O QUE EU ACHEI!*

*{TITULO}*

❌ De: ~{PRECO_ANTIGO}~
✅ Agora por: *{PRECO}*

Tá com um preço muito bom! 🔥

🛒 Corre pra ver:
{LINK}`,
  },
];

/**
 * `update: {}` de proposito: o upsert existe pra CRIAR o que falta, nunca pra
 * desfazer edicao do usuario. Se o modelo ja existe, nada muda.
 *
 * `isDefault` so entra na criacao, e so quando ainda nao ha nenhum padrao --
 * caso contrario o boot roubaria o padrao que o usuario escolheu.
 */
export async function semearTemplates(): Promise<void> {
  try {
    const jaTemPadrao = (await prisma.messageTemplate.count({ where: { isDefault: true } })) > 0;

    for (const t of TEMPLATES_PRONTOS) {
      await prisma.messageTemplate.upsert({
        where: { name: t.name },
        create: { name: t.name, body: t.body, isDefault: t.isDefault && !jaTemPadrao },
        update: {},
      });
    }
  } catch (err) {
    // Conteudo de exemplo nao pode impedir a API de subir.
    logger.warn({ err: String(err) }, 'nao consegui semear os modelos de mensagem');
  }
}
