/**
 * Mark do Hub Ofertas: um H de peca unica. As duas hastes sao ligadas por uma
 * travessa que desce da esquerda para a direita em curva S -- e a travessa que
 * faz a letra existir, entao ela encosta nas duas hastes de verdade.
 *
 * Inline de proposito: herda `currentColor`, entao a mesma peca serve no trilho
 * escuro e na tela de login clara sem virar dois arquivos.
 */
const PATH =
  'M24 16 H76 V92 C100 92 100 128 124 128 V16 H176 V240 H124 V164 C100 164 100 128 76 128 V240 H24 Z';

/** Proporcao da caixa do mark (152 x 224). */
export const LOGO_RATIO = 152 / 224;

export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={Math.round(size * LOGO_RATIO)}
      height={size}
      viewBox="24 16 152 224"
      fill="currentColor"
      role="img"
      aria-label="Hub Ofertas"
    >
      <path d={PATH} />
    </svg>
  );
}
