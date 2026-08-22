import { brl } from './message.js';

export interface TemplateOfferData {
  title: string;
  price: number;
  /** Nulo ou menor/igual ao preco atual = sem "de/por" pra mostrar. */
  comparePrice?: number | null;
  couponCode?: string | null;
  link: string;
}

type Token = 'TITULO' | 'PRECO' | 'PRECO_ANTIGO' | 'LINK' | 'CUPOM';

function valores(d: TemplateOfferData): Record<Token, string | null> {
  return {
    TITULO: d.title,
    PRECO: brl(d.price),
    PRECO_ANTIGO: d.comparePrice && d.comparePrice > d.price ? brl(d.comparePrice) : null,
    LINK: d.link,
    CUPOM: d.couponCode || null,
  };
}

const TOKEN_RE = /\{([A-Z_]+)\}/g;

/**
 * Troca os tokens {TITULO} {PRECO} {PRECO_ANTIGO} {LINK} {CUPOM} pelos dados
 * da oferta.
 *
 * Token desconhecido (typo tipo {TITULOO}): fica intacto no texto -- apagar
 * silenciosamente esconderia o erro de quem escreveu o modelo.
 *
 * Token conhecido sem valor (sem cupom, sem preco antigo): a linha inteira
 * some, mesmo que outros tokens dela tenham valor. Motivo: uma linha como
 * "De ~{PRECO_ANTIGO}~ por *{PRECO}*" sem preco antigo nao vira frase
 * valida so tirando o token ("De por *R$ 89,90*") -- fica quebrada. Por
 * isso quem escreve o modelo deve colocar o fallback (o preco simples)
 * numa linha propria separada, ja que uma linha mista some por inteiro.
 */
export function renderTemplate(
  body: string,
  data: TemplateOfferData,
  ctas: string[] = [],
  escolherCta: (opcoes: string[]) => string = (opcoes) => opcoes[Math.floor(Math.random() * opcoes.length)],
): string {
  const vals = valores(data);

  const linhas = body.split('\n').map((linha) => {
    const tokensConhecidos = [...linha.matchAll(TOKEN_RE)]
      .map((m) => m[1] as Token)
      .filter((nome) => nome in vals);

    if (tokensConhecidos.length > 0 && tokensConhecidos.some((nome) => vals[nome] === null)) {
      return null; // linha tinha um token conhecido sem valor
    }

    const out = linha.replace(TOKEN_RE, (match, nome: string) => {
      if (!(nome in vals)) return match; // token desconhecido: mantem visivel
      const v = vals[nome as Token];
      return v === null ? '' : v;
    });
    return out.replace(/ {2,}/g, ' ').trim();
  });

  let texto = linhas.filter((l): l is string => l !== null).join('\n');
  texto = texto.replace(/\n{3,}/g, '\n\n'); // sobra rara de espaçamento ao redor de uma linha removida

  if (ctas.length > 0) {
    texto = `${texto}\n\n${escolherCta(ctas)}`;
  }

  return texto;
}
