import { useState } from 'react';
import { api } from '../../api.js';
import { AparenciaCard } from './AparenciaCard.js';
import { ExtensaoCard } from './ExtensaoCard.js';

export function Conta() {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function trocar() {
    setErro(null);
    setOk(false);

    if (nova.length < 8) return setErro('A nova senha precisa de pelo menos 8 caracteres.');
    if (nova !== repetida) return setErro('As duas senhas novas não batem.');

    setBusy(true);
    try {
      await api.post('/api/senha', { atual, nova });
      setOk(true);
      setAtual('');
      setNova('');
      setRepetida('');
      // A troca derruba a sessao no servidor. Recarregar leva pro login em vez
      // de deixar a tela viva dando 401 no proximo clique.
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não consegui trocar a senha.');
    } finally {
      setBusy(false);
    }
  }

  async function sair() {
    // reload acontece mesmo se a chamada falhar -- logout local e o que importa
    try {
      await api.post('/api/logout');
    } finally {
      window.location.reload();
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Conta</h1>
          <p>Seus dados de acesso e ajustes pessoais do painel.</p>
        </div>
        <button className="btn btn--ghost" onClick={() => void sair()}>
          Sair
        </button>
      </div>

      <div className="panel">
        <h2 className="panel__title">Dados</h2>
        <div className="row">
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label>Nome</label>
            <input value="—" disabled readOnly />
          </div>
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label>E-mail</label>
            <input value="—" disabled readOnly />
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label>Plano</label>
            <input value="Instalação própria" disabled readOnly />
          </div>
        </div>
        <small style={{ color: 'var(--muted)' }}>
          Nome, e-mail e plano entram quando o painel virar multiusuário. Hoje o acesso é por senha única.
        </small>
      </div>

      <div className="panel">
        <h2 className="panel__title">Senha do painel</h2>

        {erro && <div className="notice">{erro}</div>}
        {ok && <div className="notice">Senha trocada. Entre de novo com a nova senha.</div>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void trocar();
          }}
        >
          <div className="row">
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="senha-atual">Senha atual</label>
              <input
                id="senha-atual"
                type="password"
                autoComplete="current-password"
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="senha-nova">Nova senha</label>
              <input
                id="senha-nova"
                type="password"
                autoComplete="new-password"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="senha-repetida">Repita a nova senha</label>
              <input
                id="senha-repetida"
                type="password"
                autoComplete="new-password"
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
              />
            </div>
          </div>

          <button className="btn" disabled={busy || !atual || !nova}>
            {busy ? 'Trocando...' : 'Trocar senha'}
          </button>
        </form>
      </div>

      <AparenciaCard />
      <ExtensaoCard />
    </>
  );
}
