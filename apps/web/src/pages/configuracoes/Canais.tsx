import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useProtocolToast } from '../../components/ProtocolToast.js';

// Mesma forma que Conexoes.tsx usava.
interface WaStatus {
  status: 'disconnected' | 'connecting' | 'qr' | 'connected';
  qr: string | null;
  me: string | null;
  quota: { used: number; cap: number };
  groups: { jid: string; name: string; isDefault: boolean }[];
}

export function Canais() {
  const [wa, setWa] = useState<WaStatus | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const protocolo = useProtocolToast();
  // Guarda o status anterior pra disparar so na transicao, nao a cada
  // resposta do polling (que chega de 4 em 4 segundos).
  const statusAnterior = useRef<WaStatus['status'] | null>(null);
  // Guarda o que foi ANUNCIADO, nao o status anterior: um blip
  // connected -> connecting -> connected nao pode anunciar nada, e uma
  // queda que passe por 'connecting' antes de morrer ainda precisa
  // anunciar quando chegar em 'disconnected'.
  const anunciadoConectado = useRef(false);

  const loadWa = () => api.get<WaStatus>('/api/whatsapp/status').then(setWa).catch(() => {});

  useEffect(() => {
    void loadWa();
    // Enquanto o QR está na tela, ele expira em segundos e precisa ser renovado.
    const timer = setInterval(() => void loadWa(), 4000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!wa) return;
    const antes = statusAnterior.current;
    statusAnterior.current = wa.status;

    // Primeira leitura da pagina nao e transicao: so registra o estado
    // inicial, senao abrir a tela com o WhatsApp ja conectado dispararia
    // o feedback do nada.
    if (antes === null) {
      anunciadoConectado.current = wa.status === 'connected';
      return;
    }
    if (antes === wa.status) return;

    if (wa.status === 'connected') {
      // Ja anunciado: isso e a volta de um blip, nao uma conexao nova.
      if (anunciadoConectado.current) return;
      anunciadoConectado.current = true;
      protocolo({
        title: 'WHATSAPP',
        subtitle: 'Conectado',
        accent: 'var(--gain)',
        icon: 'whatsapp',
        sound: 'whatsapp-on',
      });
    } else if (anunciadoConectado.current && wa.status !== 'connecting') {
      // 'connecting' e blip -- o Baileys reconecta sozinho em segundos.
      // So 'disconnected' e 'qr' sao queda de verdade.
      anunciadoConectado.current = false;
      protocolo({
        title: 'WHATSAPP',
        subtitle: 'Desconectado',
        accent: 'var(--drop)',
        icon: 'whatsapp',
        sound: 'whatsapp-off',
      });
    }
  }, [wa?.status]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Canais</h1>
          <p>Conecte os canais onde suas ofertas serão enviadas.</p>
        </div>
      </div>

      {aviso && <div className="notice">{aviso}</div>}

      <div className="notice">
        O envio usa uma biblioteca não oficial do WhatsApp. Pareie um <strong>chip secundário</strong>: o número
        pode ser banido, e o banimento costuma ser definitivo.
      </div>

      <div className="split">
        <div className="panel">
          <h2 className="panel__title">WhatsApp</h2>

          {wa?.status === 'connected' ? (
            <>
              <p style={{ marginTop: 0 }}>
                Conectado como <strong>{wa.me?.split(':')[0]}</strong>. Enviadas hoje: {wa.quota.used} de{' '}
                {wa.quota.cap}.
              </p>

              <div className="field" style={{ maxWidth: 380 }}>
                <label htmlFor="group">Grupo que recebe as ofertas</label>
                <select
                  id="group"
                  value={wa.groups.find((g) => g.isDefault)?.jid ?? ''}
                  onChange={async (e) => {
                    await api.post('/api/whatsapp/default-group', { jid: e.target.value });
                    void loadWa();
                  }}
                >
                  <option value="">Escolha um grupo</option>
                  {wa.groups.map((g) => (
                    <option key={g.jid} value={g.jid}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn btn--ghost" onClick={async () => { await api.post('/api/whatsapp/sync-groups'); void loadWa(); }}>
                  Atualizar grupos
                </button>
                <button className="btn btn--ghost" onClick={async () => { await api.post('/api/whatsapp/logout'); void loadWa(); }}>
                  Desconectar
                </button>
              </div>
            </>
          ) : wa?.qr ? (
            <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
              <img src={wa.qr} alt="QR code para parear o WhatsApp" width={200} height={200} style={{ borderRadius: 'var(--r)' }} />
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.8 }}>
                <li>Abra o WhatsApp no chip secundário</li>
                <li>Aparelhos conectados → Conectar aparelho</li>
                <li>Aponte para este código</li>
              </ol>
            </div>
          ) : (
            <>
              <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 14 }}>
                Desconectado. Clique em parear e o QR aparece aqui.
              </p>
              <div className="row">
                <button className="btn" onClick={async () => { await api.post('/api/whatsapp/connect'); void loadWa(); }}>
                  {wa?.status === 'connecting' ? 'Conectando...' : 'Parear número'}
                </button>
                {/* Saida de emergencia: sessao morta em disco faz o Baileys tentar
                    logar com credencial invalida e voltar pra "desconectado" sem
                    nunca gerar QR. Aqui o operador apaga e recomeca. */}
                <button
                  className="btn btn--ghost"
                  onClick={async () => {
                    if (!confirm('Isso apaga a sessão salva. Você vai precisar ler o QR de novo. Continuar?')) return;
                    await api.post('/api/whatsapp/logout');
                    await api.post('/api/whatsapp/connect');
                    void loadWa();
                  }}
                >
                  Apagar sessão e parear do zero
                </button>
              </div>
            </>
          )}
        </div>

        <div className="panel" aria-disabled="true" style={{ opacity: 0.55 }}>
          <h2 className="panel__title">
            Telegram <span className="chip" style={{ marginLeft: 8 }}>Em breve</span>
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
            Envio por bot do Telegram ainda não está disponível.
          </p>
        </div>
      </div>

      <button
        type="button"
        className="btn btn--ghost"
        style={{ marginTop: 12, width: '100%' }}
        onClick={() =>
          setAviso('Por enquanto o sistema conecta um número de WhatsApp por vez. Vários números vêm depois.')
        }
      >
        + Adicionar outro número ou bot
      </button>
    </>
  );
}
