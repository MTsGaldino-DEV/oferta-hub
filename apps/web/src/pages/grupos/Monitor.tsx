import { useEffect, useState } from 'react';
import { api, int } from '../../api.js';

interface GroupRow {
  jid: string;
  name: string;
  memberCount: number | null;
  joined: number;
  left: number;
  trackingSince: string | null;
  sent: number;
}

interface GroupsResponse {
  days: number;
  groups: GroupRow[];
  totais: { grupos: number; membros: number; enviadas: number };
}

export function Monitor() {
  const [days, setDays] = useState(30);
  const [dados, setDados] = useState<GroupsResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setErro(null);
    void api
      .get<GroupsResponse>(`/api/groups?days=${days}`)
      .then(setDados)
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar os grupos.'));
  }, [days]);

  const grupos = dados?.groups ?? [];

  return (
    <>
      <div className="head">
        <div>
          <h1>Meus Grupos</h1>
          <p>Acompanhe a saúde dos seus grupos e o alcance de cada envio.</p>
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

      {erro && <div className="notice">{erro}</div>}

      {dados && (
        <div className="grid-kpi">
          <div className="kpi">
            <div className="kpi__label">Grupos ativos</div>
            <div className="kpi__value">{int(dados.totais.grupos)}</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Membros alcançados</div>
            <div className="kpi__value">{int(dados.totais.membros)}</div>
          </div>
          <div className="kpi">
            <div className="kpi__label">Mensagens enviadas</div>
            <div className="kpi__value">{int(dados.totais.enviadas)}</div>
          </div>
        </div>
      )}

      {dados && grupos.length === 0 && (
        <div className="empty">
          <strong>Nenhum grupo sincronizado</strong>
          Conecte o WhatsApp e sincronize os grupos em Configurações › Canais para ver as métricas aqui.
        </div>
      )}

      <div className="grupos">
        {grupos.map((g) => (
          <div key={g.jid} className="grupo">
            <h2 className="grupo__nome">{g.name}</h2>

            <div className="grupo__linha">
              <div>
                <strong className="grupo__membros">{g.memberCount ?? '—'}</strong>
                <span className="grupo__unidade">membros</span>
              </div>
              <div className="grupo__delta">
                <span style={{ color: g.joined ? 'var(--gain)' : 'var(--muted)' }}>
                  ↑ {int(g.joined)} em {days}d
                </span>
                <span style={{ color: g.left ? 'var(--drop)' : 'var(--muted)' }}>
                  ↓ {int(g.left)} em {days}d
                </span>
              </div>
            </div>

            <div className="grupo__rodape">
              {g.sent > 0 ? (
                <span>
                  Enviadas: <strong>{int(g.sent)}</strong>
                </span>
              ) : (
                <span style={{ color: 'var(--muted)' }}>Sem envios ainda</span>
              )}
              {g.trackingSince ? (
                // Sem isso um grupo com poucos dias de historico mostra "0
                // em 90d" como se fosse fato sobre o periodo inteiro, quando
                // na verdade a janela rastreada e menor que isso.
                <span style={{ color: 'var(--muted)' }} title="Entradas e saídas só contam a partir dessa data">
                  desde {new Date(g.trackingSince).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                </span>
              ) : (
                <span style={{ color: 'var(--muted)' }} title="Entradas e saídas só contam a partir do primeiro registro">
                  sem histórico de entradas
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {grupos.length > 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>
          Entradas e saídas só contam a partir de quando a métrica passou a ser registrada em cada grupo —
          período anterior a isso não é zero, é desconhecido.
        </p>
      )}
    </>
  );
}
