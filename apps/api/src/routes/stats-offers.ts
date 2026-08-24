export interface LinhaOferta {
  id: string;
  title: string;
  imageUrl: string | null;
  platform: string;
  price: number;
  discountPct: number;
  score: number;
  sentAt: Date | null;
  clicks: number;
  orders: number;
  revenue: number;
  conversionRate: number;
  /** Tem venda cuja comissao a loja ainda nao liberou. */
  pendente: boolean;
}

export type Coluna = 'pendente' | 'sentAt' | 'clicks' | 'orders' | 'revenue' | 'price' | 'score';
export type Direcao = 'asc' | 'desc';

/** Status que a loja ja resolveu. Comparado sem caixa: a Shopee mistura. */
const RESOLVIDOS = new Set(['approved', 'cancelled']);

/**
 * Pendente por exclusao, nao por inclusao: se a Shopee inventar um rotulo
 * novo, a linha tem que aparecer como pendente em vez de sumir da conta.
 */
export function ehPendente(statusDasVendas: string[]): boolean {
  return statusDasVendas.some((s) => !RESOLVIDOS.has(s.trim().toLowerCase()));
}

const tempo = (d: Date | null) => (d ? d.getTime() : Number.NEGATIVE_INFINITY);

/** Nota de cada coluna: maior nota primeiro quando a direcao e `desc`. */
const NOTA: Record<Coluna, (l: LinhaOferta) => number> = {
  pendente: (l) => (l.pendente ? 1 : 0),
  sentAt: (l) => tempo(l.sentAt),
  clicks: (l) => l.clicks,
  orders: (l) => l.orders,
  revenue: (l) => l.revenue,
  price: (l) => l.price,
  score: (l) => l.score,
};

/**
 * Ordena a lista inteira. Precisa ser sobre o conjunto todo, nao sobre a
 * pagina: ordenar so o que esta na tela responderia a pergunta errada.
 *
 * Na coluna `pendente` o desempate e pela data mais recente -- duas linhas
 * pendentes tem a mesma nota, e sem desempate a ordem viria do banco.
 */
export function ordenar(linhas: LinhaOferta[], coluna: Coluna, direcao: Direcao): LinhaOferta[] {
  const nota = NOTA[coluna];
  const sinal = direcao === 'asc' ? -1 : 1;

  return [...linhas].sort((a, b) => {
    const diff = (nota(b) - nota(a)) * sinal;
    if (diff !== 0) return diff;
    return tempo(b.sentAt) - tempo(a.sentAt);
  });
}
