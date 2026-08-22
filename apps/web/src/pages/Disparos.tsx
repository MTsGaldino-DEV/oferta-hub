import { useEffect, useState } from 'react';
import { api, brl, STORE, type Offer } from '../api.js';

interface TemplateLite {
  id: string;
  name: string;
  body: string;
  ctas: string[];
}

interface Grupo {
  jid: string;
  name: string;
  isDefault: boolean;
}

interface DisparoResumo {
  id: string;
  status: 'DRAFT' | 'SENDING' | 'DONE' | 'CANCELLED';
  templateId: string;
  templateName: string | null;
  groupJids: string[];
  startAt: string;
  intervalMinutes: number;
  avoidNightHours: boolean;
  avoidWeekends: boolean;
  skipExpiredOffers: boolean;
  createdAt: string;
  cancelledAt: string | null;
  total: number;
  enviados: number;
  falharam: number;
  pendentes: number;
  estimatedFinish: string | null;
}

interface DisparoItemDetalhe {
  id: string;
  offerId: string;
  offerTitle: string | null;
  groupJid: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  scheduledFor: string;
  sentAt: string | null;
  failReason: string | null;
}

const STATUS_LABEL: Record<DisparoResumo['status'], string> = {
  DRAFT: 'aguardando início',
  SENDING: 'enviando',
  DONE: 'concluído',
  CANCELLED: 'cancelado',
};

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const PASSOS = ['Ofertas', 'Mensagem', 'Destinos'];

export function Disparos() {
  const [tab, setTab] = useState<'novo' | 'andamento'>('novo');

  return (
    <>
      <div className="head">
        <div>
          <h1>Disparos</h1>
          <p>
            Manda um lote de ofertas pra um ou mais grupos, espaçadas no tempo — sem rajada. Cada oferta sai uma
            vez por grupo escolhido, no intervalo que você definir.
          </p>
        </div>
      </div>

      <div className="tabs">
        <button className="tabs__item" data-on={tab === 'novo'} onClick={() => setTab('novo')}>
          Novo disparo
        </button>
        <button className="tabs__item" data-on={tab === 'andamento'} onClick={() => setTab('andamento')}>
          Em andamento
        </button>
      </div>

      {tab === 'novo' ? <NovoDisparo onCriado={() => setTab('andamento')} /> : <EmAndamento />}
    </>
  );
}

