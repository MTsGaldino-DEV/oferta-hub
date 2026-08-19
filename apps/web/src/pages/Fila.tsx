import { useEffect, useState } from 'react';
import { api, brl, STORE, type Offer } from '../api.js';
import { PriceTag } from '../components/PriceTag.js';

interface Found {
  ok: boolean;
  platform: string;
  externalId?: string;
  title?: string;
  price?: number;
  listPrice?: number;
  imageUrl?: string;
  commissionPct?: number;
  error?: string;
}

/** Quantas ofertas cada nicho tem parada na fila. */
interface AbaNicho {
  nicheId: string;
  nome: string;
  total: number;
}

export function Fila() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [abas, setAbas] = useState<AbaNicho[]>([]);
  const [aba, setAba] = useState('');
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [editing, setEditing] = useState<Offer | null>(null);
  const [draft, setDraft] = useState('');

  async function load(filtro = aba) {
    setLoading(true);
    try {
      const query = filtro ? `&nicheId=${encodeURIComponent(filtro)}` : '';
      setOffers(await api.get<Offer[]>(`/api/offers?status=PENDING${query}`));
      setAbas(await api.get<AbaNicho[]>('/api/offers/por-nicho?status=PENDING'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(aba);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  async function addUrl() {
    setAdding(true);
    setError(null);
    try {
      const offer = await api.post<Offer>('/api/offers', { url: url.trim(), note: note.trim() || undefined });
      setOffers((prev) => [offer, ...prev]);
      setUrl('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui capturar essa oferta.');
    } finally {
      setAdding(false);
    }
  }

  async function search() {
    setSearching(true);
    setFound(null);
    try {
      setFound(await api.get<Found[]>(`/api/search?q=${encodeURIComponent(term.trim())}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'A busca falhou.');
    } finally {
      setSearching(false);
    }
  }

  async function queueFound(item: Found) {
    const offer = await api.post<Offer>('/api/offers/from-product', {
      platform: item.platform,
      externalId: item.externalId,
    });
    setOffers((prev) => [offer, ...prev]);
  }

  /** Tira a oferta da lista e corrige o contador da aba sem recarregar tudo. */
  function retirar(id: string) {
    const saindo = offers.find((o) => o.id === id);
    setTimeout(() => {
      setOffers((prev) => prev.filter((o) => o.id !== id));
      setAbas((prev) =>
        prev
          .map((a) => (a.nicheId === (saindo?.nicheId ?? 'sem-nicho') ? { ...a, total: a.total - 1 } : a))
          .filter((a) => a.total > 0),
      );
    }, 220);
  }

  async function send(id: string) {
    await api.post(`/api/offers/${id}/send`);
    retirar(id);
  }

  async function skip(id: string) {
    await api.post(`/api/offers/${id}/skip`);
    retirar(id);
  }

  async function saveDraft() {
    if (!editing) return;
    const updated = await api.patch<Offer>(`/api/offers/${editing.id}`, { message: draft });
    setOffers((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    setEditing(null);
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Fila de curadoria</h1>
          <p>
            Ordenada pela nota: histórico de preço pesa mais que o desconto anunciado. Nada sai daqui sem você
            clicar.
          </p>
        </div>
        <button className="btn btn--ghost" onClick={() => void load()}>
          Atualizar
        </button>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="panel">
        <h2 className="panel__title">Adicionar oferta</h2>
        <div className="row">
          <div className="field" style={{ flex: '2 1 340px' }}>
            <label htmlFor="url">Cole o link do produto</label>
            <input
              id="url"
              value={url}
              placeholder="https://www.amazon.com.br/dp/..."
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="note">Comentário seu (opcional)</label>
            <input
              id="note"
              value={note}
              placeholder="Estoque baixo, corre"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button className="btn" disabled={!url.trim() || adding} onClick={() => void addUrl()}>
            {adding ? 'Buscando...' : 'Capturar'}
          </button>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <div className="field" style={{ flex: '2 1 340px' }}>
            <label htmlFor="term">Ou garimpe agora nas lojas conectadas</label>
            <input
              id="term"
              value={term}
              placeholder="air fryer 5 litros"
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && term.trim().length > 1 && void search()}
            />
          </div>
          <button className="btn btn--ghost" disabled={term.trim().length < 2 || searching} onClick={() => void search()}>
            {searching ? 'Procurando...' : 'Procurar'}
          </button>
        </div>

        {found && (
          <table className="table" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Preço</th>
                <th className="num">Comissão</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {found.filter((f) => !f.ok).map((f, i) => (
                <tr key={`err-${i}`}>
                  <td colSpan={4} style={{ color: 'var(--muted)', fontSize: 13 }}>
                    {STORE[f.platform]}: {f.error}
                  </td>
                </tr>
              ))}
              {found.filter((f) => f.ok).map((f) => (
                <tr key={`${f.platform}-${f.externalId}`}>
                  <td>
                    <div className="cell-product">
                      {f.imageUrl && <img src={f.imageUrl} alt="" loading="lazy" />}
                      <span>
                        {f.title}
                        <br />
                        <small style={{ color: 'var(--muted)' }}>{STORE[f.platform]}</small>
                      </span>
                    </div>
                  </td>
                  <td className="num">{brl(f.price)}</td>
                  <td className="num">{f.commissionPct ? `${f.commissionPct.toFixed(1)}%` : '—'}</td>
                  <td className="num">
                    <button className="btn btn--ghost btn--sm" onClick={() => void queueFound(f)}>
                      Pra fila
                    </button>
                  </td>
                </tr>
              ))}
              {found.filter((f) => f.ok).length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--muted)' }}>
                    Nenhum produto voltou dessa busca.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ height: 20 }} />

      {abas.length > 1 && (
        <div className="tabs">
          <button className="tabs__item" data-on={aba === ''} onClick={() => setAba('')}>
            Todos <span>{abas.reduce((n, a) => n + a.total, 0)}</span>
          </button>
          {abas.map((a) => (
            <button
              key={a.nicheId}
              className="tabs__item"
              data-on={aba === a.nicheId}
              onClick={() => setAba(a.nicheId)}
            >
              {a.nome} <span>{a.total}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? null : offers.length === 0 ? (
        <div className="empty">
          <strong>Fila vazia</strong>
          Cole um link acima, ou espere os workers: o monitor de preço roda de hora em hora e o garimpo a cada 3
          horas.
        </div>
      ) : (
        <div className="shelf">
          {offers.map((o) => (
            <PriceTag
              key={o.id}
              offer={o}
              onSend={send}
              onSkip={skip}
              onEdit={(offer) => {
                setEditing(offer);
                setDraft(offer.message);
              }}
            />
          ))}
        </div>
      )}

      {editing && (
        <div className="panel" style={{ marginTop: 20 }}>
          <h2 className="panel__title">Texto que vai pro grupo</h2>
          <textarea rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => void saveDraft()}>
              Salvar texto
            </button>
            <button
              className="btn btn--ghost"
              onClick={async () => {
                const rebuilt = await api.post<Offer>(`/api/offers/${editing.id}/rebuild`);
                setDraft(rebuilt.message);
              }}
            >
              Refazer pelo modelo
            </button>
            <button className="btn btn--ghost" onClick={() => setEditing(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
