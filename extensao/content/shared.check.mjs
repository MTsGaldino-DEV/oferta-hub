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

// lerPrecos com riscadoExtra (o caminho da Amazon). Precisa de DOM, entao
// montamos o minimo que as funcoes tocam -- querySelectorAll, matches, closest,
// cloneNode. Simular e o preco de nao ter jsdom como dependencia; o que
// importa aqui e a REGRA (o "de" so vale se for maior), nao o parser de CSS.
function elFalso({ classe = '', texto: t = '', pai = null }) {
  const el = {
    _classe: classe,
    textContent: t,
    parentElement: pai,
    getAttribute: (n) => (n === 'class' ? classe : null),
    matches: (sel) => sel.split(',').some((s) => {
      const c = s.trim().replace(/^\./, '');
      return s.trim().startsWith('.') && classe.split(/\s+/).includes(c);
    }),
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return el;
}
function raizFalsa(filhos) {
  return {
    textContent: filhos.map((f) => f.textContent).join(' '),
    querySelectorAll: () => filhos,
    cloneNode: () => ({ querySelectorAll: () => [], textContent: filhos.map((f) => f.textContent).join(' ') }),
  };
}
const OPCOES_AZ = {
  blocos: '.a-price',
  lerBloco: (el) => (el ? H.parsePrecoBR(el.textContent) : undefined),
  riscadoExtra: '.a-text-price',
};

// Caso Amazon real (medido 25/08/2026): "de" R$369,00 vem como .a-text-price.
const comDe = raizFalsa([
  elFalso({ classe: 'a-price', texto: 'R$ 186,77' }),
  elFalso({ classe: 'a-price a-text-price', texto: 'R$ 369,00' }),
]);
assert.deepEqual(H.lerPrecos(comDe, OPCOES_AZ), { price: 186.77, listPrice: 369 }, 'de maior vira listPrice');

// O caso perigoso: .a-text-price carregando preco POR UNIDADE (R$ 1,09 de um
// produto de R$ 174,90). Tem que ser DESCARTADO, nunca trocado -- e a troca
// que na concorrente publicou um perfume de R$ 243 por R$ 2,31.
const porUnidade = raizFalsa([
  elFalso({ classe: 'a-price', texto: 'R$ 174,90' }),
  elFalso({ classe: 'a-price a-text-price', texto: 'R$ 1,09' }),
]);
assert.deepEqual(
  H.lerPrecos(porUnidade, OPCOES_AZ),
  { price: 174.9, listPrice: undefined },
  'preco por unidade e descartado, nunca trocado',
);

// "de" igual ao atual nao e desconto de 0%, e ausencia de desconto.
const mesmoValor = raizFalsa([
  elFalso({ classe: 'a-price', texto: 'R$ 99,00' }),
  elFalso({ classe: 'a-price a-text-price', texto: 'R$ 99,00' }),
]);
assert.equal(H.lerPrecos(mesmoValor, OPCOES_AZ).listPrice, undefined, 'de igual ao atual nao conta');

console.log('shared.check: ok');
