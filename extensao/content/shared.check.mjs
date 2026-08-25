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
