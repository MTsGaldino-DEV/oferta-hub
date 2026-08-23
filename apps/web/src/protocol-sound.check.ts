/**
 * Self-check do grafo de audio. Roda em Node puro:
 *   node apps/web/src/protocol-sound.check.ts
 *
 * Web Audio so existe no navegador, entao o check instala um AudioContext
 * falso que grava as chamadas e confere que cada receita monta um grafo
 * completo (oscilador conectado, com start e stop agendados).
 */
import assert from 'node:assert/strict';

const reg = { osciladores: 0, buffers: 0, conexoes: 0, starts: 0, stops: 0 };

const param = () => ({
  value: 0,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
});

const no = (): any => ({
  connect() {
    reg.conexoes += 1;
    return no();
  },
  start() {
    reg.starts += 1;
  },
  stop() {
    reg.stops += 1;
  },
  frequency: param(),
  gain: param(),
  Q: param(),
  type: '',
  buffer: null,
});

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = no();
  sampleRate = 48000;
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    reg.osciladores += 1;
    return no();
  }
  createGain() {
    return no();
  }
  createBiquadFilter() {
    return no();
  }
  createBufferSource() {
    reg.buffers += 1;
    return no();
  }
  createBuffer(_canais: number, tamanho: number) {
    return { getChannelData: () => new Float32Array(tamanho) };
  }
}

(globalThis as any).AudioContext = FakeAudioContext;

const { playProtocolSound, PROTOCOL_KEYS } = await import('./protocol-sound.ts');

for (const chave of PROTOCOL_KEYS) {
  Object.assign(reg, { osciladores: 0, buffers: 0, conexoes: 0, starts: 0, stops: 0 });
  playProtocolSound(chave);

  assert.ok(reg.osciladores > 0, `${chave}: nenhum oscilador criado`);
  assert.ok(reg.conexoes >= reg.osciladores, `${chave}: oscilador sem connect`);
  assert.equal(reg.starts, reg.stops, `${chave}: start e stop desbalanceados`);
  assert.ok(reg.starts >= reg.osciladores + reg.buffers, `${chave}: no sem start`);
}

// Sem AudioContext (SSR / navegador antigo) nao pode explodir.
delete (globalThis as any).AudioContext;
const fresco = await import(`./protocol-sound.ts?limpo=${Date.now()}`);
fresco.playProtocolSound('tema');

console.log(`ok — ${PROTOCOL_KEYS.length} receitas montam grafo completo`);
