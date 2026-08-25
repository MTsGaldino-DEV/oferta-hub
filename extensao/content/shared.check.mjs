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

console.log('shared.check: ok');
