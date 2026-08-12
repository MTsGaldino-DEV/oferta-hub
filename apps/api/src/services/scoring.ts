import { prisma, num } from '../db.js';

export interface ScoreInput {
  productId: string;
  price: number;
  listPrice?: number | null;
  commissionPct?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
}

export interface ScoreResult {
  score: number;
  discountPct: number | null;
  commissionBrl: number | null;
  reasons: { label: string; points: number; detail: string }[];
}

/**
 * Nota de 0 a 100 que ordena a fila. A ideia e separar desconto real de
 * desconto de vitrine: o peso maior vai para "esta abaixo do que ja esteve
 * nos ultimos 90 dias", nao para o "de/por" que a loja inventa.
 */
export async function scoreOffer(input: ScoreInput): Promise<ScoreResult> {
  const reasons: ScoreResult['reasons'] = [];
  let score = 0;

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const history = await prisma.priceSnapshot.findMany({
    where: { productId: input.productId, takenAt: { gte: since } },
    select: { price: true },
  });
  const prices = history.map((h) => Number(h.price)).filter((p) => p > 0);

  // 1. Preco historico (peso 40). Sem historico, credito parcial e neutro.
  if (prices.length >= 3) {
    const min = Math.min(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const vsAvg = (avg - input.price) / avg;

    if (input.price <= min) {
      score += 40;
      reasons.push({ label: 'Menor preco em 90 dias', points: 40, detail: `Minimo anterior R$ ${min.toFixed(2)}` });
    } else if (vsAvg > 0) {
      const pts = Math.min(32, Math.round(vsAvg * 120));
      score += pts;
      reasons.push({
        label: 'Abaixo da media historica',
        points: pts,
        detail: `${(vsAvg * 100).toFixed(0)}% abaixo da media de R$ ${avg.toFixed(2)}`,
      });
    } else {
      reasons.push({ label: 'Nao esta barato historicamente', points: 0, detail: `Media R$ ${avg.toFixed(2)}` });
    }
  } else {
    score += 12;
    reasons.push({ label: 'Sem historico suficiente', points: 12, detail: `${prices.length} leitura(s) em 90 dias` });
  }

  // 2. Desconto declarado pela loja (peso 20). Vale menos justamente por ser inflavel.
  let discountPct: number | null = null;
  if (input.listPrice && input.listPrice > input.price) {
    discountPct = ((input.listPrice - input.price) / input.listPrice) * 100;
    const pts = Math.min(20, Math.round(discountPct / 3));
    score += pts;
    reasons.push({ label: 'Desconto anunciado', points: pts, detail: `${discountPct.toFixed(0)}% off` });
  }

  // 3. Comissao em reais (peso 20). Uma oferta boa que nao paga nada nao sobe a fila.
  let commissionBrl: number | null = null;
  if (input.commissionPct) {
    commissionBrl = (input.price * input.commissionPct) / 100;
    const pts = Math.min(20, Math.round(commissionBrl / 2.5));
    score += pts;
    reasons.push({
      label: 'Comissao estimada',
      points: pts,
      detail: `R$ ${commissionBrl.toFixed(2)} (${input.commissionPct}%)`,
    });
  }

  // 4. Reputacao (peso 15). Oferta boa de produto ruim queima o grupo.
  if (input.rating && input.reviewCount) {
    const trust = (input.rating / 5) * Math.min(1, Math.log10(input.reviewCount + 1) / 3);
    const pts = Math.round(trust * 15);
    score += pts;
    reasons.push({
      label: 'Reputacao do produto',
      points: pts,
      detail: `${input.rating.toFixed(1)}★ com ${input.reviewCount} avaliacoes`,
    });
  }

  // 5. Fadiga (peso -25). Repetir o mesmo produto na semana esvazia o grupo.
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await prisma.offer.count({
    where: { productId: input.productId, status: 'SENT', sentAt: { gte: week } },
  });
  if (recent > 0) {
    const pts = Math.min(25, recent * 15);
    score -= pts;
    reasons.push({ label: 'Ja postado esta semana', points: -pts, detail: `${recent}x nos ultimos 7 dias` });
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    discountPct: discountPct === null ? null : Number(discountPct.toFixed(2)),
    commissionBrl: commissionBrl === null ? null : Number(commissionBrl.toFixed(2)),
    reasons,
  };
}

/** Menor preco ja registrado, usado no texto da mensagem. */
export async function lowestPrice(productId: string, days = 90): Promise<number | null> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const row = await prisma.priceSnapshot.findFirst({
    where: { productId, takenAt: { gte: since } },
    orderBy: { price: 'asc' },
    select: { price: true },
  });
  return num(row?.price);
}
