import { useState } from 'react';
import { Conexoes } from './Conexoes.js';
import { Templates } from './Templates.js';
import { Canais } from './configuracoes/Canais.js';
import { Cupons } from './configuracoes/Cupons.js';
import { Conta } from './configuracoes/Conta.js';

type Aba = 'canais' | 'plataformas' | 'mensagens' | 'cupons' | 'conta';

const ABAS: { id: Aba; label: string }[] = [
  { id: 'canais', label: 'Canais' },
  { id: 'plataformas', label: 'Plataformas' },
  { id: 'mensagens', label: 'Mensagens' },
  { id: 'cupons', label: 'Cupons' },
  { id: 'conta', label: 'Conta' },
];

export function Configuracoes() {
  const [aba, setAba] = useState<Aba>('canais');

  return (
    <>
      <div className="tabs">
        {ABAS.map((a) => (
          <button key={a.id} className="tabs__item" data-on={aba === a.id} onClick={() => setAba(a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'canais' && <Canais />}
      {aba === 'plataformas' && <Conexoes />}
      {aba === 'mensagens' && <Templates />}
      {aba === 'cupons' && <Cupons />}
      {aba === 'conta' && <Conta />}
    </>
  );
}
