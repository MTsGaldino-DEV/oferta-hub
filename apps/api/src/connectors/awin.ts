import { Platform } from '@prisma/client';
import { request } from '../lib/http.js';
import { loadCredentials } from './credentials.js';
import type { Connector, NormalizedProduct } from './types.js';

/**
 * Awin. A API publica cobre anunciantes, relatorios e transacoes -- nao tem
 * busca de produto. Por isso o conector serve principalmente para:
 *   1. montar deep links rastreados de qualquer loja da rede;
 *   2. importar as vendas confirmadas para o dashboard.
 * A busca de produto exige o Product Feed (arquivo CSV/gz), fora do escopo aqui.
 */
const BASE = 'https://api.awin.com';

async function api<T>(path: string): Promise<T> {
  const c = await loadCredentials(Platform.AWIN);
  return request<T>(`${BASE}${path}`, { headers: { Authorization: `Bearer ${c.apiToken}` } });
}

export const awin: Connector = {
  platform: Platform.AWIN,
  label: 'Awin',
  fields: [
    { name: 'apiToken', label: 'API Token', secret: true, help: 'Awin > Conta > Credenciais API' },
    { name: 'publisherId', label: 'Publisher ID', secret: false },
  ],

  matches: (url) => /awin1\.com|\.awin\./i.test(url),
  parseId: () => null,

  async getProduct() {
    return null;
  },

  async search() {
    // Sem endpoint de busca. O garimpo automatico ignora a Awin.
    return [] as NormalizedProduct[];
  },

  async buildAffiliateLink(url) {
    const c = await loadCredentials(Platform.AWIN);
    const advertiserId = c.advertiserId || '';
    return `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${c.publisherId}&clickref=ofertahub&ued=${encodeURIComponent(url)}`;
  },

  async testCredentials() {
    const c = await loadCredentials(Platform.AWIN);
    await api(`/publishers/${c.publisherId}/programmes?relationship=joined`);
  },

  async fetchConversions(since) {
    const c = await loadCredentials(Platform.AWIN);
    const fmt = (d: Date) => d.toISOString().slice(0, 19);
    const data = await api<any[]>(
      `/publishers/${c.publisherId}/transactions/?startDate=${fmt(since)}&endDate=${fmt(new Date())}&timezone=UTC&dateType=transaction`,
    );
    return (data ?? []).map((t) => ({
      externalId: String(t.id),
      orderValue: Number(t.saleAmount?.amount ?? 0),
      commissionBrl: Number(t.commissionAmount?.amount ?? 0),
      status: String(t.commissionStatus ?? 'pending').toLowerCase(),
      occurredAt: new Date(t.transactionDate),
      clickRef: t.clickRefs?.clickRef ?? undefined,
    }));
  },
};
