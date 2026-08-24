import { useState } from 'react';
import { getTheme, setTheme } from '../../theme.js';
import { useProtocolToast } from '../../components/ProtocolToast.js';

export function AparenciaCard() {
  const [theme, setThemeState] = useState(getTheme());
  const protocolo = useProtocolToast();

  return (
    <div className="panel">
      <h2 className="panel__title">Aparência</h2>
      <div className="row">
        <button
          className="btn btn--ghost"
          onClick={() => {
            const next = theme === 'dark' ? 'light' : 'dark';
            setTheme(next);
            setThemeState(next);
            protocolo({
              title: next === 'dark' ? 'MODO ESCURO' : 'MODO CLARO',
              subtitle: 'Aplicado',
              accent: 'var(--brand)',
              icon: 'tema',
              sound: 'tema',
            });
          }}
        >
          {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        </button>
      </div>
    </div>
  );
}
