import { useState } from 'react';
import { Monitor } from './grupos/Monitor.js';
import { Protecao } from './grupos/Protecao.js';

type Aba = 'monitor' | 'protecao';

const ABAS: { id: Aba; label: string }[] = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'protecao', label: 'Proteção' },
];

export function MeusGrupos() {
  const [aba, setAba] = useState<Aba>('monitor');

  return (
    <>
      <div className="tabs">
        {ABAS.map((a) => (
          <button key={a.id} className="tabs__item" data-on={aba === a.id} onClick={() => setAba(a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'monitor' && <Monitor />}
      {aba === 'protecao' && <Protecao />}
    </>
  );
}
