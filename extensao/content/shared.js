/**
 * Helpers de extracao compartilhados pelas lojas.
 *
 * Content script nao roda como modulo ES, entao nada de import/export: este
 * arquivo e um IIFE que publica window.__HUB, e os arquivos de loja
 * (ml.js, amazon.js) leem de la. A ordem no manifest garante que este carrega
 * primeiro.
 *
 * O que mora aqui e o que TODA loja precisa e que erra do mesmo jeito em
 * todas: escolher qual numero da vitrine e o preco, escolher qual <img> e a
 * foto do produto, e nao congelar um card lido antes da pagina hidratar.
 */
(function (window) {
  'use strict';
  if (window.__HUB) return;

  const texto = (el) => (el ? (el.textContent || '').trim() : '');

  /**
   * "R$ 1.234,56" -> 1234.56. Pega o primeiro preco do texto.
   *
   * O grupo do inteiro tem duas alternativas e a ordem importa: com milhar
   * (`1.234`) OU corrido (`1234`). Um `\d{1,3}(?:\.\d{3})*` solto nao e
   * ancorado -- em "R$ 1499,00" ele casa "149", o grupo de milhar casa vazio,
   * a virgula nunca e alcancada, e o resultado sai R$ 149,00. Erro de 10x
   * publicado como preco valido, sem nenhum sinal.
   */
  function parsePrecoBR(s) {
    if (!s) return undefined;
    const m = String(s).match(/R\$\s*(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})?/);
    if (!m) return undefined;
    const num = m[0].replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(num);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  /**
   * Le um bloco .andes-money-amount (padrao do ML) em reais.
   *
   * Reais e centavos vivem em spans separados: ler so a fracao transformaria
   * R$ 729,99 em R$ 729,00. E a fracao vem com ponto de milhar ("1.099").
   */
  function lerDinheiro(raiz) {
    if (!raiz) return undefined;
    const fracao = raiz.querySelector('.andes-money-amount__fraction');
    const digitos = texto(fracao).replace(/\D/g, '');
    if (!digitos) return parsePrecoBR(texto(raiz));
    const reais = parseInt(digitos, 10);
    if (!Number.isFinite(reais) || reais <= 0) return undefined;
    const cd = texto(raiz.querySelector('.andes-money-amount__cents')).replace(/\D/g, '');
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

  /**
   * Parcela sem classe conhecida. As classes das lojas mudam sem aviso, entao
   * a forma tambem conta: o container da parcela comeca com "12x".
   */
  function pareceParcela(el) {
    let no = el.parentElement;
    for (let i = 0; i < 3 && no; i++, no = no.parentElement) {
      if (/^\s*\d{1,2}\s*x\b/i.test(no.textContent || '')) return true;
    }
    return false;
  }

  /**
   * Preco por UNIDADE DE MEDIDA em produto multipack: "(R$ 2,01 / unidade)",
   * "R$ 1,52 / 100 g". Ler esse numero como preco da oferta publicou, no grupo
   * de um cliente da concorrente, um perfume de R$ 243,00 (105 ml) por
   * R$ 2,31 -- que e 243,00 / 105.
   *
   * Duas travas porque a marcacao muda entre pagina de produto e card de
   * grade: a classe que a loja usa hoje, e o TEXTO ao redor, que sobrevive a
   * uma troca de classe. O texto e lido so no proprio no e no pai direto:
   * mais acima ele ja engloba o preco de verdade e rejeitaria os dois.
   */
  const PPU_CLASSE = /priceperunit|contains-ppu/i;
  const PPU_TEXTO = /\/\s*(unidade|un\b|100\s*(g|ml)\b|kg\b|litro|l\b|m²|metro)|unidade\s+por|por\s+unidade/i;

  function ehPrecoPorUnidade(el) {
    let n = el;
    for (let i = 0; i < 4 && n; i++) {
      const cls = (n.getAttribute && n.getAttribute('class')) || '';
      if (PPU_CLASSE.test(cls)) return true;
      if (i <= 1 && PPU_TEXTO.test((n.textContent || '').slice(0, 160))) return true;
      n = n.parentElement;
    }
    return false;
  }

  const ehRiscado = (el) =>
    el.matches('s, del, .andes-money-amount--previous, .a-text-strike') || !!el.closest('s, del');

  /**
   * Acha o preco riscado pelo ESTILO em vez da classe. Ultimo recurso, quando
   * a loja nao tem gancho semantico nenhum -- `line-through` e a definicao do
   * que a gente procura, e nao quebra no proximo deploy deles.
   *
   * NAO restringir a elementos-folha: loja que quebra o preco em dois spans
   * (`<span>R$</span><span>59,90</span>`) poe o line-through no PAI, e
   * text-decoration nao aparece no estilo computado dos filhos.
   *
   * Escopo apertado de proposito, porque getComputedStyle e caro: so
   * elementos que ja contem "R$" no texto, no maximo 12 por card.
   */
  function riscadoPorEstilo(raiz) {
    let vistos = 0;
    for (const el of raiz.querySelectorAll('*')) {
      const txt = (el.textContent || '').trim();
      // Um preco e curto. O teto de 30 chars impede casar o card inteiro (que
      // obviamente tambem contem "R$") e pagar getComputedStyle em container
      // grande.
      if (!txt || txt.length > 30 || txt.indexOf('R$') === -1) continue;
      if (++vistos > 12) break;
      let deco = '';
      try { deco = getComputedStyle(el).textDecorationLine || ''; } catch { continue; }
      if (deco.indexOf('line-through') === -1) continue;
      const n = parsePrecoBR(txt);
      if (n) return n;
    }
    return undefined;
  }

  /**
   * Preco atual e preco cheio de um card ou pagina de produto.
   *
   * Nao usa min/max sobre os numeros da caixa -- foi assim que a parcela virou
   * preco (num controle de R$ 406,43 em "12x R$ 39,30", o menor numero anuncia
   * R$ 39,30 e 94% OFF). Separa por PAPEL: riscado e o cheio, e o primeiro
   * nao-riscado que sobra depois do ruido e o atual.
   *
   * `opcoes.seletoresRuido` -- CSS dos containers que nao sao preco do produto
   * (parcela, frete, "ou R$ X em outros meios"), que muda por loja.
   * `opcoes.blocos` -- CSS dos blocos de dinheiro da loja (o ML tem
   * `.andes-money-amount`; loja sem classe estavel passa `null` e cai no
   * caminho por texto).
   */
  function lerPrecos(raiz, opcoes = {}) {
    if (!raiz) return {};
    const { seletoresRuido = '', blocos = '.andes-money-amount', lerBloco = lerDinheiro } = opcoes;

    let price;
    let listPrice;

    if (blocos) {
      const candidatos = [...raiz.querySelectorAll(blocos)].filter(
        (el) =>
          !(seletoresRuido && el.closest(seletoresRuido)) &&
          !pareceParcela(el) &&
          !ehPrecoPorUnidade(el),
      );
      price = lerBloco(candidatos.find((el) => !ehRiscado(el)));
      listPrice = lerBloco(candidatos.find(ehRiscado));
    }

    if (!price) {
      // Fallback por texto: clona e REMOVE o riscado antes de parsear, senao o
      // primeiro "R$" do textContent pode ser o preco antigo -- em card sem
      // preco proprio ("Ver opcoes de compra") o produto sairia com o preco
      // cheio ANTIGO, e como os dois ficam iguais a sanidade abaixo descarta o
      // "de" e o dado sai limpo, sem sinal de erro.
      const clone = raiz.cloneNode(true);
      clone.querySelectorAll('s, del, .andes-money-amount--previous, .a-text-strike, .a-text-price')
        .forEach((el) => el.remove());
      price = parsePrecoBR(clone.textContent);
    }
    if (!listPrice) listPrice = riscadoPorEstilo(raiz);

    return {
      price: price || undefined,
      // So conta como "de" se for MAIOR: vendedor as vezes repete o mesmo
      // numero nos dois campos, e isso viraria um desconto de 0%.
      listPrice: listPrice && price && listPrice > price ? listPrice : undefined,
    };
  }

  /**
   * A URL da foto da Amazon carrega o TAMANHO e o FORMATO no proprio nome do
   * arquivo. O card da listagem traz sempre a versao de vitrine -- pequena,
   * recortada, as vezes AVIF com nome terminando em `.jpg` mesmo assim:
   *
   *   `._AC_SF226,226_QL85_`           226px       -> "a imagem esta pixelada"
   *   `._AC_FMavif_SF217.5,435_QL54_`  recorte 1:2 -> "fica comprida"
   *   `._AC_..._FMavif_...`            AVIF        -> WhatsApp nao renderiza
   *
   * Trocamos o trecho inteiro por `_SL1600_`: a foto do catalogo limitada a
   * 1600px no lado MAIOR. `SL` so reduz -- nunca amplia -- e preserva aspecto.
   * O prefixo `_AC_` NAO pode entrar junto: ele faz autocrop do espaco branco
   * antes de escalar, e um 1000x1000 volta como 581x797.
   *
   * A extensao do arquivo e PRESERVADA, nao fixada em `.jpg`: forcar `.jpg`
   * numa imagem `.png` devolve 404 -- trocar foto feia por foto quebrada e
   * pior que o defeito original. A query tambem cai, senao a Amazon
   * reintroduz o recorte.
   */
  const AMAZON_IMG = /^(https?:\/\/(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\/images\/(?:I|S\/[^/?#]+)\/[^./?#]+)(?:\.[^/?#]*?)?(\.[a-z]{3,4})?(?:[?#].*)?$/i;

  function normalizarImagem(href) {
    const m = String(href || '').match(AMAZON_IMG);
    return m ? `${m[1]}._SL1600_${m[2] || '.jpg'}` : href;
  }

  /**
   * Resolve a URL de UM <img>, ignorando placeholder. Devolve tambem DE ONDE
   * veio: a origem e o melhor sinal de qual imagem e a do produto.
   *
   * Tem que ser lista, e nao `a || b || c`: no lazy-load a loja deixa
   * src="data:image/gif..." -- que e truthy! -- e a foto real em data-src,
   * entao com o `||` o data-src nunca era alcancado.
   */
  function urlDoImg(img) {
    if (img.getAttribute('width') === '1' && img.getAttribute('height') === '1') return null;
    const ss = img.getAttribute('srcset');
    const fontes = [
      ['currentSrc', img.currentSrc],
      ['data-src', img.getAttribute('data-src')],
      ['src', img.getAttribute('src')],
      ['srcset', ss ? ss.trim().split(',')[0].trim().split(/\s+/)[0] : null],
    ];
    for (const [origem, src] of fontes) {
      if (!src || /^data:/i.test(src)) continue; // placeholder lazy-load
      let href = src;
      try { href = new URL(src, location.href).href; } catch { /* relativo esquisito */ }
      return { href, origem };
    }
    return null;
  }

  /**
   * Escolhe a MELHOR imagem do card, nao a primeira.
   *
   * Pegar a primeira e a causa de um estrago medido em producao pela
   * concorrente: 135 ofertas de um mesmo usuario publicadas com a MESMA
   * imagem -- um selo de frete que vinha antes da foto no DOM e ja estava
   * carregado, enquanto a foto do produto ainda era placeholder. Nao era
   * "imagem faltando", era imagem ERRADA, que e pior: ninguem percebe.
   *
   * Duas regras, nesta ordem:
   *  1. URL vinda de `data-src` vence. data-src e lazy-load, e selo/banner nao
   *     costuma ser lazy -- quem e lazy num card de listagem e a foto.
   *  2. Senao, a de maior area renderizada. Selo e pequeno; foto nao. (Area so
   *     serve entre imagens JA carregadas; por isso e a segunda regra --
   *     placeholder tem area ~1 e perderia pro selo.)
   */
  function extrairMelhorImagem(cardEl) {
    let porArea = null;
    let maiorArea = -1;
    for (const img of cardEl.querySelectorAll('img')) {
      const r = urlDoImg(img);
      if (!r) continue;
      if (r.origem === 'data-src') return normalizarImagem(r.href);
      const area = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
      if (area > maiorArea) { maiorArea = area; porArea = r.href; }
    }
    return porArea ? normalizarImagem(porArea) : undefined;
  }

  /**
   * Teto de releituras do mesmo card durante o autoscroll. Completar em vez de
   * congelar tem um custo que congelar nao tinha: um card que NUNCA completa
   * passaria a ser reprocessado em todos os scans. Seis tentativas cobrem com
   * folga o tempo de hidratacao sem virar custo fixo.
   */
  const MAX_RELEITURAS = 6;

  const novoAcumulador = () => ({ produtos: new Map(), tentativas: new Map(), prontos: new Set() });

  /**
   * Registra/completa um produto no acumulador, deduplicado por id.
   *
   * COMPLETA em vez de CONGELAR. Congelar a primeira leitura (`if (visto)
   * return`) parece certo ate lembrar que o scan roda a cada poucos frames
   * DURANTE o autoscroll: o card e lido no instante em que entra no DOM, antes
   * da hidratacao, com o alt da imagem ainda vazio -- e o que faltasse ali
   * faltava pra sempre. Num lote real da concorrente, 16 de 34 produtos da
   * Amazon foram embora sem titulo, e o app gravava a palavra "Produto" no
   * lugar, publicada no grupo do cliente.
   *
   * `ler()` so e chamada se ainda vale a pena reler: e ela que toca o DOM, e
   * pular a chamada e o que economiza o custo.
   */
  function registrar(acc, id, ler) {
    if (acc.prontos.has(id)) return;
    const tentativa = (acc.tentativas.get(id) || 0) + 1;
    if (tentativa > MAX_RELEITURAS) { acc.prontos.add(id); return; }
    acc.tentativas.set(id, tentativa);

    const novo = ler() || {};
    const atual = acc.produtos.get(id) || {};
    const junto = { ...atual };
    for (const [chave, valor] of Object.entries(novo)) {
      // Falsy nao substitui o que ja veio bom: '' e 0 e undefined sao "nao
      // consegui ler agora", nunca "o valor e vazio".
      if (junto[chave] === undefined && valor !== undefined && valor !== '' && valor !== 0) {
        junto[chave] = valor;
      }
    }
    acc.produtos.set(id, junto);
    if (junto.title && junto.imageUrl && junto.price) acc.prontos.add(id);
  }

  window.__HUB = {
    texto, parsePrecoBR, lerDinheiro, lerVendidos, lerPrecos,
    normalizarImagem, extrairMelhorImagem, novoAcumulador, registrar,
  };
})(window);
