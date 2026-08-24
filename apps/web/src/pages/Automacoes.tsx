import { useState } from 'react';
import { Disparos } from './Disparos.js';
import { AutomacoesLista } from './automacoes/AutomacoesLista.js';
import { Vigiar } from './automacoes/Vigiar.js';

type Aba = 'disparos' | 'automatizar' | 'vigiar';

const ABAS: { id: Aba; label: string }[] = [
  { id: 'disparos', label: 'Disparos' },
  { id: 'automatizar', label: 'Automatizar' },
  { id: 'vigiar', label: 'Vigiar' },
];

export function Automacoes() {
  const [aba, setAba] = useState<Aba>('disparos');

  return (
    <>
      <div className="tabs">
        {ABAS.map((a) => (
          <button key={a.id} className="tabs__item" data-on={aba === a.id} onClick={() => setAba(a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'disparos' && <Disparos />}
      {aba === 'automatizar' && <AutomacoesLista />}
      {aba === 'vigiar' && <Vigiar />}
    </>
  );
}
