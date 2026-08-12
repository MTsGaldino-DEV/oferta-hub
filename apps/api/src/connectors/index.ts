import { Platform } from '@prisma/client';
import { aliexpress } from './aliexpress.js';
import { amazon } from './amazon.js';
import { awin } from './awin.js';
import { lomadee } from './lomadee.js';
import { mercadoLivre } from './mercadolivre.js';
import { shopee } from './shopee.js';
import type { Connector } from './types.js';

export const connectors: Record<Platform, Connector> = {
  [Platform.AMAZON]: amazon,
  [Platform.MERCADO_LIVRE]: mercadoLivre,
  [Platform.SHOPEE]: shopee,
  [Platform.ALIEXPRESS]: aliexpress,
  [Platform.AWIN]: awin,
  [Platform.LOMADEE]: lomadee,
};

export const connectorList = Object.values(connectors);

/** Descobre a plataforma a partir de uma URL colada no dashboard. */
export function detectPlatform(url: string): Connector | null {
  try {
    return connectorList.find((c) => c.matches(url)) ?? null;
  } catch {
    return null;
  }
}

export * from './types.js';
export { loadCredentials, saveCredentials, invalidateCache } from './credentials.js';
