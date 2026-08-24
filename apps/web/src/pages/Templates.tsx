import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

interface Template {
  id: string;
  name: string;
  body: string;
  ctas: string[];
  showImage: boolean;
  isDefault: boolean;
}

const TOKENS = ['{TITULO}', '{PRECO}', '{PRECO_ANTIGO}', '{LINK}', '{CUPOM}'];

const rascunhoVazio = {
  name: '',
  body: '',
  ctas: [] as string[],
  showImage: true,
  isDefault: false,
};

export function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editando, setEditando] = useState<string | 'novo' | null>(null);
  const [rascunho, setRascunho] = useState(rascunhoVazio);
  const [novoCta, setNovoCta] = useState('');
  const [preview, setPreview] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function carregar() {
    setTemplates(await api.get<Template[]>('/api/templates'));
  }

  useEffect(() => {
    void carregar().catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar.'));
  }, []);

  // Pré-visualização acompanha o rascunho, com um pequeno atraso pra não bater na API a cada tecla.
  useEffect(() => {
    if (!editando) return;
    const t = setTimeout(() => {
      api
        .post<{ text: string }>('/api/templates/preview', { body: rascunho.body, ctas: rascunho.ctas })
        .then((r) => setPreview(r.text))
        .catch(() => setPreview(''));
    }, 300);
    return () => clearTimeout(t);
  }, [editando, rascunho.body, rascunho.ctas]);

  function abrirNovo() {
    setRascunho(rascunhoVazio);
    setEditando('novo');
    setErro(null);
  }

  function abrirEdicao(t: Template) {
    setRascunho({ name: t.name, body: t.body, ctas: [...t.ctas], showImage: t.showImage, isDefault: t.isDefault });
    setEditando(t.id);
    setErro(null);
  }

  function inserirToken(token: string) {
    const el = textareaRef.current;
    if (!el) {
      setRascunho((r) => ({ ...r, body: r.body + token }));
      return;
    }
    const inicio = el.selectionStart ?? el.value.length;
    const fim = el.selectionEnd ?? el.value.length;
    const novoBody = rascunho.body.slice(0, inicio) + token + rascunho.body.slice(fim);
    setRascunho((r) => ({ ...r, body: novoBody }));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = inicio + token.length;
    });
  }

  function adicionarCta() {
    const texto = novoCta.trim();
    if (!texto) return;
    setRascunho((r) => ({ ...r, ctas: [...r.ctas, texto] }));
    setNovoCta('');
  }

  function removerCta(i: number) {
    setRascunho((r) => ({ ...r, ctas: r.ctas.filter((_, idx) => idx !== i) }));
  }

  async function salvar() {
    if (rascunho.name.trim().length < 2) return setErro('O nome precisa de pelo menos 2 letras.');
    if (!rascunho.body.trim()) return setErro('O texto não pode ficar vazio.');

    setBusy(true);
    setErro(null);
    try {
      const corpo = {
        name: rascunho.name.trim(),
        body: rascunho.body,
        ctas: rascunho.ctas,
        showImage: rascunho.showImage,
        isDefault: rascunho.isDefault,
      };
      if (editando === 'novo') await api.post('/api/templates', corpo);
      else await api.put(`/api/templates/${editando}`, corpo);
      setEditando(null);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não consegui salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function excluir(id: string) {
    if (!confirm('Apagar esse modelo?')) return;
    await api.del(`/api/templates/${id}`);
    await carregar();
  }

  async function marcarPadrao(t: Template) {
    await api.put(`/api/templates/${t.id}`, {
      name: t.name,
      body: t.body,
      ctas: t.ctas,
      showImage: t.showImage,
      isDefault: true,
    });
    await carregar();
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Modelos de mensagem</h1>
          <p>
            Textos reutilizáveis pros disparos em grupo: escreva uma vez com os tokens do produto no lugar certo
            e deixe um pool de chamadas finais pra fechar a mensagem — uma sorteada a cada envio, pra não repetir
            sempre a mesma linha.
          </p>
        </div>
        <button className="btn" onClick={abrirNovo}>
          Novo modelo
        </button>
      </div>

      {erro && <div className="notice">{erro}</div>}

      {editando && (
        <div className="panel">
          <h2 className="panel__title">{editando === 'novo' ? 'Novo modelo' : 'Editando modelo'}</h2>

          <div className="row" style={{ marginBottom: 14 }}>
            <div className="field" style={{ flex: '2 1 260px' }}>
              <label htmlFor="nome">Nome</label>
              <input
                id="nome"
                value={rascunho.name}
                placeholder="Direto e agressivo"
                onChange={(e) => setRascunho((r) => ({ ...r, name: e.target.value }))}
              />
            </div>
            <label
              className="field"
              style={{ flex: '0 1 140px', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}
            >
              <input
                type="checkbox"
                checked={rascunho.showImage}
                onChange={(e) => setRascunho((r) => ({ ...r, showImage: e.target.checked }))}
              />
              <span>Anexar foto</span>
            </label>
            <label
              className="field"
              style={{ flex: '0 1 140px', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}
            >
              <input
                type="checkbox"
                checked={rascunho.isDefault}
                onChange={(e) => setRascunho((r) => ({ ...r, isDefault: e.target.checked }))}
              />
              <span>Padrão</span>
            </label>
          </div>

          <div className="field" style={{ marginBottom: 8 }}>
            <label>Inserir no texto</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TOKENS.map((tok) => (
                <button
                  type="button"
                  key={tok}
                  className="chip"
                  style={{ cursor: 'pointer', background: 'none' }}
                  onClick={() => inserirToken(tok)}
                >
                  {tok}
                </button>
              ))}
            </div>
          </div>

          <div className="split">
            <div className="field">
              <label htmlFor="body">Texto</label>
              <textarea
                id="body"
                ref={textareaRef}
                rows={12}
                value={rascunho.body}
                onChange={(e) => setRascunho((r) => ({ ...r, body: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Pré-visualização (dados de exemplo)</label>
              <div className="notice" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 13 }}>
                {preview || 'Escreva o texto pra ver o resultado aqui.'}
              </div>
            </div>
          </div>

          <div className="field" style={{ marginTop: 14, marginBottom: 14 }}>
            <label>Chamadas finais (CTA)</label>
            <small style={{ display: 'block', marginBottom: 6 }}>
              Uma é sorteada por envio, pra não repetir sempre a mesma linha. Pool vazio: nenhuma chamada entra
              no texto.
            </small>
            <div className="row">
              <div className="field" style={{ flex: '1 1 260px' }}>
                <input
                  value={novoCta}
                  placeholder="Corre que acaba rápido!"
                  onChange={(e) => setNovoCta(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      adicionarCta();
                    }
                  }}
                />
              </div>
              <button type="button" className="btn btn--ghost" onClick={adicionarCta}>
                Adicionar
              </button>
            </div>
            {rascunho.ctas.length > 0 && (
              <div className="taglist" style={{ marginTop: 8 }}>
                {rascunho.ctas.map((c, i) => (
                  <span className="taglist__item" key={i}>
                    {c}
                    <button
                      type="button"
                      onClick={() => removerCta(i)}
                      aria-label={`Remover chamada "${c}"`}
                      style={{
                        marginLeft: 6,
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: 'var(--muted)',
                        fontWeight: 700,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
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

      {templates.length === 0 && !editando && (
        <div className="empty">
          <strong>Nenhum modelo criado</strong>
          Clique em "Novo modelo" pra montar o texto que os disparos vão usar.
        </div>
      )}

      {templates.map((t) => (
        <div key={t.id} className="panel" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <h2 className="panel__title" style={{ marginBottom: 4 }}>
                {t.name}
                {t.isDefault && (
                  <span className="chip" data-tone="on" style={{ marginLeft: 8 }}>
                    padrão
                  </span>
                )}
                {!t.showImage && (
                  <span className="chip" style={{ marginLeft: 8 }}>
                    sem foto
                  </span>
                )}
              </h2>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                {t.ctas.length} chamada{t.ctas.length === 1 ? '' : 's'} no pool
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              {!t.isDefault && (
                <button className="btn btn--ghost btn--sm" onClick={() => void marcarPadrao(t)}>
                  Tornar padrão
                </button>
              )}
              <button className="btn btn--ghost btn--sm" onClick={() => abrirEdicao(t)}>
                Editar
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void excluir(t.id)}>
                Excluir
              </button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
