/**
 * Captura de produtos do Mercado Livre.
 *
 * Por que uma extensao e nao uma chamada de servidor: o ML nao tem API de
 * afiliados e bloqueia leitura de fora. Buscando pelo servidor vem 39 KB de
 * casca, sem um produto; com Chrome headless vem 2,6 KB. So o navegador do
 * operador, com a sessao dele, ve a pagina montada.
 *
 * Duas telas, duas estrategias:
 *   PDP (pagina do produto) -> le o DOM, que e estavel e completo
 *   Listagem de busca       -> le window.__PRELOADED_STATE__, muito mais
 *                              confiavel que raspar 50 cards; DOM e o plano B
 */

(() => {
  'use strict';

  // ------------------------------------------------------------------
  // utilidades
  // ------------------------------------------------------------------

  const texto = (el) => (el ? (el.textContent || '').trim() : '');

  /** Extrai o codigo MLB de qualquer formato de URL do ML. */
  function codigoMlb(url) {
    const s = String(url || '');
    const m =
      s.match(/\/p\/(MLB-?\d+)/i) ||
      s.match(/\/up\/(MLBU?-?\d+)/i) ||
      s.match(/\/(MLB-?\d+)(?:[-/?#]|$)/i) ||
      s.match(/(MLB-?\d+)/i);
    return m ? m[1].toUpperCase().replace('-', '') : null;
  }

  /**
   * Le um bloco .andes-money-amount em centavos.
   *
   * Reais e centavos vivem em spans separados: ler so a fracao transformaria
   * R$ 729,99 em R$ 729,00. E a fracao vem com ponto de milhar ("1.099").
   */
  function lerDinheiro(raiz) {
    if (!raiz) return null;
    const fracao = raiz.querySelector('.andes-money-amount__fraction');
    const digitos = texto(fracao).replace(/\D/g, '');
    if (!digitos) return null;
    const reais = parseInt(digitos, 10);
    if (!Number.isFinite(reais) || reais <= 0) return null;
    const centavosEl = raiz.querySelector('.andes-money-amount__cents');
    const cd = texto(centavosEl).replace(/\D/g, '');
    return reais + (cd ? parseInt(cd.slice(0, 2), 10) : 0) / 100;
  }

  /** "+10mil vendidos", "Mais de 50 mil vendidos", "1.234 vendidos" -> numero. */
  function lerVendidos(str) {
    const t = String(str || '').toLowerCase();
    const m = t.match(/(\d[\d.,]*)\s*(mil|mi)?\s*\+?\s*vendid/);
    if (!m) return undefined;
    const base = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(base)) return undefined;
    if (m[2] === 'mil') return Math.round(base * 1000);
    if (m[2] === 'mi') return Math.round(base * 1_000_000);
    return Math.round(base);
  }

  // ------------------------------------------------------------------
  // pagina do produto (PDP)
  // ------------------------------------------------------------------

  const ehPdp = () =>
    !!document.querySelector('h1.ui-pdp-title, #price .ui-pdp-price, .ui-pdp-container__row--price');

  /**
   * Bloco de preco correto.
   *
   * `.andes-money-amount__fraction` solto na pagina nao serve: o preco riscado
   * vem ANTES do atual no DOM, e o mesmo seletor ainda alcanca a parcela
   * ("em 12x R$ 60,83") e o preco de outro vendedor em "Outras opcoes de
   * compra". Por isso a busca comeca pelo container de preco.
   */
  function raizDoPreco() {
    return (
      document.querySelector('#price .ui-pdp-price') ||
      document.querySelector('.ui-pdp-container__row--price .ui-pdp-price') ||
      document.querySelector('#price') ||
      document.querySelector('.ui-pdp-price')
    );
  }

  function capturarPdp() {
    const raiz = raizDoPreco();
    if (!raiz) return null;

    // O preco atual mora na "segunda linha"; o riscado fica fora dela.
    const escopoAtual = raiz.querySelector('.ui-pdp-price__second-line') || raiz;
    let price = lerDinheiro(escopoAtual);
    if (!price) {
      const meta = escopoAtual.querySelector('meta[itemprop="price"]');
      const v = meta && parseFloat(meta.getAttribute('content'));
      if (Number.isFinite(v) && v > 0) price = v;
    }

    const listPrice = lerDinheiro(
      raiz.querySelector('.ui-pdp-price__original-value, .andes-money-amount--previous'),
    );

    const subtitulos = [...document.querySelectorAll('.ui-pdp-subtitle, .ui-pdp-header__subtitle')]
      .flatMap((el) => [texto(el), el.getAttribute('aria-label') || ''])
      .join(' | ');

    const notaEl = document.querySelector('.ui-pdp-review__rating, .ui-review-capability__rating__average');
    const nota = parseFloat(texto(notaEl).replace(',', '.'));

    const imgEl =
      document.querySelector('.ui-pdp-gallery__figure img') ||
      document.querySelector('img[data-zoom]') ||
      document.querySelector('.ui-pdp-gallery img');

    const canonical = document.querySelector('link[rel="canonical"]');
    const canonicalUrl = (canonical && canonical.href) || location.href.split('#')[0];
    const externalId = codigoMlb(canonicalUrl) || codigoMlb(location.href);
    if (!externalId) return null;

    return {
      platform: 'MERCADO_LIVRE',
      externalId,
      title: texto(document.querySelector('h1.ui-pdp-title')) || texto(document.querySelector('h1')),
      canonicalUrl,
      imageUrl: (imgEl && (imgEl.getAttribute('data-zoom') || imgEl.src)) || undefined,
      price: price || undefined,
      // So conta como "de" se for maior: vendedor as vezes repete o mesmo
      // numero nos dois campos, e isso viraria um desconto de 0%.
      listPrice: listPrice && price && listPrice > price ? listPrice : undefined,
      soldCount: lerVendidos(subtitulos),
      rating: Number.isFinite(nota) && nota > 0 && nota <= 5 ? nota : undefined,
      origem: 'produto',
    };
  }

  // ------------------------------------------------------------------
  // listagem de busca
  // ------------------------------------------------------------------

  const ehListagem = () =>
    !!document.querySelector('.poly-card, .ui-search-result, .andes-card[class*="poly-card"]');

  /**
   * Le a listagem pelo DOM.
   *
   * O caminho bom seria `window.__PRELOADED_STATE__`, que traz os cards ja
   * estruturados -- mas ele vive no mundo MAIN e um content script nao
   * enxerga. Quem busca esse estado e o service worker, via
   * chrome.scripting com world:'MAIN'. Aqui fica o plano B.
   */
  function capturarListagemDoDom() {
    const cards = document.querySelectorAll(
      '.poly-card, .ui-search-result, .andes-card[class*="poly-card"]',
    );
    const achados = [];

    for (const card of cards) {
      const link = card.querySelector('a[href*="MLB"], a.poly-component__title, a.ui-search-link');
      const href = link && link.href;
      const externalId = codigoMlb(href);
      if (!externalId) continue;

      const titulo =
        texto(card.querySelector('.poly-component__title, .ui-search-item__title')) || texto(link);
      if (!titulo) continue;

      // No card o riscado tambem aparece antes; pegamos os dois blocos na ordem
      // e assumimos que o maior e o preco cheio.
      const blocos = [...card.querySelectorAll('.andes-money-amount')]
        .map(lerDinheiro)
        .filter((v) => v && v > 0);
      const price = blocos.length ? Math.min(...blocos) : undefined;
      const listPrice = blocos.length > 1 ? Math.max(...blocos) : undefined;

      const img = card.querySelector('img');

      achados.push({
        platform: 'MERCADO_LIVRE',
        externalId,
        title: titulo,
        canonicalUrl: href.split('#')[0],
        imageUrl: (img && (img.getAttribute('data-src') || img.src)) || undefined,
        price,
        listPrice: listPrice && price && listPrice > price ? listPrice : undefined,
        soldCount: lerVendidos(texto(card)),
        origem: 'listagem',
      });
    }

    return achados;
  }

  // ------------------------------------------------------------------
  // botao flutuante
  // ------------------------------------------------------------------

  function avisar(texto, tom) {
    let el = document.getElementById('hubofertas-aviso');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hubofertas-aviso';
      document.body.appendChild(el);
    }
    el.textContent = texto;
    el.dataset.tom = tom || 'ok';
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = 'none'), 5000);
  }

  async function enviar(produtos, botao) {
    if (!produtos.length) {
      avisar('Não encontrei produto nesta página.', 'erro');
      return;
    }
    const rotulo = botao.textContent;
    botao.disabled = true;
    botao.textContent = 'Enviando...';
    try {
      const r = await chrome.runtime.sendMessage({ tipo: 'capturar', produtos });
      if (!r?.ok) throw new Error(r?.error || 'falhou');
      const partes = [`${r.criados} na fila`];
      if (r.repetidos) partes.push(`${r.repetidos} já estavam`);
      if (r.semLink) partes.push(`${r.semLink} sem link de afiliado`);
      avisar(`Hub Ofertas: ${partes.join(', ')}.`, 'ok');
    } catch (e) {
      avisar(`Hub Ofertas: ${e.message}`, 'erro');
    } finally {
      botao.disabled = false;
      botao.textContent = rotulo;
    }
  }

  function montarBotao() {
    if (document.getElementById('hubofertas-btn')) return;

    const pdp = ehPdp();
    const listagem = !pdp && ehListagem();
    if (!pdp && !listagem) return;

    const botao = document.createElement('button');
    botao.id = 'hubofertas-btn';
    botao.textContent = pdp ? 'Mandar pro Hub' : 'Capturar esta busca';
    botao.addEventListener('click', () => {
      const produtos = pdp ? [capturarPdp()].filter(Boolean) : capturarListagemDoDom();
      void enviar(produtos, botao);
    });
    document.body.appendChild(botao);
  }

  // A listagem do ML troca de conteudo sem recarregar a pagina, entao o botao
  // e remontado quando o DOM muda.
  montarBotao();
  const observador = new MutationObserver(() => montarBotao());
  observador.observe(document.body, { childList: true, subtree: true });

  // O service worker pede a captura quando o clique vem do popup.
  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg?.tipo !== 'raspar') return;
    responder({
      ok: true,
      produtos: ehPdp() ? [capturarPdp()].filter(Boolean) : capturarListagemDoDom(),
    });
    return true;
  });
})();
