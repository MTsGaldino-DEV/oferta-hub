import { useState } from 'react';
import { brl, STORE, type Offer } from '../api.js';

interface Props {
  offer: Offer;
  onSend: (id: string) => Promise<void>;
  onSkip: (id: string) => Promise<void>;
  onEdit: (offer: Offer) => void;
}

/**
 * Etiqueta de preço. É o elemento principal do painel: você bate o olho no
 * preço, confere a nota e as razões dela, e decide.
 */
export function PriceTag({ offer, onSend, onSkip, onEdit }: Props) {
  const [busy, setBusy] = useState<'send' | 'skip' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <article className="tag" data-leaving={leaving}>
      <div className="tag__score" title="Nota de 0 a 100 calculada pelo histórico, desconto, comissão e reputação">
        {offer.score}
      </div>

      <div className="tag__top">
        {offer.product.imageUrl && (
          <img className="tag__thumb" src={offer.product.imageUrl} alt="" loading="lazy" />
        )}
        <div>
          <h3 className="tag__title">{offer.product.title}</h3>
          <div className="tag__store">
            {STORE[offer.product.platform]} · {offer.source === 'MANUAL' ? 'manual' : offer.source === 'WATCHLIST' ? 'queda de preço' : 'garimpo'}
          </div>
          {offer.nicho && <div className="tag__nicho">{offer.nicho}</div>}
        </div>
      </div>

      <div className="tag__price">
        <span className="tag__now">{brl(offer.price)}</span>
        {offer.comparePrice && offer.comparePrice > offer.price && (
          <span className="tag__was">{brl(offer.comparePrice)}</span>
        )}
        {offer.discountPct ? <span className="tag__off">−{Math.round(offer.discountPct)}%</span> : null}
      </div>

      {offer.commissionBrl ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
          comissão estimada {brl(offer.commissionBrl)}
        </div>
      ) : null}

      <ul className="tag__reasons">
        {offer.scoreReasons.slice(0, 4).map((r, i) => (
          <li key={i} data-neg={r.points < 0}>
            <span>{r.detail}</span>
            <b>
              {r.points > 0 ? '+' : ''}
              {r.points}
            </b>
          </li>
        ))}
      </ul>

      {error && (
        <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
          {error}
        </div>
      )}

      <div className="tag__actions">
        <button className="btn btn--tag" disabled={busy !== null} onClick={() => void act('send')}>
          {busy === 'send' ? 'Enviando...' : 'Enviar ao grupo'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => onEdit(offer)}>
          Ver texto
        </button>
        <span className="tag__spacer" />
        <button className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => void act('skip')}>
          Pular
        </button>
      </div>
    </article>
  );
}
