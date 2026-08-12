import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly body?: string) {
    super(message);
  }
}

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

/**
 * fetch com timeout e retry exponencial. As APIs de afiliado limitam e caem
 * com frequencia; sem isso o worker morre no meio da varredura.
 */
export async function request<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, retries = 2, ...init } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();

      if (!res.ok) {
        throw new HttpError(`${res.status} em ${new URL(url).host}`, res.status, text.slice(0, 500));
      }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      const isLast = attempt === retries;
      // 4xx nao adianta repetir (credencial errada, assinatura invalida).
      const noRetry = err instanceof HttpError && err.status < 500 && err.status !== 429;
      if (isLast || noRetry) throw err;
      const backoff = 2 ** attempt * 800;
      logger.warn({ url, attempt, backoff }, 'requisicao falhou, tentando de novo');
      await new Promise((r) => setTimeout(r, backoff));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('inalcancavel');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
