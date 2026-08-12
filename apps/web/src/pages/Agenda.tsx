import { useEffect, useState } from 'react';
import { api, brl, STORE, type Offer } from '../api.js';

export function Agenda() {
  const [queued, setQueued] = useState<Offer[]>([]);
  const [pending, setPending] = useState<Offer[]>([]);
  const [groups, setGroups] = useState<{ jid: string; name: string; isDefault: boolean }[]>([]);
  const [pick, setPick] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setQueued(await api.get<Offer[]>('/api/offers?status=QUEUED'));
    setPending(await api.get<Offer[]>('/api/offers?status=PENDING'));
    const wa = await api.get<any>('/api/whatsapp/status');
    setGroups(wa.groups ?? []);
  }

  useEffect(() => {
    void load().catch(() => {});
  }, []);

  async function schedule() {
    setError(null);
    try {
      await api.post(`/api/offers/${pick}/schedule`, { when: new Date(when).toISOString() });
      setPick('');
      setWhen('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui agendar.');
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Agenda</h1>
          <p>
            Espaçar os posts vale mais que volume: o agendador respeita o intervalo mínimo entre envios e o teto
            diário definidos no .env.
          </p>
        </div>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="panel">
        <h2 className="panel__title">Marcar horário</h2>
        <div className="row">
          <div className="field" style={{ flex: '3 1 340px' }}>
            <label htmlFor="offer">Oferta da fila</label>
            <select id="offer" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Escolha uma oferta</option>
              {pending.map((o) => (
                <option key={o.id} value={o.id}>
                  [{o.score}] {o.product.title.slice(0, 60)} — {brl(o.price)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="when">Enviar em</label>
            <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <button className="btn" disabled={!pick || !when} onClick={() => void schedule()}>
            Agendar
          </button>
        </div>
        {groups.length > 0 && (
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 0, marginTop: 12 }}>
            Destino: {groups.find((g) => g.isDefault)?.name ?? groups[0].name}. Troque em Conexões.
          </p>
        )}
      </div>

      <div className="panel">
        <h2 className="panel__title">Programadas</h2>
        {queued.length === 0 ? (
          <div className="empty">Nada agendado. As ofertas que você enviar na hora não passam por aqui.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Preço</th>
                <th className="num">Nota</th>
                <th className="num">Sai em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queued.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="cell-product">
                      {o.product.imageUrl && <img src={o.product.imageUrl} alt="" loading="lazy" />}
                      <span>{o.product.title}<br /><small style={{ color: 'var(--muted)' }}>{STORE[o.product.platform]}</small></span>
                    </div>
                  </td>
                  <td className="num">{brl(o.price)}</td>
                  <td className="num">{o.score}</td>
                  <td className="num">
                    {o.scheduledFor ? new Date(o.scheduledFor).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="num">
                    <button className="btn btn--ghost btn--sm" onClick={async () => { await api.post(`/api/offers/${o.id}/skip`); void load(); }}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
