/**
 * Log compartilhado da extensao, guardado no chrome.storage.local.
 *
 * Pagina do ML, service worker e painel lateral sao tres contextos
 * separados -- nenhum ve o console dos outros. Sem um lugar comum, depurar
 * significa abrir o DevTools de cada um na mao. O storage.local e visto por
 * todo mundo (inclusive o painel, que pode estar fechado quando o log
 * acontece), entao vira o quadro unico "o que a extensao andou fazendo".
 */

const CHAVE = 'logs';
const MAXIMO = 300;

export async function registrarLog(origem, nivel, texto) {
  try {
    const { [CHAVE]: logs = [] } = await chrome.storage.local.get(CHAVE);
    logs.push({ ts: Date.now(), origem, nivel, texto: String(texto) });
    if (logs.length > MAXIMO) logs.splice(0, logs.length - MAXIMO);
    await chrome.storage.local.set({ [CHAVE]: logs });
  } catch {
    // Sem storage disponivel o log so nao aparece no painel -- nao vale
    // quebrar quem chamou por causa disso.
  }
}

export async function lerLogs() {
  const { [CHAVE]: logs = [] } = await chrome.storage.local.get(CHAVE);
  return logs;
}

export async function limparLogs() {
  await chrome.storage.local.set({ [CHAVE]: [] });
}
