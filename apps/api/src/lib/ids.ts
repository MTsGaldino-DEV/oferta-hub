import crypto from 'node:crypto';

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** Codigo curto sem caracteres ambiguos (0/O, 1/l), pra caber bonito no link. */
export function shortCode(size = 7): string {
  const bytes = crypto.randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
