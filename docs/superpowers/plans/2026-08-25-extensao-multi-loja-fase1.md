# Extensão multi-loja Fase 1 (ML + Amazon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrair a lógica de captura robusta para um módulo compartilhado, adicionar Amazon como segunda loja da extensão, e trocar o botão flutuante por um widget on-page com badge de loja e contador.

**Architecture:** Um `content/shared.js` com helpers de extração (preço por papel, melhor imagem, retry-até-completar, autoscroll, widget Shadow DOM). Um arquivo por loja (`content/ml.js` refatorado, `content/amazon.js` novo) declarando só seletores e regex de id. Captura continua guardando em `chrome.storage.local` e o envio real segue no side panel com revisão por checkbox.

**Tech Stack:** JS puro (sem bundler, sem TypeScript), Chrome Manifest V3, content scripts clássicos (não-módulo), `chrome.storage.local`, Shadow DOM.

**Spec:** `docs/superpowers/specs/2026-08-25-extensao-multi-loja-design.md`

## Global Constraints

- `extensao/` é **JS puro sem bundler**, compatível com Manifest V3. Content scripts **não** rodam como módulo ES: sem `import`/`export` em `content/*.js` — a comunicação entre `shared.js` e os arquivos de loja é via um global (`window.__HUB`). `lib/log.js` e `ui/panel.js` continuam módulos ES (já são).
- Paleta: amarelo da marca `#ffe01b` sobre tinta escura `#16171a`, como já está em `content/ml.css`. **Nunca** adotar o dark+dourado da concorrente.
- Comentários em código explicam **por que**, não o quê — seguir o estilo denso já presente em `content/ml.js` (ex.: comentário do `RUIDO_DE_PRECO`).
- Sem dependência nova. Sem framework de teste: as verificações são `.check.mjs` rodáveis com `node` puro.
- Nada é enviado ao Hub sem o usuário revisar no side panel. A captura só grava `captura_pendente`.
- Texto de UI em português.

---

### Task 1: `shared.js` — preço por papel, com guarda de preço-por-unidade

**Files:**
- Create: `extensao/content/shared.js`
- Test: `extensao/content/shared.check.mjs`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: global `window.__HUB` com `{ texto, parsePrecoBR, lerDinheiro, lerVendidos, lerPrecos }`.
  - `texto(el) -> string` — textContent trimado, `''` se nulo.
  - `parsePrecoBR(s) -> number | undefined` — "R$ 1.234,56" vira `1234.56`.
  - `lerDinheiro(raiz) -> number | undefined` — lê `.andes-money-amount` (fração + centavos).
  - `lerVendidos(str) -> number | undefined` — "+10mil vendidos" vira `10000`.
  - `lerPrecos(raiz, opcoes) -> { price?: number, listPrice?: number }` — `opcoes.seletoresRuido` (string CSS) e `opcoes.lerBloco` (função que lê um bloco de dinheiro; padrão `lerDinheiro`).

- [ ] **Step 1: Escrever o self-check que falha**

Criar `extensao/content/shared.check.mjs`. Ele carrega `shared.js` num escopo com um `window` falso (o arquivo é um IIFE que escreve em `window.__HUB`) e testa só as funções puras — `lerPrecos` depende de DOM e é verificada manualmente na Task 6.

