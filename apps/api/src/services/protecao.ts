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

  // Numero internacional com DDI tem por volta de 10 a 15 digitos. Fora
  // dessa faixa e lixo (vazio, cpf, texto, etc), nao um numero de telefone.
  if (digitos.length < 10 || digitos.length > 15) return null;

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
 */
export function numeroDoJid(jid: string): string | null {
  const [usuario, sufixo] = jid.split('@');
  if (sufixo !== 's.whatsapp.net' || !usuario) return null;
  return normalizarNumero(usuario);
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

  if (jid === jidProprio) return { remover: false, motivo: 'PROPRIO' };
  if (admins.has(jid)) return { remover: false, motivo: 'ADMIN' };

  const numero = numeroDoJid(jid);

  if (numero && bloqueados.has(numero)) return { remover: true, motivo: 'BLOCKLIST' };

  if (filtroDdiLigado) {
    // LID nao carrega numero -- nao da pra ler o DDI, e remover por
    // suposicao expulsaria alguem inocente. Fica como nao avaliavel.
    if (!numero) return { remover: false, motivo: 'NAO_AVALIAVEL' };
    if (!numero.startsWith(ddiPermitido)) return { remover: true, motivo: 'FOREIGN_DDI' };
  }

  return { remover: false, motivo: 'PERMITIDO' };
}
