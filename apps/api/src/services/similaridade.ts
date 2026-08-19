/**
 * Agrupa anuncios que sao o mesmo produto.
 *
 * A Shopee tem dezenas de vendedores anunciando o mesmo item, e o dedup por
 * externalId nao pega nada disso -- sao anuncios diferentes. Na fila isso
 * aparecia como seis "Pen Drives Cruzer Lamina" e quatro "Mini Game Retro
 * Nintendo 400 Jogos" seguidos.
 */

/** Tira acento e caixa: "Retro" e "Retrô" tem que casar. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Palavras que aparecem em qualquer titulo de marketplace e nao distinguem
 * produto nenhum. Deixar elas dentro inflava a semelhanca entre coisas
 * diferentes.
 */
const VAZIAS = new Set([
  'de', 'da', 'do', 'com', 'para', 'em', 'no', 'na', 'por', 'pra', 'um', 'uma',
  'dos', 'das', 'ou', 'the', 'os', 'as', 'pcs', 'sem', 'fio', 'novo', 'nova',
]);

/** Conjunto de palavras significativas do titulo. */
export function palavras(titulo: string): string[] {
  return [
    ...new Set(
      normalizar(titulo)
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((p) => p.length > 2 && !VAZIAS.has(p)),
    ),
  ];
}

/**
 * Coeficiente de contencao, nao Jaccard: divide pelo MENOR dos dois conjuntos.
 *
 * Vendedor de marketplace enche o titulo de palavra-chave ("Memory Stick
 * PenDrive Flash Drive"), entao o mesmo produto aparece com titulos de tamanhos
 * bem diferentes. Jaccard pune isso pela uniao e deixa o par passar; contencao
 * enxerga que o titulo curto esta inteiro dentro do longo.
 */
export function semelhanca(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const outro = new Set(b);
  let comuns = 0;
  for (const p of a) if (outro.has(p)) comuns++;
  return comuns / Math.min(a.length, b.length);
}

/**
 * 0.7 foi medido contra a fila real. Abaixo disso comeca a juntar produto
 * diferente: em 0.5 "Lampada Bluetooth Caixa de Som RGB 12W" (R$19) caiu no
 * mesmo grupo que "Caixa de Som Karaoke 50W" (R$116), e os joysticks de
 * PlayStation, Switch e universal viraram um so.
 */
export const LIMIAR_PADRAO = 0.7;

export interface Agrupavel {
  title: string;
  price?: number;
}

/**
 * Devolve um representante por grupo -- o mais barato, que e o que o grupo
 * quer ver -- junto de quantos anuncios ele resumiu.
 */
export function agruparSimilares<T extends Agrupavel>(
  itens: T[],
  limiar = LIMIAR_PADRAO,
): { escolhido: T; repetidos: T[] }[] {
  // Do mais barato pro mais caro: o primeiro de cada grupo vira o representante.
  const ordenados = [...itens].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const grupos: { chave: string[]; escolhido: T; repetidos: T[] }[] = [];

  for (const item of ordenados) {
    const chave = palavras(item.title);
    const grupo = grupos.find((g) => semelhanca(chave, g.chave) >= limiar);
    if (grupo) grupo.repetidos.push(item);
    else grupos.push({ chave, escolhido: item, repetidos: [] });
  }

  return grupos.map(({ escolhido, repetidos }) => ({ escolhido, repetidos }));
}
