import type { Resultado } from './tipos.js';

interface Props {
  resultado: Resultado | null;
  buscando: boolean;
  onPagina: (page: number) => void;
}

export function ResultadoBusca({ resultado, buscando }: Props) {
  if (buscando) return <div className="empty"><strong>Buscando...</strong></div>;
  if (!resultado) return <div className="empty"><strong>Faça uma busca</strong>Use os filtros acima.</div>;
  return <div className="empty">{resultado.produtos.length} produtos.</div>;
}
