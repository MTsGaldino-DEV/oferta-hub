import { Platform } from '@prisma/client';

const STORE_NAME: Record<Platform, string> = {
  AMAZON: 'Amazon',
  MERCADO_LIVRE: 'Mercado Livre',
  SHOPEE: 'Shopee',
  ALIEXPRESS: 'AliExpress',
  AWIN: 'Loja parceira',
  LOMADEE: 'Loja parceira',
};

export interface MessageInput {
  platform: Platform;
  title: string;
  price: number;
  comparePrice?: number | null;
  discountPct?: number | null;
  lowest?: number | null;
  couponCode?: string | null;
  link: string;
  /** Texto livre que voce digita antes de enviar. */
  note?: string | null;
}

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

/** Corta o titulo sem quebrar palavra no meio. */
function trim(title: string, max = 78) {
  if (title.length <= max) return title;
  return title.slice(0, title.lastIndexOf(' ', max)).trim() + '...';
}

/**
 * Monta a mensagem no formato do WhatsApp (*negrito*, ~riscado~).
 * Sem emoji em excesso e sem CAPS LOCK: alem de parecer spam pro leitor,
 * mensagens muito padronizadas e repetitivas aumentam a chance de denuncia,
 * que e o que de fato derruba o numero.
 */
export function renderMessage(input: MessageInput): string {
  const lines: string[] = [];

  lines.push(`*${trim(input.title)}*`);
  lines.push('');

  if (input.comparePrice && input.comparePrice > input.price) {
    lines.push(`~${brl(input.comparePrice)}~`);
  }
  const off = input.discountPct ? `  (-${Math.round(input.discountPct)}%)` : '';
  lines.push(`*${brl(input.price)}*${off}`);

  if (input.lowest !== null && input.lowest !== undefined && input.price <= input.lowest) {
    lines.push('_Menor preco dos ultimos 90 dias._');
  }

  if (input.couponCode) {
    lines.push('');
    lines.push(`Cupom: *${input.couponCode}*`);
  }

  if (input.note) {
    lines.push('');
    lines.push(input.note.trim());
  }

  lines.push('');
  lines.push(input.link);
  lines.push(`_${STORE_NAME[input.platform]} · link de afiliado_`);

  return lines.join('\n');
}
