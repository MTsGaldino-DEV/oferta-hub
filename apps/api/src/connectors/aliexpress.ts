import crypto from 'node:crypto';
import { Platform } from '@prisma/client';
import { request } from '../lib/http.js';
import { loadCredentials } from './credentials.js';
import { exigeKeyword } from './types.js';
import type { Connector, NormalizedProduct } from './types.js';

/**
 * AliExpress Affiliate (Open Platform / sistema TOP).
 * A assinatura e HMAC-SHA256 sobre os parametros ordenados alfabeticamente,
 * concatenados como chave+valor, em MAIUSCULAS.
 */
const ENDPOINT = 'https://api-sg.aliexpress.com/sync';

async function call<T>(method: string, params: Record<string, string>): Promise<T> {
  const c = await loadCredentials(Platform.ALIEXPRESS);
  const all: Record<string, string> = {
    ...params,
    method,
    app_key: c.appKey,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    format: 'json',
    v: '2.0',
  };

  const base = Object.keys(all)
    .sort()
    .map((k) => `${k}${all[k]}`)
    .join('');

  all.sign = crypto.createHmac('sha256', c.appSecret).update(base).digest('hex').toUpperCase();

  const data = await request<any>(`${ENDPOINT}?${new URLSearchParams(all)}`, { method: 'POST' });
  if (data.error_response) {
    throw new Error(`AliExpress: ${data.error_response.msg ?? data.error_response.sub_msg}`);
  }
  return data as T;
}

function normalize(p: any): NormalizedProduct {
  const price = Number(p.target_sale_price ?? p.sale_price ?? 0);
  const listPrice = Number(p.target_original_price ?? p.original_price ?? 0) || undefined;
  return {
    platform: Platform.ALIEXPRESS,
    externalId: String(p.product_id),
    title: p.product_title,
    imageUrl: p.product_main_image_url,
    canonicalUrl: p.product_detail_url,
    category: p.second_level_category_name ?? p.first_level_category_name,
    price,
    listPrice,
    commissionPct: p.commission_rate ? Number(String(p.commission_rate).replace('%', '')) : undefined,
    rating: p.evaluate_rate ? Number(String(p.evaluate_rate).replace('%', '')) / 20 : undefined,
    reviewCount: p.lastest_volume ? Number(p.lastest_volume) : undefined,
    available: true,
  };
}

export const aliexpress: Connector = {
  platform: Platform.ALIEXPRESS,
  label: 'AliExpress Afiliados',
  fields: [
    { name: 'appKey', label: 'App Key', secret: false, help: 'open.aliexpress.com > seu app' },
    { name: 'appSecret', label: 'App Secret', secret: true },
    { name: 'trackingId', label: 'Tracking ID', secret: false, help: 'Ex: default ou o nome do seu canal' },
  ],

  matches: (url) => /aliexpress\.com|s\.click\.aliexpress/i.test(url),

  parseId(url) {
    const m = url.match(/\/item\/(?:[\w-]+\/)?(\d+)\.html/);
    return m ? m[1] : null;
  },

  async getProduct(id) {
    const c = await loadCredentials(Platform.ALIEXPRESS);
    const data = await call<any>('aliexpress.affiliate.productdetail.get', {
      product_ids: id,
      target_currency: 'BRL',
      target_language: 'PT',
      tracking_id: c.trackingId,
    });
    const p = data.aliexpress_affiliate_productdetail_get_response?.resp_result?.result?.products?.product?.[0];
    return p ? normalize(p) : null;
  },

  async search({ keyword, maxPrice, limit = 20 }) {
    const termo = exigeKeyword(keyword, 'AliExpress');
    const c = await loadCredentials(Platform.ALIEXPRESS);
    const data = await call<any>('aliexpress.affiliate.product.query', {
      keywords: termo,
      page_size: String(Math.min(limit, 50)),
      target_currency: 'BRL',
      target_language: 'PT',
      ship_to_country: 'BR',
      sort: 'LAST_VOLUME_DESC',
      tracking_id: c.trackingId,
      ...(maxPrice ? { max_sale_price: String(Math.round(maxPrice * 100)) } : {}),
    });
    const list = data.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product ?? [];
    return list.map(normalize);
  },

  async buildAffiliateLink(url) {
    const c = await loadCredentials(Platform.ALIEXPRESS);
    const data = await call<any>('aliexpress.affiliate.link.generate', {
      promotion_link_type: '0',
      source_values: url,
      tracking_id: c.trackingId,
    });
    const link =
      data.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links
        ?.promotion_link?.[0]?.promotion_link;
    return link ?? url;
  },

  async testCredentials() {
    await this.search({ keyword: 'fone', limit: 1 });
  },
};