function NovoDisparo({ onCriado }: { onCriado: () => void }) {
  const [step, setStep] = useState(1);

  const [offers, setOffers] = useState<Offer[]>([]);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [loadingOffers, setLoadingOffers] = useState(true);

  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState('');

  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [groupJids, setGroupJids] = useState<Set<string>>(new Set());
  const [quando, setQuando] = useState<'agora' | 'agendar'>('agora');
  const [agendadoPara, setAgendadoPara] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [avoidNightHours, setAvoidNightHours] = useState(true);
  const [avoidWeekends, setAvoidWeekends] = useState(false);
  const [skipExpiredOffers, setSkipExpiredOffers] = useState(false);

  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLoadingOffers(true);
    api
      .get<Offer[]>('/api/offers?status=PENDING')
      .then((os) => {
        setOffers(os);
        setSelecionadas(new Set(os.map((o) => o.id)));
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar a fila.'))
      .finally(() => setLoadingOffers(false));

    api.get<TemplateLite[]>('/api/templates').then(setTemplates).catch(() => {});
    api
      .get<{ groups: Grupo[] }>('/api/whatsapp/status')
      .then((r) => setGrupos(r.groups ?? []))
      .catch(() => {});
  }, []);

  // Pré-visualização acompanha o modelo escolhido.
  useEffect(() => {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return setPreview('');
    api
      .post<{ text: string }>('/api/templates/preview', { body: t.body, ctas: t.ctas })
      .then((r) => setPreview(r.text))
      .catch(() => setPreview(''));
  }, [templateId, templates]);

  function alternarOferta(id: string) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function alternarGrupo(jid: string) {
    setGroupJids((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  }

  const totalEnvios = selecionadas.size * groupJids.size;

  function estimativaFim(): Date | null {
    if (!totalEnvios) return null;
    const inicio = quando === 'agora' ? new Date() : agendadoPara ? new Date(agendadoPara) : null;
    if (!inicio || Number.isNaN(inicio.getTime())) return null;
    return new Date(inicio.getTime() + (totalEnvios - 1) * intervalMinutes * 60_000);
  }

  async function criar() {
    setErro(null);
    if (quando === 'agendar' && !agendadoPara) return setErro('Escolha a data/hora do agendamento.');
    if (intervalMinutes < 5) return setErro('O intervalo mínimo é 5 minutos.');

    setCriando(true);
    try {
      await api.post('/api/disparos', {
        offerIds: [...selecionadas],
        templateId,
        groupJids: [...groupJids],
        startNow: quando === 'agora',
        scheduledFor: quando === 'agendar' ? new Date(agendadoPara).toISOString() : undefined,
        intervalMinutes,
        avoidNightHours,
        avoidWeekends,
        skipExpiredOffers,
      });
      onCriado();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não consegui criar o disparo.');
    } finally {
      setCriando(false);
    }
  }

  const fim = estimativaFim();

  return (
    <div className="panel">
      <div className="steps">
        {PASSOS.map((nome, i) => {
          const n = i + 1;
          return (
            <div className="steps__item" key={nome} data-on={step === n} data-done={step > n}>
              <span className="steps__num">{step > n ? '✓' : n}</span>
              {nome}
              {n < PASSOS.length && <span className="steps__sep" />}
            </div>
          );
        })}
      </div>

      {erro && <div className="notice">{erro}</div>}

      {step === 1 && (
        <>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
            {loadingOffers
              ? 'Carregando a fila...'
              : `${selecionadas.size} de ${offers.length} oferta(s) selecionada(s).`}
          </p>
          {!loadingOffers && offers.length === 0 && (
            <div className="empty">
              <strong>Fila vazia</strong>
              Não há ofertas pendentes pra colocar num disparo.
            </div>
          )}
          {offers.length > 0 && (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <button className="btn btn--ghost btn--sm" onClick={() => setSelecionadas(new Set(offers.map((o) => o.id)))}>
                  Marcar todas
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => setSelecionadas(new Set())}>
                  Desmarcar todas
                </button>
              </div>
              <div className="picked" style={{ maxHeight: 420 }}>
                {offers.map((o) => (
                  <label
                    key={o.id}
                    className="picked__item"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={selecionadas.has(o.id)}
                      onChange={() => alternarOferta(o.id)}
                      style={{ width: 'auto', flex: 'none' }}
                    />
                    {o.product.imageUrl && (
                      <img
                        src={o.product.imageUrl}
                        alt=""
                        loading="lazy"
                        style={{ width: 34, height: 34, objectFit: 'contain', background: 'var(--canvas)', borderRadius: 2, flexShrink: 0 }}
                      />
                    )}
                    <span style={{ flex: 1, fontSize: 13 }}>
                      {o.product.title}
                      <br />
                      <small style={{ color: 'var(--muted)' }}>
                        {STORE[o.product.platform]} · {brl(o.price)}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn" disabled={selecionadas.size === 0} onClick={() => setStep(2)}>
              Continuar
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {templates.length === 0 ? (
            <div className="empty">
              <strong>Nenhum modelo criado</strong>
              Crie um modelo em Modelos antes de montar um disparo.
            </div>
          ) : (
            <div className="split">
              <div className="field">
                <label>Modelo de mensagem</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {templates.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      className="chip"
                      data-tone={templateId === t.id ? 'on' : 'off'}
                      style={{ cursor: 'pointer', background: 'none', textAlign: 'left', padding: '8px 10px' }}
                      onClick={() => setTemplateId(t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Pré-visualização (dados de exemplo)</label>
                <div className="notice" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 13 }}>
                  {templateId ? preview || 'Renderizando...' : 'Escolha um modelo pra ver o resultado aqui.'}
                </div>
              </div>
            </div>
          )}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button className="btn btn--ghost" onClick={() => setStep(1)}>
              Voltar
            </button>
            <button className="btn" disabled={!templateId} onClick={() => setStep(3)}>
              Continuar
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          {grupos.length === 0 && (
            <div className="empty">
              <strong>Nenhum grupo sincronizado</strong>
              Conecte o WhatsApp e sincronize os grupos em Conexões antes de disparar.
            </div>
          )}
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Grupos de destino</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {grupos.map((g) => (
                <button
                  type="button"
                  key={g.jid}
                  className="chip"
                  data-tone={groupJids.has(g.jid) ? 'on' : 'off'}
                  style={{ cursor: 'pointer', background: 'none' }}
                  onClick={() => alternarGrupo(g.jid)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>

          <div className="row" style={{ marginBottom: 14 }}>
            <div className="field" style={{ flex: '0 1 200px' }}>
              <label>Início</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="chip"
                  data-tone={quando === 'agora' ? 'on' : 'off'}
                  style={{ cursor: 'pointer', background: 'none' }}
                  onClick={() => setQuando('agora')}
                >
                  Agora
                </button>
                <button
                  type="button"
                  className="chip"
                  data-tone={quando === 'agendar' ? 'on' : 'off'}
                  style={{ cursor: 'pointer', background: 'none' }}
                  onClick={() => setQuando('agendar')}
                >
                  Agendar
                </button>
              </div>
            </div>
            {quando === 'agendar' && (
              <div className="field" style={{ flex: '0 1 220px' }}>
                <label htmlFor="agendadoPara">Data/hora</label>
                <input
                  id="agendadoPara"
                  type="datetime-local"
                  value={agendadoPara}
                  onChange={(e) => setAgendadoPara(e.target.value)}
                />
              </div>
            )}
            <div className="field" style={{ flex: '0 1 160px' }}>
              <label htmlFor="intervalo">Intervalo (min)</label>
              <input
                id="intervalo"
                inputMode="numeric"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Math.max(5, Number(e.target.value) || 5))}
              />
              <small>mínimo 5 — um envio por vez, nunca rajada</small>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 16 }}>
            <label>Guardas de segurança</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={avoidNightHours}
                  onChange={(e) => setAvoidNightHours(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span style={{ fontSize: 13 }}>Não enviar entre 23h e 06h — adia pro dia seguinte às 06h.</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={avoidWeekends}
                  onChange={(e) => setAvoidWeekends(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span style={{ fontSize: 13 }}>Não enviar aos sábados e domingos.</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={skipExpiredOffers}
                  onChange={(e) => setSkipExpiredOffers(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span style={{ fontSize: 13 }}>
                  Não enviar ofertas expiradas <small style={{ color: 'var(--muted)' }}>(guardado pra depois — ainda sem efeito)</small>
                </span>
              </label>
            </div>
          </div>

          <div className="notice" data-tone="warn" style={{ marginBottom: 16 }}>
            <strong>
              {selecionadas.size} oferta{selecionadas.size === 1 ? '' : 's'} × {groupJids.size} grupo
              {groupJids.size === 1 ? '' : 's'} = {totalEnvios} envio{totalEnvios === 1 ? '' : 's'}
            </strong>
            {fim && (
              <>
                <br />
                Previsão de término: {fim.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--ghost" onClick={() => setStep(2)}>
              Voltar
            </button>
            <button className="btn" disabled={criando || groupJids.size === 0 || totalEnvios === 0} onClick={() => void criar()}>
              {criando ? 'Criando...' : 'Criar disparo'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EmAndamento() {
  const [disparos, setDisparos] = useState<DisparoResumo[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [itens, setItens] = useState<DisparoItemDetalhe[]>([]);
  const [cancelando, setCancelando] = useState<string | null>(null);

  async function carregar() {
    setDisparos(await api.get<DisparoResumo[]>('/api/disparos'));
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      carregar(),
      api.get<{ groups: Grupo[] }>('/api/whatsapp/status').then((r) => setGrupos(r.groups ?? [])),
    ]).finally(() => setLoading(false));

    // Progresso ao vivo: reconsulta enquanto essa aba estiver aberta.
    const t = setInterval(() => void carregar().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, []);

  const nomeGrupo = (jid: string) => grupos.find((g) => g.jid === jid)?.name ?? jid;

  async function alternarExpandido(id: string) {
    if (expandido === id) {
      setExpandido(null);
      return;
    }
    setExpandido(id);
    const detalhe = await api.get<{ items: DisparoItemDetalhe[] }>(`/api/disparos/${id}`);
    setItens(detalhe.items);
  }

  async function cancelar(id: string) {
    if (!confirm('Cancelar esse disparo? Os envios que ainda não saíram voltam pra fila; os que já saíram continuam enviados.')) return;
    setCancelando(id);
    try {
      await api.post(`/api/disparos/${id}/cancelar`);
      await carregar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não consegui cancelar.');
    } finally {
      setCancelando(null);
    }
  }

  if (loading) return null;

  if (disparos.length === 0) {
    return (
      <div className="empty">
        <strong>Nenhum disparo criado</strong>
        Vá em "Novo disparo" pra mandar um lote de ofertas pros seus grupos.
      </div>
    );
  }

  return (
    <>
      {disparos.map((d) => {
        const pct = d.total ? Math.round(((d.enviados + d.falharam) / d.total) * 100) : 0;
        const cancelavel = d.status === 'DRAFT' || d.status === 'SENDING';
        return (
          <div key={d.id} className="panel" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => void alternarExpandido(d.id)}>
                <h2 className="panel__title" style={{ marginBottom: 4 }}>
                  {d.templateName ?? 'Modelo apagado'}
                  <span className="chip" data-tone={d.status === 'DONE' ? 'on' : d.status === 'CANCELLED' ? 'off' : undefined} style={{ marginLeft: 8 }}>
                    {STATUS_LABEL[d.status]}
                  </span>
                </h2>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                  {d.groupJids.map(nomeGrupo).join(', ')} · a cada {d.intervalMinutes} min
                </p>
              </div>
              {cancelavel && (
                <button className="btn btn--ghost btn--sm" disabled={cancelando === d.id} onClick={() => void cancelar(d.id)}>
                  {cancelando === d.id ? 'Cancelando...' : 'Cancelar'}
                </button>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="progress">
                <div className="progress__bar" style={{ width: `${pct}%` }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0', fontFamily: 'var(--mono)' }}>
                {d.enviados + d.falharam}/{d.total} envios · {pct}%
                {d.falharam > 0 && ` · ${d.falharam} falha(s)`}
                {d.estimatedFinish && d.status !== 'DONE' && d.status !== 'CANCELLED' && (
                  <> · previsão de término {fmt(d.estimatedFinish)}</>
                )}
              </p>
            </div>

            {expandido === d.id && (
              <table className="table" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>Oferta</th>
                    <th>Grupo</th>
                    <th>Status</th>
                    <th className="num">Horário</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.id}>
                      <td>{i.offerTitle ?? '—'}</td>
                      <td>{nomeGrupo(i.groupJid)}</td>
                      <td>
                        {i.status === 'SENT' ? 'enviado' : i.status === 'FAILED' ? `falhou${i.failReason ? `: ${i.failReason}` : ''}` : 'pendente'}
                      </td>
                      <td className="num">{fmt(i.sentAt ?? i.scheduledFor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </>
  );
}
