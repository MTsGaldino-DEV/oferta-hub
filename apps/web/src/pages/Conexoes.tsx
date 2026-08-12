import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface PlatformInfo {
  platform: string;
  label: string;
  connected: boolean;
  lastCheck: string | null;
  lastError: string | null;
  preview: Record<string, string>;
  fields: { name: string; label: string; secret: boolean; help?: string }[];
}

interface WaStatus {
  status: 'disconnected' | 'connecting' | 'qr' | 'connected';
  qr: string | null;
  me: string | null;
  quota: { used: number; cap: number };
  groups: { jid: string; name: string; isDefault: boolean }[];
}

function PlatformCard({ info, onSaved }: { info: PlatformInfo; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(!info.connected);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.put(`/api/platforms/${info.platform}`, values);
      setValues({});
      await test();
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Não deu para salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await api.post(`/api/platforms/${info.platform}/test`);
      setMsg('Credencial funcionando.');
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Falhou o teste.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <strong style={{ fontSize: 16 }}>{info.label}</strong>
        <span className="chip" data-tone={info.connected ? (info.lastError ? 'off' : 'on') : undefined}>
          {info.connected ? (info.lastError ? 'com erro' : 'conectada') : 'não configurada'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {info.connected && (
            <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void test()}>
              Testar
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Fechar' : 'Editar'}
          </button>
        </span>
      </div>

      {info.lastError && !msg && <div className="notice">{info.lastError}</div>}
      {msg && <div className="notice" data-tone={msg.includes('funcionando') ? 'warn' : undefined}>{msg}</div>}

      {open && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            {info.fields.map((f) => (
              <div className="field" key={f.name}>
                <label htmlFor={`${info.platform}-${f.name}`}>{f.label}</label>
                <input
                  id={`${info.platform}-${f.name}`}
                  type={f.secret ? 'password' : 'text'}
                  value={values[f.name] ?? ''}
                  placeholder={info.preview[f.name] || (f.secret ? 'não preenchido' : '')}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
                {f.help && <small>{f.help}</small>}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" disabled={busy || Object.keys(values).length === 0} onClick={() => void save()}>
              Salvar e testar
            </button>
            <small style={{ color: 'var(--muted)' }}>
              Campo em branco mantém o valor já salvo. Tudo é gravado criptografado.
            </small>
          </div>
        </>
      )}
    </div>
  );
}

export function Conexoes() {
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [wa, setWa] = useState<WaStatus | null>(null);

  const loadPlatforms = () => api.get<PlatformInfo[]>('/api/platforms').then(setPlatforms).catch(() => {});
  const loadWa = () => api.get<WaStatus>('/api/whatsapp/status').then(setWa).catch(() => {});

  useEffect(() => {
    void loadPlatforms();
    void loadWa();
    // Enquanto o QR está na tela, ele expira em segundos e precisa ser renovado.
    const timer = setInterval(() => void loadWa(), 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <div className="head">
        <div>
          <h1>Conexões</h1>
          <p>Credenciais ficam criptografadas no banco com a MASTER_KEY. Perdeu a chave, perdeu as credenciais.</p>
        </div>
      </div>

      <div className="notice">
        O envio usa uma biblioteca não oficial do WhatsApp. Pareie um <strong>chip secundário</strong>: o número
        pode ser banido, e o banimento costuma ser definitivo.
      </div>

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
            <img src={wa.qr} alt="QR code para parear o WhatsApp" width={200} height={200} style={{ borderRadius: 3 }} />
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.8 }}>
              <li>Abra o WhatsApp no chip secundário</li>
              <li>Aparelhos conectados → Conectar aparelho</li>
              <li>Aponte para este código</li>
            </ol>
          </div>
        ) : (
          <div className="row">
            <button className="btn" onClick={async () => { await api.post('/api/whatsapp/connect'); void loadWa(); }}>
              {wa?.status === 'connecting' ? 'Conectando...' : 'Parear número'}
            </button>
          </div>
        )}
      </div>

      {platforms.map((p) => (
        <PlatformCard key={p.platform} info={p} onSaved={loadPlatforms} />
      ))}
    </>
  );
}
