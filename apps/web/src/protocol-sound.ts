/**
 * Feedback sonoro de "protocolo": som sintetizado na hora, sem arquivo de
 * audio e sem dependencia. Cada receita e um thump grave (seno com pitch
 * caindo) + um chime (triangulares em paralelo) + opcionalmente uma camada
 * de ruido filtrado. Chime subindo = confirmado, chime caindo = desfeito.
 */

export const PROTOCOL_KEYS = [
  'disparo',
  'disparo-off',
  'tema',
  'whatsapp-on',
  'whatsapp-off',
] as const;

export type ProtocolKey = (typeof PROTOCOL_KEYS)[number];

interface Receita {
  /** Varredura do thump grave, em Hz: [inicio, fim]. */
  thump: [number, number];
  /** Frequencias dos triangulares do chime, em Hz. Vazio = sem chime. */
  chime: number[];
  /** Camada de ruido filtrado passa-baixa junto do thump. */
  ruido: boolean;
}

const RECEITAS: Record<ProtocolKey, Receita> = {
  disparo: { thump: [190, 70], chime: [523.25, 784.0], ruido: true },
  'disparo-off': { thump: [150, 55], chime: [392.0, 261.63], ruido: true },
  tema: { thump: [140, 90], chime: [440.0], ruido: false },
  'whatsapp-on': { thump: [170, 80], chime: [440.0, 659.25], ruido: false },
  'whatsapp-off': { thump: [140, 60], chime: [329.63, 246.94], ruido: false },
};

let ctx: AudioContext | null = null;

function pegarCtx(): AudioContext | null {
  const Ctor =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // O navegador suspende o contexto ate um gesto do usuario.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Envelope de volume: ataque rapido, decaimento exponencial. */
function envelope(g: GainNode, t0: number, pico: number, ataque: number, cauda: number): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(pico, t0 + ataque);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + cauda);
}

/**
 * Toca a receita da chave. Nunca lanca: sem AudioContext (SSR, navegador
 * antigo, autoplay bloqueado) sai em silencio, porque o feedback visual
 * sozinho ja cumpre o papel.
 */
export function playProtocolSound(key: ProtocolKey): void {
  const c = pegarCtx();
  if (!c) return;

  const receita = RECEITAS[key];
  if (!receita) return;

  try {
    const t0 = c.currentTime;
    const [de, para] = receita.thump;

    // Thump: seno caindo de `de` pra `para` em 80ms, cauda de 340ms.
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(de, t0);
    osc.frequency.exponentialRampToValueAtTime(para, t0 + 0.08);
    const gThump = c.createGain();
    envelope(gThump, t0, 0.5, 0.008, 0.34);
    osc.connect(gThump);
    gThump.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.4);

    // Ruido filtrado: textura de impacto, so 120ms.
    if (receita.ruido) {
      const amostras = Math.floor(c.sampleRate * 0.12);
      const buffer = c.createBuffer(1, amostras, c.sampleRate);
      const dados = buffer.getChannelData(0);
      for (let i = 0; i < amostras; i += 1) dados[i] = Math.random() * 2 - 1;

      const src = c.createBufferSource();
      src.buffer = buffer;
      const filtro = c.createBiquadFilter();
      filtro.type = 'lowpass';
      filtro.frequency.setValueAtTime(820, t0);
      filtro.frequency.exponentialRampToValueAtTime(180, t0 + 0.12);
      const gRuido = c.createGain();
      envelope(gRuido, t0, 0.22, 0.006, 0.12);
      src.connect(filtro);
      filtro.connect(gRuido);
      gRuido.connect(c.destination);
      src.start(t0);
      src.stop(t0 + 0.14);
    }

    // Chime: entra 30ms depois do thump, e o que da a sensacao de "pronto".
    const tChime = t0 + 0.03;
    for (const hz of receita.chime) {
      const tri = c.createOscillator();
      tri.type = 'triangle';
      tri.frequency.setValueAtTime(hz, tChime);
      const gChime = c.createGain();
      envelope(gChime, tChime, 0.16, 0.01, 0.6);
      tri.connect(gChime);
      gChime.connect(c.destination);
      tri.start(tChime);
      tri.stop(tChime + 0.62);
    }
  } catch {
    // Autoplay bloqueado ou contexto morto: o overlay visual ja avisa.
  }
}
