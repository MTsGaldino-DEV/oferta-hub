import { useEffect, useState } from 'react';
import { api, brl, int } from '../api.js';

interface Raiz {
  id: number;
  nome: string;
  itens: number;
  filhas: { id: number; nome: string; itens: number }[];
}

interface Produto {
  externalId: string;
  title: string;
  imageUrl: string | null;
  price: number | null;
  listPrice: number | null;
  commissionPct: number | null;
  soldCount: number | null;
  rating: number | null;
}

interface Resultado {
  categoria: string | null;
  produtos: Produto[];
}

const ORDENS = [
  { valor: 'vendas', rotulo: 'Mais vendidos' },
  { valor: 'relevancia', rotulo: 'Relevância' },
  { valor: 'comissao', rotulo: 'Maior comissão' },
  { valor: 'menor-preco', rotulo: 'Menor preço' },
  { valor: 'desconto', rotulo: 'Maior desconto' },
] as const;

function desconto(p: Produto): string {
  if (p.listPrice && p.price && p.listPrice > p.price) {
    return `${Math.round((1 - p.price / p.listPrice) * 100)}%`;
  }
  return '—';
}

export function Garimpar() {
  const [arvore, setArvore] = useState<Raiz[]>([]);
  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const [sort, setSort] = useState<(typeof ORDENS)[number]['valor']>('vendas');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Raiz[]>('/api/categorias')
      .then(setArvore)
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar as categorias.'));
  }, []);

  useEffect(() => {
    if (categoriaId === null) return;
    setCarregando(true);
    setErro(null);
    api
      .get<Resultado>(`/api/garimpar/produtos?categoryId=${categoriaId}&sort=${sort}`)
      .then((r) => setResultado(r))
      .catch((e) => {
        setResultado(null);
        setErro(e instanceof Error ? e.message : 'A busca falhou.');
      })
      .finally(() => setCarregando(false));
  }, [categoriaId, sort]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Garimpar</h1>
          <p>Navegue os produtos de uma categoria da Shopee, direto da busca ao vivo, sem passar pela fila.</p>
        </div>
      </div>

      {erro && <div className="notice">{erro}</div>}

      <div className="split">
        <div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label htmlFor="sort">Ordenar por</label>
            <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              {ORDENS.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div className="catbox">
            {arvore.map((r) => (
              <div key={r.id} className="catbox__grupo">
                <div className="catbox__raiz">
                  {r.nome} <span>{int(r.itens)}</span>
                </div>
                {r.filhas.map((f) => (
                  <div
                    key={f.id}
                    className="catbox__item"
                    onClick={() => setCategoriaId(f.id)}
                    style={
                      categoriaId === f.id
                        ? { background: 'rgba(22, 23, 26, 0.06)', fontWeight: 700 }
                        : undefined
                    }
                  >
                    <span>{f.nome}</span>
                    <em>{int(f.itens)}</em>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div>
          {categoriaId === null && (
            <div className="empty">
              <strong>Escolha uma categoria</strong>
              Clique em uma categoria à esquerda pra ver os produtos.
            </div>
          )}

          {categoriaId !== null && carregando && (
            <div className="empty">
              <strong>Buscando...</strong>
            </div>
          )}

          {categoriaId !== null && !carregando && resultado && resultado.produtos.length === 0 && (
            <div className="empty">
              <strong>Nada encontrado</strong>
              Nada encontrado nessa categoria com esse filtro.
            </div>
          )}

          {categoriaId !== null && !carregando && resultado && resultado.produtos.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Preço</th>
                  <th className="num">Desconto</th>
                  <th className="num">Comissão</th>
                  <th className="num">Vendas</th>
                </tr>
              </thead>
              <tbody>
                {resultado.produtos.map((p) => (
                  <tr key={p.externalId}>
                    <td>
                      <div className="cell-product">
                        {p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" />}
                        <span>
                          {p.title}
                          <br />
                          <small style={{ color: 'var(--muted)' }}>{resultado.categoria}</small>
                        </span>
                      </div>
                    </td>
                    <td className="num">{brl(p.price)}</td>
                    <td className="num">{desconto(p)}</td>
                    <td className="num">{p.commissionPct ? `${p.commissionPct.toFixed(0)}%` : '—'}</td>
                    <td className="num">
                      <strong>{int(p.soldCount)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
