import { useEffect, useMemo, useState } from 'react';
import { api, brl, int } from '../../api.js';

interface Entry {
  categoryId: number;
  nome: string;
  requireTerms: string[];
}

interface Nicho {
  id: string;
  name: string;
  platform: string;
  minSales: number;
  excludeTerms: string[];
  builtIn: boolean;
  active: boolean;
  regras: number;
  entries: Entry[];
}

interface Raiz {
  id: number;
  nome: string;
  itens: number;
  filhas: { id: number; nome: string; itens: number }[];
}

interface Placar {
  categoryId: number;
  nome: string;
  bruto: number;
  aceitos: number;
  erro?: string;
}

interface Teste {
  bruto: number;
  aceitos: number;
  porCategoria: Placar[];
  produtos: {
    externalId: string;
    title: string;
    imageUrl: string | null;
    price: number | null;
    listPrice: number | null;
    commissionPct: number | null;
    soldCount: number | null;
    categoria: string | null;
  }[];
}

/** "gamer, rgb , headset" -> ['gamer','rgb','headset'] */
const parseTermos = (texto: string): string[] =>
  texto
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

const rascunhoVazio = { name: '', minSales: 100, excludeTerms: '', entries: [] as Entry[] };

export function EditorNicho() {
  const [nichos, setNichos] = useState<Nicho[]>([]);
  const [arvore, setArvore] = useState<Raiz[]>([]);
  const [editando, setEditando] = useState<string | 'novo' | null>(null);
  const [rascunho, setRascunho] = useState(rascunhoVazio);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [teste, setTeste] = useState<{ id: string; dados: Teste } | null>(null);
  const [testando, setTestando] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function carregar() {
    setNichos(await api.get<Nicho[]>('/api/nichos'));
    setArvore(await api.get<Raiz[]>('/api/categorias'));
  }

  useEffect(() => {
    void carregar().catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar.'));
  }, []);

  const escolhidas = useMemo(() => new Set(rascunho.entries.map((e) => e.categoryId)), [rascunho.entries]);

  const arvoreFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return arvore;
    return arvore
      .map((r) => ({ ...r, filhas: r.filhas.filter((f) => f.nome.toLowerCase().includes(q)) }))
      .filter((r) => r.filhas.length > 0 || r.nome.toLowerCase().includes(q));
  }, [arvore, busca]);

  function abrirNovo() {
    setRascunho(rascunhoVazio);
    setEditando('novo');
    setErro(null);
  }

  function abrirEdicao(n: Nicho) {
    setRascunho({
      name: n.name,
      minSales: n.minSales,
      excludeTerms: n.excludeTerms.join(', '),
      entries: n.entries.map((e) => ({ ...e })),
    });
    setEditando(n.id);
    setErro(null);
  }

  function alternarCategoria(id: number, nome: string) {
    setRascunho((r) => ({
      ...r,
      entries: escolhidas.has(id)
        ? r.entries.filter((e) => e.categoryId !== id)
        : [...r.entries, { categoryId: id, nome, requireTerms: [] }],
    }));
  }

  async function salvar() {
    setBusy(true);
    setErro(null);
    try {
      const corpo = {
        name: rascunho.name.trim(),
        minSales: Number(rascunho.minSales) || 0,
        excludeTerms: parseTermos(rascunho.excludeTerms),
        entries: rascunho.entries.map((e) => ({ categoryId: e.categoryId, requireTerms: e.requireTerms })),
      };
      if (editando === 'novo') await api.post('/api/nichos', corpo);
      else await api.put(`/api/nichos/${editando}`, corpo);
      setEditando(null);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não consegui salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function testar(id: string) {
    setTestando(id);
    setErro(null);
    try {
      setTeste({ id, dados: await api.post<Teste>(`/api/nichos/${id}/testar`) });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'O teste falhou.');
    } finally {
      setTestando(null);
    }
  }

  async function sincronizar() {
    setSincronizando(true);
    setAviso(null);
    try {
      const r = await api.post<{ categories: number; roots: number; rows: number }>('/api/categorias/sync');
      setAviso(`Catálogo atualizado: ${r.categories} categorias em ${r.roots} prateleiras, lidas de ${int(r.rows)} produtos.`);
      await carregar();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'A colheita falhou.');
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Regras de nicho</h1>
          <p>
            Categoria sozinha não entrega nicho: a prateleira de fones é quase toda TWS genérico. Um nicho aqui
            é um conjunto de categorias mais o que você aceita dentro de cada uma.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost" disabled={sincronizando} onClick={() => void sincronizar()}>
            {sincronizando ? 'Colhendo...' : 'Atualizar catálogo'}
          </button>
          <button className="btn" onClick={abrirNovo}>
            Novo nicho
          </button>
        </div>
      </div>

      {erro && <div className="notice">{erro}</div>}
      {aviso && <div className="notice" data-tone="warn">{aviso}</div>}

      {arvore.length === 0 && (
        <div className="empty">
          <strong>Catálogo vazio</strong>
          Clique em "Atualizar catálogo" para colher as categorias da Shopee. Leva cerca de um minuto e só
          precisa ser feito de vez em quando.
        </div>
      )}

      {editando && (
        <div className="panel">
          <h2 className="panel__title">{editando === 'novo' ? 'Novo nicho' : 'Editando nicho'}</h2>

          <div className="row">
            <div className="field" style={{ flex: '2 1 260px' }}>
              <label htmlFor="nome">Nome</label>
              <input
                id="nome"
                value={rascunho.name}
                placeholder="Gamer e setup"
                onChange={(e) => setRascunho((r) => ({ ...r, name: e.target.value }))}
              />
            </div>
            <div className="field" style={{ flex: '0 1 150px' }}>
              <label htmlFor="minv">Vendas mínimas</label>
              <input
                id="minv"
                inputMode="numeric"
                value={rascunho.minSales}
                onChange={(e) => setRascunho((r) => ({ ...r, minSales: Number(e.target.value) || 0 }))}
              />
              <small>corta o que não vende</small>
            </div>
            <div className="field" style={{ flex: '2 1 300px' }}>
              <label htmlFor="excl">Nunca trazer se o título tiver</label>
              <input
                id="excl"
                value={rascunho.excludeTerms}
                placeholder="lapela, infantil, automotivo"
                onChange={(e) => setRascunho((r) => ({ ...r, excludeTerms: e.target.value }))}
              />
              <small>separe por vírgula</small>
            </div>
          </div>

          <div className="split">
            <div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label htmlFor="cat">Categorias do catálogo</label>
                <input
                  id="cat"
                  value={busca}
                  placeholder="buscar categoria..."
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <div className="catbox">
                {arvoreFiltrada.map((r) => (
                  <div key={r.id} className="catbox__grupo">
                    <div className="catbox__raiz">
                      {r.nome} <span>{int(r.itens)}</span>
                    </div>
                    {r.filhas.map((f) => (
                      <label key={f.id} className="catbox__item">
                        <input
                          type="checkbox"
                          checked={escolhidas.has(f.id)}
                          onChange={() => alternarCategoria(f.id, f.nome)}
                        />
                        <span>{f.nome}</span>
                        <em>{int(f.itens)}</em>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>No nicho ({rascunho.entries.length})</label>
                <small>
                  Deixe os termos vazios quando a prateleira já for pura. Preencha quando ela vier misturada.
                </small>
              </div>
              {rascunho.entries.length === 0 ? (
                <div className="empty" style={{ padding: 24 }}>
                  Escolha ao menos uma categoria à esquerda.
                </div>
              ) : (
                <div className="picked">
                  {rascunho.entries.map((e) => (
                    <div className="picked__item" key={e.categoryId}>
                      <div className="picked__top">
                        <strong>{e.nome}</strong>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => alternarCategoria(e.categoryId, e.nome)}
                        >
                          Tirar
                        </button>
                      </div>
                      <input
                        value={e.requireTerms.join(', ')}
                        placeholder="só trazer se tiver: gamer, rgb, headset"
                        onChange={(ev) =>
                          setRascunho((r) => ({
                            ...r,
                            entries: r.entries.map((x) =>
                              x.categoryId === e.categoryId
                                ? { ...x, requireTerms: parseTermos(ev.target.value) }
                                : x,
                            ),
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <button
              className="btn"
              disabled={busy || rascunho.name.trim().length < 2 || rascunho.entries.length === 0}
              onClick={() => void salvar()}
            >
              {busy ? 'Salvando...' : 'Salvar nicho'}
            </button>
            <button className="btn btn--ghost" onClick={() => setEditando(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {nichos.map((n) => (
        <div className="panel" key={n.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 16 }}>{n.name}</strong>
            {n.builtIn && <span className="chip">vem pronto</span>}
            <span className="chip">{n.entries.length} categorias</span>
            {n.minSales > 0 && <span className="chip">mín. {int(n.minSales)} vendas</span>}
            {n.regras > 0 && <span className="chip" data-tone="on">{n.regras} regra(s) usando</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn--ghost btn--sm" disabled={testando === n.id} onClick={() => void testar(n.id)}>
                {testando === n.id ? 'Testando...' : 'Testar'}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => abrirEdicao(n)}>
                Editar
              </button>
              {!n.builtIn && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={async () => {
                    await api.del(`/api/nichos/${n.id}`);
                    void carregar();
                  }}
                >
                  Remover
                </button>
              )}
            </span>
          </div>

          <div className="taglist">
            {n.entries.map((e) => (
              <span className="taglist__item" key={e.categoryId}>
                {e.nome}
                {e.requireTerms.length > 0 && <em> · {e.requireTerms.join(', ')}</em>}
              </span>
            ))}
          </div>

          {teste?.id === n.id && (
            <div style={{ marginTop: 16 }}>
              <div className="notice" data-tone="warn">
                <strong>
                  {teste.dados.bruto} produtos varridos → {teste.dados.aceitos} entraram no nicho
                  {teste.dados.bruto > 0 && ` (${Math.round((teste.dados.aceitos / teste.dados.bruto) * 100)}%)`}
                </strong>
              </div>

              <table className="table" style={{ marginBottom: 16 }}>
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th className="num">Varridos</th>
                    <th className="num">Aceitos</th>
                    <th className="num">Aproveitamento</th>
                  </tr>
                </thead>
                <tbody>
                  {teste.dados.porCategoria.map((c) => (
                    <tr key={c.categoryId}>
                      <td>
                        {c.nome}
                        {c.erro && <small style={{ display: 'block', color: 'var(--drop)' }}>{c.erro}</small>}
                      </td>
                      <td className="num">{c.bruto}</td>
                      <td className="num">
                        <strong>{c.aceitos}</strong>
                      </td>
                      <td className="num">{c.bruto ? `${Math.round((c.aceitos / c.bruto) * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <table className="table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Preço</th>
                    <th className="num">Vendas</th>
                    <th className="num">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {teste.dados.produtos.slice(0, 15).map((p) => (
                    <tr key={p.externalId}>
                      <td>
                        <div className="cell-product">
                          {p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" />}
                          <span>
                            {p.title}
                            <br />
                            <small style={{ color: 'var(--muted)' }}>{p.categoria}</small>
                          </span>
                        </div>
                      </td>
                      <td className="num">{brl(p.price)}</td>
                      <td className="num">
                        <strong>{int(p.soldCount)}</strong>
                      </td>
                      <td className="num">{p.commissionPct ? `${p.commissionPct.toFixed(0)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
