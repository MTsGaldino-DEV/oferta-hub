/**
 * Captura de produtos da Shopee.
 *
 * SPA React com classe muitas vezes hasheada -- sem gancho semantico
 * estavel de preco/preco "de" como o ML tem. `lerPrecos` cai no fallback por
 * ESTILO (line-through computado, ver shared.js) pra achar o preco riscado;
 * o preco atual sai do fallback por TEXTO (primeiro "R$" fora do riscado).
 *
 * externalId sai como "<shopId>_<itemId>", MESMO formato que o conector
 * oficial (apps/api/src/connectors/shopee.ts) usa pra gravar Product -- sem
 * isso, um produto capturado aqui e o mesmo produto que a API oficial ja
 * trouxe pelo garimpo automatico virariam DOIS registros em vez de um.
 *
 * PRIMEIRA VERSAO SEM VALIDACAO AO VIVO: a Shopee bloqueia qualquer acesso
 * automatizado/anonimo com verificacao anti-bot (confirmado tentando abrir
 * /flash_sale e /search de fora -- as duas caem em /verify/traffic/error),
 * entao os seletores abaixo (CARDS, LINK_PRODUTO, RUIDO_SHOPEE) sao a melhor
 * aposta com base em atributos conhecidos da Shopee (data-sqe), nunca
 * confirmados numa pagina real. Se o widget disser "nao encontrei produto"
 * numa pagina que claramente tem produto, o proximo passo e abrir o
 * DevTools na pagina real (logado, no seu navegador) e ajustar essas
 * constantes.
 */
