import { Platform } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { shopeeGql } from './shopee.js';
import { nomeBr } from './categorias-pt.js';

/**
 * Datafeed de afiliados da Shopee.
 *
 * A API de afiliados nao tem endpoint de categorias -- por isso os nichos
 * viviam chutados no codigo. Mas o datafeed diario traz, em cada linha,
 * `global_catid1/global_category1` e `global_catid2/global_category2`.
 * Varrendo algumas milhares de linhas o catalogo satura: 30 raizes e ~276
 * categorias no total, com nome.
 */

interface Feed {
  datafeedId: string;
  datafeedName: string;
  totalCount: number;
  date: string;
}

/**
 * ATENCAO: o datafeedId carrega a data ("428535457031659520_FULL_2026-08-17")
 * e muda todo dia. Tem que ser lido a cada execucao -- fixar no codigo quebra
 * silenciosamente no dia seguinte.
 */
export async function listFeeds(): Promise<Feed[]> {
  const data = await shopeeGql<any>(
    `{ listItemFeeds(feedMode: FULL) { feeds { datafeedId datafeedName totalCount date } } }`,
  );
  return data.listItemFeeds?.feeds ?? [];
}

interface LinhaFeed {
  global_catid1?: string;
  global_category1?: string;
  global_catid2?: string;
  global_category2?: string;
}

/** Uma pagina do feed, ja com o JSON de cada linha aberto. */
async function paginaFeed(datafeedId: string, offset: number, limit: number): Promise<LinhaFeed[]> {
  const data = await shopeeGql<any>(
    `{ getItemFeedData(datafeedId: "${datafeedId}", offset: ${offset}, limit: ${limit}) {
      rows { columns }
    } }`,
  );
  // `columns` vem como string JSON, nao como lista.
  return (data.getItemFeedData?.rows ?? []).flatMap((r: { columns: string }) => {
    try {
      return [JSON.parse(r.columns) as LinhaFeed];
    } catch {
      return [];
    }
  });
}

export interface CategorySyncSummary {
  feeds: number;
  rows: number;
  categories: number;
  roots: number;
}

/**
 * Colhe o catalogo de categorias e grava em Category.
 *
 * `maxRowsPorFeed` existe porque o feed grande tem 100 mil linhas e o catalogo
 * satura muito antes disso -- na medicao, 6 mil linhas ja tinham achado 270 das
 * 276 categorias. Varrer o feed inteiro so gastaria tempo e cota.
 */
export async function harvestCategories(maxRowsPorFeed = 8000): Promise<CategorySyncSummary> {
  const feeds = await listFeeds();
  if (!feeds.length) throw new Error('A Shopee nao devolveu nenhum datafeed. Confira a credencial em Conexoes.');

  const achadas = new Map<number, { nameEn: string; parentId: number | null; count: number }>();
  let linhas = 0;

  for (const feed of feeds) {
    const teto = Math.min(feed.totalCount, maxRowsPorFeed);
    for (let offset = 0; offset < teto; offset += 500) {
      let rows: LinhaFeed[];
      try {
        rows = await paginaFeed(feed.datafeedId, offset, 500);
      } catch (err) {
        logger.warn({ feed: feed.datafeedId, offset, err: String(err) }, 'pagina do feed falhou');
        break;
      }
      if (!rows.length) break;
      linhas += rows.length;

      for (const row of rows) {
        const raiz = row.global_catid1 ? Number(row.global_catid1) : null;
        if (raiz && row.global_category1) {
          const e = achadas.get(raiz) ?? { nameEn: row.global_category1, parentId: null, count: 0 };
          e.count++;
          achadas.set(raiz, e);
        }
        const filha = row.global_catid2 ? Number(row.global_catid2) : null;
        if (filha && row.global_category2) {
          const e = achadas.get(filha) ?? { nameEn: row.global_category2, parentId: raiz, count: 0 };
          e.count++;
          e.parentId = e.parentId ?? raiz;
          achadas.set(filha, e);
        }
      }
    }
    logger.info({ feed: feed.datafeedName, categorias: achadas.size }, 'feed varrido');
  }

  for (const [externalId, e] of achadas) {
    const dados = {
      parentId: e.parentId,
      nameEn: e.nameEn,
      nameBr: nomeBr(externalId, e.nameEn),
      itemCount: e.count,
    };
    await prisma.category.upsert({
      where: { platform_externalId: { platform: Platform.SHOPEE, externalId } },
      create: { platform: Platform.SHOPEE, externalId, ...dados },
      update: dados,
    });
  }

  const roots = [...achadas.values()].filter((e) => e.parentId === null).length;
  return { feeds: feeds.length, rows: linhas, categories: achadas.size, roots };
}
