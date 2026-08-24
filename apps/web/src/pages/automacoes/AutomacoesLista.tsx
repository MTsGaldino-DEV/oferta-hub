import { useEffect, useState } from 'react';
import { api } from '../../api.js';

interface Regra {
  id: string;
  name: string;
  active: boolean;
  weekdays: number[];
  windowStart: string;
  windowEnd: string;
  intervalMinutes: number;
  nicheId: string | null;
  nicho: string | null;
  batchSize: number;
  cooldownHours: number;
  groupJids: string[];
  runsCount: number;
  lastRunAt: string | null;
}

interface Grupo {
  jid: string;
  name: string;
  isDefault: boolean;
}

interface NichoOpcao {
  id: string;
  name: string;
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const rascunhoVazio = {
  name: '',
  active: false,
  weekdays: [1, 2, 3, 4, 5, 6, 0] as number[],
  windowStart: '09:00',
  windowEnd: '21:00',
  intervalMinutes: 180,
  nicheId: '' as string,
  batchSize: 1,
  cooldownHours: 72,
  groupJids: [] as string[],
};

function resumoJanela(r: Regra) {
  const dias = r.weekdays.length === 7 ? 'Todo dia' : r.weekdays.map((d) => DIAS[d]).join(', ');
  const horas = r.intervalMinutes % 60 === 0 ? `${r.intervalMinutes / 60}h` : `${r.intervalMinutes}min`;
  return `${dias} · ${r.windowStart}–${r.windowEnd} · a cada ${horas}`;
}

function tempoDesde(iso: string | null) {
  if (!iso) return 'nunca rodou';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.round(h / 24)}d`;
}

export function AutomacoesLista() {
  const [regras, setRegras] = useState<Regra[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [nichos, setNichos] = useState<NichoOpcao[]>([]);
  const [editando, setEditando] = useState<string | 'novo' | null>(null);
  const [rascunho, setRascunho] = useState(rascunhoVazio);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rodando, setRodando] = useState<string | null>(null);

  async function carregar() {
    setRegras(await api.get<Regra[]>('/api/automacoes'));
    const wa = await api.get<{ groups: Grupo[] }>('/api/whatsapp/status');
    setGrupos(wa.groups ?? []);
    setNichos(await api.get<NichoOpcao[]>('/api/nichos'));
  }

  useEffect(() => {
    void carregar().catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar.'));
  }, []);

  function abrirNovo() {
    setRascunho(rascunhoVazio);
    setEditando('novo');
    setErro(null);
  }

  function abrirEdicao(r: Regra) {
    setRascunho({
      name: r.name,
      active: r.active,
      weekdays: [...r.weekdays],
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      intervalMinutes: r.intervalMinutes,
      nicheId: r.nicheId ?? '',
      batchSize: r.batchSize,
      cooldownHours: r.cooldownHours,
      groupJids: [...r.groupJids],
    });
    setEditando(r.id);
    setErro(null);
  }

  function alternarDia(d: number) {
    setRascunho((r) => ({
      ...r,
      weekdays: r.weekdays.includes(d) ? r.weekdays.filter((x) => x !== d) : [...r.weekdays, d].sort(),
    }));
  }

  function alternarGrupo(jid: string) {
    setRascunho((r) => ({
      ...r,
      groupJids: r.groupJids.includes(jid) ? r.groupJids.filter((x) => x !== jid) : [...r.groupJids, jid],
    }));
  }

  async function salvar() {
    if (!rascunho.weekdays.length) return setErro('Escolha ao menos um dia da semana.');
    if (!rascunho.groupJids.length) return setErro('Escolha ao menos um grupo de destino.');

    setBusy(true);
    setErro(null);
    try {
      const corpo = {
        name: rascunho.name.trim(),
        active: rascunho.active,
        weekdays: rascunho.weekdays,
        windowStart: rascunho.windowStart,
        windowEnd: rascunho.windowEnd,
        intervalMinutes: Number(rascunho.intervalMinutes) || 180,
        nicheId: rascunho.nicheId || null,
        batchSize: Number(rascunho.batchSize) || 1,
        cooldownHours: Number(rascunho.cooldownHours) || 72,
        groupJids: rascunho.groupJids,
      };
      if (editando === 'novo') await api.post('/api/automacoes', corpo);
      else await api.put(`/api/automacoes/${editando}`, corpo);
      setEditando(null);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não consegui salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function excluir(id: string) {
    if (!confirm('Apagar essa automação?')) return;
    await api.del(`/api/automacoes/${id}`);
    await carregar();
  }

  async function alternarAtiva(r: Regra) {
    await api.put(`/api/automacoes/${r.id}`, { ...r, nicheId: r.nicheId, active: !r.active });
    await carregar();
  }

  async function rodarAgora(id: string) {
    setRodando(id);
    setAviso(null);
    try {
      const res = await api.post<{ grupo: string; escolhidos: number; enviados: number; falhas: string[] }>(
        `/api/automacoes/${id}/rodar-agora`,
      );
      const partes = [`${res.enviados} de ${res.escolhidos} enviados`];
      if (res.falhas.length) partes.push(`${res.falhas.length} falharam`);
      setAviso(partes.join(', ') + '.');
      await carregar();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'A rodada falhou.');
    } finally {
      setRodando(null);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Automações</h1>
          <p>
            A única parte do app que manda oferta sozinha, sem você clicar. Escolhe as melhores ofertas
            pendentes e envia nos dias, horários e grupos que você definir aqui — o teto diário e o intervalo
            mínimo entre envios continuam valendo por cima disso.
          </p>
        </div>
        <button className="btn" onClick={abrirNovo}>
          Nova automação
        </button>
      </div>

      {erro && <div className="notice">{erro}</div>}
      {aviso && <div className="notice" data-tone="warn">{aviso}</div>}

      {grupos.length === 0 && (
        <div className="empty">
          <strong>Nenhum grupo sincronizado</strong>
          Conecte o WhatsApp e sincronize os grupos em Configurações › Canais antes de criar uma automação.
        </div>
      )}

      {editando && (
        <div className="panel">
          <h2 className="panel__title">{editando === 'novo' ? 'Nova automação' : 'Editando automação'}</h2>

          <div className="row">
            <div className="field" style={{ flex: '2 1 260px' }}>
              <label htmlFor="nome">Nome</label>
              <input
                id="nome"
                value={rascunho.name}
                placeholder="Gamer à noite"
                onChange={(e) => setRascunho((r) => ({ ...r, name: e.target.value }))}
              />
            </div>
            <div className="field" style={{ flex: '2 1 220px' }}>
              <label htmlFor="nicho">Nicho</label>
              <select
                id="nicho"
                value={rascunho.nicheId}
                onChange={(e) => setRascunho((r) => ({ ...r, nicheId: e.target.value }))}
              >
                <option value="">Qualquer nicho, melhor nota primeiro</option>
                {nichos.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            <label
              className="field"
              style={{ flex: '0 1 140px', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}
            >
              <input
                type="checkbox"
                checked={rascunho.active}
                onChange={(e) => setRascunho((r) => ({ ...r, active: e.target.checked }))}
              />
              <span>Ligada</span>
            </label>
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>Dias da semana</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DIAS.map((nome, i) => (
                <button
                  type="button"
                  key={i}
                  className="chip"
                  data-tone={rascunho.weekdays.includes(i) ? 'on' : 'off'}
                  style={{ cursor: 'pointer', background: 'none' }}
                  onClick={() => alternarDia(i)}
                >
                  {nome}
                </button>
              ))}
            </div>
          </div>

          <div className="row">
            <div className="field" style={{ flex: '0 1 130px' }}>
              <label htmlFor="ini">Janela — início</label>
              <input
                id="ini"
                type="time"
                value={rascunho.windowStart}
                onChange={(e) => setRascunho((r) => ({ ...r, windowStart: e.target.value }))}
              />
            </div>
            <div className="field" style={{ flex: '0 1 130px' }}>
              <label htmlFor="fim">Janela — fim</label>
              <input
                id="fim"
                type="time"
                value={rascunho.windowEnd}
                onChange={(e) => setRascunho((r) => ({ ...r, windowEnd: e.target.value }))}
              />
            </div>
            <div className="field" style={{ flex: '0 1 160px' }}>
              <label htmlFor="intervalo">Intervalo (min)</label>
              <input
                id="intervalo"
                inputMode="numeric"
                value={rascunho.intervalMinutes}
                onChange={(e) => setRascunho((r) => ({ ...r, intervalMinutes: Number(e.target.value) || 0 }))}
              />
              <small>tempo mínimo entre uma rodada e a próxima — mínimo 5</small>
            </div>
            <div className="field" style={{ flex: '0 1 140px' }}>
              <label htmlFor="lote">Produtos por rodada</label>
              <input
                id="lote"
                inputMode="numeric"
                value={rascunho.batchSize}
                onChange={(e) => setRascunho((r) => ({ ...r, batchSize: Number(e.target.value) || 1 }))}
              />
            </div>
            <div className="field" style={{ flex: '0 1 160px' }}>
              <label htmlFor="cooldown">Não repetir por (h)</label>
              <input
                id="cooldown"
                inputMode="numeric"
                value={rascunho.cooldownHours}
                onChange={(e) => setRascunho((r) => ({ ...r, cooldownHours: Number(e.target.value) || 1 }))}
              />
              <small>mesmo produto, outra captura</small>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>Grupos de destino</label>
            <small style={{ display: 'block', marginBottom: 6 }}>
              Mais de um grupo entra em rodízio: uma rodada por grupo, na ordem.
            </small>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {grupos.map((g) => (
                <button
                  type="button"
                  key={g.jid}
                  className="chip"
                  data-tone={rascunho.groupJids.includes(g.jid) ? 'on' : 'off'}
                  style={{ cursor: 'pointer', background: 'none' }}
                  onClick={() => alternarGrupo(g.jid)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy} onClick={() => void salvar()}>
              {busy ? 'Salvando...' : 'Salvar'}
            </button>
            <button className="btn btn--ghost" onClick={() => setEditando(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {regras.length === 0 && !editando && (
        <div className="empty">
          <strong>Nenhuma automação criada</strong>
          Clique em "Nova automação" para deixar o app enviar sozinho, nos horários que você definir.
        </div>
      )}

      {regras.map((r) => (
        <div key={r.id} className="panel" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <h2 className="panel__title" style={{ marginBottom: 4 }}>
                {r.name}
                <span className="chip" data-tone={r.active ? 'on' : 'off'} style={{ marginLeft: 8 }}>
                  {r.active ? 'ligada' : 'desligada'}
                </span>
              </h2>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>{resumoJanela(r)}</p>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '2px 0 0' }}>
                {r.nicho ?? 'Qualquer nicho'} · {r.batchSize} por rodada · não repete por {r.cooldownHours}h ·{' '}
                {r.groupJids.length} grupo{r.groupJids.length === 1 ? '' : 's'} · {tempoDesde(r.lastRunAt)}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="btn btn--ghost btn--sm" onClick={() => void alternarAtiva(r)}>
                {r.active ? 'Desligar' : 'Ligar'}
              </button>
              <button className="btn btn--ghost btn--sm" disabled={rodando === r.id} onClick={() => void rodarAgora(r.id)}>
                {rodando === r.id ? 'Rodando...' : 'Rodar agora'}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => abrirEdicao(r)}>
                Editar
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void excluir(r.id)}>
                Excluir
              </button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