```js
// Self-check das funcoes puras de shared.js. Roda com `node shared.check.mjs`,
// sem dependencia nenhuma: content script e JS puro e nao tem suite de teste.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const aqui = dirname(fileURLToPath(import.meta.url));
const codigo = readFileSync(join(aqui, 'shared.js'), 'utf8');

// shared.js e um IIFE que escreve em window.__HUB. Aqui damos um window falso.
const janela = {};
new Function('window', codigo)(janela);
const H = janela.__HUB;

// parsePrecoBR: ponto e milhar, virgula e decimal.
assert.equal(H.parsePrecoBR('R$ 1.234,56'), 1234.56, 'milhar + centavos');
assert.equal(H.parsePrecoBR('R$ 1499,00'), 1499, 'sem separador de milhar');
assert.equal(H.parsePrecoBR('R$ 89'), 89, 'sem centavos');
assert.equal(H.parsePrecoBR('sem preco aqui'), undefined, 'texto sem preco');
assert.equal(H.parsePrecoBR(''), undefined, 'string vazia');

// lerVendidos: mil e milhao viram numero cheio.
assert.equal(H.lerVendidos('+10mil vendidos'), 10000, 'mil colado');
assert.equal(H.lerVendidos('Mais de 50 mil vendidos'), 50000, 'mil separado');
assert.equal(H.lerVendidos('1.234 vendidos'), 1234, 'milhar com ponto');
assert.equal(H.lerVendidos('novo'), undefined, 'sem vendidos');

console.log('shared.check: ok');
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `node extensao/content/shared.check.mjs`
Expected: FAIL — `Cannot find module` / `ENOENT` em `shared.js` (o arquivo ainda não existe).

- [ ] **Step 3: Escrever `shared.js` com as funções desta task**

As funções `texto`, `lerDinheiro`, `lerVendidos` e a lista `RUIDO_DE_PRECO` saem de `content/ml.js` (linhas 25, 121-131, 133-143, 157-206) — mover, não reescrever: elas já carregam o hardening documentado. Novo em relação ao ML: `parsePrecoBR` (a concorrente tem, nós não tínhamos), a guarda de preço-por-unidade, o fallback de riscado por estilo computado, e `lerPrecos` receber os seletores de ruído por parâmetro (cada loja tem os seus).

```js
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

  window.__HUB = { texto, parsePrecoBR, lerDinheiro, lerVendidos, lerPrecos };
})(window);
```

- [ ] **Step 4: Rodar o self-check e confirmar que passa**

Run: `node extensao/content/shared.check.mjs`
Expected: PASS — imprime `shared.check: ok`.

- [ ] **Step 5: Commit**

```bash
git add extensao/content/shared.js extensao/content/shared.check.mjs
git commit -m "feat(extensao): shared.js com leitura de preco por papel"
```

---

### Task 2: `shared.js` — melhor imagem e completar-em-vez-de-congelar

**Files:**
- Modify: `extensao/content/shared.js`
- Modify: `extensao/content/shared.check.mjs`

**Interfaces:**
- Consumes: `window.__HUB` da Task 1.
- Produces: soma a `window.__HUB`:
  - `normalizarImagem(href) -> string` — troca o trecho de tamanho da URL da Amazon por `_SL1600_`; outras URLs voltam intactas.
  - `extrairMelhorImagem(cardEl) -> string | undefined`.
  - `registrar(acc, id, ler) -> void` — `acc` é `{ produtos: Map, tentativas: Map, prontos: Set }`; `ler()` devolve o objeto parcial do card.
  - `novoAcumulador() -> { produtos, tentativas, prontos }`.

- [ ] **Step 1: Somar os casos ao self-check**

Acrescentar ao fim de `shared.check.mjs`, antes do `console.log`:

```js
// normalizarImagem: a URL da foto da Amazon carrega tamanho e formato no nome
// do arquivo. O card da listagem traz a versao de vitrine -- pequena,
// recortada, as vezes AVIF (que o WhatsApp nao renderiza). `_SL1600_` limita
// o lado maior a 1600px e so REDUZ, nunca amplia, preservando o aspecto.
const A = 'https://m.media-amazon.com/images/I/51G+D9DlGxL';
assert.equal(H.normalizarImagem(`${A}._AC_SF226,226_QL85_.jpg`), `${A}._SL1600_.jpg`, 'crop pequeno');
assert.equal(H.normalizarImagem(`${A}._AC_FMavif_SF217.5,435_QL54_.jpg`), `${A}._SL1600_.jpg`, 'avif recortado');
// A extensao do arquivo e PRESERVADA, nao fixada em .jpg: forcar .jpg numa
// imagem .png devolve 404, e trocar foto feia por foto quebrada e pior.
assert.equal(H.normalizarImagem(`${A}._SS200_.png`), `${A}._SL1600_.png`, 'png segue png');
assert.equal(H.normalizarImagem(`${A}.jpg?aicid=homepage`), `${A}._SL1600_.jpg`, 'query cai fora');
// URL de outra loja passa intacta.
const outra = 'https://http2.mlstatic.com/D_NQ_NP_123-MLB456.webp';
assert.equal(H.normalizarImagem(outra), outra, 'nao-Amazon intacta');

// registrar: COMPLETA em vez de congelar. Card lido antes da hidratacao volta
// sem titulo; a proxima leitura preenche, sem sobrescrever o que ja veio bom.
const acc = H.novoAcumulador();
H.registrar(acc, 'MLB1', () => ({ url: 'u', title: '', price: 10 }));
assert.equal(acc.produtos.get('MLB1').price, 10, 'preco da 1a leitura');
assert.equal(acc.produtos.get('MLB1').title, undefined, 'titulo vazio nao entra');
H.registrar(acc, 'MLB1', () => ({ url: 'u', title: 'Furadeira', price: 99 }));
assert.equal(acc.produtos.get('MLB1').title, 'Furadeira', '2a leitura completa o titulo');
assert.equal(acc.produtos.get('MLB1').price, 10, 'preco bom nao e sobrescrito');

// Teto de releituras: card que nunca completa para de custar.
const acc2 = H.novoAcumulador();
let leituras = 0;
for (let i = 0; i < 20; i++) H.registrar(acc2, 'MLB2', () => { leituras++; return { url: 'u' }; });
assert.equal(leituras, 6, 'para em MAX_RELEITURAS');
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `node extensao/content/shared.check.mjs`
Expected: FAIL — `TypeError: H.normalizarImagem is not a function`.

- [ ] **Step 3: Implementar em `shared.js`**

Inserir antes da linha `window.__HUB = ...`:

```js
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
```

