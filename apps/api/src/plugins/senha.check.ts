/**
 * Self-check da derivacao de senha. Nao faz query no banco, mas importa
 * senha.js -> env.js, que exige DATABASE_URL, MASTER_KEY, DASHBOARD_PASSWORD
 * e SESSION_SECRET no .env -- sem isso o processo morre antes do 1o assert.
 *   npx tsx apps/api/src/plugins/senha.check.ts
 *
 * O que precisa valer: mesma senha confere, senha errada nao confere, dois
 * hashes da MESMA senha saem diferentes (salt aleatorio), e valor corrompido
 * devolve false em vez de explodir -- um throw aqui viraria 500 no login.
 */
import assert from 'node:assert/strict';
import { confere, derivar } from './senha.js';

const guardado = await derivar('senha-de-teste');

assert.match(guardado, /^[0-9a-f]{32}:[0-9a-f]{128}$/, 'formato esperado: salt:hash em hex');
assert.equal(await confere('senha-de-teste', guardado), true, 'senha certa tem que conferir');
assert.equal(await confere('senha-errada', guardado), false, 'senha errada nao pode conferir');
assert.equal(await confere('', guardado), false, 'senha vazia nao pode conferir');

const outro = await derivar('senha-de-teste');
assert.notEqual(guardado, outro, 'salt aleatorio: dois hashes da mesma senha diferem');
assert.equal(await confere('senha-de-teste', outro), true, 'o segundo hash tambem confere');

// Valor corrompido no banco nao pode derrubar o login.
assert.equal(await confere('x', 'lixo-sem-dois-pontos'), false);
assert.equal(await confere('x', ':'), false);
assert.equal(await confere('x', 'abc:naohex'), false);
assert.equal(await confere('x', 'abc:ff'), false, 'hash de tamanho errado devolve false');

console.log('senha.check: ok');
