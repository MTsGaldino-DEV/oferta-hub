import { useState } from 'react';
import { api, brl, int } from '../../api.js';
import type { Produto, Resultado } from './tipos.js';

interface Props {
  resultado: Resultado | null;
  buscando: boolean;
  onPagina: (page: number) => void;
}

/** Estado do envio pra fila, por produto. */
type Envio = 'enviando' | 'na-fila' | { erro: string };

function desconto(p: Produto): string {
  if (p.listPrice && p.price && p.listPrice > p.price) {
    return `${Math.round((1 - p.price / p.listPrice) * 100)}%`;
  }
  return '—';
}

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}%`);

export function ResultadoBusca({ resultado, buscando, onPagina }: Props) {
  const [envios, setEnvios] = useState<Record<string, Envio>>({});

  async function mandarPraFila(p: Produto) {
    setEnvios((e) => ({ ...e, [p.externalId]: 'enviando' }));
    try {
      await api.post('/api/offers/from-product', { platform: p.platform, externalId: p.externalId });
      setEnvios((e) => ({ ...e, [p.externalId]: 'na-fila' }));
    } catch (err) {
      setEnvios((e) => ({
        ...e,
        [p.externalId]: { erro: err instanceof Error ? err.message : 'Não consegui adicionar.' },
      }));
    }
  }

  if (buscando) {
    return (
      <div className="empty">
        <strong>Buscando...</strong>
        Cada categoria marcada é uma consulta à Shopee.
      </div>
    );
  }

  if (!resultado) {
    return (
      <div className="empty">
        <strong>Faça uma busca</strong>
        Use a palavra-chave, as categorias, ou os dois juntos.
      </div>
    );
  }

  // O filtro (comissao/preco) roda sobre o lote que a Shopee devolveu, entao
  // pagina vazia nao significa fim dos resultados -- sem os controles aqui,
  // pagina 1 vazia nao deixa ver a 2, e pagina 3 vazia prende o usuario sem volta.
  const paginacao = (
    <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
      <button
        className="btn btn--ghost btn--sm"
        disabled={resultado.pageInfo.page <= 1}
        onClick={() => onPagina(resultado.pageInfo.page - 1)}
      >
        Anterior
      </button>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>Página {resultado.pageInfo.page}</span>
      <button
        className="btn btn--ghost btn--sm"
        disabled={!resultado.pageInfo.hasNextPage}
        onClick={() => onPagina(resultado.pageInfo.page + 1)}
      >
        Próxima
      </button>
    </div>
  );

  if (resultado.produtos.length === 0) {
    return (
      <>
        {resultado.falhas.length > 0 && (
          <div className="notice">
            {resultado.falhas.length} categoria(s) falharam: {resultado.falhas[0].motivo}
          </div>
        )}
        <div className="empty">
          <strong>Nada sobrou</strong>
          {resultado.antesDoFiltro > 0
            ? `A Shopee devolveu ${int(resultado.antesDoFiltro)} itens, mas os filtros cortaram todos. Tente baixar a comissão mínima ou subir o teto de preço.`
            : 'A Shopee não devolveu nada pra essa combinação.'}
        </div>
        {(resultado.pageInfo.page > 1 || resultado.pageInfo.hasNextPage) && paginacao}
      </>
    );
  }

  return (
    <>
      {resultado.falhas.length > 0 && (
        <div className="notice">
          Resultado parcial: {resultado.falhas.length} categoria(s) falharam. Primeiro erro:{' '}
          {resultado.falhas[0].motivo}
        </div>
      )}

      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        {int(resultado.produtos.length)} de {int(resultado.bruto)} encontrados
        {resultado.categorias.length > 0 && ` em ${resultado.categorias.length} categoria(s)`}
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Produto</th>
            <th className="num">Preço</th>
            <th className="num">Desconto</th>
            <th className="num">Comissão</th>
            <th className="num">Vendedor</th>
            <th className="num">Vendas</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {resultado.produtos.map((p) => {
            const envio = envios[p.externalId];
            return (
              <tr key={p.externalId}>
                <td>
                  <div className="cell-product">
                    {p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" />}
                    <span>
                      {p.title}
                      <br />
                      <small style={{ color: 'var(--muted)' }}>{p.shopName ?? '—'}</small>
                      {typeof envio === 'object' && (
                        <>
                          <br />
                          <small style={{ color: 'var(--drop)' }}>{envio.erro}</small>
                        </>
                      )}
                    </span>
                  </div>
                </td>
                <td className="num">{brl(p.price)}</td>
                <td className="num">{desconto(p)}</td>
                <td className="num">{pct(p.commissionPct)}</td>
                <td className="num">
                  <strong>{pct(p.sellerCommissionPct)}</strong>
                  {p.commissionBrl !== null && (
                    <>
                      <br />
                      <small style={{ color: 'var(--muted)' }}>{brl(p.commissionBrl)}</small>
                    </>
                  )}
                </td>
                <td className="num">
                  <strong>{int(p.soldCount)}</strong>
                </td>
                <td className="num">
                  {envio === 'na-fila' ? (
                    <span className="chip" data-tone="on">
                      na fila
                    </span>
                  ) : (
                    <button
                      className="btn btn--ghost btn--sm"
                      disabled={envio === 'enviando'}
                      onClick={() => void mandarPraFila(p)}
                    >
                      {envio === 'enviando' ? 'Enviando...' : 'Mandar pra fila'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {paginacao}
    </>
  );
}
