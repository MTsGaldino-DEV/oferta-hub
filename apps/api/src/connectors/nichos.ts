import { Platform } from '@prisma/client';

/**
 * Nichos = categorias raiz da loja. E o filtro que faz o garimpo virar
 * curadoria: palavra-chave devolve tudo que contem o termo (inclusive
 * equipamento profissional de R$20 mil), enquanto o nicho devolve o que o
 * publico daquela prateleira de fato compra.
 *
 * A Shopee nao expoe listagem de categorias na API de afiliados. Os IDs abaixo
 * foram levantados na mao: buscas por termos de cada nicho, olhando qual
 * categoria raiz se repetia, e conferidos puxando os campeoes de venda de cada
 * um. `pico` e o maior numero de vendas visto num produto do nicho -- serve de
 * termometro do volume da prateleira.
 */
export interface Nicho {
  id: number;
  label: string;
  exemplo: string;
  pico: number;
}

export const NICHOS_SHOPEE: Nicho[] = [
  { id: 100636, label: 'Casa e utilidades', exemplo: 'jogo de lençol, tira-manchas', pico: 78912 },
  { id: 100630, label: 'Beleza e cuidados', exemplo: 'adesivo de acne, sérum', pico: 46629 },
  { id: 100535, label: 'Áudio e fones', exemplo: 'fone TWS bluetooth', pico: 38580 },
  { id: 100631, label: 'Pet', exemplo: 'areia de gato, coleira', pico: 27653 },
  { id: 100017, label: 'Moda', exemplo: 'legging, meias, modeladora', pico: 26022 },
  { id: 100010, label: 'Cozinha e eletroportáteis', exemplo: 'mixer, chaleira elétrica', pico: 24175 },
  { id: 100629, label: 'Alimentos e bebidas', exemplo: 'castanhas, chocolate', pico: 21464 },
  { id: 100632, label: 'Bebê e brinquedos', exemplo: 'mordedor, toalha umedecida', pico: 17033 },
  { id: 100013, label: 'Celulares e acessórios', exemplo: 'capa, carregador, suporte', pico: 16225 },
  { id: 100637, label: 'Esporte e ar livre', exemplo: 'guarda-chuva, bike, lanterna', pico: 12791 },
];

/** Nichos por plataforma. So a Shopee garimpa hoje -- o ML bloqueou a busca. */
export function nichosDe(platform: Platform): Nicho[] {
  return platform === Platform.SHOPEE ? NICHOS_SHOPEE : [];
}
