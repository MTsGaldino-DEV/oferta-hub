import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import { Layout } from './components/Layout.js';
import { Logo } from './components/Logo.js';
import { VisaoGeral } from './pages/VisaoGeral.js';
import { Fila } from './pages/Fila.js';
import { Desempenho } from './pages/Desempenho.js';
import { MeusGrupos } from './pages/MeusGrupos.js';
import { Garimpar } from './pages/Garimpar.js';
import { Nichos } from './pages/Nichos.js';
import { Produtos } from './pages/Produtos.js';
import { Agenda } from './pages/Agenda.js';
import { Automacoes } from './pages/Automacoes.js';
import { Disparos } from './pages/Disparos.js';
import { Configuracoes } from './pages/Configuracoes.js';

function Login({ onIn }: { onIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/login', { password });
      onIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não deu para entrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="login__brand">
          <span className="login__mark">
            <Logo size={30} />
          </span>
          <h1>Hub Ofertas</h1>
        </div>
        <div className="field">
          <label htmlFor="pw">Senha do painel</label>
          <input
            id="pw"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="notice">{error}</div>}
        <button className="btn" disabled={busy || !password}>
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .get<{ authenticated: boolean }>('/api/me')
      .then((r) => setAuth(r.authenticated))
      .catch(() => setAuth(false));
  }, []);

  if (auth === null) return null;
  if (!auth) return <Login onIn={() => setAuth(true)} />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<VisaoGeral />} />
        <Route path="/fila" element={<Fila />} />
        <Route path="/desempenho" element={<Desempenho />} />
        <Route path="/grupos" element={<MeusGrupos />} />
        <Route path="/produtos" element={<Produtos />} />
        <Route path="/nichos" element={<Nichos />} />
        <Route path="/garimpar" element={<Garimpar />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/automacoes" element={<Automacoes />} />
        <Route path="/disparos" element={<Disparos />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