E trocar a linha final por:

```js
  window.__HUB = {
    texto, parsePrecoBR, lerDinheiro, lerVendidos, lerPrecos,
    normalizarImagem, extrairMelhorImagem, novoAcumulador, registrar,
  };
```

- [ ] **Step 4: Rodar o self-check e confirmar que passa**

Run: `node extensao/content/shared.check.mjs`
Expected: PASS — `shared.check: ok`.

- [ ] **Step 5: Commit**

```bash
git add extensao/content/shared.js extensao/content/shared.check.mjs
git commit -m "feat(extensao): melhor imagem e releitura de card incompleto"
```

---

### Task 3: `shared.js` — autoscroll genérico com host resiliente

**Files:**
- Modify: `extensao/content/shared.js`

**Interfaces:**
- Consumes: `novoAcumulador`, `registrar` da Task 2.
- Produces: soma a `window.__HUB`:
  - `manterMontado(host) -> void` — reata `host` ao body se a página o remover.
  - `rolarAcumulando(varrer, opcoes) -> Promise<Array>` — `varrer(acc)` é chamada a cada parada e devolve o total acumulado; `opcoes` = `{ alvo, esperaMs, maxPassos, aoProgredir }`.

- [ ] **Step 1: Implementar em `shared.js`**

Não há self-check pra esta task: as duas funções são inteiramente DOM/scroll, verificadas na Task 6 (verificação manual por loja). Inserir antes do `window.__HUB = ...`:

```js
  /**
   * Mantem um elemento fixo montado mesmo quando a pagina remonta o body.
   *
   * A Amazon re-renderiza a grade de resultados durante o autoscroll e leva o
   * host junto. O garimpo entao morre EM SILENCIO: os elementos que a gente
   * atualiza (contador, mensagem de erro) continuam existindo como nos
   * DESTACADOS, entao escrever neles nao lanca -- so nao aparece pra ninguem.
   * Medido pela concorrente numa busca da Amazon: a varredura parou em 640px
   * de 6.298px, sem widget na tela e sem nenhuma mensagem ao usuario.
   *
   * Remontar preserva o estado: o conteudo vive dentro do proprio host, entao
   * re-anexar o MESMO elemento devolve a UI exatamente como estava.
   *
   * Dois observadores, ambos so de childList (sem subtree): num autoscroll a
   * pagina dispara milhares de mutacoes, e observar a arvore inteira custaria
   * caro justamente no momento mais pesado.
   *  - no body: pega a remocao do host;
   *  - no documentElement: pega a troca do body INTEIRO, caso em que o
   *    observador do body antigo fica orfao e precisa ser refeito.
   */
  function manterMontado(host) {
    let obsBody = null;
    function garantir() {
      if (!document.body || host.isConnected) return;
      document.body.appendChild(host);
      observarBody();
    }
    function observarBody() {
      if (obsBody) obsBody.disconnect();
      if (!document.body) return;
      obsBody = new MutationObserver(garantir);
      obsBody.observe(document.body, { childList: true });
    }
    new MutationObserver(garantir).observe(document.documentElement, { childList: true });
    observarBody();
    return garantir;
  }

  /**
   * Rola a pagina acumulando o que cada parada revelou.
   *
   * Grid virtualizado (o painel de afiliado do ML, a grade da Amazon) so
   * mantem no DOM os cards perto da posicao atual -- os que saem da vista
   * SOMEM. Pular direto pro fim so ve a primeira leva e a ultima. Por isso
   * rola em passos de quase uma tela e chama `varrer` em CADA parada, nunca
   * so no estado final.
   *
   * `varrer(acc)` faz o registro no acumulador e devolve quantos ja tem.
   * Volta pro topo no fim: deixar o usuario no rodape de uma busca de 200
   * itens e desorientador.
   */
  async function rolarAcumulando(varrer, opcoes = {}) {
    const { alvo = Infinity, esperaMs = 500, maxPassos = 150, aoProgredir } = opcoes;
    const acc = novoAcumulador();
    const origemY = window.scrollY;
    let semNovoNoFim = 0;
    let anterior = 0;

    for (let i = 0; i < maxPassos; i++) {
      const total = varrer(acc);
      if (aoProgredir) aoProgredir(total);
      if (total >= alvo) break;

      const noFim = window.scrollY + window.innerHeight >= document.body.scrollHeight - 4;
      if (noFim && total === anterior) {
        // Tres paradas no rodape sem nada novo: a pagina acabou de verdade, e
        // nao e o carregamento por scroll infinito ainda buscando.
        if (++semNovoNoFim >= 3) break;
      } else {
        semNovoNoFim = 0;
      }
      anterior = total;

      window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      await new Promise((r) => setTimeout(r, esperaMs));
    }

    varrer(acc);
    window.scrollTo({ top: origemY });
    return [...acc.produtos.values()];
  }
```

Somar `manterMontado` e `rolarAcumulando` ao objeto `window.__HUB`.

