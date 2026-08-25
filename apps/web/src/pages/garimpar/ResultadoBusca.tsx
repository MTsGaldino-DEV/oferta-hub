import { useState } from 'react';
import { api, brl, int, STORE } from '../../api.js';
import { CAMPEAO, vendidos } from '../../components/PriceTag.js';
import type { Produto, Resultado } from './tipos.js';

interface Props {
  resultado: Resultado | null;
  buscando: boolean;
  onPagina: (page: number) => void;
}

/** Estado do envio pra fila, por produto. */
type Envio = 'enviando' | 'na-fila' | { erro: string };

/** Desconto em pontos percentuais, 0 quando nao da pra comparar. */
function desconto(p: Produto): number {
  if (p.listPrice && p.price && p.listPrice > p.price) {
    return Math.round((1 - p.price / p.listPrice) * 100);
  }
  return 0;
}

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
    <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
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

      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
        {int(resultado.produtos.length)} de {int(resultado.bruto)} encontrados
        {resultado.categorias.length > 0 && ` em ${resultado.categorias.length} categoria(s)`}
      </p>

      <div className="shelf">
        {resultado.produtos.map((p) => {
          const envio = envios[p.externalId];
          const off = desconto(p);
          const vendas = vendidos(p.soldCount);
          // sellerCommissionPct e o que separa oferta boa de oferta comum: a base
          // da loja fica fixa, o extra do vendedor e o que varia. Cai pra base so
          // quando a Shopee nao mandou o extra.
          const comissao = p.sellerCommissionPct ?? p.commissionPct;

          return (
            <article key={p.externalId} className="card card--estatico">
              <div className="card__well">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" loading="lazy" />
                ) : (
                  <span className="card__semfoto">sem foto</span>
                )}
                {off > 0 && <span className="card__off--badge">-{off}%</span>}
              </div>

              <div className="card__corpo">
                {(p.soldCount ?? 0) >= CAMPEAO && <span className="card__selo">Mais vendido</span>}

                <h3 className="card__titulo">
                  <span className="card__titulo-txt" title={p.title}>
                    {p.title}
                  </span>
                </h3>

                <div className="card__meta">
                  {p.rating ? <span className="card__estrela">★ {p.rating.toFixed(1)}</span> : null}
                  {vendas && <span>{vendas}</span>}
                </div>

                {comissao !== null && (
                  <div className="card__ganho" title="Comissão do vendedor por cima da base da loja">
                    {p.commissionBrl !== null ? `Ganha ${brl(p.commissionBrl)}` : 'Comissão'}
                    <em>{comissao.toFixed(0)}%</em>
                  </div>
                )}

                <div className="card__precos">
                  {p.listPrice && p.price && p.listPrice > p.price ? (
                    <span className="card__antes">{brl(p.listPrice)}</span>
                  ) : null}
                  <div className="card__linha">
                    <span className="card__agora">{brl(p.price)}</span>
                  </div>
                </div>

                <div className="card__origem">
                  {STORE[p.platform] ?? p.platform}
                  {p.shopName && <span className="card__loja">{p.shopName}</span>}
                </div>

                {typeof envio === 'object' && <div className="card__erro">{envio.erro}</div>}

                <div className="card__acoes">
                  <button
                    className="btn btn--alvo card__enviar"
                    disabled={envio === 'enviando' || envio === 'na-fila'}
                    onClick={() => void mandarPraFila(p)}
                  >
                    {envio === 'na-fila' ? '✓ Na fila' : envio === 'enviando' ? 'Enviando...' : 'Mandar pra fila'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {paginacao}
    </>
  );
}
