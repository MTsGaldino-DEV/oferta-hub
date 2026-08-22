import { useEffect, useState } from 'react';
import { api, int } from '../api.js';

interface GroupRow {
  jid: string;
  name: string;
  memberCount: number | null;
  joined: number;
  left: number;
  trackingSince: string | null;
}

interface GroupsResponse {
  days: number;
  groups: GroupRow[];
}

export function MeusGrupos() {
  const [days, setDays] = useState(30);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);

  useEffect(() => {
    void api
      .get<GroupsResponse>(`/api/groups?days=${days}`)
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
  }, [days]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Meus Grupos</h1>
          <p>Quantos membros cada grupo tem agora, e quantos entraram ou saíram no período escolhido.</p>
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

      <div className="panel">
        <h2 className="panel__title">Grupos</h2>
        {groups === null ? null : groups.length === 0 ? (
          <div className="empty">
            <strong>Nenhum grupo sincronizado</strong>
            Conecte o WhatsApp e sincronize os grupos em Configurações para ver as métricas aqui.
          </div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th className="num">Membros</th>
                  <th className="num">Entraram</th>
                  <th className="num">Saíram</th>
                  <th>Rastreando desde</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.jid}>
                    <td>
                      <strong>{g.name}</strong>
                    </td>
                    <td className="num">{g.memberCount ?? '—'}</td>
                    <td className="num" style={g.joined ? { color: 'var(--gain)' } : undefined}>
                      {g.joined ? `+${int(g.joined)}` : 0}
                    </td>
                    <td className="num" style={g.left ? { color: 'var(--drop)' } : undefined}>
                      {g.left ? `-${int(g.left)}` : 0}
                    </td>
                    <td>
                      {g.trackingSince ? (
                        `desde ${new Date(g.trackingSince).toLocaleDateString('pt-BR')}`
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>ainda sem histórico</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>
              Entradas e saídas só contam a partir de quando essa métrica passou a ser registrada (veja
              "Rastreando desde" de cada grupo) — período anterior a isso não é zero, é desconhecido.
            </p>
          </>
        )}
      </div>
    </>
  );
}
