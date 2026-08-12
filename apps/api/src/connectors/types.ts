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
  available: boolean;
  couponCode?: string;
}

export interface SearchParams {
  keyword: string;
  maxPrice?: number;
  minDiscount?: number;
  limit?: number;
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
  /** Transforma a URL limpa em link de afiliado rastreado. */
  buildAffiliateLink(url: string, productId?: string): Promise<string>;
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
