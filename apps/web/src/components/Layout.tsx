import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const LINKS = [
  { to: '/', label: 'Fila', end: true },
  { to: '/desempenho', label: 'Desempenho' },
  { to: '/produtos', label: 'Preços vigiados' },
  { to: '/agenda', label: 'Agenda' },
  { to: '/conexoes', label: 'Conexões' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState(0);
  const [wa, setWa] = useState<{ status: string; quota: { used: number; cap: number } } | null>(null);
  const location = useLocation();

  useEffect(() => {
    api.get<{ pending: number }>('/api/stats/overview?days=30').then((s) => setPending(s.pending)).catch(() => {});
    api.get<any>('/api/whatsapp/status').then(setWa).catch(() => {});
  }, [location.pathname]);

  const online = wa?.status === 'connected';

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail__mark">
          Oferta<span>Hub</span>
        </div>

        <nav className="rail__nav">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="rail__link">
              {l.label}
              {l.to === '/' && pending > 0 && <span className="rail__count">{pending}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="rail__foot">
          <div>
            WhatsApp: <strong style={{ color: online ? 'var(--tag)' : '#fff' }}>{online ? 'conectado' : 'offline'}</strong>
          </div>
          {wa && (
            <div>
              Envios hoje: {wa.quota.used}/{wa.quota.cap}
            </div>
          )}
          <button
            className="btn btn--ghost btn--sm"
            style={{ borderColor: 'rgba(255,255,255,.25)', color: '#fff', width: 'fit-content' }}
            onClick={async () => {
              await api.post('/api/logout');
              window.location.href = '/';
            }}
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
