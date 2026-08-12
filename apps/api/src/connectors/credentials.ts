import type { Platform } from '@prisma/client';
import { prisma } from '../db.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { MissingCredentialsError } from './types.js';

type Bag = Record<string, string>;

const cache = new Map<Platform, { value: Bag; at: number }>();
const TTL_MS = 60_000;

export async function loadCredentials(platform: Platform): Promise<Bag> {
  const hit = cache.get(platform);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const row = await prisma.credential.findUnique({ where: { platform } });
  if (!row || !row.active) throw new MissingCredentialsError(platform);

  const value = JSON.parse(decrypt(row.payload)) as Bag;
  cache.set(platform, { value, at: Date.now() });
  return value;
}

export async function saveCredentials(platform: Platform, bag: Bag, label?: string) {
  cache.delete(platform);
  const payload = encrypt(JSON.stringify(bag));
  return prisma.credential.upsert({
    where: { platform },
    create: { platform, payload, label, active: true },
    update: { payload, label, active: true, lastError: null },
  });
}

/** Alguns tokens (Mercado Livre) expiram em horas e precisam ser regravados. */
export async function patchCredentials(platform: Platform, patch: Bag) {
  const current = await loadCredentials(platform).catch(() => ({}) as Bag);
  return saveCredentials(platform, { ...current, ...patch });
}

export function invalidateCache(platform?: Platform) {
  if (platform) cache.delete(platform);
  else cache.clear();
}
