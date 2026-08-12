import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
});

/// Prisma devolve Decimal; o dashboard quer number. Este helper faz a ponte.
export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value.toString());
}
