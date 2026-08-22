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
  const [enviadasHoje, setEnviadasHoje] = useState<number | null>(null);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [limpando, setLimpando] = useState(false);
  const [limpandoFila, setLimpandoFila] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const [editing, setEditing] = useState<Offer | null>(null);
  const [draft, setDraft] = useState('');

  async function load(filtro = aba) {
    setLoading(true);
    try {
      const query = filtro ? `&nicheId=${encodeURIComponent(filtro)}` : '';
      setOffers(await api.get<Offer[]>(`/api/offers?status=PENDING${query}`));
      setAbas(await api.get<AbaNicho[]>('/api/offers/por-nicho?status=PENDING'));
      void carregarEnviadasHoje();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(aba);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  async function carregarEnviadasHoje() {
    try {
      const r = await api.get<{ total: number }>('/api/offers/enviadas-hoje');
      setEnviadasHoje(r.total);
    } catch {
      // contador e informativo -- uma falha aqui nao pode travar a fila
    }
  }

  useEffect(() => {
    void carregarEnviadasHoje();
  }, []);

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
    setEnviadasHoje((n) => (n ?? 0) + 1);
  }

  async function skip(id: string) {
    await api.post(`/api/offers/${id}/skip`);
    retirar(id);
  }

  /** Colapsa anuncios repetidos que ja estao na fila, ficando com o mais barato. */
  async function limparDuplicados() {
    setLimpando(true);
    setAviso(null);
    try {
      const r = await api.post<{
        antes: number;
        depois: number;
        cortadas: number;
        exemplos: { ficou: string; preco: number; repetidos: number }[];
      }>('/api/offers/limpar-duplicados');
      setAviso(
        r.cortadas === 0
          ? 'Nenhum produto repetido na fila.'
          : `${r.cortadas} anúncio(s) repetido(s) saíram da fila — ficou o mais barato de cada produto. Restaram ${r.depois}.` +
            (r.exemplos.length ? ` Ex.: "${r.exemplos[0].ficou.slice(0, 40)}..." resumiu ${r.exemplos[0].repetidos + 1} anúncios.` : ''),
      );
      await load(aba);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Não consegui limpar.');
    } finally {
      setLimpando(false);
    }
  }

  /** Manda pra SKIPPED tudo que esta pendente na aba aberta -- ou a fila toda, na aba "Todos". */
  async function limparFila() {
    const nomeAba = aba ? abas.find((a) => a.nicheId === aba)?.nome ?? 'este nicho' : 'toda a fila';
    if (!offers.length) return;
    if (!confirm(`Pular ${offers.length} oferta(s) de ${nomeAba}? Não volta pra fila sozinha.`)) return;

    setLimpandoFila(true);
    setAviso(null);
    try {
      const r = await api.post<{ removidas: number }>('/api/offers/limpar-fila', aba ? { nicheId: aba } : {});
      setAviso(`${r.removidas} oferta(s) saíram da fila.`);
      await load(aba);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Não consegui limpar a fila.');
    } finally {
      setLimpandoFila(false);
    }
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
            {enviadasHoje !== null && (
              <>
                {' '}
                <strong>{enviadasHoje}</strong> enviada{enviadasHoje === 1 ? '' : 's'} hoje.
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost" disabled={limpando} onClick={() => void limparDuplicados()}>
            {limpando ? 'Limpando...' : 'Limpar repetidos'}
          </button>
          <button
            className="btn btn--ghost"
            disabled={limpandoFila || offers.length === 0}
            onClick={() => void limparFila()}
          >
            {limpandoFila ? 'Limpando...' : 'Limpar fila'}
          </button>
          <button className="btn btn--ghost" onClick={() => void load(aba)}>
            Atualizar
          </button>
        </div>
      </div>

      {error && <div className="notice">{error}</div>}
      {aviso && <div className="notice" data-tone="warn">{aviso}</div>}

      <div className="panel panel--hero">
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
          {offers.map((o, i) => (
            <PriceTag
              key={o.id}
              offer={o}
              posicao={i + 1}
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
