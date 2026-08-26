import type { Filtros } from './tipos.js';
import { ORDENS } from './tipos.js';

interface Props {
  filtros: Filtros;
  onChange: (f: Filtros) => void;
  onBuscar: () => void;
  buscando: boolean;
}

export function FiltrosBusca({ filtros, onChange, onBuscar, buscando }: Props) {
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => onChange({ ...filtros, [k]: v });
  const podeBuscar = filtros.keyword.trim().length >= 2 || filtros.categorias.length > 0;

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (podeBuscar && !buscando) onBuscar();
      }}
    >
      <div className="row">
        <div className="field" style={{ flex: '2 1 260px' }}>
          <label htmlFor="kw">Palavra-chave</label>
          <input
            id="kw"
            value={filtros.keyword}
            placeholder="fone bluetooth"
            onChange={(e) => set('keyword', e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: '1 1 160px' }}>
          <label htmlFor="ordem">Ordenar por</label>
          <select id="ordem" value={filtros.sort} onChange={(e) => set('sort', e.target.value as Filtros['sort'])}>
            {ORDENS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="comissao">Comissão mínima do vendedor (%)</label>
          <input
            id="comissao"
            type="number"
            min={0}
            max={100}
            value={filtros.minCommissionPct}
            placeholder="20"
            onChange={(e) => set('minCommissionPct', e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="teto">Preço até (R$)</label>
          <input
            id="teto"
            type="number"
            min={0}
            value={filtros.maxPrice}
            placeholder="200"
            onChange={(e) => set('maxPrice', e.target.value)}
          />
        </div>
        <label className="field" style={{ flex: '0 1 190px', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}>
          <input
            type="checkbox"
            checked={filtros.keySeller}
            onChange={(e) => set('keySeller', e.target.checked)}
          />
          <span>Só vendedor destaque</span>
        </label>
      </div>

      <button className="btn" disabled={buscando || !podeBuscar}>
        {buscando ? 'Buscando...' : 'Buscar'}
      </button>
      {!podeBuscar && (
        <small style={{ display: 'block', marginTop: 6, color: 'var(--muted)' }}>
          Digite uma palavra-chave com 2 letras ou mais, ou marque pelo menos uma categoria.
        </small>
      )}
    </form>
  );
}
