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
const PRECO_ANTIGO_RISCADO_RE = /~\{PRECO_ANTIGO\}~/g;

/**
 * Troca os tokens {TITULO} {PRECO} {PRECO_ANTIGO} {LINK} {CUPOM} pelos dados
 * da oferta.
 *
 * Token desconhecido (typo tipo {TITULOO}): fica intacto no texto -- apagar
 * silenciosamente esconderia o erro de quem escreveu o modelo.
 *
 * Token conhecido sem valor (sem cupom, sem preco antigo): some sem deixar
 * rastro. Se a linha inteira so existia por causa desse token (ex: "Cupom:
 * {CUPOM}" numa linha propria), a linha inteira e removida -- nada de linha
 * em branco no lugar. Se o token divide linha com outro que tem valor (ex:
 * "De ~{PRECO_ANTIGO}~ por *{PRECO}*"), so o par "~{PRECO_ANTIGO}~" vira
 * nada, pra nao sobrar um "~~" solto (risco vazio nao significa nada no
 * WhatsApp).
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

    if (tokensConhecidos.length > 0 && tokensConhecidos.every((nome) => vals[nome] === null)) {
      return null; // linha so existia por causa de um token ausente
    }

    let out = linha.replace(PRECO_ANTIGO_RISCADO_RE, vals.PRECO_ANTIGO === null ? '' : `~${vals.PRECO_ANTIGO}~`);
    out = out.replace(TOKEN_RE, (match, nome: string) => {
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
