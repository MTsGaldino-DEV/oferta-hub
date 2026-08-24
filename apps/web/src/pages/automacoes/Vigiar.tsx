import { useEffect, useState } from 'react';
import { api, brl, int, STORE } from '../../api.js';
import { Sparkline } from '../../components/Sparkline.js';

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
  id: string; platform: string; keyword: string | null;
  categoryId: number | null; nicheId: string | null; nicho: string | null;
  maxPrice: number | null; minDiscount: number; minCommission: number; lastRunAt: string | null;
}

/** Recorte curado de varias categorias. Semeado pelo backend por enquanto. */
interface NichoCurado {
  id: string; name: string; minSales: number; entries: { categoryId: number }[];
}

export function Vigiar() {
  const [items, setItems] = useState<Watch[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState('');
  const [drop, setDrop] = useState('10');
  const [keyword, setKeyword] = useState('');
  // Shopee e a unica que ainda garimpa: o ML bloqueou a busca por palavra.
  const [platform, setPlatform] = useState('SHOPEE');
  const [minDiscount, setMinDiscount] = useState('25');
  const [nicheId, setNicheId] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [nichos, setNichos] = useState<NichoCurado[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const [jobBusy, setJobBusy] = useState(false);

  const nichoAtual = nichos.find((n) => n.id === nicheId);

  async function load() {
    setItems(await api.get<Watch[]>('/api/watch'));
    setRules(await api.get<Rule[]>('/api/discovery'));
    setNichos(await api.get<NichoCurado[]>('/api/nichos'));
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
        nicheId: nicheId || undefined,
        keyword: keyword.trim() || undefined,
        minDiscount: Number(minDiscount),
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
      });
      setKeyword('');
      setNicheId('');
      setMaxPrice('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui criar a regra.');
    } finally {
      setBusy(false);
    }
  }

  /** O clique precisa dizer o que aconteceu, inclusive quando o resultado e zero. */
  async function rodarMonitor() {
    setJobBusy(true);
    setJobMsg(null);
    try {
      const r = await api.post<{ checked: number; fired: number; failed: number }>('/api/jobs/price-monitor');
      if (r.checked === 0) {
        setJobMsg('Monitor rodou, mas não há nenhum produto vigiado ainda. Adicione um abaixo.');
      } else {
        const partes = [`${r.checked} produto(s) conferido(s)`];
        partes.push(r.fired > 0 ? `${r.fired} caíram de preço e foram pra fila` : 'nenhuma queda no gatilho');
        if (r.failed > 0) partes.push(`${r.failed} falharam`);
        setJobMsg(`Monitor: ${partes.join(', ')}.`);
      }
      await load();
    } catch (err) {
      setJobMsg(err instanceof Error ? err.message : 'O monitor falhou.');
    } finally {
      setJobBusy(false);
    }
  }

  async function rodarGarimpo() {
    setJobBusy(true);
    setJobMsg(null);
    try {
      const r = await api.post<{ rules: { keyword: string; platform: string; found: number; added: number; error?: string }[] }>(
        '/api/jobs/discovery',
      );
      if (r.rules.length === 0) {
        setJobMsg('Garimpo rodou, mas não há nenhuma regra ativa. Crie uma abaixo.');
      } else {
        setJobMsg(
          r.rules
            .map((x) => {
              const onde = `${STORE[x.platform] ?? x.platform} · "${x.keyword}"`;
              if (x.error) return `${onde}: falhou — ${x.error}`;
              if (x.added > 0) return `${onde}: ${x.added} de ${x.found} entraram na fila`;
              return `${onde}: ${x.found} encontrados, nenhum passou nos filtros`;
            })
            .join(' | '),
        );
      }
      await load();
    } catch (err) {
      setJobMsg(err instanceof Error ? err.message : 'O garimpo falhou.');
    } finally {
      setJobBusy(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Vigiar</h1>
          <p>
            O monitor lê o preço de hora em hora e guarda o histórico. Quando bate seu gatilho, a oferta vai
            direto pra fila — nunca direto pro grupo.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost" disabled={jobBusy} onClick={() => void rodarMonitor()}>
            {jobBusy ? 'Rodando...' : 'Rodar monitor agora'}
          </button>
          <button className="btn btn--ghost" disabled={jobBusy} onClick={() => void rodarGarimpo()}>
            {jobBusy ? 'Rodando...' : 'Rodar garimpo agora'}
          </button>
        </div>
      </div>

      {error && <div className="notice">{error}</div>}
      {jobMsg && <div className="notice">{jobMsg}</div>}

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
            <label htmlFor="nicho">Nicho</label>
            <select id="nicho" value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
              <option value="">— escolha um nicho —</option>
              {nichos.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
            <small>
              {nichoAtual
                ? `${nichoAtual.entries.length} categorias, mín. ${int(nichoAtual.minSales)} vendas`
                : 'edição manual de nichos volta em breve'}
            </small>
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label htmlFor="kw">Refinar (opcional)</label>
            <input id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="deixe vazio p/ nicho todo" />
          </div>
          <div className="field" style={{ flex: '0 1 130px' }}>
            <label htmlFor="mind">Desconto mín.</label>
            <input id="mind" value={minDiscount} onChange={(e) => setMinDiscount(e.target.value)} inputMode="numeric" />
            <small>em %</small>
          </div>
          <div className="field" style={{ flex: '0 1 130px' }}>
            <label htmlFor="maxp">Preço até</label>
            <input id="maxp" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} inputMode="numeric" placeholder="R$" />
            <small>opcional</small>
          </div>
          <button
            className="btn"
            disabled={busy || (!nicheId && keyword.trim().length < 2)}
            onClick={() => void addRule()}
          >
            Criar regra
          </button>
        </div>

        {rules.length > 0 && (
          <table className="table" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Nicho / palavra</th>
                <th>Loja</th>
                <th className="num">Desconto mín.</th>
                <th className="num">Última varredura</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.nicho ?? r.keyword}</strong>
                    {r.nicho && r.keyword && <small style={{ display: 'block' }}>refinado por "{r.keyword}"</small>}
                  </td>
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
