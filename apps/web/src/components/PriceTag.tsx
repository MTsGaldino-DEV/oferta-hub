import { useState } from 'react';
import { brl, STORE, type Offer } from '../api.js';

interface Rotulos {
  skip: string;
  send: string;
  sendBusy: string;
}

const ROTULOS_PADRAO: Rotulos = { skip: 'Pular', send: 'Enviar ao grupo', sendBusy: 'Enviando...' };

interface Props {
  offer: Offer;
  /** Posicao dessa oferta na fila atual (1 = proxima a sair). */
  posicao: number;
  onSend: (id: string) => Promise<void>;
  onSkip: (id: string) => Promise<void>;
  /** Sem isso o card nao abre editor de mensagem -- usado na aba Manual, onde
   *  a decisao e so mandar pra fila ou descartar. */
  onEdit?: (offer: Offer) => void;
  /** Troca o texto dos dois botoes de acao. Default e o vocabulario da Fila. */
  rotulos?: Rotulos;
}

/** "+38 mil vendidos". Abaixo de mil, o numero cheio -- arredondar mentiria. */
export function vendidos(n: number | null): string | null {
  if (!n || n < 1) return null;
  if (n < 1000) return `${n} vendidos`;
  return `+${Math.floor(n / 1000)} mil vendidos`;
}

/** Acima disso a prateleira ja provou que o produto sai. */
export const CAMPEAO = 5000;

/**
 * Card da fila. E onde voce decide "manda ou pula", entao a hierarquia e:
 * foto, preco, quanto paga. A nota fica de canto -- ela ordena a fila, mas
 * quem decide olha o produto.
 */
export function PriceTag({ offer, posicao, onSend, onSkip, onEdit, rotulos = ROTULOS_PADRAO }: Props) {
  const [busy, setBusy] = useState<'send' | 'skip' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [porque, setPorque] = useState(false);

  async function act(kind: 'send' | 'skip') {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'send') await onSend(offer.id);
      else await onSkip(offer.id);
      setLeaving(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir.');
      setBusy(null);
    }
  }

  const vendas = vendidos(offer.product.soldCount);
  const desconto = offer.discountPct ? Math.round(offer.discountPct) : 0;

  return (
    <article
      className={`card${onEdit ? '' : ' card--estatico'}`}
      data-leaving={leaving}
      onClick={onEdit ? () => onEdit(offer) : undefined}
    >
      <div className="card__well">
        {offer.product.imageUrl ? (
          <img src={offer.product.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="card__semfoto">sem foto</span>
        )}
        {desconto > 0 && <span className="card__off--badge">-{desconto}%</span>}
        <span
          className="card__nota"
          title="Nota de 0 a 100: histórico de preço, desconto, comissão e reputação"
        >
          {offer.score}
        </span>
      </div>

      <div className="card__corpo">
        <span className="card__posicao" title="Posição na fila de envio atual">
          #{posicao}
        </span>
        {(offer.product.soldCount ?? 0) >= CAMPEAO && <span className="card__selo">Mais vendido</span>}

        <h3 className="card__titulo">
          {onEdit ? (
            <button
              type="button"
              className="card__titulo-btn"
              title="Ver e editar o texto da mensagem"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(offer);
              }}
            >
              {offer.product.title}
            </button>
          ) : (
            <span className="card__titulo-txt" title={offer.product.title}>
              {offer.product.title}
            </span>
          )}
        </h3>

        <div className="card__meta">
          {offer.product.rating ? (
            <span className="card__estrela">★ {offer.product.rating.toFixed(1)}</span>
          ) : null}
          {vendas && <span>{vendas}</span>}
        </div>

        {offer.commissionBrl ? (
          <div className="card__ganho">
            Ganha {brl(offer.commissionBrl)}
            {offer.product.commissionPct ? <em>{offer.product.commissionPct.toFixed(0)}%</em> : null}
          </div>
        ) : null}

        <div className="card__precos">
          {offer.comparePrice && offer.comparePrice > offer.price ? (
            <span className="card__antes">{brl(offer.comparePrice)}</span>
          ) : null}
          <div className="card__linha">
            <span className="card__agora">{brl(offer.price)}</span>
          </div>
        </div>

        <div className="card__origem">
          {STORE[offer.product.platform]}
          {offer.nicho && <span className="card__nicho">{offer.nicho}</span>}
        </div>

        {error && <div className="card__erro">{error}</div>}

        {/* Pular e Enviar ficam lado a lado, os dois com alvo grande. Enviar e
            irreversivel, entao errar o Pular nao pode cair nele: empilhados,
            um deslize de 2px pro lado errado manda a oferta pro grupo. */}
        <div className="card__acoes">
          <div className="card__botoes">
            <button
              className="btn btn--ghost btn--alvo"
              disabled={busy !== null}
              onClick={(e) => {
                e.stopPropagation();
                void act('skip');
              }}
            >
              {busy === 'skip' ? '...' : rotulos.skip}
            </button>
            <button
              className="btn btn--alvo card__enviar"
              disabled={busy !== null}
              onClick={(e) => {
                e.stopPropagation();
                void act('send');
              }}
            >
              {busy === 'send' ? rotulos.sendBusy : rotulos.send}
            </button>
          </div>
          <div className="card__links">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPorque((v) => !v);
              }}
            >
              {porque ? 'Fechar' : 'Por quê?'}
            </button>
          </div>
        </div>

        {/* A justificativa da nota so aparece sob demanda: ela e util quando
            voce duvida do card, e ruido nos outros 90% das vezes. */}
        {porque && (
          // Para o clique aqui -- sem isso, ler ou selecionar uma razao
          // dispara o onEdit do card inteiro, ja que o clique borbulha ate o
          // <article>.
          <ul className="card__razoes" onClick={(e) => e.stopPropagation()}>
            {offer.scoreReasons.map((r, i) => (
              <li key={i} data-neg={r.points < 0}>
                <span>{r.detail}</span>
                <b>
                  {r.points > 0 ? '+' : ''}
                  {r.points}
                </b>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
