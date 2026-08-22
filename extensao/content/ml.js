/**
 * Captura de produtos do Mercado Livre.
 *
 * Por que uma extensao e nao uma chamada de servidor: o ML nao tem API de
 * afiliados e bloqueia leitura de fora. Buscando pelo servidor vem 39 KB de
 * casca, sem um produto; com Chrome headless vem 2,6 KB. So o navegador do
 * operador, com a sessao dele, ve a pagina montada.
 *
 * Tres telas, tres estrategias:
 *   PDP (pagina do produto)     -> le o DOM, que e estavel e completo
 *   Listagem de busca           -> le window.__PRELOADED_STATE__, muito mais
 *                                  confiavel que raspar 50 cards; DOM e o plano B
 *   Painel de afiliado (hub)    -> grade virtualizada (ver rolarAcumulando);
 *                                  por padrao so os que batem o limiar de
 *                                  desconto, com opcao de mandar todos
 */

(() => {
  'use strict';

  // ------------------------------------------------------------------
  // utilidades
  // ------------------------------------------------------------------

  const texto = (el) => (el ? (el.textContent || '').trim() : '');

  /**
   * Mesmo formato/chave do lib/log.js (service worker e painel), mas
   * duplicado aqui: content script nao roda como modulo ES, entao nao da
   * pra importar. O storage.local e que junta os tres num so lugar.
   */
  async function registrarLog(nivel, mensagem) {
    try {
      const { logs = [] } = await chrome.storage.local.get('logs');
      logs.push({ ts: Date.now(), origem: 'pagina', nivel, texto: String(mensagem) });
      if (logs.length > 300) logs.splice(0, logs.length - 300);
      await chrome.storage.local.set({ logs });
    } catch {
      // sem storage, so nao aparece no painel
    }
  }

  const BASE_ML = 'https://www.mercadolivre.com.br';

  const jm = (digitos) => `https://produto.mercadolivre.com.br/MLB-${digitos}-_JM`;

  /**
   * Resolve uma URL do ML no par (id do item, URL que a API de afiliados aceita).
   *
   * Nao basta pegar o href do card e nao basta so reconhecer a forma. A URL de
   * um card de busca chega assim:
   *   .../p/MLB67503176?matt_word=x#polycard_client=search_best-seller&
   *   tracking_id=...&wid=MLB.../sid=search
   * A forma "/p/MLB<id>" e aceita pela API -- mas so se for so ela. Mandar essa
   * URL inteira, com o fragmento de tracking da busca junto, voltava 400 mesmo
   * sendo uma forma "aceita": foi o que fez toda captura vinda de busca cair no
   * link matt_tool de reserva, enquanto uma PDP aberta direto (cuja canonica ja
   * vem limpa) funcionava. A solucao nao e aceitar mais formas -- e nunca
   * repassar query nem fragmento adiante: todo id numerico de item, de onde
   * quer que venha, vira a mesma URL limpa reconstruida do zero.
   *
   *  - TRACKING (click1.mercadolivre.com.br/mclics/...): o caminho nao descreve
   *    produto nenhum. So vale se carregar wid= ou item_id= nos parametros -- e
   *    mesmo assim quem vai para a API e a URL limpa do item, nunca a de
   *    tracking, que nao atribui comissao.
   *  - PRODUTO DE VENDEDOR (/up/MLBU123): MLBU e outro namespace, nao um MLB com
   *    letra sobrando. O MLB de verdade vem no wid= do mesmo link; tirar o "U"
   *    para "converter" aponta para outro anuncio. Sem wid, so da pra limpar
   *    query e fragmento -- o path continua sendo /up/, que a API aceita.
   */
  function resolverUrlMl(rawUrl) {
    if (!rawUrl) return null;

    let u;
    try {
      u = new URL(String(rawUrl), BASE_ML);
    } catch {
      return null;
    }
    if (!/(^|\.)mercadoli(vre|bre)\.com(\.br)?$/i.test(u.hostname)) return null;

    let extras = u.search + u.hash;
    try {
      extras = decodeURIComponent(extras);
    } catch {
      // parametro mal codificado: segue com a forma crua
    }
    const wid =
      extras.match(/[?#&](?:wid|item_id)=(MLB\d{6,})/i) || extras.match(/item_id[:=](MLB\d{6,})/i);
    const porWid = () => ({ externalId: wid[1].toUpperCase(), url: jm(wid[1].slice(3)) });

    const caminho = u.pathname;
    if (/^click/i.test(u.hostname) || caminho.includes('/mclics/')) {
      return wid ? porWid() : null;
    }

    // Qualquer forma que exponha o id numerico do item -- catalogo /p/MLB123,
    // PDP /MLB-123-slug-_JM, ou compacta /MLB123 -- normaliza para a mesma URL
    // limpa. O {6,} tambem e o que evita casar "bone-mlb-9forty": o "9" sozinho
    // nunca chega a seis digitos.
    let m = caminho.match(/\/MLB-?(\d{6,})/i);
    if (m) return { externalId: `MLB${m[1]}`, url: jm(m[1]) };

    // Produto de vendedor: o wid tem precedencia sobre o id do caminho, porque
    // MLBU nao serve para a API. Sem wid, ao menos tira query e fragmento.
    m = caminho.match(/\/up\/(MLBU?)-?(\d{6,})/i);
    if (m) {
      if (wid) return porWid();
      return { externalId: `${m[1].toUpperCase()}${m[2]}`, url: `${u.origin}${u.pathname}` };
    }

    return wid ? porWid() : null;
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
  // preco: escolher por PAPEL, nunca pelo tamanho do numero
  // ------------------------------------------------------------------

  /**
   * Blocos de dinheiro que NAO sao o preco do produto.
   *
   * O erro mais caro da vitrine e a parcela. Num controle de R$ 406,43 em
   * "12x R$ 39,30", pegar o menor numero do card anuncia R$ 39,30 e 94% OFF --
   * preco mentiroso no grupo, e o grupo e o ativo que nao da pra reconstruir.
   * Frete e "ou R$ 47,90 em outros meios" entram na mesma lista.
   */
  const RUIDO_DE_PRECO = [
    '.poly-price__installments',
    '.ui-search-installments',
    '.ui-search-item__group--installments',
    '.ui-pdp-price__subtitles',
    '.poly-component__shipping',
    '.ui-search-item__shipping',
    '.poly-price__other-payment',
    '.ui-search-price__other-payment',
  ].join(', ');

  /**
   * Parcela sem classe conhecida. As classes do ML mudam sem aviso, entao a
   * forma tambem conta: o container da parcela comeca com "12x".
   */
  function pareceParcela(el) {
    let no = el.parentElement;
    for (let i = 0; i < 3 && no; i++, no = no.parentElement) {
      if (/^\s*\d{1,2}\s*x\b/i.test(no.textContent || '')) return true;
    }
    return false;
  }

  const ehRiscado = (el) =>
    el.matches('s, del, .andes-money-amount--previous') || !!el.closest('s, del');

  /**
   * Preco atual e preco cheio, de um card ou de uma pagina de produto.
   *
   * Nao usa min/max sobre os numeros da caixa -- foi assim que a parcela virou
   * preco. Separa por papel: riscado e o cheio, e o primeiro nao-riscado que
   * sobra depois do ruido e o atual.
   */
  function lerPrecos(raiz) {
    if (!raiz) return {};

    const blocos = [...raiz.querySelectorAll('.andes-money-amount')].filter(
      (el) => !el.closest(RUIDO_DE_PRECO) && !pareceParcela(el),
    );

    const price = lerDinheiro(blocos.find((el) => !ehRiscado(el)));
    const listPrice = lerDinheiro(blocos.find(ehRiscado));

    return {
      price: price || undefined,
      // So conta como "de" se for maior: vendedor as vezes repete o mesmo
      // numero nos dois campos, e isso viraria um desconto de 0%.
      listPrice: listPrice && price && listPrice > price ? listPrice : undefined,
    };
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

    const { price: lido, listPrice } = lerPrecos(raiz);
    let price = lido;
    if (!price) {
      const meta =
        raiz.querySelector('meta[itemprop="price"]') ||
        document.querySelector('meta[itemprop="price"]');
      const v = meta && parseFloat(meta.getAttribute('content'));
      if (Number.isFinite(v) && v > 0) price = v;
    }

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
    // A canonica pode vir relativa, e numa PDP alcancada por clique no card o
    // MLB real esta no wid= do endereco da barra -- por isso as duas entram.
    const ref =
      resolverUrlMl(canonical && canonical.getAttribute('href')) || resolverUrlMl(location.href);
    if (!ref) return null;

    return {
      platform: 'MERCADO_LIVRE',
      externalId: ref.externalId,
      title: texto(document.querySelector('h1.ui-pdp-title')) || texto(document.querySelector('h1')),
      canonicalUrl: ref.url,
      imageUrl: (imgEl && (imgEl.getAttribute('data-zoom') || imgEl.src)) || undefined,
      price,
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
      const ref = resolverUrlMl(link && link.getAttribute('href'));
      if (!ref) continue;

      const titulo =
        texto(card.querySelector('.poly-component__title, .ui-search-item__title')) || texto(link);
      if (!titulo) continue;

      const { price, listPrice } = lerPrecos(card);
      const img = card.querySelector('img');

      achados.push({
        platform: 'MERCADO_LIVRE',
        externalId: ref.externalId,
        title: titulo,
        canonicalUrl: ref.url,
        imageUrl: (img && (img.getAttribute('data-src') || img.src)) || undefined,
        price,
        listPrice,
        soldCount: lerVendidos(texto(card)),
        origem: 'listagem',
      });
    }

    return achados;
  }

  // ------------------------------------------------------------------
  // painel de afiliado (hub): so os produtos com desconto acima do limiar
  // ------------------------------------------------------------------

  const LIMIAR_DESCONTO = 0.25;
  const ALVO_PRODUTOS = 78;

  const ehHub = () => /^\/afiliados\/hub(\/|$)/i.test(location.pathname);

  /**
   * Cards do painel de afiliado apontam o `href` para o produto de catalogo
   * (.../p/MLB<id>), mas o item que de fato gera comissao e outro -- o mesmo
   * que o proprio botao "Compartilhar" do card usa, exposto num input oculto
   * (name="id"). Usar o id do path repetiria o erro que ja gerou 400 na
   * geracao de link duas vezes (ver historico de commits do connector).
   * Por isso aqui o id vem do input, nunca do link.
   *
   * `exigirDesconto` liga/desliga o corte de LIMIAR_DESCONTO, caso sirva de
   * novo pra algum botao sem filtro.
   *
   * Cada achado carrega `_topoAbs`/`_esquerdaAbs` (posicao real na pagina no
   * momento da leitura) -- e o que permite reordenar no final pela ordem
   * visual de cima pra baixo, nunca a ordem em que o scroll foi descobrindo
   * cada card. Sao removidos antes de mandar pro Hub (ver rolarAcumulando).
   */
  function extrairCards(cards, { exigirDesconto = true } = {}) {
    const achados = [];

    for (const card of cards) {
      const idEl = card.querySelector('input[name="id"]');
      const id = idEl && idEl.value;
      if (!id || !/^MLB\d{6,}$/i.test(id)) continue;

      const titulo = texto(card.querySelector('.poly-component__title'));
      if (!titulo) continue;

      const { price, listPrice } = lerPrecos(card);
      if (!price) continue; // sem preco nao da pra enviar nada
      if (exigirDesconto) {
        // Sem preco "de" nao tem desconto pra medir -- card fica de fora, nao
        // vira "0%".
        if (!listPrice) continue;
        const desconto = (listPrice - price) / listPrice;
        if (desconto < LIMIAR_DESCONTO) continue;
      }

      const digitos = id.slice(3);
      const img = card.querySelector('img');
      const rect = card.getBoundingClientRect();

      achados.push({
        platform: 'MERCADO_LIVRE',
        externalId: `MLB${digitos}`,
        title: titulo,
        canonicalUrl: jm(digitos),
        imageUrl: (img && (img.getAttribute('data-src') || img.src)) || undefined,
        price,
        listPrice,
        soldCount: lerVendidos(texto(card)),
        origem: 'painel',
        _topoAbs: Math.round(rect.top + window.scrollY),
        _esquerdaAbs: Math.round(rect.left + window.scrollX),
      });
    }

    return achados;
  }

  /**
   * O grid do painel e virtualizado: o `.polycards__spacer` ja reserva a
   * altura total (dezenas de milhares de px, centenas de produtos) desde o
   * inicio, mas so os cards perto da posicao atual da tela ficam no DOM -- os
   * que saem da vista SOMEM. Pular direto pro fim (como a versao anterior
   * fazia) so via a primeira leva e a ultima; o resto da lista nunca era
   * visto, e por isso o alvo quase nunca era batido mesmo com a pagina
   * inteira disponivel.
   *
   * A correcao: rolar em passos de uma tela por vez e ACUMULAR por
   * externalId (sem repetir) o que estava montado em cada parada, nunca so
   * olhar o estado final.
   */
  async function rolarAcumulando(
    alvo,
    { exigirDesconto = true, esperaMs = 700, maxTentativas = 150, rotulo = '' } = {},
  ) {
    const vistos = new Map();
    let semNovoNoFim = 0;

    for (let i = 0; i < maxTentativas; i++) {
      let novosNestaVolta = 0;
      for (const p of extrairCards(document.querySelectorAll('.poly-card'), { exigirDesconto })) {
        if (!vistos.has(p.externalId)) novosNestaVolta++;
        vistos.set(p.externalId, p);
      }

      // Log de progresso: sem isso, uma trava no meio do caminho nao deixa
      // pista nenhuma de ate onde chegou. A cada 5 passos ou sempre que achar
      // produto novo -- nao a cada passo, pra nao afogar a aba de logs.
      if (novosNestaVolta > 0 || i % 5 === 0) {
        void registrarLog(
          'info',
          `${rotulo}passo ${i + 1}/${maxTentativas}: ${vistos.size}/${alvo} acumulado(s) (+${novosNestaVolta} agora), scrollY=${Math.round(window.scrollY)}/${document.body.scrollHeight}px.`,
        );
      }

      if (vistos.size >= alvo) break;

      const chegouAoFim = window.scrollY + window.innerHeight >= document.body.scrollHeight - 4;
      if (chegouAoFim) {
        semNovoNoFim++;
        if (semNovoNoFim >= 3) {
          void registrarLog('info', `${rotulo}chegou ao fim da página sem achar mais nada novo.`);
          break;
        }
      } else {
        semNovoNoFim = 0;
      }

      window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      await new Promise((r) => setTimeout(r, esperaMs));

      if (i === maxTentativas - 1) {
        void registrarLog('aviso', `${rotulo}atingiu o limite de ${maxTentativas} passos e parou por segurança.`);
      }
    }

    // A ordem de insercao no Map e "quando o scroll descobriu cada card", nao
    // a ordem visual -- o buffer de pre-carregamento da virtualizacao pode
    // montar um card um pouco fora de sequencia. Reordena pela posicao real
    // na pagina (de cima pra baixo, esquerda pra direita) antes de cortar em
    // `alvo`, e tira os campos internos que so serviam pra isso.
    return [...vistos.values()]
      .sort((a, b) => a._topoAbs - b._topoAbs || a._esquerdaAbs - b._esquerdaAbs)
      .slice(0, alvo)
      .map(({ _topoAbs, _esquerdaAbs, ...produto }) => produto);
  }

  async function capturarHub(alvo = ALVO_PRODUTOS, opcoes = {}) {
    return rolarAcumulando(alvo, opcoes);
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
    void registrarLog(tom === 'erro' ? 'erro' : 'info', texto);
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
      // O motivo da falha vai para o console inteiro: no aviso nao cabe, e sem
      // ele so sobra o status HTTP, que nao diz nada.
      if (r.avisoLink) console.warn('[Hub Ofertas] link de afiliado:', r.avisoLink);
      avisar(
        `Hub Ofertas: ${partes.join(', ')}.${r.avisoLink ? ' Veja o console para o motivo.' : ''}`,
        r.semLink ? 'erro' : 'ok',
      );
    } catch (e) {
      // "Extension context invalidated" nao e bug: acontece toda vez que a
      // extensao e recarregada em chrome://extensions com esta aba ja
      // aberta -- o script daqui fica orfao, sem conexao com a extensao
      // reiniciada. So um F5 nesta pagina resolve.
      const orfao = /context invalidated/i.test(e.message || '');
      avisar(
        orfao
          ? 'Hub Ofertas: a extensão foi recarregada. Dê um F5 nesta página e tente de novo.'
          : `Hub Ofertas: ${e.message}`,
        'erro',
      );
    } finally {
      botao.disabled = false;
      botao.textContent = rotulo;
    }
  }

  /**
   * Um dos dois botoes do hub: com desconto minimo, ou sem filtro nenhum.
   * So CAPTURA e guarda em chrome.storage.local -- nunca manda pro Hub
   * sozinho. Quem envia de verdade e o botao "Enviar ao Hub" do painel
   * lateral, depois de revisar a lista (marcar/desmarcar item por item).
   */
  function criarBotaoHub(id, rotulo, exigirDesconto) {
    const botao = document.createElement('button');
    botao.id = id;
    botao.className = 'hubofertas-btn-hub';
    botao.textContent = rotulo;
    const tag = `[${id}] `;

    botao.addEventListener('click', async () => {
      const rotuloOriginal = botao.textContent;
      botao.disabled = true;
      botao.textContent = `Buscando ${ALVO_PRODUTOS}...`;
      void registrarLog(
        'info',
        `${tag}rolando atrás de ${ALVO_PRODUTOS} produtos${exigirDesconto ? ` com ${Math.round(LIMIAR_DESCONTO * 100)}%+ de desconto` : ' (sem filtro de desconto)'}...`,
      );

      try {
        const produtos = await capturarHub(ALVO_PRODUTOS, { exigirDesconto, rotulo: tag });

        if (!produtos.length) {
          void registrarLog('aviso', `${tag}não achei nenhum produto que servisse.`);
          avisar('Hub Ofertas: não achei nenhum produto nessa busca.', 'erro');
          return;
        }
        if (produtos.length < ALVO_PRODUTOS) {
          void registrarLog(
            'aviso',
            `${tag}só achei ${produtos.length} de ${ALVO_PRODUTOS}${exigirDesconto ? ' com desconto' : ''} -- a página acabou antes do alvo.`,
          );
        } else {
          void registrarLog('info', `${tag}achei ${produtos.length} produtos.`);
        }

        await chrome.storage.local.set({ captura_pendente: { produtos, criadoEm: Date.now() } });
        void registrarLog('info', `${tag}${produtos.length} produto(s) guardado(s) -- nada foi enviado ainda.`);
        avisar(
          `Hub Ofertas: ${produtos.length} produto(s) prontos. Abra o painel lateral, revise e clique "Enviar ao Hub".`,
          'ok',
        );
      } catch (e) {
        void registrarLog('erro', `${tag}captura travou: ${e.message}${e.stack ? `\n${e.stack}` : ''}`);
        avisar(`Hub Ofertas: a captura travou (${e.message}). Veja a aba de logs.`, 'erro');
      } finally {
        botao.disabled = false;
        botao.textContent = rotuloOriginal;
      }
    });
    return botao;
  }

  function montarBotao() {
    if (document.getElementById('hubofertas-btn') || document.getElementById('hubofertas-btns')) return;

    const pdp = ehPdp();
    const hub = !pdp && ehHub();
    const listagem = !pdp && !hub && ehListagem();
    if (!pdp && !hub && !listagem) return;

    if (hub) {
      const wrap = document.createElement('div');
      wrap.id = 'hubofertas-btns';
      wrap.append(
        criarBotaoHub('hubofertas-btn-desconto', `Enviar descontos ${Math.round(LIMIAR_DESCONTO * 100)}%+`, true),
      );
      document.body.appendChild(wrap);
      return;
    }

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

  // O painel lateral pede essa leitura sozinho toda hora -- ao trocar de aba,
  // ao recarregar a pagina, a cada clique em "Atualizar". Tem que ser uma
  // leitura passiva do que ja esta na tela: nunca pode rolar a pagina sem o
  // usuario ter pedido isso de proposito (so os botoes flutuantes do hub
  // fazem isso, via clique).
  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg?.tipo !== 'raspar') return;
    const produtos = ehPdp()
      ? [capturarPdp()].filter(Boolean)
      : ehHub()
        ? extrairCards(document.querySelectorAll('.poly-card'))
        : capturarListagemDoDom();
    responder({ ok: true, produtos });
    return true;
  });
})();
