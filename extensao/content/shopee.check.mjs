// Self-check das funcoes puras de shopee.js. Roda com `node shopee.check.mjs`.
// shopee.js le window.__HUB no topo -- por isso shared.js roda primeiro,
// dentro do MESMO objeto window falso, antes de shopee.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const aqui = dirname(fileURLToPath(import.meta.url));
const shared = readFileSync(join(aqui, 'shared.js'), 'utf8');
const shopee = readFileSync(join(aqui, 'shopee.js'), 'utf8');

// shopee.js chama montar()/MutationObserver/chrome.runtime no carregamento
// (mesmo padrao de amazon.js) -- sem DOM/chrome de verdade aqui, viram stubs
// inertes so pra deixar o modulo carregar e publicar __HUB_SHOPEE.
global.MutationObserver = class { observe() {} };
global.chrome = { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}) } } };
const documentoFalso = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  documentElement: {},
  title: '',
};

const janela = { location: { hostname: 'shopee.com.br', href: 'https://shopee.com.br/' } };
// shopee.js le `location.href` sem prefixo `window.` (bare global, como um
// browser real resolve) -- Node nao tem isso por padrao.
global.location = janela.location;
new Function('window', shared)(janela);
new Function('window', 'document', shopee)(janela, documentoFalso);
const S = janela.__HUB_SHOPEE;

// extrairIdShopee: forma com slug (-i.<shopId>.<itemId>).
assert.equal(
  S.extrairIdShopee('https://shopee.com.br/Fone-Bluetooth-i.123456.789'),
  '123456_789',
  'forma com slug',
);
// forma /product/<shopId>/<itemId>.
assert.equal(
  S.extrairIdShopee('https://shopee.com.br/product/123456/789'),
  '123456_789',
  'forma /product/',
);
// dominio errado nao casa.
assert.equal(S.extrairIdShopee('https://amazon.com.br/produto-i.1.2'), null, 'dominio errado');
// sem padrao reconhecido.
assert.equal(S.extrairIdShopee('https://shopee.com.br/busca?keyword=fone'), null, 'sem id na url');

// canonicaDeShopee: reconstroi limpo, ignora slug e query de tracking.
assert.equal(
  S.canonicaDeShopee('https://shopee.com.br/Fone-i.123456.789?sp_atk=xyz'),
  'https://shopee.com.br/product/123456/789',
  'reconstroi sem slug nem tracking',
);
assert.equal(S.canonicaDeShopee('https://shopee.com.br/busca'), null, 'sem id vira null');

console.log('shopee.check: ok');
