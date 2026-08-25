import { useEffect, useState } from 'react';
import { api } from '../../api.js';

interface Bloqueado {
  id: string;
  phone: string;
  note: string | null;
  createdAt: string;
}

interface GrupoProtecao {
  jid: string;
  name: string;
  botIsAdmin: boolean;
}

interface Avaliabilidade {
  comNumeroVisivel: number;
  comLid: number;
  medido: boolean;
}

interface ProtecaoResposta {
  escudo: boolean;
  ddi: boolean;
  bloqueados: Bloqueado[];
  grupos: GrupoProtecao[];
  avaliabilidade: Avaliabilidade;
}

interface Achado {
  groupJid: string;
  groupName: string;
  jid: string;
  numero: string | null;
  motivo: 'BLOCKLIST' | 'FOREIGN_DDI';
}

interface EscanearResposta {
  achados: Achado[];
  naoAvaliaveis: number;
  gruposSemAdmin: { jid: string; name: string }[];
}

interface RemoverResposta {
  removidos: number;
  falhas: number;
  pulados: number;
}

// So formata o padrao BR (o unico que o produto trata) -- qualquer outro
// DDI aparece cru com "+" na frente, o que ainda e legivel.
function formatarNumero(digitos: string): string {
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    const ddd = digitos.slice(2, 4);
    const resto = digitos.slice(4);
    const corte = resto.length === 9 ? 5 : 4;
    return `+55 (${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
  }
  return digitos ? `+${digitos}` : '—';
}

export function Protecao() {
  const [dados, setDados] = useState<ProtecaoResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [numero, setNumero] = useState('');
  const [erroBloqueio, setErroBloqueio] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  const [critBlocklist, setCritBlocklist] = useState(true);
  const [critDdi, setCritDdi] = useState(true);
  const [escaneando, setEscaneando] = useState(false);
  const [erroEscaneio, setErroEscaneio] = useState<string | null>(null);
  const [resultado, setResultado] = useState<EscanearResposta | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [removendo, setRemovendo] = useState(false);
  const [placar, setPlacar] = useState<RemoverResposta | null>(null);

  async function carregar() {
    setDados(await api.get<ProtecaoResposta>('/api/protecao'));
  }

  useEffect(() => {
    void carregar().catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar a proteção.'));
  }, []);

  async function alternar(campo: 'escudo' | 'ddi') {
    if (!dados) return;
    const res = await api.put<{ escudo: boolean; ddi: boolean }>('/api/protecao', { [campo]: !dados[campo] });
    setDados((d) => (d ? { ...d, ...res } : d));
  }

  async function adicionarNumero(e: React.FormEvent) {
    e.preventDefault();
    if (!numero.trim()) return;
    setErroBloqueio(null);
    setAdicionando(true);
    try {
      await api.post('/api/protecao/bloqueados', { numero });
      setNumero('');
      await carregar();
    } catch (err) {
      setErroBloqueio(err instanceof Error ? err.message : 'Não consegui adicionar o número.');
    } finally {
      setAdicionando(false);
    }
  }

  async function removerBloqueado(id: string) {
    await api.del(`/api/protecao/bloqueados/${id}`);
    await carregar();
  }

  async function escanear() {
    setResultado(null);
    setPlacar(null);
    setSelecionados(new Set());

    if (!critBlocklist && !critDdi) {
      setErroEscaneio('Marque pelo menos um critério (Na blocklist ou DDI estrangeiro) para escanear.');
      return;
    }
    setErroEscaneio(null);
    setEscaneando(true);
    try {
      const res = await api.post<EscanearResposta>('/api/protecao/escanear', {
        blocklist: critBlocklist,
        ddi: critDdi,
      });
      setResultado(res);
    } catch (err) {
      setErroEscaneio(err instanceof Error ? err.message : 'Não consegui escanear os grupos.');
    } finally {
      setEscaneando(false);
    }
  }

  function alternarSelecao(chave: string) {
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  }

  async function removerSelecionados() {
    if (!resultado) return;
    const alvos = resultado.achados
      .filter((a) => selecionados.has(`${a.groupJid}|${a.jid}`))
      .map((a) => ({ groupJid: a.groupJid, jid: a.jid }));
    if (alvos.length === 0) return;
    if (!confirm(`Remover ${alvos.length} pessoa${alvos.length === 1 ? '' : 's'} dos grupos? Essa ação é irreversível.`)) {
      return;
    }
    setRemovendo(true);
    try {
      const res = await api.post<RemoverResposta>('/api/protecao/remover', { alvos });
      setPlacar(res);
      setResultado(null);
      setSelecionados(new Set());
    } catch (err) {
      setErroEscaneio(err instanceof Error ? err.message : 'Não consegui remover.');
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Proteção</h1>
          <p>
            Mantém os grupos limpos e reduz o risco de banimento — vale para os grupos onde o número conectado é
            admin.
          </p>
        </div>
      </div>

      {erro && <div className="notice">{erro}</div>}

      {dados && (
        <>
          <div className="split">
            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 className="panel__title" style={{ marginBottom: 0 }}>
                  Escudo{' '}
                  <span className="chip" data-tone={dados.escudo ? 'on' : 'off'} style={{ marginLeft: 6 }}>
                    {dados.escudo ? 'ligado' : 'desligado'}
                  </span>
                </h2>
                <button className="btn btn--ghost btn--sm" onClick={() => void alternar('escudo')}>
                  {dados.escudo ? 'Desligar' : 'Ligar'}
                </button>
              </div>
              <p style={{ marginTop: 0, fontSize: 13, color: 'var(--muted)' }}>
                Remove na entrada quem estiver na blocklist abaixo.
              </p>

              <form onSubmit={(e) => void adicionarNumero(e)} className="row" style={{ marginTop: 14 }}>
                <div className="field" style={{ flex: '1 1 220px' }}>
                  <label htmlFor="numero">Número com DDI</label>
                  <input
                    id="numero"
                    placeholder="ex.: 55 11 99999-9999"
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                  />
                </div>
                <button className="btn btn--sm" disabled={adicionando} type="submit">
                  {adicionando ? 'Adicionando...' : 'Adicionar'}
                </button>
              </form>
              {erroBloqueio && <div className="notice" style={{ marginTop: 10 }}>{erroBloqueio}</div>}

              {dados.bloqueados.length === 0 ? (
                <div className="empty" style={{ marginTop: 14 }}>
                  <strong>Nenhum número na blocklist ainda.</strong>
                  Adicione um número acima — quem entrar com ele é removido na hora.
                </div>
              ) : (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dados.bloqueados.map((b) => (
                    <div key={b.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{formatarNumero(b.phone)}</span>
                      <button className="btn btn--ghost btn--sm" onClick={() => void removerBloqueado(b.id)}>
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 className="panel__title" style={{ marginBottom: 0 }}>
                  Filtro de DDI{' '}
                  <span className="chip" data-tone={dados.ddi ? 'on' : 'off'} style={{ marginLeft: 6 }}>
                    {dados.ddi ? 'ligado' : 'desligado'}
                  </span>
                </h2>
                <button className="btn btn--ghost btn--sm" onClick={() => void alternar('ddi')}>
                  {dados.ddi ? 'Desligar' : 'Ligar'}
                </button>
              </div>
              <p style={{ marginTop: 0, fontSize: 13, color: 'var(--muted)' }}>
                Remove na entrada quem entrar com um DDI diferente de +55.
              </p>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                Só age quando o WhatsApp mostra o número de quem entrou — participante com identificador oculto
                (LID) não é avaliado.
                {dados.avaliabilidade.medido
                  ? dados.avaliabilidade.comLid > 0 &&
                    ` Hoje isso deixa ${dados.avaliabilidade.comLid} participante(s) fora da avaliação.`
                  : ' Conecte o WhatsApp em Configurações › Canais para medir quantos ficam de fora.'}
              </p>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h2 className="panel__title">Guilhotina</h2>
            <div className="notice">
              Remove pessoas dos grupos agora, de uma vez — ação irreversível e visível para todo o grupo.
            </div>

            <div className="row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={critBlocklist} onChange={(e) => setCritBlocklist(e.target.checked)} />
                Na blocklist
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={critDdi} onChange={(e) => setCritDdi(e.target.checked)} />
                DDI estrangeiro
              </label>
              <button className="btn" disabled={escaneando} onClick={() => void escanear()}>
                {escaneando ? 'Escaneando...' : 'Escanear grupos'}
              </button>
            </div>

            {erroEscaneio && <div className="notice" style={{ marginTop: 10 }}>{erroEscaneio}</div>}

            {resultado && (
              <div style={{ marginTop: 14 }}>
                {resultado.gruposSemAdmin.length > 0 && (
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                    Não protegido em {resultado.gruposSemAdmin.length} grupo
                    {resultado.gruposSemAdmin.length === 1 ? '' : 's'} onde o número conectado não é admin:{' '}
                    {resultado.gruposSemAdmin.map((g) => g.name).join(', ')}. O WhatsApp recusa remoção nesses
                    grupos.
                  </p>
                )}
                {resultado.naoAvaliaveis > 0 && (
                  <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                    {resultado.naoAvaliaveis} participante{resultado.naoAvaliaveis === 1 ? '' : 's'} não avaliado
                    {resultado.naoAvaliaveis === 1 ? '' : 's'}: o WhatsApp não mostrou o número, então não dá pra
                    comparar com a blocklist nem checar o DDI.
                  </p>
                )}

                {resultado.achados.length === 0 ? (
                  <div className="empty" style={{ marginTop: 10 }}>
                    <strong>Ninguém se encaixa nos critérios marcados.</strong>
                    Escaneie de novo depois de mudar a blocklist ou os critérios acima.
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
                      {resultado.achados.map((a) => {
                        const chave = `${a.groupJid}|${a.jid}`;
                        return (
                          <label
                            key={chave}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '6px 2px',
                              borderBottom: '1px solid var(--line)',
                              fontSize: 13,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selecionados.has(chave)}
                              onChange={() => alternarSelecao(chave)}
                            />
                            <span style={{ fontFamily: 'var(--mono)' }}>{formatarNumero(a.numero ?? '')}</span>
                            <span style={{ color: 'var(--muted)' }}>{a.groupName}</span>
                            <span className="chip">{a.motivo === 'BLOCKLIST' ? 'blocklist' : 'DDI estrangeiro'}</span>
                          </label>
                        );
                      })}
                    </div>
                    <button
                      className="btn"
                      style={{ marginTop: 14, background: 'var(--drop)', borderColor: 'var(--drop)' }}
                      disabled={selecionados.size === 0 || removendo}
                      onClick={() => void removerSelecionados()}
                    >
                      {removendo ? 'Removendo...' : `Remover ${selecionados.size}`}
                    </button>
                  </>
                )}
              </div>
            )}

            {placar && (
              <div className="notice" data-tone="warn" style={{ marginTop: 14 }}>
                Removidos: {placar.removidos} · Falhas: {placar.falhas} · Pulados: {placar.pulados}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
