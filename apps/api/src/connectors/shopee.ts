import crypto from 'node:crypto';
import { Platform } from '@prisma/client';
import { request } from '../lib/http.js';
import { loadCredentials } from './credentials.js';
import type { Connector, NormalizedProduct } from './types.js';

/**
 * Shopee Affiliate Open API (GraphQL).
 * A assinatura e SHA256 de appId + timestamp + payload + secret, enviada no
 * header Authorization. Timestamp fora de 5 min da erro de assinatura.
 */
const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const c = await loadCredentials(Platform.SHOPEE);
  const payload = JSON.stringify({ query, variables });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash('sha256')
    .update(`${c.appId}${timestamp}${payload}${c.secret}`)
    .digest('hex');

  const data = await request<{ data: T; errors?: { message: string }[] }>(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `SHA256 Credential=${c.appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body: payload,
  });

  if (data.errors?.length) throw new Error(`Shopee: ${data.errors[0].message}`);
  return data.data;
}

function normalize(node: any): NormalizedProduct {
  const price = Number(node.price ?? node.priceMin ?? 0);
  const listPrice = node.priceDiscountRate ? price / (1 - node.priceDiscountRate / 100) : undefined;
  return {
    platform: Platform.SHOPEE,
    externalId: `${node.shopId}_${node.itemId}`,
    title: node.productName,
    imageUrl: node.imageUrl,
    canonicalUrl: node.productLink,
    category: node.productCatIds?.join('/'),
    price,
    listPrice: listPrice ? Number(listPrice.toFixed(2)) : undefined,
    commissionPct: node.commissionRate ? Number(node.commissionRate) * 100 : undefined,
    rating: node.ratingStar ? Number(node.ratingStar) : undefined,
    reviewCount: node.sales,
    available: true,
  };
}

const PRODUCT_FIELDS = `
  itemId shopId productName imageUrl productLink offerLink price priceMin
  priceDiscountRate commissionRate ratingStar sales productCatIds
`;

export const shopee: Connector = {
  platform: Platform.SHOPEE,
  label: 'Shopee Afiliados',
  fields: [
    { name: 'appId', label: 'App ID', secret: false, help: 'Painel Shopee Affiliate > Open API' },
    { name: 'secret', label: 'Secret', secret: true },
  ],

  matches: (url) => /shopee\.com\.br|shp\.ee/i.test(url),

  parseId(url) {
    const m = url.match(/i\.(\d+)\.(\d+)/);
    if (m) return `${m[1]}_${m[2]}`;
    const q = url.match(/[?&]itemId=(\d+).*?[?&]shopId=(\d+)/);
    return q ? `${q[2]}_${q[1]}` : null;
  },

  async getProduct(id) {
    const [shopId, itemId] = id.split('_');
    const data = await gql<any>(
      `query ($shopId: Int64!, $itemId: Int64!) {
        productOfferV2(shopId: $shopId, itemId: $itemId) { nodes { ${PRODUCT_FIELDS} } }
      }`,
      { shopId: Number(shopId), itemId: Number(itemId) },
    );
    const node = data.productOfferV2?.nodes?.[0];
    return node ? normalize(node) : null;
  },

  async search({ keyword, limit = 20 }) {
    const data = await gql<any>(
      `query ($keyword: String!, $limit: Int) {
        productOfferV2(keyword: $keyword, limit: $limit, sortType: 3) { nodes { ${PRODUCT_FIELDS} } }
      }`,
      { keyword, limit },
    );
    return (data.productOfferV2?.nodes ?? []).map(normalize);
  },

  async buildAffiliateLink(url) {
    const data = await gql<any>(
      `mutation ($input: GenerateShortLinkInput!) {
        generateShortLink(input: $input) { shortLink }
      }`,
      { input: { originUrl: url, subIds: ['ofertahub'] } },
    );
    return data.generateShortLink?.shortLink ?? url;
  },

  async testCredentials() {
    await gql(`query { shopeeOfferV2(limit: 1) { nodes { commissionRate } } }`);
  },
};
