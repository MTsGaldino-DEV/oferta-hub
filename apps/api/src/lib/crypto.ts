import crypto from 'node:crypto';
import { env } from '../env.js';

const KEY = Buffer.from(env.masterKey, 'hex');
const ALGO = 'aes-256-gcm';

/**
 * Criptografa as credenciais antes de gravar no banco.
 * Formato: iv:authTag:cipherText (tudo em base64url).
 * Se o MASTER_KEY vazar OU for perdido, as credenciais viram lixo -- guarde-o
 * fora do repositorio e faca backup dele junto com o backup do banco.
 */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString('base64url')).join(':');
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Credencial corrompida no banco.');
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashIp(ip: string): string {
  return crypto.createHmac('sha256', env.sessionSecret).update(ip).digest('hex').slice(0, 32);
}

/** Mostra so o final da chave na tela, pra voce conferir sem expor o valor. */
export function maskSecret(value: string): string {
  if (value.length <= 6) return '••••';
  return '••••' + value.slice(-4);
}