- [ ] **Step 2: Verificar que o arquivo continua carregando**

Run: `node extensao/content/shared.check.mjs`
Expected: PASS — `shared.check: ok`. (As funções novas não são exercidas aqui; o check serve pra pegar erro de sintaxe que quebraria o arquivo inteiro.)

- [ ] **Step 3: Commit**

```bash
git add extensao/content/shared.js
git commit -m "feat(extensao): autoscroll generico com host resiliente"
```

---

### Task 4: `shared.js` — widget on-page

**Files:**
- Modify: `extensao/content/shared.js`
- Modify: `extensao/content/ml.css`

**Interfaces:**
- Consumes: `manterMontado` da Task 3.
- Produces: soma a `window.__HUB`:
  - `montarWidget({ loja, rotulo, aoCapturar }) -> void` — `aoCapturar(api)` recebe `{ progresso(n), pronto(n), erro(msg) }` e devolve `Promise`.

- [ ] **Step 1: Implementar `montarWidget` em `shared.js`**

O widget substitui o `#hubofertas-btn` atual. Usa Shadow DOM fechado (o CSS da loja não vaza pra dentro nem o nosso pra fora — a página do ML tem regras agressivas de `button`), com a paleta que já está em `ml.css`. Inserir antes do `window.__HUB = ...`:

