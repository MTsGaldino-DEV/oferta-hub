import { Platform } from '@prisma/client';

export interface MessageInput {
  platform: Platform;
  title: string;
  price: number;
  comparePrice?: number | null;
  discountPct?: number | null;
  /**
   * Menor preco do historico. Continua sendo calculado porque a nota da fila
   * depende dele -- so nao entra mais no texto que vai pro grupo.
   */
  lowest?: number | null;
  couponCode?: string | null;
  link: string;
  /** Chamada que voce escreve. Vai no topo, antes do titulo. */
  note?: string | null;
  /** Marca a mensagem como publicidade. Ver ANUNCIO. */
  anuncio?: boolean;
}

/**
 * "R$ 468" quando nao ha centavos, "R$ 33,66" quando ha.
 *
 * O modelo em que este formato se baseia arredonda tudo pra reais inteiros.
 * Aqui nao: dizer "R$ 13" num produto de R$ 12,10 e anunciar preco errado, e
 * o ganho estetico nao paga isso. Sem centavos o numero ja fica limpo.
 */
export const brl = (v: number): string => {
  const inteiro = Number.isInteger(v);
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: inteiro ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

/** Corta o titulo sem quebrar palavra no meio. */
function trim(title: string, max = 90) {
  if (title.length <= max) return title;
  return title.slice(0, title.lastIndexOf(' ', max)).trim() + '...';
}

/**
 * Instrucao especifica da loja, quando ela muda o que o comprador precisa
 * fazer. So existe onde o passo nao e obvio:
 *  - AliExpress: o preco "Do Brasil" so aparece dentro do app, e o link cai
 *    numa listagem, nao no produto.
 * Shopee e Mercado Livre abrem direto no produto e nao precisam de instrucao.
 */
const INSTRUCAO: Partial<Record<Platform, string>> = {
  ALIEXPRESS: 'Após entrar no link no APP, vá na guia "Do Brasil" — o produto é o primeiro da lista:',
};

/** Como o link e apresentado, quando a loja pede um rotulo. */
const ROTULO_LINK: Partial<Record<Platform, string>> = {
  SHOPEE: '-Link produto:',
};

/**
 * Identificacao de publicidade. O grupo que serviu de modelo fecha as ofertas
 * com "(ANÚNCIO)" -- e o que o CONAR espera e o que o CDC cobra. Fica
 * desligado por padrao porque a decisao e do operador.
 */
const ANUNCIO = '(ANÚNCIO)';

/**
 * Monta a mensagem no formato do WhatsApp (*negrito*, ~riscado~).
 *
 * O desenho segue o modelo que funciona nos grupos grandes: chamada, titulo
 * limpo, preco em uma linha so, cupom, link. Sem CAPS e sem emoji demais --
 * mensagem que parece robo aumenta denuncia, e denuncia e o que derruba numero.
 */
export function renderMessage(input: MessageInput): string {
  const lines: string[] = [];

  // A chamada vem antes do titulo: e ela que faz o dedo parar de rolar.
  if (input.note?.trim()) {
    lines.push(`*${input.note.trim()}*`);
    lines.push('');
  }

  lines.push(trim(input.title));
  lines.push('');

  // "De R$ 999 por R$ 468" numa linha so, em vez de riscado + linha nova.
  if (input.comparePrice && input.comparePrice > input.price) {
    lines.push(`De ~${brl(input.comparePrice)}~ por *${brl(input.price)}* 💵`);
  } else {
    lines.push(`*${brl(input.price)}* 💵`);
  }

  if (input.couponCode) {
    lines.push(`Use o cupom: *${input.couponCode}* 📌`);
  }

  const instrucao = INSTRUCAO[input.platform];
  if (instrucao) {
    lines.push('');
    lines.push(instrucao);
  } else {
    const rotulo = ROTULO_LINK[input.platform];
    lines.push('');
    if (rotulo) lines.push(rotulo);
  }

  lines.push(input.link);

  if (input.anuncio) {
    lines.push('');
    lines.push(ANUNCIO);
  }

  return lines.join('\n');
}
