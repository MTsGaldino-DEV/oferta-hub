import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { playProtocolSound, type ProtocolKey } from '../protocol-sound.js';

export interface ProtocolConfig {
  /** Linha de cima, caixa alta e espacada. Ex.: "DISPARO". */
  title: string;
  /** Linha de baixo. Ex.: "Iniciado". */
  subtitle: string;
  /** Cor da borda e do icone. Aceita `var(--brand)` e afins. */
  accent: string;
  icon: 'disparo' | 'tema' | 'whatsapp';
  sound: ProtocolKey;
}

const MS_NA_TELA = 1500;

const Ctx = createContext<((config: ProtocolConfig) => void) | null>(null);

/** SVG inline: 3 icones nao pagam uma dependencia de icones inteira. */
function Icone({ nome }: { nome: ProtocolConfig['icon'] }) {
  const comum = {
    width: 44,
    height: 44,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (nome === 'disparo') {
    return (
      <svg {...comum}>
        <path d="M22 2 11 13" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    );
  }

  if (nome === 'tema') {
    return (
      <svg {...comum}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }

  return (
    <svg {...comum}>
      <path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3L3 21z" />
      <path d="M8.6 9.2c.3 2.6 3.6 5.9 6.2 6.2l1.3-1.6 2 1-.6 2c-3.8.6-8.7-4.3-9.3-8.1l2-.6 1 2-1.4 1.3z" />
    </svg>
  );
}

export function ProtocolToastProvider({ children }: { children: React.ReactNode }) {
  const [atual, setAtual] = useState<{ config: ProtocolConfig; id: number } | null>(null);
  const proximoId = useRef(0);

  const show = useCallback((config: ProtocolConfig) => {
    playProtocolSound(config.sound);
    proximoId.current += 1;
    setAtual({ config, id: proximoId.current });
  }, []);

  // Um estado so: dois disparos em sequencia substituem, nao empilham. O id
  // no dep reinicia o timer e remonta a animacao.
  useEffect(() => {
    if (!atual) return;
    const timer = setTimeout(() => setAtual(null), MS_NA_TELA);
    return () => clearTimeout(timer);
  }, [atual?.id]);

  return (
    <Ctx.Provider value={show}>
      {children}
      {atual && (
        <div className="protocol" role="status" aria-live="polite">
          <div
            key={atual.id}
            className="protocol__box"
            style={{ '--protocol-accent': atual.config.accent } as React.CSSProperties}
          >
            <span className="protocol__icon">
              <Icone nome={atual.config.icon} />
            </span>
            <span className="protocol__title">{atual.config.title}</span>
            <span className="protocol__subtitle">{atual.config.subtitle}</span>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useProtocolToast(): (config: ProtocolConfig) => void {
  const show = useContext(Ctx);
  if (!show) throw new Error('useProtocolToast precisa estar dentro de <ProtocolToastProvider>');
  return show;
}
