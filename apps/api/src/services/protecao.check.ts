/**
 * Self-check da decisao de moderacao. Roda sem banco e sem rede:
 *   npx tsx apps/api/src/services/protecao.check.ts
 *
 * Esta e a logica que decide se alguem e removido de um grupo -- acao
 * irreversivel e visivel pra todo mundo. Cada caso aqui existe porque errar
 * nele significa remover a pessoa errada, ou deixar passar quem devia sair.
 */
import assert from 'node:assert/strict';
import { decidir, normalizarNumero, numeroDoJid } from './protecao.js';

// --- normalizacao ---

// Mesma pessoa escrita de varios jeitos tem que virar a mesma chave.
const canon = normalizarNumero('+55 11 98765-4321');
assert.equal(normalizarNumero('5511987654321'), canon);
assert.equal(normalizarNumero('55 (11) 98765 4321'), canon);
assert.equal(normalizarNumero('  +55-11-987654321  '), canon);

// Numero brasileiro com e sem o nono digito e a MESMA pessoa. Sem isso, quem
// voce barra com nono digito continua entrando sem ele.
assert.equal(normalizarNumero('551187654321'), normalizarNumero('5511987654321'));

// Lixo nao vira chave: guardar torto falha depois em silencio.
assert.equal(normalizarNumero(''), null);
assert.equal(normalizarNumero('abc'), null);
assert.equal(normalizarNumero('123'), null, 'digitos de menos');
assert.equal(normalizarNumero('1'.repeat(20)), null, 'digitos demais');

// --- extracao do JID ---

assert.equal(numeroDoJid('5511987654321@s.whatsapp.net'), normalizarNumero('5511987654321'));
assert.equal(numeroDoJid('209384756@lid'), null, 'LID nao carrega numero');
assert.equal(numeroDoJid('120363000000000000@g.us'), null, 'jid de grupo nao e pessoa');
assert.equal(numeroDoJid(''), null);

// --- decisao ---

const bloqueados = new Set([normalizarNumero('5511999999999')!]);
const base = {
  bloqueados,
  filtroDdiLigado: true,
  ddiPermitido: '55',
  jidProprio: '5511000000000@s.whatsapp.net',
  admins: new Set(['5511777777777@s.whatsapp.net']),
};

// Blocklist manda, mesmo com DDI brasileiro.
assert.deepEqual(decidir({ ...base, jid: '5511999999999@s.whatsapp.net' }), {
  remover: true,
  motivo: 'BLOCKLIST',
});

// Blocklist tem precedencia sobre DDI: o motivo registrado tem que ser o certo,
// senao o log conta a historia errada.
assert.deepEqual(
  decidir({ ...base, bloqueados: new Set([normalizarNumero('447700900000')!]), jid: '447700900000@s.whatsapp.net' }),
  { remover: true, motivo: 'BLOCKLIST' },
);

// DDI estrangeiro com numero visivel: remove.
assert.deepEqual(decidir({ ...base, jid: '447700900000@s.whatsapp.net' }), {
  remover: true,
  motivo: 'FOREIGN_DDI',
});

// Brasileiro comum fica.
assert.deepEqual(decidir({ ...base, jid: '5521912345678@s.whatsapp.net' }), {
  remover: false,
  motivo: 'PERMITIDO',
});

// LID nunca e removido por DDI: o numero nao veio, entao nao da pra saber.
// Remover por suposicao seria expulsar alguem inocente.
assert.deepEqual(decidir({ ...base, jid: '209384756@lid' }), {
  remover: false,
  motivo: 'NAO_AVALIAVEL',
});

// Mas LID na blocklist tambem nao e removido -- nao da pra comparar sem numero.
assert.equal(decidir({ ...base, jid: '999@lid' }).remover, false);

// A propria conta nunca sai.
assert.deepEqual(decidir({ ...base, jid: base.jidProprio }), { remover: false, motivo: 'PROPRIO' });

// Admin do grupo nunca sai, nem se estiver na blocklist.
assert.deepEqual(
  decidir({ ...base, bloqueados: new Set([normalizarNumero('5511777777777')!]), jid: '5511777777777@s.whatsapp.net' }),
  { remover: false, motivo: 'ADMIN' },
);

// Filtro desligado: estrangeiro fica.
assert.deepEqual(decidir({ ...base, filtroDdiLigado: false, jid: '447700900000@s.whatsapp.net' }), {
  remover: false,
  motivo: 'PERMITIDO',
});

// Filtro desligado nao desliga a blocklist.
assert.equal(decidir({ ...base, filtroDdiLigado: false, jid: '5511999999999@s.whatsapp.net' }).remover, true);

// Blocklist vazia e filtro desligado: ninguem sai.
assert.equal(
  decidir({ ...base, bloqueados: new Set(), filtroDdiLigado: false, jid: '447700900000@s.whatsapp.net' }).remover,
  false,
);

console.log('protecao.check: ok');
