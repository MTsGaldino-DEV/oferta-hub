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

/** Encurtadores das proprias lojas. O link colado vem quase sempre num destes. */
const ENCURTADORES = /^(s\.shopee\.com\.br|shp\.ee|meli\.la|mercadolivre\.com\/sec|amzn\.to|a\.co)/i;

export const isShortUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return ENCURTADORES.test(u.host) || ENCURTADORES.test(u.host + u.pathname);
  } catch {
    return false;
  }
};

/**
 * Abre um link curto de loja e devolve para onde ele aponta, junto com o HTML.
 *
 * Precisa de User-Agent de navegador: o meli.la responde 403 sem ele. E o HTML
 * vem junto porque o ML encurtado cai numa pagina "social" cujo endereco nao
 * tem o codigo do produto -- ele so aparece no corpo da pagina.
 */
export async function resolveShortUrl(url: string): Promise<{ finalUrl: string; html: string }> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'accept-language': 'pt-BR,pt;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  });
  return { finalUrl: res.url, html: res.status === 200 ? await res.text() : '' };
}
