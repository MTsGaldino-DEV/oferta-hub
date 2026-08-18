const json = { 'content-type': 'application/json' };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`);
  return body as T;
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, data?: unknown) =>
    call<T>(path, { method: 'POST', headers: json, body: JSON.stringify(data ?? {}) }),
  put: <T>(path: string, data: unknown) =>
    call<T>(path, { method: 'PUT', headers: json, body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    call<T>(path, { method: 'PATCH', headers: json, body: JSON.stringify(data) }),
  del: <T>(path: string) => call<T>(path, { method: 'DELETE' }),
};

export const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const int = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR');

export const STORE: Record<string, string> = {
  AMAZON: 'Amazon',
  MERCADO_LIVRE: 'Mercado Livre',
  SHOPEE: 'Shopee',
  ALIEXPRESS: 'AliExpress',
  AWIN: 'Awin',
  LOMADEE: 'Lomadee',
};

export interface Offer {
  id: string;
  status: string;
  source: string;
  score: number;
  scoreReasons: { label: string; points: number; detail: string }[];
  price: number;
  comparePrice: number | null;
  discountPct: number | null;
  commissionBrl: number | null;
  message: string;
  nicheId: string | null;
  nicho: string | null;
  shortCode: string | null;
  clicks: number;
  scheduledFor: string | null;
  sentAt: string | null;
  failReason: string | null;
  createdAt: string;
  product: {
    id: string;
    title: string;
    imageUrl: string | null;
    platform: string;
    canonicalUrl: string;
    rating: number | null;
    reviewCount: number | null;
  };
}
