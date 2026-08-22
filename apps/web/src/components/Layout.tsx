import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Logo } from './Logo.js';

type NavLinkDef = { to: string; label: string; end?: boolean };

const GROUPS: { label: string | null; items: NavLinkDef[] }[] = [
  { label: null, items: [{ to: '/', label: 'Fila', end: true }] },
  {
    label: 'Catálogo',
    items: [
      { to: '/nichos', label: 'Nichos' },
      { to: '/produtos', label: 'Preços vigiados' },
    ],
  },
  {
    label: 'Automação',
    items: [
      { to: '/agenda', label: 'Agenda' },
      { to: '/automacoes', label: 'Automações' },
    ],
  },
  { label: 'Métricas', items: [{ to: '/desempenho', label: 'Desempenho' }] },
  { label: 'Configurações', items: [{ to: '/conexoes', label: 'Conexões' }] },
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
          <Logo size={34} className="rail__logo" />
          <div className="rail__wordmark">
            Hub<span>Ofertas</span>
          </div>
        </div>

        <nav className="rail__nav">
          {GROUPS.map((g, gi) => (
            <div className="rail__group" key={g.label ?? `g${gi}`}>
              {g.label && <div className="rail__group-label">{g.label}</div>}
              {g.items.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className="rail__link">
                  {l.label}
                  {l.to === '/' && pending > 0 && <span className="rail__count">{pending}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="rail__foot">
          <div className="rail__user">
            <div className="rail__user__row">
              <span className="rail__user__status">
                <span className="rail__user__dot" data-online={online} />
                {online ? 'Conectado' : 'Offline'}
              </span>
              <button
                className="btn btn--ghost btn--sm"
                style={{ borderColor: 'rgba(255,255,255,.25)', color: '#fff' }}
                onClick={async () => {
                  await api.post('/api/logout');
                  window.location.href = '/';
                }}
              >
                Sair
              </button>
            </div>
            {wa && (
              <div className="rail__user__quota">
                Envios hoje: {wa.quota.used}/{wa.quota.cap}
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
