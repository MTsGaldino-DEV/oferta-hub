import crypto from 'node:crypto';
import { Platform } from '@prisma/client';
import { request } from '../lib/http.js';
import { loadCredentials } from './credentials.js';
import type { Connector, NormalizedProduct, SearchSort } from './types.js';

/**
 * Shopee Affiliate Open API (GraphQL).
 * A assinatura e SHA256 de appId + timestamp + payload + secret, enviada no
 * header Authorization. Timestamp fora de 5 min da erro de assinatura.
 */
const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

export async function shopeeGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
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

/** Apelido curto para o uso interno deste arquivo. */
const gql = shopeeGql;

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
    // A Shopee manda comissao como fracao (0.53 = 53%), mesma escala de
    // commissionRate -- por isso os dois multiplicam por 100 aqui.
    sellerCommissionPct:
      node.sellerCommissionRate !== undefined && node.sellerCommissionRate !== null
        ? Number(node.sellerCommissionRate) * 100
        : undefined,
    commissionBrl: node.commission !== undefined && node.commission !== null ? Number(node.commission) : undefined,
    shopType: node.shopType !== undefined && node.shopType !== null ? Number(node.shopType) : undefined,
    rating: node.ratingStar ? Number(node.ratingStar) : undefined,
    // A Shopee nao expoe numero de avaliacoes, so de vendas. Mantemos o valor
    // tambem em reviewCount porque a nota de reputacao ainda le esse campo --
    // trocar isso mudaria a ordem da fila e nao e assunto desta fase.
    reviewCount: node.sales,
    soldCount: node.sales ? Number(node.sales) : undefined,
    shopName: node.shopName ?? undefined,
    available: true,
  };
}

const PRODUCT_FIELDS = `
  itemId shopId productName imageUrl productLink offerLink price priceMin
  priceDiscountRate commissionRate ratingStar sales productCatIds
  sellerCommissionRate commission shopType
`;

/**
 * sortType da Shopee, levantado na mao contra a API -- eles nao documentam.
 *   1 e 6 = relevancia (padrao)
 *   2     = mais vendidos
 *   3     = preco DEcrescente  <- era o padrao antigo, e por isso a busca
 *                                 devolvia fone de R$21 mil com zero vendas
 *   4     = preco crescente
 *   5     = maior comissao (aparecem itens em 83%)
 */
const SORT_TYPE: Record<SearchSort, number> = {
  relevancia: 1,
  vendas: 2,
  'menor-preco': 4,
  comissao: 5,
  desconto: 2, // sem sort nativo: puxa por vendas e reordena no cliente
};

/** Desconto anunciado, usado so para reordenar. */
function descontoPct(p: NormalizedProduct): number {
  if (!p.listPrice || !p.price || p.listPrice <= p.price) return 0;
  return ((p.listPrice - p.price) / p.listPrice) * 100;
}

