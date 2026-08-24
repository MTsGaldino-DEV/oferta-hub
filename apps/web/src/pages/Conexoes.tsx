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
          {info.connected ? (info.lastError ? 'Com erro' : 'Conectado') : 'Pendente'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {info.connected && (
            <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void test()}>
              Validar conexão
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
              Salvar
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

  const loadPlatforms = () => api.get<PlatformInfo[]>('/api/platforms').then(setPlatforms).catch(() => {});

  useEffect(() => {
    void loadPlatforms();
  }, []);

  return (
    <>
      <div className="head">
        <div>
          <h1>Plataformas</h1>
          <p>Suas contas de afiliado, pra gerar links com a sua tag.</p>
        </div>
      </div>

      {[...platforms]
        .sort((a, b) => Number(b.connected) - Number(a.connected))
        .map((p) => (
          <PlatformCard key={p.platform} info={p} onSaved={loadPlatforms} />
        ))}
    </>
  );
}
