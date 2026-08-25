import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { CategoriaMultiSelect } from './garimpar/CategoriaMultiSelect.js';
import { FiltrosBusca } from './garimpar/FiltrosBusca.js';
import { PesquisasProntas } from './garimpar/PesquisasProntas.js';
import { ResultadoBusca } from './garimpar/ResultadoBusca.js';
import { filtrosVazios, queryDeBusca, type Filtros, type Raiz, type Resultado } from './garimpar/tipos.js';

type Aba = 'buscar' | 'prontas';

export function Garimpar() {
  const [aba, setAba] = useState<Aba>('buscar');
  const [arvore, setArvore] = useState<Raiz[]>([]);
  const [filtros, setFiltros] = useState<Filtros>(filtrosVazios);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Raiz[]>('/api/categorias')
      .then(setArvore)
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar as categorias.'));
  }, []);

  async function buscar(page = 1) {
    setBuscando(true);
    setErro(null);
    try {
      setResultado(await api.get<Resultado>(`/api/garimpar/produtos?${queryDeBusca(filtros, page)}`));
    } catch (e) {
      setResultado(null);
      setErro(e instanceof Error ? e.message : 'A busca falhou.');
    } finally {
      setBuscando(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Garimpar</h1>
          <p>Busque na Shopee ao vivo e mande o que valer direto pra fila.</p>
        </div>
      </div>

      <div className="tabs">
        <button className="tabs__item" data-on={aba === 'buscar'} onClick={() => setAba('buscar')}>
          Buscar
        </button>
        <button className="tabs__item" data-on={aba === 'prontas'} onClick={() => setAba('prontas')}>
          Pesquisas prontas
        </button>
      </div>

      {erro && <div className="notice">{erro}</div>}

      {aba === 'prontas' ? (
        <PesquisasProntas />
      ) : (
        <>
          {/* Controles em cima, prateleira embaixo -- igual a fila. Os cards
              precisam da largura inteira: espremidos em meia tela cabiam dois
              por linha e a foto, que e o que faz garimpar, virava miniatura. */}
          <div className="split">
            <div>
              <CategoriaMultiSelect
                arvore={arvore}
                selecionadas={filtros.categorias}
                onChange={(categorias) => setFiltros((f) => ({ ...f, categorias }))}
              />
            </div>
            <div>
              <FiltrosBusca
                filtros={filtros}
                onChange={setFiltros}
                onBuscar={() => void buscar(1)}
                buscando={buscando}
              />
            </div>
          </div>

          <div style={{ height: 20 }} />

          <ResultadoBusca resultado={resultado} buscando={buscando} onPagina={(p) => void buscar(p)} />
        </>
      )}
    </>
  );
}
