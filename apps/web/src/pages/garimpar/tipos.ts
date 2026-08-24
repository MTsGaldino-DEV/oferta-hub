export interface Produto {
  externalId: string;
  platform: string;
  title: string;
  imageUrl: string | null;
  price: number | null;
  listPrice: number | null;
  commissionPct: number | null;
  sellerCommissionPct: number | null;
  commissionBrl: number | null;
  soldCount: number | null;
  rating: number | null;
  shopName: string | null;
}

export interface Resultado {
  categorias: { id: number; nome: string }[];
  bruto: number;
  antesDoFiltro: number;
  produtos: Produto[];
  pageInfo: { page: number; hasNextPage: boolean };
  falhas: { categoryId: number | null; motivo: string }[];
}

export interface Raiz {
  id: number;
  nome: string;
  itens: number;
  filhas: { id: number; nome: string; itens: number }[];
}

export const ORDENS = [
  { valor: 'vendas', rotulo: 'Mais vendidos' },
  { valor: 'relevancia', rotulo: 'Relevância' },
  { valor: 'comissao', rotulo: 'Maior comissão' },
  { valor: 'menor-preco', rotulo: 'Menor preço' },
  { valor: 'desconto', rotulo: 'Maior desconto' },
] as const;

export type Ordem = (typeof ORDENS)[number]['valor'];

export interface Filtros {
  keyword: string;
  categorias: number[];
  sort: Ordem;
  minCommissionPct: string;
  maxPrice: string;
  keySeller: boolean;
}

export const filtrosVazios: Filtros = {
  keyword: '',
  categorias: [],
  sort: 'vendas',
  minCommissionPct: '',
  maxPrice: '',
  keySeller: false,
};

/** Monta a query string, omitindo o que esta vazio. */
export function queryDeBusca(f: Filtros, page: number): string {
  const p = new URLSearchParams();
  if (f.keyword.trim()) p.set('keyword', f.keyword.trim());
  for (const id of f.categorias) p.append('categoryIds', String(id));
  p.set('sort', f.sort);
  if (f.minCommissionPct) p.set('minCommissionPct', f.minCommissionPct);
  if (f.maxPrice) p.set('maxPrice', f.maxPrice);
  if (f.keySeller) p.set('keySeller', 'true');
  p.set('page', String(page));
  return p.toString();
}
