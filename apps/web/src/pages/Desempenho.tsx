import { useEffect, useState } from 'react';
import { api, brl, int, STORE } from '../api.js';

interface Overview {
  days: number;
  sent: { value: number; previous: number };
  clicks: { value: number; previous: number };
  orders: { value: number; previous: number };
  revenue: { value: number; previous: number };
  clicksPerOffer: number;
  conversionRate: number;
}

interface Point { day: string; clicks: number; revenue: number }

interface OfferRow {
  id: string; title: string; imageUrl: string | null; platform: string;
  price: number; sentAt: string; clicks: number; orders: number; revenue: number; conversionRate: number;
}

interface PlatformRow {
  platform: string; sent: number; clicks: number; orders: number;
  revenue: number; revenuePerClick: number; revenuePerOffer: number; conversionRate: number;
}

function delta(now: number, before: number) {
  if (!before) return null;
  const pct = ((now - before) / before) * 100;
  return { pct, dir: pct >= 0 ? 'up' : 'down' } as const;
}

function Kpi({ label, value, now, before }: { label: string; value: string; now: number; before: number }) {
  const d = delta(now, before);
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      <div className="kpi__delta" data-dir={d?.dir}>
        {d ? `${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(0)}% vs período anterior` : 'sem base de comparação'}
      </div>
    </div>
  );
}

/** Gráfico de duas séries desenhado à mão: cliques em barra, comissão em linha. */
function Chart({ data }: { data: Point[] }) {
  if (data.length < 2) return <div className="empty">Ainda não há dias suficientes para o gráfico.</div>;

  const w = 900;
  const h = 200;
  const pad = { t: 12, r: 8, b: 20, l: 8 };
  const maxClicks = Math.max(...data.map((d) => d.clicks), 1);
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const barW = (w - pad.l - pad.r) / data.length;

  const line = data
    .map((d, i) => {
      const x = pad.l + i * barW + barW / 2;
      const y = pad.t + (1 - d.revenue / maxRevenue) * (h - pad.t - pad.b);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img"
        aria-label="Cliques por dia em barras e comissão por dia em linha">
        {data.map((d, i) => {
          const barH = (d.clicks / maxClicks) * (h - pad.t - pad.b);
          return (
            <rect key={d.day} x={pad.l + i * barW + 1} y={h - pad.b - barH}
              width={Math.max(1, barW - 2)} height={barH} fill="rgba(22,23,26,0.16)" />
          );
        })}
        <line x1={0} y1={h - pad.b} x2={w} y2={h - pad.b} stroke="var(--line)" strokeWidth="1" />
        <path d={line} fill="none" stroke="var(--drop)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
        <span>▪ cliques (máx {maxClicks})</span>
        <span style={{ color: 'var(--drop)' }}>— comissão (máx {brl(maxRevenue)})</span>
        <span style={{ marginLeft: 'auto' }}>{data[0].day} → {data[data.length - 1].day}</span>
      </div>
    </>
  );
}

export function Desempenho() {
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [series, setSeries] = useState<Point[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);

  useEffect(() => {
    void Promise.all([
      api.get<Overview>(`/api/stats/overview?days=${days}`).then(setOverview),
      api.get<Point[]>(`/api/stats/timeseries?days=${days}`).then(setSeries),
      api.get<OfferRow[]>(`/api/stats/offers?days=${days}`).then(setOffers),
      api.get<PlatformRow[]>(`/api/stats/platforms?days=${days}`).then(setPlatforms),
    ]).catch(() => {});
  }, [days]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Desempenho</h1>
          <p>Clique é o que você mede sozinho. Venda depende do relatório da rede, que costuma atrasar dias.</p>
        </div>
        <div className="field" style={{ width: 180 }}>
          <label htmlFor="days">Período</label>
          <select id="days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </div>
      </div>

      {overview && (
        <div className="grid-kpi">
          <Kpi label="Cliques" value={int(overview.clicks.value)} now={overview.clicks.value} before={overview.clicks.previous} />
          <Kpi label="Comissão" value={brl(overview.revenue.value)} now={overview.revenue.value} before={overview.revenue.previous} />
          <Kpi label="Vendas" value={int(overview.orders.value)} now={overview.orders.value} before={overview.orders.previous} />
          <Kpi label="Ofertas enviadas" value={int(overview.sent.value)} now={overview.sent.value} before={overview.sent.previous} />
          <div className="kpi">
            <div className="kpi__label">Cliques por oferta</div>
            <div className="kpi__value">{overview.clicksPerOffer}</div>
            <div className="kpi__delta">conversão de {overview.conversionRate}%</div>
          </div>
        </div>
      )}

      <div className="panel">
        <h2 className="panel__title">Cliques e comissão por dia</h2>
        <Chart data={series} />
      </div>

      <div className="panel">
        <h2 className="panel__title">Onde vale a pena postar</h2>
        {platforms.length === 0 ? (
          <div className="empty">Sem ofertas enviadas nesse período.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Plataforma</th>
                <th className="num">Ofertas</th>
                <th className="num">Cliques</th>
                <th className="num">Vendas</th>
                <th className="num">Comissão</th>
                <th className="num">R$ / clique</th>
                <th className="num">R$ / oferta</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((p) => (
                <tr key={p.platform}>
                  <td><strong>{STORE[p.platform]}</strong></td>
                  <td className="num">{p.sent}</td>
                  <td className="num">{int(p.clicks)}</td>
                  <td className="num">{p.orders}</td>
                  <td className="num">{brl(p.revenue)}</td>
                  <td className="num">{brl(p.revenuePerClick)}</td>
                  <td className="num">{brl(p.revenuePerOffer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2 className="panel__title">Ofertas enviadas</h2>
        {offers.length === 0 ? (
          <div className="empty">
            <strong>Nada enviado ainda</strong>
            Aprove uma oferta na fila e ela aparece aqui com os cliques.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Preço</th>
                <th className="num">Cliques</th>
                <th className="num">Vendas</th>
                <th className="num">Comissão</th>
                <th className="num">Enviada</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="cell-product">
                      {o.imageUrl && <img src={o.imageUrl} alt="" loading="lazy" />}
                      <span>{o.title}<br /><small style={{ color: 'var(--muted)' }}>{STORE[o.platform]}</small></span>
                    </div>
                  </td>
                  <td className="num">{brl(o.price)}</td>
                  <td className="num"><strong>{int(o.clicks)}</strong></td>
                  <td className="num">{o.orders || '—'}</td>
                  <td className="num">{o.revenue ? brl(o.revenue) : '—'}</td>
                  <td className="num">{new Date(o.sentAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
