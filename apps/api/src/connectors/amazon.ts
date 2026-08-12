import crypto from 'node:crypto';
import { Platform } from '@prisma/client';
import { loadCredentials } from './credentials.js';
import type { Connector, NormalizedProduct, SearchParams } from './types.js';

/**
 * Amazon Product Advertising API 5.0.
 * ATENCAO: a Amazon so libera a PA-API depois de 3 vendas qualificadas em 180
 * dias, e revoga se voce ficar 30 dias sem vender. Ate la, cadastre as ofertas
 * no modo manual -- o sistema ainda monta o link de afiliado com a sua tag.
 */

const RESOURCES = [
  'ItemInfo.Title',
  'ItemInfo.ByLineInfo',
  'ItemInfo.Classifications',
  'Images.Primary.Large',
  'Offers.Listings.Price',
  'Offers.Listings.SavingBasis',
  'Offers.Listings.Availability.Message',
  'CustomerReviews.StarRating',
  'CustomerReviews.Count',
];

function sign(key: Buffer | string, msg: string) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

/** Assinatura AWS Signature V4 exigida pela PA-API. */
async function callPaapi<T>(operation: 'SearchItems' | 'GetItems', body: object): Promise<T> {
  const c = await loadCredentials(Platform.AMAZON);
  const host = c.host || 'webservices.amazon.com.br';
  const region = c.region || 'us-east-1';
  const service = 'ProductAdvertisingAPI';
  const path = `/paapi5/${operation.toLowerCase()}`;
  const target = `com.amazon.paapi5.v1.ProductAdvertisingAPIv1.${operation}`;

  const payload = JSON.stringify({ ...body, PartnerTag: c.partnerTag, PartnerType: 'Associates', Marketplace: `www.${host.replace('webservices.', '')}` });
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders =
    `content-encoding:amz-1.0\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`;
  const signedHeaders = 'content-encoding;host;x-amz-date;x-amz-target';
  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = sign(sign(sign(sign(`AWS4${c.secretKey}`, dateStamp), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  const res = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'amz-1.0',
      'x-amz-date': amzDate,
      'x-amz-target': target,
      Authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: payload,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`PA-API ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

function normalize(item: any): NormalizedProduct {
  const listing = item.Offers?.Listings?.[0];
  const price = listing?.Price?.Amount;
  const listPrice = listing?.SavingBasis?.Amount;
  return {
    platform: Platform.AMAZON,
    externalId: item.ASIN,
    title: item.ItemInfo?.Title?.DisplayValue ?? 'Sem titulo',
    imageUrl: item.Images?.Primary?.Large?.URL,
    canonicalUrl: `${item.DetailPageURL ?? `https://www.amazon.com.br/dp/${item.ASIN}`}`,
    brand: item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue,
    category: item.ItemInfo?.Classifications?.ProductGroup?.DisplayValue,
    price: typeof price === 'number' ? price : undefined,
    listPrice: typeof listPrice === 'number' ? listPrice : undefined,
    rating: item.CustomerReviews?.StarRating?.Value,
    reviewCount: item.CustomerReviews?.Count,
    available: Boolean(listing),
  };
}

export const amazon: Connector = {
  platform: Platform.AMAZON,
  label: 'Amazon Associados',
  fields: [
    { name: 'accessKey', label: 'Access Key', secret: true, help: 'Painel PA-API > Credenciais' },
    { name: 'secretKey', label: 'Secret Key', secret: true },
    { name: 'partnerTag', label: 'Tag de afiliado', secret: false, help: 'Ex: seugrupo-20' },
    { name: 'host', label: 'Host', secret: false, help: 'webservices.amazon.com.br' },
    { name: 'region', label: 'Regiao', secret: false, help: 'us-east-1' },
  ],

  matches: (url) => /(^|\.)(amazon\.com\.br|amzn\.to)/i.test(new URL(url).hostname),

  parseId(url) {
    const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  },

  async getProduct(id) {
    const data = await callPaapi<any>('GetItems', { ItemIds: [id], Resources: RESOURCES });
    const item = data.ItemsResult?.Items?.[0];
    return item ? normalize(item) : null;
  },

  async search({ keyword, maxPrice, limit = 10 }) {
    const data = await callPaapi<any>('SearchItems', {
      Keywords: keyword,
      ItemCount: Math.min(limit, 10),
      Resources: RESOURCES,
      ...(maxPrice ? { MaxPrice: Math.round(maxPrice * 100) } : {}),
    });
    return (data.SearchResult?.Items ?? []).map((i: any) => normalize(i));
  },

  async buildAffiliateLink(url) {
    const c = await loadCredentials(Platform.AMAZON);
    const u = new URL(url);
    u.searchParams.set('tag', c.partnerTag);
    // linkCode/ref_ ajudam a Amazon a atribuir a origem do trafego.
    u.searchParams.set('linkCode', 'ogi');
    return u.toString();
  },

  async testCredentials() {
    await callPaapi('SearchItems', { Keywords: 'teste', ItemCount: 1, Resources: ['ItemInfo.Title'] });
  },
};
