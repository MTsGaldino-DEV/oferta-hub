import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { prisma } from '../db.js';
import { env } from '../env.js';

const scrypt = promisify(crypto.scrypt) as (senha: string, salt: string, tamanho: number) => Promise<Buffer>;

/** Chave da senha em AppSetting. Enquanto ela nao existe, vale a do .env. */
export const CHAVE_SENHA = 'dashboard_password_hash';

const TAMANHO_HASH = 64;

export async function derivar(senha: string, salt = crypto.randomBytes(16).toString('hex')): Promise<string> {
  const hash = await scrypt(senha, salt, TAMANHO_HASH);
  return `${salt}:${hash.toString('hex')}`;
}

/**
 * Nao lanca: valor corrompido em AppSetting viraria 500 no login, e a saida
 * util nesse caso e "nao confere", nao um erro de servidor.
 */
export async function confere(senha: string, guardado: string): Promise<boolean> {
  const [salt, hex] = guardado.split(':');
  if (!salt || !hex || !/^[0-9a-f]+$/.test(hex)) return false;
  const esperado = Buffer.from(hex, 'hex');
  if (esperado.length !== TAMANHO_HASH) return false;
  const hash = await scrypt(senha, salt, TAMANHO_HASH);
  return crypto.timingSafeEqual(hash, esperado);
}

/**
 * Senha do painel: a do banco quando alguem ja trocou, senao a do .env.
 * Isso e o que deixa instalacao existente continuar entrando sem migracao.
 */
export async function senhaConfere(dada: string): Promise<boolean> {
  const linha = await prisma.appSetting.findUnique({ where: { key: CHAVE_SENHA } });
  if (linha) return confere(dada, linha.value);

  const esperada = env.dashboardPassword;
  // timingSafeEqual explode se os buffers tiverem tamanhos diferentes.
  if (dada.length !== esperada.length) return false;
  return crypto.timingSafeEqual(Buffer.from(dada), Buffer.from(esperada));
}

export async function trocarSenha(nova: string): Promise<void> {
  const value = await derivar(nova);
  await prisma.appSetting.upsert({
    where: { key: CHAVE_SENHA },
    create: { key: CHAVE_SENHA, value },
    update: { value },
  });
}
