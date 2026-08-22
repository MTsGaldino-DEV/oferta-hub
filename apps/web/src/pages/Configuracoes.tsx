import { useState } from 'react';
import { Conexoes } from './Conexoes.js';
import { Templates } from './Templates.js';

export function Configuracoes() {
  const [tab, setTab] = useState<'conexoes' | 'modelos'>('conexoes');

  return (
    <>
      <div className="tabs">
        <button className="tabs__item" data-on={tab === 'conexoes'} onClick={() => setTab('conexoes')}>
          Conexões
        </button>
        <button className="tabs__item" data-on={tab === 'modelos'} onClick={() => setTab('modelos')}>
          Modelos de mensagem
        </button>
      </div>

      {tab === 'conexoes' ? <Conexoes /> : <Templates />}
    </>
  );
}
