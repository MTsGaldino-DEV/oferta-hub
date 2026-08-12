import { Platform } from '@prisma/client';
import { request } from '../lib/http.js';
import { loadCredentials } from './credentials.js';
import type { Connector, NormalizedProduct } from './types.js';

/**
 * Lomadee (rede do Buscape). Cobre Magalu, Americanas, Casas Bahia e cia --
 * lojas grandes que nao tem API de afiliado propria acessivel.
 */
const BASE = 'https://api.lomadee.com/v3';

async function api<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const c = await loadCredentials(Platform.LOMADEE);
  const query = new URLSearchParams({ sourceId: c.sourceId, ...params });
  return request<T>(`${BASE}/${c.appToken}${path}?${query}`);
}

function normalize(offer: any): NormalizedProduct {
  return {
    platform: Platform.LOMADEE,
    externalId: String(offer.id),
    title: offer.name,
    imageUrl: offer.thumbnail,
    canonicalUrl: offer.link,
    category: offer.category?.name,
    price: Number(offer.price ?? 0),
    listPrice: offer.priceFrom ? Number(offer.priceFrom) : undefined,
    available: true,
  };
}

export const lomadee: Connector = {
  platform: Platform.LOMADEE,
  label: 'Lomadee (Magalu, Americanas...)',
  fields: [
    { name: 'appToken', label: 'App Token', secret: true },
    { name: 'sourceId', label: 'Source ID', secret: false, help: 'Identificador do seu canal' },
  ],

  matches: (url) => /lomadee\.com|redir\.lomadee/i.test(url),
  parseId: (url) => url.match(/\/offer\/(\d+)/)?.[1] ?? null,

  async getProduct(id) {
    const data = await api<any>(`/offer/_id/${id}`);
    const offer = data?.offer?.[0];
    return offer ? normalize(offer) : null;
  },

  async search({ keyword, maxPrice, limit = 20 }) {
    const data = await api<any>('/offer/_search', {
      keyword,
      size: String(limit),
      sort: 'price',
      ...(maxPrice ? { priceMax: String(maxPrice) } : {}),
    });
    return (data?.offers ?? []).map(normalize);
  },

  async buildAffiliateLink(url) {
    // A Lomadee ja devolve o link rastreado dentro da oferta.
    return url;
  },

  async testCredentials() {
    await api('/category/_all');
  },
};
