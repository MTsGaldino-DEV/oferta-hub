import { useEffect, useState } from 'react';
import { api, type Offer } from '../api.js';
import { PriceTag } from '../components/PriceTag.js';

const ROTULOS = { skip: 'Descartar', send: 'Mandar pra fila', sendBusy: 'Movendo...' };

export function Manual() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setOffers(await api.get<Offer[]>('/api/offers?status=SCANNED'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  /** Tira o card da lista depois da animacao de saida (ver .card[data-leaving]). */
  function retirar(id: string) {
    setTimeout(() => {
      setOffers((prev) => prev.filter((o) => o.id !== id));
    }, 220);
  }

  async function promover(id: string) {
    await api.post(`/api/offers/${id}/promover`);
    retirar(id);
  }

  async function descartar(id: string) {
    await api.post(`/api/offers/${id}/skip`);
    retirar(id);
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Manual</h1>
          <p>Capturas da extensão (Shopee, Amazon, Mercado Livre) esperando sua decisão, uma por uma.</p>
        </div>
        <button className="btn btn--ghost" onClick={() => void load()}>
          Atualizar
        </button>
      </div>

      {loading ? null : offers.length === 0 ? (
        <div className="empty">
          <strong>Nada pra revisar</strong>
          Escaneie uma página de ofertas com a extensão — o que ela capturar aparece aqui pra você decidir.
        </div>
      ) : (
        <div className="shelf">
          {offers.map((offer, i) => (
            <PriceTag
              key={offer.id}
              offer={offer}
              posicao={i + 1}
              onSend={promover}
              onSkip={descartar}
              rotulos={ROTULOS}
            />
          ))}
        </div>
      )}
    </>
  );
}