(function (window, document) {
  'use strict';

  const H = window.__HUB;
  if (!H) return;

  const { texto, lerPrecos, extrairMelhorImagem, registrar } = H;

  function extrairIdShopee(url) {
    let u;
    try { u = new URL(String(url), 'https://shopee.com.br'); } catch { return null; }
    if (!/(^|\.)shopee\.com\.br$/i.test(u.hostname)) return null;
    let m = u.pathname.match(/-i\.(\d+)\.(\d+)/);
    if (!m) m = u.pathname.match(/\/product\/(\d+)\/(\d+)/);
    return m ? `${m[1]}_${m[2]}` : null;
  }

  /** URL limpa do produto, reconstruida do id -- ignora slug e query de tracking. */
  function canonicaDeShopee(url) {
    const id = extrairIdShopee(url);
    if (!id) return null;
    const [shopId, itemId] = id.split('_');
    return `https://shopee.com.br/product/${shopId}/${itemId}`;
  }

  // Publicado ANTES do guard de hostname, mesmo motivo do amazon.js: deixa o
  // self-check (shopee.check.mjs) testar as funcoes puras sem DOM real.
  window.__HUB_SHOPEE = { extrairIdShopee, canonicaDeShopee };

  // Este arquivo carrega em todos os dominios do manifest; daqui pra baixo
  // so roda na Shopee.
  if (!/(^|\.)shopee\.com\.br$/i.test(window.location.hostname)) return;

  /** Container de cada card na grade de listagem/busca. */
  const CARDS = '[data-sqe="item"]';
  const LINK_PRODUTO = 'a[href*="-i."], a[href*="/product/"]';
  const RUIDO_SHOPEE = ['[class*="badge" i]', '[class*="label" i]', '[class*="voucher" i]'].join(', ');

  function achaLink(card) {
    return card.querySelector(LINK_PRODUTO) || (card.matches(LINK_PRODUTO) ? card : null);
  }

  /** Titulo do card: alt da imagem primeiro, aria-label do link como reserva. */
  function extrairTitulo(card) {
    const img = card.querySelector('img[alt]');
    const alt = (img?.getAttribute('alt') || '').trim();
    if (alt.length >= 6) return alt.slice(0, 200);
    const link = achaLink(card);
    return (link?.getAttribute('aria-label') || '').trim().slice(0, 200);
  }

  const OPCOES_PRECO = { seletoresRuido: RUIDO_SHOPEE, blocos: null };

  const ehProduto = () => !!canonicaDeShopee(location.href);

  function capturarProduto() {
    const canonicalUrl = canonicaDeShopee(location.href);
    if (!canonicalUrl) return null;
    const { price, listPrice } = lerPrecos(document.body, OPCOES_PRECO);
    const titulo = texto(document.querySelector('h1')) || document.title.split('|')[0].trim();
    return {
      platform: 'SHOPEE',
      externalId: extrairIdShopee(canonicalUrl),
      title: titulo,
      canonicalUrl,
      imageUrl: extrairMelhorImagem(document.body),
      price,
      listPrice,
      origem: 'produto',
    };
  }

  /** Le os cards que estao no DOM AGORA. Chamada a cada parada do autoscroll. */
  function varrerListagem(acc) {
    for (const card of document.querySelectorAll(CARDS)) {
      const link = achaLink(card);
      const canonicalUrl = link ? canonicaDeShopee(link.getAttribute('href')) : null;
      if (!canonicalUrl) continue;
      const id = extrairIdShopee(canonicalUrl);

      registrar(acc, id, () => {
        const { price, listPrice } = lerPrecos(card, OPCOES_PRECO);
        return {
          platform: 'SHOPEE',
          externalId: id,
          title: extrairTitulo(card),
          canonicalUrl,
          imageUrl: extrairMelhorImagem(card),
          price,
          listPrice,
          origem: 'listagem',
        };
      });
    }
    return acc.produtos.size;
  }

  /**
   * Mesmo formato/chave do lib/log.js (service worker e painel), mas
   * duplicado aqui: content script nao roda como modulo ES.
   */
  async function registrarLog(nivel, mensagem) {
    try {
      const { logs = [] } = await chrome.storage.local.get('logs');
      logs.push({ ts: Date.now(), origem: 'pagina', nivel, texto: String(mensagem) });
      if (logs.length > 300) logs.splice(0, logs.length - 300);
      await chrome.storage.local.set({ logs });
    } catch { /* sem storage, so nao aparece no painel */ }
  }

  function montar() {
    if (document.getElementById('hubofertas-widget')) return;
    const produto = ehProduto();
    if (!produto && !document.querySelector(CARDS)) return;

    H.montarWidget({
      loja: 'Shopee',
      rotulo: produto ? 'Capturar produto' : 'Capturar esta busca',
      async aoCapturar({ progresso, pronto, erro }) {
        const produtos = produto
          ? [capturarProduto()].filter((p) => p && p.title)
          : await H.rolarAcumulando(varrerListagem, { aoProgredir: progresso });

        if (!produtos.length) {
          erro('Não encontrei produto nesta página.');
          return;
        }
        await chrome.storage.local.set({ captura_pendente: { produtos, criadoEm: Date.now() } });
        void registrarLog('info', `${produtos.length} produto(s) capturado(s) da Shopee -- nada foi enviado ainda.`);
        pronto(produtos.length);
      },
    });
  }

  // A Shopee e SPA e troca a grade sem recarregar (filtro, paginacao,
  // navegacao entre categorias) -- o widget e remontado quando o DOM muda.
  montar();
  new MutationObserver(montar).observe(document.documentElement, { childList: true, subtree: true });

  // O painel lateral pede essa leitura sozinho ao trocar de aba e a cada
  // "Atualizar". Leitura PASSIVA do que ja esta na tela.
  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg?.tipo !== 'raspar') return;
    if (ehProduto()) {
      responder({ ok: true, produtos: [capturarProduto()].filter((p) => p && p.title) });
    } else {
      const acc = H.novoAcumulador();
      varrerListagem(acc);
      responder({ ok: true, produtos: [...acc.produtos.values()] });
    }
    return true;
  });
})(window, document);
