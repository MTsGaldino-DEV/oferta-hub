import { useEffect, useState } from 'react';
import { api } from '../../api.js';

/**
 * A extensao do navegador e o unico caminho pro Mercado Livre: eles nao tem
 * API de afiliados e bloqueiam leitura de fora. Ela autentica por este token,
 * nao pela sessao do painel -- fala de outra origem e nao carrega o cookie.
 */
export function ExtensaoCard() {
  const [token, setToken] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    api.get<{ token: string }>('/api/extensao/token').then((r) => setToken(r.token)).catch(() => {});
  }, []);

  async function copiar() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <strong style={{ fontSize: 16 }}>Extensão do navegador</strong>
        <span className="chip" data-tone={token ? 'on' : undefined}>Mercado Livre</span>
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn btn--ghost btn--sm" onClick={() => setAberto((v) => !v)}>
            {aberto ? 'Fechar' : 'Como instalar'}
          </button>
        </span>
      </div>

      <p style={{ marginTop: 0, fontSize: 14, color: 'var(--muted)' }}>
        O Mercado Livre não tem API de afiliados e bloqueia leitura de fora. A extensão captura o produto
        pela sua sessão e gera o link <strong>meli.la</strong> de verdade — sem ele a comissão pode não
        ser atribuída a você.
      </p>

      <div className="field" style={{ maxWidth: 460 }}>
        <label htmlFor="exttoken">Token da extensão</label>
        <div className="row">
          <input id="exttoken" readOnly value={token ?? 'carregando...'} style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
          <button className="btn btn--ghost" disabled={!token} onClick={() => void copiar()}>
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <small>Cole no popup da extensão, junto do endereço deste app.</small>
      </div>

      {aberto && (
        <ol style={{ fontSize: 14, lineHeight: 1.9, marginTop: 16, paddingLeft: 20 }}>
          <li>Abra <code>chrome://extensions</code> e ligue o <strong>Modo do desenvolvedor</strong></li>
          <li>Clique em <strong>Carregar sem compactação</strong> e escolha a pasta <code>extensao/</code> do projeto</li>
          <li>Abra o popup da extensão, cole o token acima e o endereço <code>http://localhost:3333</code></li>
          <li>Entre no <strong>Mercado Livre Afiliados</strong> neste mesmo navegador — é a sessão dele que gera o link</li>
          <li>Abra um produto ou uma busca do ML: o botão <strong>Mandar pro Hub</strong> aparece no canto</li>
        </ol>
      )}
    </div>
  );
}
