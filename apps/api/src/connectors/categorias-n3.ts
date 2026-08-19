import { Platform } from '@prisma/client';
import { prisma } from '../db.js';

/**
 * Categorias de nivel 3, levantadas a mao.
 *
 * O datafeed so expoe dois niveis (global_catid1 e 2), mas o
 * `productOfferV2` aceita productCatId de nivel 3 -- testado e confirmado. E
 * ai que moram recortes que o nivel 2 nao alcanca: "cadeira gamer" esta
 * enterrada em Moveis, junto de mesa de cabeceira e puff.
 *
 * Como foram achadas: busca por palavra-chave, olhando o terceiro elemento de
 * `productCatIds` nos resultados. Sem o feed nao ha nome, entao o nome aqui e
 * escrito a mao.
 *
 * `parentId` aponta para a RAIZ, nao para a categoria de nivel 2. E uma
 * simplificacao proposital: o seletor da tela mostra dois niveis, e enfiar um
 * terceiro so pra estas poucas linhas complicaria a arvore inteira.
 */
export interface CategoriaN3 {
  externalId: number;
  raiz: number;
  nameEn: string;
  nameBr: string;
}

export const CATEGORIAS_N3: CategoriaN3[] = [
  // Moveis (100713) -- e aqui que a cadeira gamer se esconde
  { externalId: 101171, raiz: 100636, nameEn: 'Chairs', nameBr: 'Cadeiras e poltronas' },
  { externalId: 101169, raiz: 100636, nameEn: 'Tables & Desks', nameBr: 'Mesas e escrivaninhas' },
  // Perifericos (101940) -- prateleira quase toda de setup
  { externalId: 101996, raiz: 100644, nameEn: 'Mousepads', nameBr: 'Mousepads' },
];

/** Grava as de nivel 3 junto das colhidas do feed. */
export async function seedCategoriasN3(): Promise<number> {
  for (const c of CATEGORIAS_N3) {
    await prisma.category.upsert({
      where: { platform_externalId: { platform: Platform.SHOPEE, externalId: c.externalId } },
      create: {
        platform: Platform.SHOPEE,
        externalId: c.externalId,
        parentId: c.raiz,
        nameEn: c.nameEn,
        nameBr: c.nameBr,
      },
      // itemCount fica de fora: o feed nao conta essas, e zerar seria mentira.
      update: { parentId: c.raiz, nameBr: c.nameBr, nameEn: c.nameEn },
    });
  }
  return CATEGORIAS_N3.length;
}