export const shopee: Connector = {
  platform: Platform.SHOPEE,
  label: 'Shopee Afiliados',
  fields: [
    { name: 'appId', label: 'App ID', secret: false, help: 'Painel Shopee Affiliate > Open API' },
    { name: 'secret', label: 'Secret', secret: true },
  ],

  matches: (url) => /shopee\.com\.br|shp\.ee/i.test(url),

  parseId(url) {
    // Formato classico: /i.<shopId>.<itemId>
    const m = url.match(/i\.(\d+)\.(\d+)/);
    if (m) return `${m[1]}_${m[2]}`;

    const q = url.match(/[?&]itemId=(\d+).*?[?&]shopId=(\d+)/);
    if (q) return `${q[2]}_${q[1]}`;

    // Formato atual, pra onde os links s.shopee.com.br resolvem:
    // /<nome-da-loja>/<shopId>/<itemId>
    const novo = url.match(/shopee\.com\.br\/[^/?#]+\/(\d{6,})\/(\d{6,})/);
    return novo ? `${novo[1]}_${novo[2]}` : null;
  },

  async getProduct(id) {
    const [shopId, itemId] = id.split('_');
    const data = await gql<any>(
      `query ($shopId: Int64!, $itemId: Int64!) {
        productOfferV2(shopId: $shopId, itemId: $itemId) { nodes { ${PRODUCT_FIELDS} } }
      }`,
      // Int64 da Shopee so aceita string: itemId passa de 2^31 e como numero
      // o servidor responde "wrong type".
      { shopId: String(shopId), itemId: String(itemId) },
    );
    const node = data.productOfferV2?.nodes?.[0];
    return node ? normalize(node) : null;
  },

  /**
   * A API nao aceita filtro de preco -- so listType/sortType/categoria -- entao
   * o teto de maxPrice e aplicado aqui, sobre um lote maior que o pedido pra
   * sobrar resultado depois do corte.
   */
  async searchPage({
    keyword,
    categoryId,
    maxPrice,
    minCommissionPct,
    keySeller,
    sort = 'vendas',
    limit = 20,
    page = 1,
  }) {
    if (!keyword && !categoryId) throw new Error('Informe um nicho ou uma palavra-chave.');

    // Com teto de preco ou piso de comissao pede lote maior pra sobrar
    // resultado depois do corte. 50 e o maximo que a Shopee aceita por pagina.
    const cortaNoCliente = Boolean(maxPrice || minCommissionPct);
    const lote = Math.min(cortaNoCliente ? limit * 3 : limit, 50);

    const filtros = [
      categoryId ? `productCatId: ${categoryId}` : '',
      keyword ? `keyword: $keyword` : '',
      keySeller ? `isKeySeller: true` : '',
      `sortType: ${SORT_TYPE[sort]}`,
      `page: $page`,
      `limit: $limit`,
    ]
      .filter(Boolean)
      .join(', ');

    const data = await gql<any>(
      `query (${keyword ? '$keyword: String!, ' : ''}$limit: Int, $page: Int) {
        productOfferV2(${filtros}) {
          nodes { ${PRODUCT_FIELDS} }
          pageInfo { hasNextPage }
        }
      }`,
      keyword ? { keyword, limit: lote, page } : { limit: lote, page },
    );

    let produtos: NormalizedProduct[] = (data.productOfferV2?.nodes ?? []).map(normalize);
    // Contagem antes dos filtros de preco/comissao, pra tela distinguir "a
    // Shopee nao devolveu nada" de "devolveu, mas o filtro cortou tudo".
    const antesDoFiltro = produtos.length;

    if (maxPrice) {
      produtos = produtos.filter((p) => p.price !== undefined && p.price <= maxPrice);
    }
    if (minCommissionPct) {
      // Sem o campo o produto nao prova que atinge o piso, entao fica fora.
      produtos = produtos.filter(
        (p) => p.sellerCommissionPct !== undefined && p.sellerCommissionPct >= minCommissionPct,
      );
    }

    // A API nao tem ordenacao por desconto. Puxamos por vendas e reordenamos
    // aqui -- ordenar so por desconto traria o catalogo parado com "de/por" inflado.
    if (sort === 'desconto') {
      produtos.sort((a, b) => descontoPct(b) - descontoPct(a));
    }

    return {
      produtos: produtos.slice(0, limit),
      hasNextPage: Boolean(data.productOfferV2?.pageInfo?.hasNextPage),
      antesDoFiltro,
    };
  },

  async search(params) {
    const { produtos } = await this.searchPage!(params);
    return produtos;
  },

  /**
   * O subId volta como `utmContent` no relatorio de conversao -- e por ele que
   * a venda e amarrada a oferta exata que a gerou.
   */
  async buildAffiliateLink(url, _productId, subId) {
    const data = await gql<any>(
      // O tipo do input ja se chamou GenerateShortLinkInput; a Shopee renomeou
      // para ShortLinkInput. Confirmado por introspeccao do schema deles.
      `mutation ($input: ShortLinkInput!) {
        generateShortLink(input: $input) { shortLink }
      }`,
      { input: { originUrl: url, subIds: [subId ?? 'ofertahub'] } },
    );
    return data.generateShortLink?.shortLink ?? url;
  },

  /**
   * Vendas confirmadas direto do painel de afiliado. Substitui a contagem de
   * cliques que se perdeu quando a mensagem passou a levar o link da propria
   * loja: aqui vem dinheiro de verdade, nao clique.
   */
  async fetchConversions(since: Date) {
    const inicio = Math.floor(since.getTime() / 1000);
    const fim = Math.floor(Date.now() / 1000);
    const saida: {
      externalId: string;
      orderValue: number;
      commissionBrl: number;
      status: string;
      occurredAt: Date;
      clickRef?: string;
    }[] = [];

    let scrollId: string | null = null;
    // Pagina ate acabar; o teto de 50 por pagina vale aqui tambem.
    for (let pagina = 0; pagina < 20; pagina++) {
      const cursor: string = scrollId ? `, scrollId: "${scrollId}"` : '';
      const data = await gql<any>(`query {
        conversionReport(purchaseTimeStart: ${inicio}, purchaseTimeEnd: ${fim}, limit: 50${cursor}) {
          nodes {
            conversionId purchaseTime conversionStatus totalCommission utmContent
            orders { orderId items { actualAmount itemPrice qty } }
          }
          pageInfo { hasNextPage scrollId }
        }
      }`);

      const report = data.conversionReport;
      for (const n of report?.nodes ?? []) {
        const itens = (n.orders ?? []).flatMap((o: any) => o.items ?? []);
        const valor = itens.reduce(
          (soma: number, i: any) => soma + (Number(i.actualAmount) || Number(i.itemPrice) * (i.qty ?? 1) || 0),
          0,
        );
        saida.push({
          externalId: String(n.conversionId),
          orderValue: Number(valor.toFixed(2)),
          commissionBrl: Number(n.totalCommission ?? 0),
          status: String(n.conversionStatus ?? 'PENDING'),
          occurredAt: new Date(Number(n.purchaseTime) * 1000),
          clickRef: n.utmContent || undefined,
        });
      }

      if (!report?.pageInfo?.hasNextPage) break;
      scrollId = report.pageInfo.scrollId;
    }

    return saida;
  },

  async testCredentials() {
    await gql(`query { shopeeOfferV2(limit: 1) { nodes { commissionRate } } }`);
  },
};
