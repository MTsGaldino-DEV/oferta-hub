import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, int } from '../api.js';

interface Overview {
  sent: { value: number };
  clicks: { value: number };
  pending: number;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
    </div>
  );
}

export function VisaoGeral() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [groups, setGroups] = useState<number | null>(null);

  useEffect(() => {
    api.get<Overview>('/api/stats/overview?days=1').then(setOverview).catch(() => {});
    api
      .get<any>('/api/whatsapp/status')
      .then((s) => setGroups(s.groups.length))
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="head">
        <div>
          <h1>Visão geral</h1>
          <p>Um retrato rápido do que está na fila e do que saiu hoje. Pra métrica de verdade, veja Desempenho.</p>
        </div>
      </div>

      <div className="panel panel--hero">
        <h2 className="panel__title">Capturar oferta</h2>
        <p>Cole um link ou busque nas lojas conectadas — a fila é onde você decide manda ou pula.</p>
        <Link className="btn" to="/fila">
          Ir para a fila
        </Link>
      </div>

      <div className="panel">
        <div className="kpi__label">Ofertas esperando revisão</div>
        <div className="kpi__value">{overview ? int(overview.pending) : '—'}</div>
        <p style={{ marginTop: 8 }}>
          <Link to="/fila">Ver fila →</Link>
        </p>
      </div>

      <div style={{ height: 20 }} />

      <div className="grid-kpi">
        <Kpi label="Ofertas na fila" value={overview ? int(overview.pending) : '—'} />
        <Kpi label="Cliques" value={overview ? int(overview.clicks.value) : '—'} />
        <Kpi label="Enviadas hoje" value={overview ? int(overview.sent.value) : '—'} />
        <Kpi label="Grupos ativos" value={groups === null ? '—' : int(groups)} />
      </div>

      <div className="panel">
        <h2 className="panel__title">Disparos</h2>
        <div className="empty">
          <strong>Disparos ainda não existe</strong>
          Em breve.
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <h2 className="panel__title">Ranking de conversão</h2>
          <p>Ainda não construído — vai mostrar quais grupos convertem melhor.</p>
        </div>
        <div className="panel">
          <h2 className="panel__title">Melhores horários para disparar</h2>
          <p>Ainda não construído — vai apontar os horários com mais clique.</p>
        </div>
      </div>
    </>
  );
}
