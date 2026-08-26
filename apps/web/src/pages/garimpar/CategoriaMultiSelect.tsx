import { useMemo, useState } from 'react';
import { int } from '../../api.js';
import type { Raiz } from './tipos.js';

const LIMITE = 10;

interface Props {
  arvore: Raiz[];
  selecionadas: number[];
  onChange: (ids: number[]) => void;
}

export function CategoriaMultiSelect({ arvore, selecionadas, onChange }: Props) {
  const [filtro, setFiltro] = useState('');
  const noLimite = selecionadas.length >= LIMITE;

  // A arvore tem ~276 categorias: sem o filtro por nome a lista e longa demais
  // pra achar uma categoria especifica.
  const visivel = useMemo(() => {
    const termo = filtro.trim().toLowerCase();
    if (!termo) return arvore;
    return arvore
      .map((r) => ({ ...r, filhas: r.filhas.filter((f) => f.nome.toLowerCase().includes(termo)) }))
      .filter((r) => r.filhas.length > 0 || r.nome.toLowerCase().includes(termo));
  }, [arvore, filtro]);

  function alternar(id: number) {
    onChange(selecionadas.includes(id) ? selecionadas.filter((x) => x !== id) : [...selecionadas, id]);
  }

  return (
    <div className="field">
      <label htmlFor="filtro-cat">
        Categorias
        {selecionadas.length > 0 && (
          <span className="chip" data-tone="on" style={{ marginLeft: 8 }}>
            {selecionadas.length} selecionada{selecionadas.length === 1 ? '' : 's'}
          </span>
        )}
      </label>

      <div className="row" style={{ marginBottom: 6 }}>
        <input
          id="filtro-cat"
          value={filtro}
          placeholder="Filtrar categoria pelo nome"
          onChange={(e) => setFiltro(e.target.value)}
          style={{ flex: '1 1 auto' }}
        />
        {selecionadas.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([])}>
            Limpar
          </button>
        )}
      </div>

      {noLimite && <div className="notice">Limite de {LIMITE} categorias por busca atingido.</div>}

      <div className="catbox">
        {/* arvore vazia sem filtro digitado quer dizer catalogo nunca sincronizado,
            nao "sem resultado pro filtro" -- textos diferentes pra cada caso */}
        {visivel.length === 0 && arvore.length === 0 && !filtro.trim() && (
          <div className="empty">
            O catálogo de categorias ainda não foi carregado. A busca por palavra-chave funciona normalmente
            enquanto isso.
          </div>
        )}
        {visivel.length === 0 && (arvore.length > 0 || filtro.trim()) && (
          <div className="empty">Nenhuma categoria com esse nome.</div>
        )}
        {visivel.map((r) => (
          <div key={r.id} className="catbox__grupo">
            <div className="catbox__raiz">
              {r.nome} <span>{int(r.itens)}</span>
            </div>
            {r.filhas.map((f) => {
              const marcada = selecionadas.includes(f.id);
              return (
                <label key={f.id} className="catbox__item" data-picked={marcada}>
                  <input
                    type="checkbox"
                    checked={marcada}
                    disabled={!marcada && noLimite}
                    onChange={() => alternar(f.id)}
                    style={{ marginRight: 8 }}
                  />
                  <span>{f.nome}</span>
                  <em>{int(f.itens)}</em>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <small style={{ color: 'var(--muted)' }}>
        Cada categoria é uma consulta à Shopee. Selecionar muitas deixa a busca mais lenta.
      </small>
    </div>
  );
}
