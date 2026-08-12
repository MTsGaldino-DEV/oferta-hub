import { useEffect, useState } from 'react';
import { api, brl, STORE } from '../api.js';
import { Sparkline } from '../components/Sparkline.js';

interface Watch {
  id: string;
  active: boolean;
  targetPrice: number | null;
  minDropPct: number;
  lastFiredAt: string | null;
  product: { id: string; title: string; imageUrl: string | null; platform: string; currentPrice: number | null };
  history: { price: number | null; at: string }[];
}

interface Rule {
  id: string; platform: string; keyword: string;
  maxPrice: number | null; minDiscount: number; minCommission: number; lastRunAt: string | null;
}

export function Produtos() {
  const [items, setItems] = useState<Watch[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState('');
  const [drop, setDrop] = useState('10');
  const [keyword, setKeyword] = useState('');
  const [platform, setPlatform] = useState('MERCADO_LIVRE');
  const [minDiscount, setMinDiscount] = useState('25');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setItems(await api.get<Watch[]>('/api/watch'));
    setRules(await api.get<Rule[]>('/api/discovery'));
  }

  useEffect(() => {
    void load().catch(() => {});
  }, []);

  async function addWatch() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/watch', {
        url: url.trim(),
        targetPrice: target ? Number(target) : undefined,
        minDropPct: Number(drop),
      });
      setUrl('');
      setTarget('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui adicionar.');
    } finally {
      setBusy(false);
    }
  }

  async function addRule() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/discovery', {
        platform,
        keyword: keyword.trim(),
        minDiscount: Number(minDiscount),
      });
      setKeyword('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui criar a regra.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Preços vigiados</h1>
          <p>
            O monitor lê o preço de hora em hora e guarda o histórico. Quando bate seu gatilho, a oferta vai
            direto pra fila — nunca direto pro grupo.
          </p>
        </div>
        <button className="btn btn--ghost" onClick={() => void api.post('/api/jobs/price-monitor')}>
          Rodar monitor agora
        </button>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="panel">
        <h2 className="panel__title">Vigiar um produto</h2>
        <div className="row">
          <div className="field" style={{ flex: '3 1 320px' }}>
            <label htmlFor="wurl">Link do produto</label>
            <input id="wurl" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="field" style={{ flex: '0 1 150px' }}>
            <label htmlFor="target">Avisar abaixo de</label>
            <input id="target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="R$ 299" inputMode="decimal" />
          </div>
          <div className="field" style={{ flex: '0 1 130px' }}>
            <label htmlFor="drop">Ou queda de</label>
            <input id="drop" value={drop} onChange={(e) => setDrop(e.target.value)} inputMode="numeric" />
            <small>em %</small>
          </div>
          <button className="btn" disabled={!url.trim() || busy} onClick={() => void addWatch()}>
            Vigiar
          </button>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel__title">Garimpo automático</h2>
        <div className="row">
          <div className="field" style={{ flex: '0 1 190px' }}>
            <label htmlFor="plat">Loja</label>
            <select id="plat" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {['MERCADO_LIVRE', 'SHOPEE', 'ALIEXPRESS', 'AMAZON', 'LOMADEE'].map((p) => (
                <option key={p} value={p}>{STORE[p]}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '2 1 260px' }}>
            <label htmlFor="kw">Palavra-chave</label>
            <input id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="fone bluetooth" />
          </div>
          <div className="field" style={{ flex: '0 1 150px' }}>
            <label htmlFor="mind">Desconto mínimo</label>
            <input id="mind" value={minDiscount} onChange={(e) => setMinDiscount(e.target.value)} inputMode="numeric" />
            <small>em %</small>
          </div>
          <button className="btn" disabled={keyword.trim().length < 2 || busy} onClick={() => void addRule()}>
            Criar regra
          </button>
        </div>

        {rules.length > 0 && (
          <table className="table" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Palavra-chave</th>
                <th>Loja</th>
                <th className="num">Desconto mín.</th>
                <th className="num">Última varredura</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.keyword}</strong></td>
                  <td>{STORE[r.platform]}</td>
                  <td className="num">{r.minDiscount}%</td>
                  <td className="num">
                    {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca'}
                  </td>
                  <td className="num">
                    <button className="btn btn--ghost btn--sm" onClick={async () => { await api.del(`/api/discovery/${r.id}`); void load(); }}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ height: 20 }} />

      {items.length === 0 ? (
        <div className="empty">
          <strong>Nenhum produto vigiado</strong>
          Cole um link acima. Depois de algumas leituras o gráfico de preço aparece aqui.
        </div>
      ) : (
        <div className="queue">
          {items.map((w) => (
            <article className="tag" key={w.id}>
              <div className="tag__top">
                {w.product.imageUrl && <img className="tag__thumb" src={w.product.imageUrl} alt="" loading="lazy" />}
                <div>
                  <h3 className="tag__title">{w.product.title}</h3>
                  <div className="tag__store">{STORE[w.product.platform]}</div>
                </div>
              </div>

              <div className="tag__price">
                <span className="tag__now">{brl(w.product.currentPrice)}</span>
                {w.targetPrice && <span className="tag__off">alvo {brl(w.targetPrice)}</span>}
              </div>

              <Sparkline points={w.history} />

              <div className="tag__actions">
                <span className="chip">{w.history.length} leituras</span>
                <span className="chip">queda ≥ {w.minDropPct}%</span>
                <span className="tag__spacer" />
                <button className="btn btn--ghost btn--sm" onClick={async () => { await api.del(`/api/watch/${w.id}`); void load(); }}>
                  Parar de vigiar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
