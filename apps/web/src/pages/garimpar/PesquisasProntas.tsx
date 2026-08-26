import { useEffect, useState } from 'react';
import { api, int } from '../../api.js';
import { EditorNicho } from './EditorNicho.js';
import { ResultadoBusca } from './ResultadoBusca.js';
import type { Produto } from './tipos.js';

interface Nicho {
  id: string;
  name: string;
  platform: string;
  minSales: number;
  builtIn: boolean;
  active: boolean;
  // regras = numero de DiscoveryRule usando o nicho, nao numero de categorias.
  // Contagem de categorias vem de entries.
  entries: { categoryId: number }[];
}

/** Resposta de POST /api/nichos/:id/testar. */
interface Teste {
  bruto: number;
  aceitos: number;
  porCategoria: { categoryId: number; nome: string; bruto: number; aceitos: number; erro?: string }[];
  produtos: (Produto & { categoria: string | null })[];
}

export function PesquisasProntas() {
  const [nichos, setNichos] = useState<Nicho[]>([]);
  const [editando, setEditando] = useState(false);
  const [rodando, setRodando] = useState<string | null>(null);
  const [teste, setTeste] = useState<{ nicho: Nicho; dados: Teste } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setNichos(await api.get<Nicho[]>('/api/nichos'));
  }

  useEffect(() => {
    void carregar().catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar os nichos.'));
  }, []);

  async function rodar(n: Nicho) {
    setRodando(n.id);
    setErro(null);
    setTeste(null);
    try {
      const dados = await api.post<Teste>(`/api/nichos/${n.id}/testar`, {});
      setTeste({ nicho: n, dados });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A pesquisa falhou.');
    } finally {
      setRodando(null);
    }
  }

  if (editando) {
    return (
      <>
        <button
          className="btn btn--ghost btn--sm"
          style={{ marginBottom: 12 }}
          onClick={() => {
            setEditando(false);
            // As regras podem ter mudado enquanto o editor estava aberto.
            void carregar().catch(() => {});
          }}
        >
          ← Voltar pras pesquisas
        </button>
        <EditorNicho />
      </>
    );
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
          Buscas já montadas: categoria, termos obrigatórios e mínimo de vendas num clique.
        </p>
        <button className="btn btn--ghost" onClick={() => setEditando(true)}>
          Editar regras
        </button>
      </div>

      {erro && <div className="notice">{erro}</div>}

      {nichos.length === 0 && (
        <div className="empty">
          <strong>Nenhum nicho montado</strong>
          Clique em "Editar regras" pra criar o primeiro.
        </div>
      )}

      <div className="split">
        {nichos.map((n) => (
          <div key={n.id} className="panel">
            <h2 className="panel__title">
              {n.name}
              {!n.active && (
                <span className="chip" style={{ marginLeft: 8 }}>
                  inativo
                </span>
              )}
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 10px' }}>
              {n.entries.length} categoria{n.entries.length === 1 ? '' : 's'} · mínimo de {int(n.minSales)} vendas
            </p>
            <button className="btn" disabled={rodando !== null} onClick={() => void rodar(n)}>
              {rodando === n.id ? 'Buscando...' : 'Buscar agora'}
            </button>
          </div>
        ))}
      </div>

      {teste && (
        <div style={{ marginTop: 16 }}>
          <h2 className="panel__title">
            {teste.nicho.name}: {int(teste.dados.aceitos)} de {int(teste.dados.bruto)} passaram no filtro
          </h2>

          {teste.dados.porCategoria.some((c) => c.erro) && (
            <div className="notice">
              Algumas categorias falharam: {teste.dados.porCategoria.find((c) => c.erro)?.erro}
            </div>
          )}

          <ResultadoBusca
            resultado={{
              categorias: teste.dados.porCategoria.map((c) => ({ id: c.categoryId, nome: c.nome })),
              bruto: teste.dados.bruto,
              // Aqui bruto e antesDoFiltro sao o mesmo numero: o endpoint de
              // nicho ja devolve bruto como "antes do filtro de termos", que e
              // exatamente o que antesDoFiltro representa na busca ao vivo.
              antesDoFiltro: teste.dados.bruto,
              produtos: teste.dados.produtos,
              // O endpoint de nicho nao pagina: ele varre as categorias do
              // nicho de uma vez. Sem proxima pagina pra oferecer.
              pageInfo: { page: 1, hasNextPage: false },
              falhas: teste.dados.porCategoria
                .filter((c) => c.erro)
                .map((c) => ({ categoryId: c.categoryId, motivo: c.erro! })),
            }}
            buscando={false}
            onPagina={() => {}}
          />
        </div>
      )}
    </>
  );
}
