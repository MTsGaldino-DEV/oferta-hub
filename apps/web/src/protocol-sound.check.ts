/**
 * Self-check do grafo de audio. Roda em Node puro:
 *   node apps/web/src/protocol-sound.check.ts
 *
 * Web Audio so existe no navegador, entao o check instala um AudioContext
 * falso que da identidade a cada no e grava as arestas de connect(), e
 * confere que cada fonte sonora (oscilador ou buffer source) tem um
 * caminho real ate `destination`, com exatamente um start() e um stop().
 * Contar chamadas agregadas nao pega no desconectado — so o caminho real
 * pega.
 */
import assert from 'node:assert/strict';

type NoId = number | 'destination';

let proximoId = 0;
const nos = new Map<number, { tipo: string; starts: number; stops: number }>();
const arestas: Array<[NoId, NoId]> = [];

const param = () => ({
  value: 0,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
});

const destino = {
  __id: 'destination' as const,
  connect() {},
};

function no(tipo: string): any {
  const id = proximoId;
  proximoId += 1;
  nos.set(id, { tipo, starts: 0, stops: 0 });
  return {
    __id: id,
    connect(alvo: any) {
      const alvoId: NoId = alvo === destino ? 'destination' : alvo.__id;
      arestas.push([id, alvoId]);
      return alvo;
    },
    start() {
      nos.get(id)!.starts += 1;
    },
    stop() {
      nos.get(id)!.stops += 1;
    },
    frequency: param(),
    gain: param(),
    Q: param(),
    type: '',
    buffer: null,
  };
}

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = destino;
  sampleRate = 48000;
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    return no('oscillator');
  }
  createGain() {
    return no('gain');
  }
  createBiquadFilter() {
    return no('biquadFilter');
  }
  createBufferSource() {
    return no('bufferSource');
  }
  createBuffer(_canais: number, tamanho: number) {
    return { getChannelData: () => new Float32Array(tamanho) };
  }
}

(globalThis as any).AudioContext = FakeAudioContext;

const { playProtocolSound, PROTOCOL_KEYS } = await import('./protocol-sound.ts');

/** Percorre `arestas` a partir de `origem` e diz se algum caminho chega em `destination`. */
function alcancaDestino(origem: NoId): boolean {
  const visitados = new Set<NoId>();
  const pilha: NoId[] = [origem];
  while (pilha.length > 0) {
    const atual = pilha.pop()!;
    if (atual === 'destination') return true;
    if (visitados.has(atual)) continue;
    visitados.add(atual);
    for (const [de, para] of arestas) {
      if (de === atual) pilha.push(para);
    }
  }
  return false;
}

for (const chave of PROTOCOL_KEYS) {
  proximoId = 0;
  nos.clear();
  arestas.length = 0;

  playProtocolSound(chave);

  const fontes = [...nos.entries()].filter(
    ([, n]) => n.tipo === 'oscillator' || n.tipo === 'bufferSource',
  );
  assert.ok(fontes.length > 0, `${chave}: nenhuma fonte sonora criada`);

  for (const [id, n] of fontes) {
    assert.equal(n.starts, 1, `${chave}: ${n.tipo}#${id} chamou start() ${n.starts}x (esperado 1x)`);
    assert.equal(n.stops, 1, `${chave}: ${n.tipo}#${id} chamou stop() ${n.stops}x (esperado 1x)`);
    assert.ok(alcancaDestino(id), `${chave}: ${n.tipo}#${id} nao tem caminho ate destination`);
  }
}

// Sem AudioContext (SSR / navegador antigo) nao pode explodir.
delete (globalThis as any).AudioContext;
const fresco = await import(`./protocol-sound.ts?limpo=${Date.now()}`);
fresco.playProtocolSound('tema');

console.log(`ok — ${PROTOCOL_KEYS.length} receitas montam grafo completo`);
