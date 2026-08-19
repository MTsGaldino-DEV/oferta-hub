/**
 * Service worker: gera o link de afiliado no Mercado Livre e entrega os
 * produtos ao Hub Ofertas.
 *
 * O passo do link e o que da valor a extensao. O programa de afiliados do ML
 * nao expoe API publica, mas o proprio painel usa endpoints internos que
 * respondem para a SESSAO do navegador. Sem esse link o produto ate entra na
 * fila, mas com uma URL de matt_tool montada na mao -- que pode nao atribuir
 * comissao nenhuma.
 */

const ML = 'https://www.mercadolivre.com.br';
const API_AFILIADOS = '/affiliate-program/api/v2/stripe/user';

const PADRAO = { apiUrl: 'http://localhost:3333', token: '' };

async function config() {
  const salvo = await chrome.storage.sync.get(PADRAO);
  return { ...PADRAO, ...salvo, apiUrl: String(salvo.apiUrl || PADRAO.apiUrl).replace(/\/$/, '') };
}

// ---------------------------------------------------------------------------
// link de afiliado
// ---------------------------------------------------------------------------

/**
 * Roda DENTRO da pagina (world MAIN) para que o fetch leve os cookies da
 * sessao do ML. De fora, no mundo isolado da extensao, a chamada volta 401.
 */
function gerarLinkNaPagina(urls, base, api) {
  function csrf() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.getAttribute('content');
    const cookie = document.cookie.match(/_csrf=([^;]+)/);
    return cookie ? cookie[1] : null;
  }

  return (async () => {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    const t = csrf();
    if (t) headers['x-csrf-token'] = t;

    const tagsRes = await fetch(`${base}${api}/tags`, { credentials: 'include', headers });
    if (!tagsRes.ok) {
      return { erro: 'Entre no Mercado Livre Afiliados neste navegador e tente de novo.' };
    }
    const corpo = await tagsRes.json();
    const tags = corpo.tags || corpo;
    if (!Array.isArray(tags) || !tags.length) {
      return { erro: 'Nenhuma tag de afiliado na sua conta do Mercado Livre.' };
    }
    const tagId = tags[0].id || tags[0];

    const links = {};
    for (const url of urls) {
      try {
        const res = await fetch(`${base}${api}/links`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({ url, tag_id: tagId }),
        });
        if (!res.ok) continue;
        const dados = await res.json();
        const curto = dados.short_url || dados.short_link || dados.url || null;
        // So vale meli.la. Qualquer outra coisa (redirect, URL do produto) nao
        // carrega atribuicao, e mandar ela seria pior que nao mandar link.
        if (curto && curto.startsWith('https://meli.la/')) links[url] = curto;
      } catch {
        // link individual pode falhar; o resto do lote continua
      }
      await new Promise((r) => setTimeout(r, 300)); // nao martelar o painel
    }
    return { links };
  })();
}

async function gerarLinks(urls, tabId) {
  if (!urls.length) return { links: {} };
  try {
    const saida = await chrome.scripting.executeScript({
      target: { tabId },
      func: gerarLinkNaPagina,
      args: [urls, ML, API_AFILIADOS],
      world: 'MAIN',
    });
    return saida[0]?.result || { links: {} };
  } catch (e) {
    return { erro: e.message, links: {} };
  }
}

// ---------------------------------------------------------------------------
// conversa com o Hub
// ---------------------------------------------------------------------------

async function chamarHub(caminho, corpo) {
  const { apiUrl, token } = await config();
  if (!token) throw new Error('Falta o token. Abra a extensão e cole o token que está em Conexões.');

  const res = await fetch(`${apiUrl}${caminho}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  const texto = await res.text();
  const dados = texto ? JSON.parse(texto) : {};
  if (!res.ok) throw new Error(dados.error || `Hub respondeu ${res.status}`);
  return dados;
}

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (msg?.tipo === 'capturar') {
    (async () => {
      try {
        const tabId = remetente.tab?.id ?? msg.tabId;
        const produtos = msg.produtos || [];

        const { links, erro } = await gerarLinks(
          produtos.map((p) => p.canonicalUrl),
          tabId,
        );
        for (const p of produtos) {
          const curto = links[p.canonicalUrl];
          if (curto) p.affiliateUrl = curto;
        }
        const semLink = produtos.filter((p) => !p.affiliateUrl).length;

        const r = await chamarHub('/api/extensao/produtos', { produtos });
        responder({ ...r, semLink, avisoLink: erro });
      } catch (e) {
        responder({ ok: false, error: e.message });
      }
    })();
    return true; // resposta assincrona
  }

  if (msg?.tipo === 'ping') {
    (async () => {
      try {
        responder(await chamarHub('/api/extensao/ping'));
      } catch (e) {
        responder({ ok: false, error: e.message });
      }
    })();
    return true;
  }
});
