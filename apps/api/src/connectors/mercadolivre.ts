import { Platform } from '@prisma/client';
import { request } from '../lib/http.js';
import { loadCredentials, patchCredentials } from './credentials.js';
import { exigeKeyword } from './types.js';
import type { Connector, NormalizedProduct } from './types.js';

/**
 * Mercado Livre. O access_token vale 6 horas, entao renovamos sozinhos usando
 * o refresh_token e regravamos criptografado no banco.
 * O refresh_token e de uso unico: cada renovacao devolve um novo.
 */
const SITE = 'MLB';

async function accessToken(): Promise<string> {
  const c = await loadCredentials(Platform.MERCADO_LIVRE);
  const expiresAt = Number(c.expiresAt ?? 0);
  if (c.accessToken && Date.now() < expiresAt - 60_000) return c.accessToken;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: c.refreshToken,
  });

  const data = await request<{ access_token: string; refresh_token: string; expires_in: number }>(
    'https://api.mercadolibre.com/oauth/token',
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
  );

  await patchCredentials(Platform.MERCADO_LIVRE, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: String(Date.now() + data.expires_in * 1000),
  });
  return data.access_token;
}

async function api<T>(path: string): Promise<T> {
  const token = await accessToken();
  return request<T>(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function normalize(item: any): NormalizedProduct {
  return {
    platform: Platform.MERCADO_LIVRE,
    externalId: item.id,
    title: item.title,
    imageUrl: item.thumbnail?.replace(/-I\.jpg$/, '-O.jpg') ?? item.pictures?.[0]?.secure_url,
    canonicalUrl: item.permalink,
    category: item.category_id,
    brand: item.attributes?.find((a: any) => a.id === 'BRAND')?.value_name,
    price: item.price,
    listPrice: item.original_price ?? undefined,
    available: item.status === 'active' && (item.available_quantity ?? 1) > 0,
  };
}

export const mercadoLivre: Connector = {
  platform: Platform.MERCADO_LIVRE,
  label: 'Mercado Livre',
  fields: [
    { name: 'clientId', label: 'Client ID', secret: false, help: 'App em developers.mercadolivre.com.br' },
    { name: 'clientSecret', label: 'Client Secret', secret: true },
    { name: 'refreshToken', label: 'Refresh Token', secret: true, help: 'Gerado no fluxo OAuth' },
    { name: 'affiliateTag', label: 'Tag de afiliado', secret: false, help: 'Seu identificador no programa' },
  ],

  // meli.la e o encurtador do proprio programa de afiliados do ML.
  matches: (url) => /mercadolivre\.com\.br|mercadolibre\.com|produto\.mercadolivre|meli\.la/i.test(url),

  /**
   * Aceita tanto URL quanto o HTML de uma pagina: o link meli.la cai numa
   * pagina "social" cujo endereco nao tem o codigo -- ele so aparece no corpo.
   */
  parseId(url) {
    const m = url.match(/(MLB)-?(\d{6,})/i);
    return m ? `${m[1].toUpperCase()}${m[2]}` : null;
  },

  async getProduct(id) {
    const item = await api<any>(`/items/${id}`);
    return item?.id ? normalize(item) : null;
  },

  async search({ keyword, maxPrice, limit = 20 }) {
    const termo = exigeKeyword(keyword, 'Mercado Livre');
    const params = new URLSearchParams({ q: termo, limit: String(limit) });
    if (maxPrice) params.set('price', `*-${maxPrice}`);
    const data = await api<any>(`/sites/${SITE}/search?${params}`);
    return (data.results ?? []).map(normalize);
  },

  async buildAffiliateLink(url) {
    const c = await loadCredentials(Platform.MERCADO_LIVRE);
    const u = new URL(url);
    // O ML atribui a venda pelos parametros matt_*. Se voce usar o gerador de
    // links curtos (mercadolivre.com/sec/...), cole o link ja encurtado no
    // campo manual -- o sistema respeita links /sec/ e nao mexe neles.
    u.searchParams.set('matt_tool', c.affiliateTag || '');
    u.searchParams.set('matt_word', 'ofertahub');
    return u.toString();
  },

  async testCredentials() {
    await api('/users/me');
  },
};
