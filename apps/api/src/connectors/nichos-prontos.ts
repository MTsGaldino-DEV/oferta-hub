import { Platform } from '@prisma/client';

/**
 * Nichos que ja vem montados no sistema.
 *
 * Cada um foi medido contra a API antes de entrar aqui: puxei os 50 mais
 * vendidos de cada categoria candidata e contei quantos sobreviviam ao filtro.
 * Categoria que rendeu quase nada ficou de fora, e esta anotada no fim -- para
 * ninguem tentar "melhorar" o nicho re-adicionando o que ja foi testado.
 */
export interface NichoPronto {
  platform: Platform;
  name: string;
  minSales: number;
  excludeTerms: string[];
  entries: { categoryId: number; requireTerms: string[] }[];
}

export const NICHOS_PRONTOS: NichoPronto[] = [
  {
    platform: Platform.SHOPEE,
    name: 'Gamer e setup',
    // Corta o catalogo parado. Foi o filtro que mais limpou a lista.
    minSales: 100,
    excludeTerms: [
      'lapela',
      'office 20',
      'copa do mundo',
      'figurinha',
      'panini',
      'infantil',
      'automotiv',
      'banheiro',
      'cozinha',
      'para dormir',
      'tv box',
      'smart tv',
    ],
    entries: [
      // --- Prateleiras puras: entram inteiras (46 a 49 de 50 aprovados) ---
      { categoryId: 101941, requireTerms: [] }, // Teclados e mouses
      { categoryId: 101933, requireTerms: [] }, // Monitores
      { categoryId: 100696, requireTerms: [] }, // Acessorios de console
      { categoryId: 100695, requireTerms: [] }, // Consoles
      { categoryId: 101934, requireTerms: [] }, // Componentes de PC

      // --- Prateleiras mistas: so passa o que bater o termo ---
      {
        categoryId: 101940, // Perifericos: metade e apoio de notebook e hub
        requireTerms: ['mousepad', 'mouse pad', 'desk pad', 'gamer', 'rgb', 'headset', 'webcam'],
      },
      {
        categoryId: 100697, // Jogos: vem junto com brinquedo de tabuleiro
        requireTerms: ['game', 'ps4', 'ps5', 'xbox', 'nintendo', 'playstation', 'steam', 'patch'],
      },
      {
        categoryId: 100578, // Fones: 99% TWS generico. So 2 em 50 sao gamer.
        requireTerms: ['gamer', 'gaming', 'headset'],
      },
      {
        categoryId: 100582, // Caixas de som: as RGB servem, o resto nao
        requireTerms: ['gamer', 'rgb'],
      },
    ],
  },
];

/**
 * Testadas e descartadas do nicho gamer, para nao repetir o teste:
 *   100737 Colecionaveis  -> 0 de 50. A prateleira e figurinha da Copa.
 *   100580 Microfones     -> 4 de 50. E microfone de lapela para celular.
 *   101935 Armazenamento  -> 10 de 50. E adaptador USB-C, nao SSD gamer.
 *   101942 Notebooks      -> caros e com pouca venda; nao sustentam grupo.
 *   100713 Moveis         -> 0 de 50. A cadeira gamer nao aparece entre os
 *                            mais vendidos, que sao mesa de cabeceira.
 *   100719 Iluminacao     -> fita LED entra, mas puxa lampada e luz noturna
 *                            junto; o ganho nao pagou o ruido.
 */
