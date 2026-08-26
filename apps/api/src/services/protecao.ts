/**
 * Decisao de moderacao de grupo -- pura, sem Prisma nem Baileys.
 *
 * Remover alguem de um grupo e irreversivel e visivel pra todo mundo no
 * grupo. Por isso essa logica fica isolada num modulo sem I/O: e o que
 * permite testar de verdade cada guarda antes de qualquer numero real
 * ser avaliado.
 */

// Uniao de strings em vez de importar o enum do Prisma -- mantem o modulo
// sem dependencia de banco.
export type Decisao =
  | { remover: true; motivo: 'BLOCKLIST' | 'FOREIGN_DDI' }
  | { remover: false; motivo: 'NAO_AVALIAVEL' | 'PERMITIDO' | 'PROPRIO' | 'ADMIN' };

export interface DecidirParams {
  jid: string;
  bloqueados: Set<string>;
  filtroDdiLigado: boolean;
  ddiPermitido: string;
  jidProprio: string;
  admins: Set<string>;
}

/**
 * So digitos, forma canonica. Retorna null se o numero for implausivel --
 * guardar uma chave torta falha depois em silencio (nunca bate com nada).
 */
export function normalizarNumero(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, '');

  // Um numero internacional sempre tem DDI + numero nacional. O menor combo
  // real fica perto de 11 digitos (DDI de 1 digito tipo EUA/Canada + 10, ou
  // DDI de 2 digitos tipo Chile + 9). Abaixo disso nunca cabe um DDI de
  // verdade -- e sempre numero local sem DDI, que nunca vai bater com um
  // JID (que sempre traz DDI). Aceitar e falhar calado e pior que rejeitar
  // na entrada.
  // ponytail: sem tabela de prefixos por pais, um numero local de 11+
  // digitos de um pais com DDI curto ainda pode escapar dessa checagem --
  // sobe pra uma tabela de DDIs se isso virar reclamacao real.
  if (digitos.length < 11 || digitos.length > 15) return null;

  // Brasil (DDI 55) tem um nono digito opcional no celular que o WhatsApp
  // as vezes inclui e as vezes nao -- 5511987654321 e 551187654321 sao a
  // MESMA pessoa. Sem colapsar essa diferenca, quem o usuario barra com
  // nono digito continua entrando pelo numero sem ele. Vale so pro Brasil:
  // outros paises nao tem essa regra e um 9 a mais la pode ser parte real
  // do numero.
  if (digitos.startsWith('55') && digitos.length === 13) {
    const ddd = digitos.slice(2, 4);
    const nono = digitos[4];
    if (nono === '9') {
      return '55' + ddd + digitos.slice(5);
    }
  }

  return digitos;
}

/**
 * Extrai o numero de um jid de pessoa (<numero>@s.whatsapp.net). JID de LID
 * ou de grupo nao carrega numero -- devolve null, e quem chama trata isso
 * como "nao avaliavel", nunca como "sem DDI estrangeiro".
 *
 * O Baileys entrega o jid da propria conta com sufixo de dispositivo
 * (<numero>:12@s.whatsapp.net), mas participantes chegam sem ele -- corta
 * o sufixo antes de normalizar, senao os dois nunca colidem. Tambem baixa a
 * caixa: o sufixo do servidor pode variar de capitalizacao.
 */
export function numeroDoJid(jid: string): string | null {
  const [usuarioComDispositivo, sufixo] = jid.toLowerCase().split('@');
  if (sufixo !== 's.whatsapp.net' || !usuarioComDispositivo) return null;
  const [usuario] = usuarioComDispositivo.split(':');
  return normalizarNumero(usuario);
}

/**
 * Mesma pessoa em dois jids, mesmo que um venha com sufixo de dispositivo
 * (conta propria) ou em formato diferente. Quando os dois tem numero,
 * compara pelo numero normalizado; sem numero dos dois lados (ex: LID),
 * cai pra igualdade crua -- e o unico jeito de comparar sem numero.
 */
function mesmoParticipante(a: string, b: string): boolean {
  const numA = numeroDoJid(a);
  const numB = numeroDoJid(b);
  if (numA && numB) return numA === numB;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Decisao completa para um participante. Ordem das guardas -- cada uma
 * protege de um engano irreversivel antes da proxima ser avaliada:
 *   1. propria conta -- nunca se auto-remove.
 *   2. admin do grupo -- remover outro admin e sempre engano.
 *   3. blocklist -- decisao explicita do usuario, tem precedencia sobre DDI.
 *   4. filtro de DDI -- so avalia quem tem numero visivel.
 *   5. permitido.
 */
export function decidir(params: DecidirParams): Decisao {
  const { jid, bloqueados, filtroDdiLigado, ddiPermitido, jidProprio, admins } = params;

  if (mesmoParticipante(jid, jidProprio)) return { remover: false, motivo: 'PROPRIO' };
  if ([...admins].some((admin) => mesmoParticipante(jid, admin))) {
    return { remover: false, motivo: 'ADMIN' };
  }

  const numero = numeroDoJid(jid);

  if (numero && bloqueados.has(numero)) return { remover: true, motivo: 'BLOCKLIST' };

  // LID nao carrega numero -- nao da pra ler o DDI nem comparar com a
  // blocklist, e remover por suposicao expulsaria alguem inocente. Fica
  // como nao avaliavel sempre, mesmo com o filtro desligado: a auditoria
  // nao pode registrar "liberado" pra quem ninguem conseguiu avaliar.
  if (!numero) return { remover: false, motivo: 'NAO_AVALIAVEL' };

  if (filtroDdiLigado) {
    // DDI de configuracao pode vir com espaco ou "+" (texto livre). Compara
    // so digito com digito -- senao um "+55" digitado errado expulsa o
    // grupo brasileiro inteiro. DDI vazio depois de limpo significa
    // configuracao ausente: nao da pra decidir "estrangeiro" contra nada,
    // entao o filtro fica inerte em vez de remover por engano.
    const ddi = ddiPermitido.replace(/\D/g, '');
    if (ddi && !numero.startsWith(ddi)) return { remover: true, motivo: 'FOREIGN_DDI' };
  }

  return { remover: false, motivo: 'PERMITIDO' };
}
