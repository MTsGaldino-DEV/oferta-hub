import type { Platform } from '@prisma/client';

/** Produto normalizado. Toda plataforma converte o formato dela pra este. */
export interface NormalizedProduct {
  platform: Platform;
  externalId: string;
  title: string;
  imageUrl?: string;
  canonicalUrl: string;
  category?: string;
  brand?: string;
  price?: number;
  /** Preco "de", riscado. Cuidado: varias plataformas inflam esse numero. */
  listPrice?: number;
  /** Percentual de comissao do programa, quando a API informa. */
  commissionPct?: number;
  rating?: number;
  reviewCount?: number;
  /** Unidades vendidas. E o filtro que separa "vende" de "esta no catalogo". */
  soldCount?: number;
  /** Nome da loja, quando a API informa. */
  shopName?: string;
  available: boolean;
  couponCode?: string;
}

/**
 * Ordenacao da busca. Mapeada empiricamente contra a API da Shopee -- o valor
 * numerico dela nao e documentado. Ver shopee.ts.
 */
export type SearchSort = 'relevancia' | 'vendas' | 'comissao' | 'menor-preco' | 'desconto';

export interface SearchParams {
  /** Opcional quando ha categoria: o nicho inteiro ja e um recorte valido. */
  keyword?: string;
  /** Nicho na taxonomia da loja. Ver NICHOS_SHOPEE. */
  categoryId?: number;
  maxPrice?: number;
  minDiscount?: number;
  /** Padrao: mais vendidos. E o que separa oferta de vitrine parada. */
  sort?: SearchSort;
  limit?: number;
}

/**
 * So a Shopee expoe nicho na API de afiliados. Nas outras lojas a busca ainda
 * depende de palavra-chave, e uma regra so de nicho nao tem o que consultar.
 */
export function exigeKeyword(keyword: string | undefined, loja: string): string {
  if (!keyword?.trim()) {
    throw new Error(`A busca da ${loja} precisa de palavra-chave: essa loja nao tem filtro por nicho.`);
  }
  return keyword.trim();
}

export interface Connector {
  platform: Platform;
  /** Nome que aparece no dashboard. */
  label: string;
  /** Campos que o formulario de Conexoes deve pedir. */
  fields: { name: string; label: string; secret: boolean; help?: string }[];
  /** Regex que identifica se uma URL colada pertence a esta plataforma. */
  matches(url: string): boolean;
  /** Extrai o ID do produto a partir da URL colada. */
  parseId(url: string): string | null;
  getProduct(id: string): Promise<NormalizedProduct | null>;
  search(params: SearchParams): Promise<NormalizedProduct[]>;
  /**
   * Transforma a URL limpa em link de afiliado rastreado.
   * `subId` e o carimbo que volta no relatorio de vendas da loja e liga a
   * venda a oferta que a gerou -- usamos o codigo do ShortLink.
   */
  buildAffiliateLink(url: string, productId?: string, subId?: string): Promise<string>;
  /** Bate na API so pra validar a credencial na tela de Conexoes. */
  testCredentials(): Promise<void>;
  /** Puxa vendas confirmadas do relatorio da plataforma, quando existir. */
  fetchConversions?(since: Date): Promise<
    {
      externalId: string;
      orderValue: number;
      commissionBrl: number;
      status: string;
      occurredAt: Date;
      clickRef?: string;
    }[]
  >;
}

export class MissingCredentialsError extends Error {
  constructor(platform: Platform) {
    super(`Sem credencial ativa para ${platform}. Cadastre em Conexoes.`);
  }
}
