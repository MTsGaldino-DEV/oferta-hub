/**
 * Captura de produtos da Amazon.
 *
 * Diferente do ML, aqui a extensao NAO gera link de afiliado: o servidor faz
 * isso sozinho em connectors/amazon.ts, reescrevendo a URL com a tag salva em
 * Credential. Entao este arquivo so precisa entregar dados limpos -- titulo,
 * preco, foto -- e a canonica certa.
 *
 * Duas telas: pagina de produto e listagem (busca, ofertas, categoria).
 */
(function (window, document) {
  'use strict';

  const H = window.__HUB;
  if (!H) return;

  const { texto, lerPrecos, extrairMelhorImagem, registrar } = H;

  /**
   * ASIN a partir do caminho. As duas formas canonicas (/dp/ e /gp/product/)
   * cobrem tudo que a listagem produz; a forma solta `/([A-Z0-9]{10})/` fica
   * de fora de proposito -- ela casa pedaco de slug e inventa produto.
   */
  function extrairAsin(url) {
    let u;
    try { u = new URL(String(url), 'https://www.amazon.com.br'); } catch { return null; }
    if (!/(^|\.)amazon\.com(\.br)?$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }

  /**
   * URL limpa do produto. Reconstruida do zero a partir do ASIN, nunca o href
   * do card: o link da listagem carrega `ref=sr_1_3` e afins, e guardar
   * parametro de tracking da busca junto e o tipo de coisa que quebra a
   * atribuicao mais tarde sem dar nenhum sinal.
   */
  function canonicaDe(url) {
    const asin = extrairAsin(url);
    if (!asin) return null;
    let host = 'www.amazon.com.br';
    try { host = new URL(String(url), 'https://www.amazon.com.br').hostname; } catch { /* fica o padrao */ }
    return `https://${host}/dp/${asin}`;
  }

  // Publicado ANTES do guard de hostname de proposito: e o que permite o
  // self-check (shared.check.mjs) carregar este arquivo e testar so as
  // funcoes puras, sem executar nada que dependa de DOM ou de chrome.*.
  window.__HUB_AMAZON = { extrairAsin, canonicaDe };

  // Este arquivo carrega em todos os dominios do manifest (evita manter um
  // bloco de content_scripts por loja); daqui pra baixo so roda na Amazon.
  if (!/(^|\.)amazon\.com(\.br)?$/i.test(window.location.hostname)) return;

  /**
   * Ruido de preco da Amazon. `.a-text-price` NAO entra aqui: na pagina de
   * produto ele e o riscado (que a gente quer, como listPrice), e no card de
   * busca ele e o preco por unidade -- que o guarda de preco-por-unidade do
   * shared.js ja derruba pelo texto ao redor.
   */
  const RUIDO_AMAZON = [
    '#sp-cc',
    '.sp-cc-container',
    '[class*="swatch" i]',
    '[class*="twister" i]',
    '.a-carousel-container',
  ].join(', ');

  /** Blocos que a Amazon usa pra preco, nas duas telas. */
  const BLOCOS_AMAZON = '.a-price, .a-text-strike, .apex-basisprice-value';

  const JUNK = [
    'header', 'footer', '#nav-main', '#navbar-main', '#rhf-container',
    '#hmenu-container', '#nav-footer', '#desktop-dp-sims', '#p13n-asin-index',
    '.ad-feedback-message', '[class*="sims-desktop"]', '.a-carousel-container',
    '[id*="sponsored" i]', '[class*="sponsored" i]', '[data-asin=""]',
  ].join(', ');

  const CARDS = 'div[data-asin], .s-result-item, .s-card-container';

  const ehProduto = () => !!document.getElementById('productTitle');
  const ehListagem = () => !!document.querySelector('div[data-asin][data-component-type], .s-result-item');

  /**
   * Titulo do card. O primeiro anchor /dp/ costuma ser o SELO de oferta
   * ("14% off", "Oferta Prime Day"), nao o nome -- entao a fonte mais
   * confiavel e o alt da imagem, que a Amazon preenche com o nome completo em
   * qualquer um dos layouts (busca, ofertas, Prime Day).
   */
  function pareceSelo(t) {
    const s = (t || '').trim();
    if (!s) return true;
    if (/^-?\d*\s*%/.test(s)) return true;                    // "14% off", "-14%"
    if (/^(de\s+|por\s+)?R\$/i.test(s)) return true;          // preco
    return /^(oferta|prime\s*day|menor\s*pre[cç]o|cupom|frete\s*gr[aá]tis|mais\s*vendido|black\s*friday|recomendado|patrocinado|adicionar|comprar\s+agora|ver\s+op[cç][oõ]es)\b/i.test(s);
  }

  function extrairTitulo(card) {
    const candidatos = [];
    for (const img of card.querySelectorAll('img[alt]')) candidatos.push(img.getAttribute('alt'));
    for (const a of card.querySelectorAll('a[href*="/dp/"]')) candidatos.push(a.getAttribute('aria-label'));
    const cabecalho = card.querySelector('h2 a span, h2 span, h2, .a-truncate-full, .a-size-base-plus, .a-size-medium');
    if (cabecalho) candidatos.push(texto(cabecalho));

    for (const c of candidatos) {
      const t = (c || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (t.length >= 6 && !pareceSelo(t)) return t;
    }
    return '';
  }

  /** Le um bloco de preco da Amazon: aqui o valor vem no texto, nao em spans. */
  const lerBlocoAmazon = (el) => (el ? H.parsePrecoBR(texto(el)) : undefined);

  const OPCOES_PRECO = {
    seletoresRuido: RUIDO_AMAZON,
    blocos: BLOCOS_AMAZON,
    lerBloco: lerBlocoAmazon,
  };

  function capturarProduto() {
    const canonicalUrl = canonicaDe(location.href);
    if (!canonicalUrl) return null;
    const { price, listPrice } = lerPrecos(
      document.getElementById('centerCol') || document.body,
      OPCOES_PRECO,
    );
    const galeria = document.getElementById('imgTagWrapperId') || document.getElementById('main-image-container');

    return {
      platform: 'AMAZON',
      externalId: extrairAsin(canonicalUrl),
      title: texto(document.getElementById('productTitle')),
      canonicalUrl,
      imageUrl: galeria ? extrairMelhorImagem(galeria) : undefined,
      price,
      listPrice,
      origem: 'produto',
    };
  }

  /** Le os cards que estao no DOM AGORA. Chamada a cada parada do autoscroll. */
  function varrerListagem(acc) {
    for (const card of document.querySelectorAll(CARDS)) {
      if (card.closest(JUNK)) continue;
      const link = card.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]');
      const canonicalUrl = canonicaDe(link && link.getAttribute('href'));
      if (!canonicalUrl) continue;
      const asin = extrairAsin(canonicalUrl);

      registrar(acc, asin, () => {
        const { price, listPrice } = lerPrecos(card, OPCOES_PRECO);
        return {
          platform: 'AMAZON',
          externalId: asin,
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
   * Mesmo formato/chave do lib/log.js (service worker e painel), mas duplicado
   * aqui: content script nao roda como modulo ES, entao nao da pra importar.
   * O storage.local e que junta os tres num so lugar.
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
    if (!produto && !ehListagem()) return;

    H.montarWidget({
      loja: 'Amazon',
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
        void registrarLog('info', `${produtos.length} produto(s) capturado(s) da Amazon -- nada foi enviado ainda.`);
        pronto(produtos.length);
      },
    });
  }

  // A Amazon troca a grade sem recarregar (filtro lateral, paginacao), entao o
  // widget e remontado quando o DOM muda.
  montar();
  new MutationObserver(montar).observe(document.documentElement, { childList: true, subtree: true });

  // O painel lateral pede essa leitura sozinho ao trocar de aba e a cada
  // "Atualizar". Leitura PASSIVA do que ja esta na tela: nunca pode rolar a
  // pagina sem o usuario ter pedido (so o botao do widget faz isso).
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