```js
  const ID_HOST = 'hubofertas-widget';

  /**
   * Widget flutuante da captura. Shadow DOM fechado: a pagina da loja tem
   * regras agressivas em `button` e `div`, e o inverso tambem vale -- nosso
   * estilo nao pode vazar pra vitrine do cliente.
   *
   * NAO envia nada ao Hub. Captura, guarda em captura_pendente, e manda o
   * usuario pro painel lateral -- e la, com checkbox por item, que o envio de
   * verdade acontece. Mesma regra que os botoes do hub ja seguiam.
   */
  function montarWidget({ loja, rotulo, aoCapturar }) {
    if (document.getElementById(ID_HOST)) return;

    const host = document.createElement('div');
    host.id = ID_HOST;
    document.body.appendChild(host);
    manterMontado(host);
    const raiz = host.attachShadow({ mode: 'closed' });

    // Favicon da propria loja: e sempre a logo certa, sem a gente empacotar
    // um icone por marketplace.
    const favHref = document.querySelector('link[rel~="icon"]')?.getAttribute('href') || '/favicon.ico';
    const favUrl = new URL(favHref, location.origin).href;

    raiz.innerHTML = `
      <style>
        :host{all:initial}
        *{box-sizing:border-box;font:500 13px/1.4 system-ui,sans-serif}
        .caixa{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:236px;
          background:#16171a;color:#fff;border:2px solid #ffe01b;border-radius:8px;
          box-shadow:0 4px 16px rgba(0,0,0,.28);overflow:hidden}
        .topo{display:flex;align-items:center;gap:8px;padding:10px 12px;
          border-bottom:1px solid rgba(255,255,255,.1)}
        .fav{width:16px;height:16px;border-radius:3px;background:#fff;object-fit:contain}
        .loja{font-weight:600;color:#ffe01b}
        .corpo{padding:12px}
        .btn{width:100%;padding:10px 14px;border:2px solid #ffe01b;border-radius:6px;
          background:#16171a;color:#ffe01b;font:600 14px/1.2 system-ui,sans-serif;cursor:pointer}
        .btn:hover:not(:disabled){background:#23252a}
        .btn:disabled{opacity:.6;cursor:wait}
        .msg{margin-top:10px;font-size:12px;line-height:1.45;color:#d8d8d8}
        .msg[data-tom="erro"]{color:#ff8b7a}
        .msg[data-tom="ok"]{color:#8ce39a}
        .msg:empty{display:none}
      </style>
      <div class="caixa">
        <div class="topo">
          <img class="fav" id="fav" src="${favUrl}" alt="" />
          <span class="loja">${loja}</span>
        </div>
        <div class="corpo">
          <button class="btn" id="capturar">${rotulo}</button>
          <p class="msg" id="msg"></p>
        </div>
      </div>`;

    const botao = raiz.getElementById('capturar');
    const msg = raiz.getElementById('msg');
    // Favicon que nao carrega deixaria um icone quebrado ao lado do nome.
    raiz.getElementById('fav').addEventListener('error', (e) => e.target.remove());

    const dizer = (texto, tom) => { msg.textContent = texto; msg.dataset.tom = tom || ''; };

    botao.addEventListener('click', async () => {
      botao.disabled = true;
      dizer('');
      try {
        await aoCapturar({
          progresso: (n) => { botao.textContent = `Varrendo... (${n})`; },
          pronto: (n) => dizer(`${n} produto(s) prontos. Abra o painel lateral, revise e clique "Enviar ao Hub".`, 'ok'),
          erro: (texto) => dizer(texto, 'erro'),
        });
      } catch (e) {
        // "Extension context invalidated" nao e bug: acontece toda vez que a
        // extensao e recarregada em chrome://extensions com esta aba ja
        // aberta -- o script daqui fica orfao, sem conexao com a extensao
        // reiniciada. So um F5 nesta pagina resolve.
        dizer(
          /context invalidated/i.test(e.message || '')
            ? 'A extensão foi recarregada. Dê um F5 nesta página e tente de novo.'
            : e.message,
          'erro',
        );
      } finally {
        botao.disabled = false;
        botao.textContent = rotulo;
      }
    });
  }
```

Somar `montarWidget` ao `window.__HUB`.

- [ ] **Step 2: Limpar `ml.css`**

O widget carrega o próprio estilo no Shadow DOM. `ml.css` fica só com o que ainda é usado — os botões do hub, que a Task 5 mantém — e perde `#hubofertas-btn` e `#hubofertas-aviso`, que somem com o widget novo. Substituir o conteúdo inteiro de `extensao/content/ml.css` por:

```css
/* Painel de afiliado (hub): wrapper que empilha os botoes de captura em massa.
   O widget de captura comum nao esta aqui -- ele vive no Shadow DOM
   (shared.js), fora do alcance do CSS da loja. */
#hubofertas-btns {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
}

.hubofertas-btn-hub {
  background: #16171a;
  color: #ffe01b;
  border: 2px solid #ffe01b;
  border-radius: 6px;
  padding: 11px 16px;
  font: 600 14px/1.2 system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
}

.hubofertas-btn-hub:hover { background: #23252a; }
.hubofertas-btn-hub:disabled { opacity: 0.6; cursor: wait; }
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node extensao/content/shared.check.mjs`
Expected: PASS — `shared.check: ok`.

- [ ] **Step 4: Commit**

```bash
git add extensao/content/shared.js extensao/content/ml.css
git commit -m "feat(extensao): widget on-page em Shadow DOM"
```

---

### Task 5: Refatorar `content/ml.js` pra usar `shared.js`

**Files:**
- Modify: `extensao/content/ml.js`
- Modify: `extensao/manifest.json`

**Interfaces:**
- Consumes: `window.__HUB` inteiro (Tasks 1-4).
- Produces: nada consumido por outra task — `amazon.js` (Task 6) usa `__HUB` direto, não `ml.js`.

- [ ] **Step 1: Remover de `ml.js` o que agora mora em `shared.js`**

Apagar de `extensao/content/ml.js`: `texto` (linha 25), `lerDinheiro` (121-131), `lerVendidos` (133-143), `RUIDO_DE_PRECO` (157-166), `pareceParcela` (168-178), `ehRiscado` (180-181), `lerPrecos` (190-206). No topo do IIFE, somar:

```js
  const H = window.__HUB;
  if (!H) return; // shared.js nao carregou -- sem ele nada aqui funciona

  const { texto, lerVendidos, extrairMelhorImagem, novoAcumulador, registrar } = H;

  /**
   * Ruido de preco do ML: parcela, frete e "ou R$ X em outros meios" nao sao o
   * preco do produto. O erro mais caro da vitrine e a parcela -- num controle
   * de R$ 406,43 em "12x R$ 39,30", pegar o menor numero anuncia R$ 39,30 e
   * 94% OFF, preco mentiroso no grupo, e o grupo e o ativo que nao da pra
   * reconstruir.
   */
  const RUIDO_ML = [
    '.poly-price__installments',
    '.ui-search-installments',
    '.ui-search-item__group--installments',
    '.ui-pdp-price__subtitles',
    '.poly-component__shipping',
    '.ui-search-item__shipping',
    '.poly-price__other-payment',
    '.ui-search-price__other-payment',
  ].join(', ');

  const lerPrecos = (raiz) => H.lerPrecos(raiz, { seletoresRuido: RUIDO_ML });
```

`registrarLog`, `resolverUrlMl`, `jm`, `BASE_ML`, `capturarPdp`, `raizDoPreco`, `ehPdp`, `ehListagem`, `ehHub`, `extrairCards`, `rolarAcumulando`, `capturarHub`, `criarBotaoHub` e o listener de `raspar` **ficam** — carregam hardening específico do ML e não são genéricos.

- [ ] **Step 2: Trocar a leitura de imagem pela versão boa**

Em `capturarListagemDoDom` e em `extrairCards`, a imagem hoje é `card.querySelector('img')` com `data-src || src` — pega a primeira, que é o bug do selo de frete. Trocar as duas ocorrências de:

```js
      const img = card.querySelector('img');
```
```js
        imageUrl: (img && (img.getAttribute('data-src') || img.src)) || undefined,
```

por:

```js
        imageUrl: extrairMelhorImagem(card),
```

(removendo a linha do `const img`). Em `capturarPdp` **não** mexer: a PDP tem galeria com seletor específico (`.ui-pdp-gallery__figure img`), que é mais confiável que a heurística genérica.

- [ ] **Step 3: Trocar o botão de listagem/PDP pelo widget**

Substituir o bloco final de `montarBotao` (o `const botao = document.createElement('button')` até `document.body.appendChild(botao)`) por:

```js
    H.montarWidget({
      loja: 'Mercado Livre',
      rotulo: pdp ? 'Capturar produto' : 'Capturar esta busca',
      async aoCapturar({ progresso, pronto, erro }) {
        // PDP e uma leitura so; listagem rola a pagina acumulando, porque a
        // grade do ML e virtualizada e o que sai da vista some do DOM.
        const produtos = pdp
          ? [capturarPdp()].filter(Boolean)
          : await H.rolarAcumulando(
              (acc) => {
                for (const p of capturarListagemDoDom()) {
                  registrar(acc, p.externalId, () => p);
                }
                return acc.produtos.size;
              },
              { aoProgredir: progresso },
            );

        if (!produtos.length) {
          erro('Não encontrei produto nesta página.');
          return;
        }
        await chrome.storage.local.set({ captura_pendente: { produtos, criadoEm: Date.now() } });
        void registrarLog('info', `${produtos.length} produto(s) capturado(s) do ML -- nada foi enviado ainda.`);
        pronto(produtos.length);
      },
    });
    return;
```

E apagar a função `enviar` e a função `avisar`: nenhuma das duas tem chamador depois desta troca — `enviar` mandava direto pro Hub (que era a inconsistência com o fluxo de revisão), e `avisar` era a caixinha de aviso que o widget substitui. Os `avisar(...)` dentro de `criarBotaoHub` viram `void registrarLog(...)` com o mesmo texto, já que o botão do hub segue sem widget.

- [ ] **Step 4: Somar `shared.js` ao manifest**

Em `extensao/manifest.json`, no bloco de `content_scripts`, trocar `"js": ["content/ml.js"]` por:

```json
      "js": ["content/shared.js", "content/ml.js"],
```

A ordem importa: `shared.js` publica `window.__HUB`, que `ml.js` lê no topo.

- [ ] **Step 5: Verificar no navegador**

1. `chrome://extensions` → recarregar a extensão.
2. Abrir uma busca do ML (ex.: `https://lista.mercadolivre.com.br/furadeira`), F5.
3. O widget aparece no canto inferior direito com o favicon do ML e "Mercado Livre".
4. Clicar "Capturar esta busca": a página rola sozinha, o botão vira "Varrendo... (N)", volta ao topo, e a mensagem verde diz quantos ficaram prontos.
5. Abrir o painel lateral: a lista traz os produtos com título e preço; conferir contra a tela que os preços batem (nenhum preço de parcela, nenhum "de" menor que o "por").
6. Abrir uma PDP, repetir: o widget diz "Capturar produto" e captura 1.
7. Abrir `/afiliados/hub`: o botão antigo de desconto continua lá e funcionando.

Expected: todos os passos acima acontecem como descrito.

- [ ] **Step 6: Commit**

```bash
git add extensao/content/ml.js extensao/manifest.json
git commit -m "refactor(extensao): ml.js usa shared.js e o widget novo"
```

---

### Task 6: `content/amazon.js` — segunda loja

**Files:**
- Create: `extensao/content/amazon.js`
- Modify: `extensao/manifest.json`
- Modify: `extensao/content/shared.check.mjs`

**Interfaces:**
- Consumes: `window.__HUB` inteiro.
- Produces: nada — é folha.

- [ ] **Step 1: Somar ao self-check os casos de id da Amazon**

`extrairAsin` é pura e vale testar. Como ela vive em `amazon.js` (que é IIFE de content script e depende de `document` no resto do arquivo), a função é publicada em `window.__HUB_AMAZON` pra ficar alcançável. Acrescentar ao `shared.check.mjs`, antes do `console.log`:

```js
// amazon.js publica os helpers puros ANTES do guard de hostname, justamente
// pra este check alcancar as funcoes sem executar o resto do content script
// (que toca chrome.*, MutationObserver e DOM real, nenhum deles existe aqui).
// Por isso o hostname falso e de outra loja: o guard entao retorna cedo.
const codigoAmazon = readFileSync(join(aqui, 'amazon.js'), 'utf8');
const janelaAmazon = { __HUB: H, location: { hostname: 'exemplo.invalido' } };
new Function('window', 'document', codigoAmazon)(janelaAmazon, {});
const AZ = janelaAmazon.__HUB_AMAZON;

assert.equal(AZ.extrairAsin('https://www.amazon.com.br/dp/B08N5WRWNW'), 'B08N5WRWNW', 'forma /dp/');
assert.equal(AZ.extrairAsin('https://www.amazon.com.br/gp/product/B08N5WRWNW/ref=x'), 'B08N5WRWNW', 'forma /gp/product/');
assert.equal(AZ.extrairAsin('https://www.amazon.com.br/Nome-Do-Produto/dp/B08N5WRWNW?th=1'), 'B08N5WRWNW', 'com slug e query');
assert.equal(AZ.extrairAsin('https://www.amazon.com.br/s?k=furadeira'), null, 'pagina de busca nao e produto');
assert.equal(AZ.extrairAsin('https://www.mercadolivre.com.br/p/MLB123456'), null, 'outra loja');

// canonica: sai limpa, sem query nem slug -- o que a gente guarda e o que
// vira link de afiliado depois, e parametro de tracking da busca nao pode ir
// junto.
assert.equal(
  AZ.canonicaDe('https://www.amazon.com.br/Nome/dp/B08N5WRWNW?ref=sr_1_3'),
  'https://www.amazon.com.br/dp/B08N5WRWNW',
  'canonica limpa',
);
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `node extensao/content/shared.check.mjs`
Expected: FAIL — `ENOENT` em `amazon.js`.

- [ ] **Step 3: Escrever `extensao/content/amazon.js`**

```js
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

  function capturarProduto() {
    const canonicalUrl = canonicaDe(location.href);
    if (!canonicalUrl) return null;
    const { price, listPrice } = lerPrecos(document.getElementById('centerCol') || document.body, {
      seletoresRuido: RUIDO_AMAZON,
      blocos: BLOCOS_AMAZON,
      lerBloco: (el) => (el ? H.parsePrecoBR(texto(el)) : undefined),
    });
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
        const { price, listPrice } = lerPrecos(card, {
          seletoresRuido: RUIDO_AMAZON,
          blocos: BLOCOS_AMAZON,
          lerBloco: (el) => (el ? H.parsePrecoBR(texto(el)) : undefined),
        });
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
```

- [ ] **Step 4: Rodar o self-check e confirmar que passa**

Run: `node extensao/content/shared.check.mjs`
Expected: PASS — `shared.check: ok`.

- [ ] **Step 5: Somar Amazon ao manifest**

Em `extensao/manifest.json`:

```json
  "host_permissions": [
    "https://*.mercadolivre.com.br/*",
    "https://*.mercadolibre.com/*",
    "https://*.amazon.com.br/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
```

E no bloco de `content_scripts`:

```json
      "matches": [
        "https://*.mercadolivre.com.br/*",
        "https://*.mercadolibre.com/*",
        "https://*.amazon.com.br/*"
      ],
      "js": ["content/shared.js", "content/ml.js", "content/amazon.js"],
```

`ml.js` e `amazon.js` se auto-guardam pelo hostname, então carregar os dois em ambos os domínios é inofensivo e evita manter dois blocos de manifest em sincronia.

- [ ] **Step 6: Verificar no navegador**

1. `chrome://extensions` → recarregar.
2. Abrir `https://www.amazon.com.br/s?k=fone+de+ouvido`, F5.
3. Widget aparece com favicon da Amazon e "Amazon".
4. Capturar: rola, conta, volta ao topo, diz quantos ficaram prontos.
5. Painel lateral: conferir item a item contra a tela — **nenhum título é "14% off" ou similar**, nenhum preço é o de "por unidade" (procurar um multipack: fralda, pilha, cápsula de café), e todo "de" riscado é maior que o "por".
6. Abrir uma página de produto da Amazon, capturar: 1 produto, com o título do `#productTitle`.
7. Voltar numa aba de ML e confirmar que o widget do ML continua funcionando (os dois arquivos convivem).

Expected: todos os passos acontecem como descrito. Anotar quantos itens saíram sem preço ou sem imagem — se for mais que uns poucos, é sinal de que `MAX_RELEITURAS` ou o `esperaMs` do autoscroll precisa subir.

- [ ] **Step 7: Commit**

```bash
git add extensao/content/amazon.js extensao/content/shared.check.mjs extensao/manifest.json
git commit -m "feat(extensao): captura da Amazon"
```

---

### Task 7: Side panel multi-loja

**Files:**
- Modify: `extensao/ui/panel.js`
- Modify: `extensao/ui/panel.css`

**Interfaces:**
- Consumes: produtos com `platform: 'MERCADO_LIVRE' | 'AMAZON'` (Tasks 5 e 6).
- Produces: nada — é folha.

- [ ] **Step 1: Generalizar a detecção de página suportada**

Em `extensao/ui/panel.js`, trocar `ehPaginaMl` (linha 65) por:

```js
/**
 * Hosts que a extensao sabe capturar. Precisa bater com o `matches` dos
 * content_scripts do manifest: dizer "suportada" aqui numa pagina onde o
 * content script nao roda leva o painel a mostrar area de captura e depois
 * falhar no sendMessage.
 */
const LOJAS = [
  { teste: /(^|\/\/)([^/]*\.)?mercadoli(vre|bre)\.com(\.br)?\//i, nome: 'Mercado Livre' },
  { teste: /(^|\/\/)([^/]*\.)?amazon\.com\.br\//i, nome: 'Amazon' },
];

const ehPaginaSuportada = (url) => LOJAS.some((l) => l.teste.test(url || ''));
```

Trocar as duas chamadas de `ehPaginaMl(tab.url)` (linha 108) por `ehPaginaSuportada(tab.url)`.

- [ ] **Step 2: Mostrar a loja de cada item**

O nome da loja por item importa porque a lista pode misturar origens: o usuário captura no ML, troca de aba pra Amazon e captura de novo antes de enviar.

Primeiro, somar no topo do arquivo (junto de `LOJAS`, fora de qualquer função — declarar dentro do loop de `renderizar()` recriaria o objeto a cada item):

```js
/** Enum do backend -> nome que o humano reconhece. */
const NOME_LOJA = { MERCADO_LIVRE: 'Mercado Livre', AMAZON: 'Amazon' };
```

Depois, em `renderizar()`, logo após o bloco que monta `titulo` (linha 161-164):

```js
    // A lista pode misturar lojas: captura no ML, troca de aba, captura na
    // Amazon, revisa tudo junto antes de enviar. Sem o selo nao da pra saber
    // de onde cada item veio.
    const selo = document.createElement('span');
    selo.className = 'item__loja';
    selo.textContent = NOME_LOJA[produto.platform] || produto.platform;
```

E trocar `corpo.append(titulo, linhaPreco);` (linha 190) por:

```js
    corpo.append(titulo, linhaPreco, selo);
```

- [ ] **Step 3: Estilizar o selo**

Somar ao fim de `extensao/ui/panel.css`:

```css
/* Selo discreto da loja de origem. Fica abaixo do preco: quem revisa olha
   titulo e preco primeiro; a loja so importa quando alguma coisa parece
   errada. */
.item__loja {
  display: inline-block;
  margin-top: 3px;
  font-size: 11px;
  color: #8a8f98;
}
```

- [ ] **Step 4: Generalizar a mensagem de "fora da loja"**

Em `extensao/ui/panel.html`, trocar o texto de `#fora-do-ml`:

```html
  <section id="fora-do-ml" class="aviso-vazio" hidden>
    Abra um produto ou uma busca do Mercado Livre ou da Amazon nesta aba para capturar.
  </section>
```

E em `panel.js`, a origem exibida (linha 126) hoje assume ML. Trocar por:

```js
  $origemAtual.textContent = itens[0]?.produto.origem === 'produto' ? 'Página do produto' : 'Listagem';
```

- [ ] **Step 5: Verificar no navegador**

1. Recarregar a extensão, capturar 2 produtos no ML e, sem enviar, ir numa busca da Amazon e capturar de novo.
2. O painel mostra os itens da última captura com o selo "Amazon".
3. Marcar/desmarcar funciona, a contagem bate.
4. Clicar "Enviar ao Hub": os itens do ML criam oferta; os da Amazon caem em falha com mensagem legível se a credencial `partnerTag` ainda não estiver configurada (é o esperado — a configuração é tarefa sua no painel).
5. Abrir uma aba fora das lojas: a mensagem cita ML e Amazon.

Expected: todos os passos acontecem como descrito.

- [ ] **Step 6: Commit**

```bash
git add extensao/ui/panel.js extensao/ui/panel.css extensao/ui/panel.html
git commit -m "feat(extensao): painel lateral multi-loja"
```

---

### Task 8: Aceitar `AMAZON` na rota da extensão

**Files:**
- Modify: `apps/api/src/routes/extensao.ts:68`

**Interfaces:**
- Consumes: payload das Tasks 5-7.
- Produces: nada — é folha.

- [ ] **Step 1: Conferir se o backend já aceita**

O schema em `extensao.ts:53` usa `z.nativeEnum(Platform)`, que já inclui `AMAZON` — nada a mudar ali. O que **não** cobre é `origem`: hoje é `z.enum(['produto', 'listagem', 'painel'])` e a Amazon manda `'produto'` ou `'listagem'`, ambos já válidos.

Run: `cd apps/api && npx tsc -p tsconfig.json --noEmit`
Expected: PASS — sem erro (nada mudou ainda; é o baseline).

- [ ] **Step 2: Confirmar por leitura que o caminho da Amazon fecha**

Ler `apps/api/src/connectors/index.ts` e confirmar que `connectors[Platform.AMAZON]` existe e expõe `buildAffiliateLink`. Se existir, **esta task não tem mudança de código** — marcar como verificada e seguir. Se não existir, parar e reportar: seria uma lacuna que a spec não previu.

- [ ] **Step 3: Rodar o build inteiro**

Run: `npm run build`
Expected: PASS nos dois workspaces.

- [ ] **Step 4: Commit (só se algo mudou)**

Se o Step 2 não exigiu mudança, não há commit nesta task.

---

## Fase 2 (Magalu) — fora deste plano

Magalu precisa de migration do enum `Platform`, `connectors/magalu.ts` novo,
registro em `connectors/index.ts`, campo de credencial e `content/magalu.js`.
Vai num plano próprio, depois que a Fase 1 estiver rodando — a spec já descreve
o desenho em "Backend — Fase 2 (Magalu)".
