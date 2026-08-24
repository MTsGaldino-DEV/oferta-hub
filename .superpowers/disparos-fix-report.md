# Relatório — fixes de code review em Disparos

Worktree `frontend-melhorias`, base `914a221`.

## CRITICAL 1 + 2 — desenho combinado (claim/release lifecycle)

**Claim antes de enviar** (`disparo.ts` ~linha 312-319): o item vira `PENDING -> SENT`
via `updateMany({ where: { id, status: PENDING }, data: { status: SENT, sentAt } })`
*antes* de chamar `sendOffer`. Se `claim.count !== 1`, outra rodada ou um cancelamento já
mexeu no item — `continue` sem enviar. Isso fecha CRITICAL 1: um restart do processo (ou
falha do próprio UPDATE de "marcar enviado") nunca mais deixa o item em PENDING depois de
já ter saído de verdade, porque não existe mais essa janela — o item já está SENT antes do
envio de rede acontecer.

**Troca deliberada** (documentada no comment acima de `runDisparos`, estendendo o comment
original de reentrância): com o claim vindo primeiro, o pior caso vira o oposto de antes —
o processo cai *depois* do claim mas *antes* (ou durante) o envio de verdade, e o item fica
SENT sem ter saído. Envio perdido, não reenviado. Isso é aceitável; reenviar em loop pra um
número ban-able não é. É a troca que o CRITICAL 1 pediu.

**Release em erro retryable** (CRITICAL 2, catch em `disparo.ts` ~linha 325-347):
- Identifico retryable via `instanceof WhatsAppRetryableError` — classe nova em
  `baileys.ts`, lançada nos dois throw sites (`checkQuota`, teto diário; e o guard de
  `status !== 'connected'` em `sendOffer`). Typed, não string matching — troca mínima
  (`throw new Error(...)` → `throw new WhatsAppRetryableError(...)`, mesma mensagem), não
  muda nada do comportamento de envio manual (ainda é um `Error` normal pra quem só faz
  `err instanceof Error`).
- No catch: desfaço o claim (`SENT -> PENDING`, `sentAt: null`, guardado por
  `where: { status: SENT }`), restauro a oferta (`FAILED -> DISPATCHING`, guardado por
  `where: { status: FAILED }`) e adio a cauda com `adiar(item, disparo, RETRY_DELAY_MINUTES * MINUTE_MS)`.
- **Como mantive a oferta fora de FAILED**: escolhi a opção "o worker de disparo restaura o
  status depois" em vez de mudar `dispatch.ts`. `dispatch.ts:sendOffer` continua com o
  mesmo catch de sempre (seta FAILED, rethrow) — ele é usado também pelo botão manual "Enviar
  ao grupo" e pelo agendador da Fila, e ali um erro retryable realmente deveria terminar em
  FAILED (não há retry automático nesses fluxos). Só o worker de Disparos sabe que este erro
  é retryable e sabe desfazer. Diff mínimo, comportamento dos outros chamadores intocado.
- **Delay escolhido: 30 minutos.** O teto diário não reseta antes da virada do dia (UTC) —
  qualquer delay curto só bateria na mesma falha de novo. Uma desconexão do WhatsApp
  reconecta em segundos (`setTimeout(5000)` em `baileys.ts`) a poucos minutos. 30min evita
  martelar a cada tick (o bug relatado: "burn de um por tick") sem travar um disparo por
  horas numa reconexão rápida — e como o item mesmo assim volta pra fila e a cauda inteira
  desliza junto, sucessivas tentativas a cada 30min (enquanto o teto não libera) só vão
  empurrando o horário adiante, sem nunca perder o espaçamento configurado.
- `adiar()` ganhou um 3º parâmetro opcional `atrasoMs` (default 0) — desloca o ponto de
  partida antes de achar o próximo horário liberado. Chamada de bloqueio de horário
  continua `adiar(item, disparo)` sem mudança de comportamento; retry usa
  `adiar(item, disparo, RETRY_DELAY_MINUTES * MINUTE_MS)`.
- **Burn removido**: antes, `checkQuota` throwava antes de `waitInterval`, então cada tick
  tentava de novo em ~1min sem nenhum atraso real. Agora o item some da fila de "devidos" por
  30min (mais o próprio `intervalMinutes` do disparo, via o gate do item 3) — sem burst.

## Item 3 — startAt no passado e drenagem em rajada

- `routes/disparos.ts`: novo `.refine` rejeitando `scheduledFor` no passado quando
  `!startNow` (linha ~33-38).
- `Disparos.tsx`: `min={proximoMinutoLocal()}` no `<input type="datetime-local">` (linha
  ~379-384), helper novo no topo do arquivo.
- `disparo.ts` (~linha 291-303): antes de reivindicar o próximo item devido, checo o
  `DisparoItem` mais recente com `status: SENT` deste disparo (`findFirst orderBy sentAt desc`).
  Se `Date.now() - ultimoEnvio.sentAt < intervalMinutes * MINUTE_MS`, `continue` — não envia
  ainda, mesmo que o item esteja "vencido". Isso é o que impede a drenagem de backlog em
  ~1/min: agora só manda de novo depois do intervalo configurado, goste ou não do
  `scheduledFor` de cada item.

## Item 4 — groupJids/offerIds duplicados

`routes/disparos.ts`: `.transform((a) => [...new Set(a)])` em ambos os arrays, antes das
validações de tamanho mínimo (zod aplica `.min` antes do transform, então "escolha ao menos
um grupo" continua funcionando mesmo que o array de entrada já venha vazio).

## Item 5 — race em `criarDisparo`

`disparo.ts` (~linha 80-86): `tx.offer.updateMany` agora filtra também
`status: OfferStatus.PENDING`; se `reservadas.count !== input.offerIds.length`, `throw` —
que desfaz a transação inteira (não cria o disparo pela metade, não força de volta uma
oferta que virou SENT nesse meio-tempo).

## Item 6 — race no cancelamento

Duas partes:
- **Escrita do item**: já resolvida estruturalmente pelo CRITICAL 1 — o item vira SENT
  *antes* de qualquer `waitInterval`/envio, então o `updateMany` do cancelamento
  (`where: { status: PENDING }`) nunca mais alcança um item em voo. Não sobrescreve nada.
- **Conclusão do disparo** (`disparo.ts` ~linha 360-369): troquei
  `prisma.disparo.update({ where: { id }, data: { status: DONE } })` (incondicional) por
  `updateMany({ where: { id, status: { in: [DRAFT, SENDING] } }, data: { status: DONE } })`.
  Se um cancelamento concorrente já levou o disparo pra CANCELLED enquanto o último envio
  estava em voo, essa condição não bate — zero linhas afetadas, CANCELLED sobrevive.

## Item 7 — ofertas FAILED presas fora da Fila

`cancelarDisparo` (`disparo.ts` ~linha 108-129): além de reverter ofertas ainda
`DISPATCHING`, agora também recupera ofertas `FAILED` que não têm nenhum `DisparoItem`
`SENT` neste disparo (`failedSemSent`) — essas voltam pra `PENDING`. Uma oferta que já saiu
pra pelo menos um grupo (tem item SENT) não é tocada, mesmo que tenha falhado noutro grupo.

**Gap residual que NÃO fechei** (fora do que foi pedido): se o cancelamento roda exatamente
durante o `waitInterval` do último item em voo e esse envio falha de forma *terminal* depois
do cancelamento já ter processado a recuperação de FAILED, esse item específico ainda pode
ficar preso (a recuperação só olha o snapshot de FAILED no momento do cancel). É uma janela
rara (segundos) e exigiria rodar a recuperação de novo a cada falha terminal pós-cancelamento
— não pedido, não fiz.

## Item 8 — texto do cancelamento

`Disparos.tsx` linha ~529-535: trocado para "Cancelar esse disparo? Os envios que já saíram
continuam enviados; as ofertas que ainda não saíram pra nenhum grupo voltam pra fila." —
exatamente o texto sugerido, reflete o comportamento real (granularidade é por oferta, não
por "envio").

## Item 9 — aviso de teto diário + visibilidade da quota

`Disparos.tsx`: `/api/whatsapp/status` (já retorna `quota: {used, cap}`) agora também
alimenta um `useState<Quota>`. No resumo do passo 3 (~linha 466-476), mostro
`used/cap` e, se `totalEnvios > cap - used`, um aviso extra. Não bloqueia o submit — o
CRITICAL 2 já trata o excedente adiando em vez de queimar.

## Item 10 — intervalo não revisável pra baixo

`Disparos.tsx`: input trocado de texto-com-clamp-por-tecla pra `type="number" min={5}`,
clamp só no `onBlur`. `onChange` aceita qualquer número digitado livremente; `criar()`
ainda valida `intervalMinutes < 5` no submit como rede de segurança.

## Minors

- `Disparos.tsx` (`alternarExpandido`): `setItens([])` antes do fetch + `try/catch` (fica
  vazio em erro, não trava mostrando itens do card errado).
- `Disparos.tsx` (carga inicial de `EmAndamento`): `.catch` novo, estado `erro` mostrado em
  vez do empty state "Nenhum disparo criado" quando a carga falha.
- `Disparos.tsx` (fila do passo 1): `limit=500` na query e aviso "mostrando só as 500
  primeiras" quando o resultado bate o teto.
- `disparo.ts`: `Intl.DateTimeFormat` de `bloqueado()` hoisted pro módulo (`fusoSaoPaulo`),
  criado uma vez em vez de a cada uma das até ~3300 voltas de `proximoLiberado`.
- `disparo.ts`: o flip `DRAFT -> SENDING` (linha ~305-310) só acontece depois do check de
  bloqueio de horário E do gate de pacing — não mais antes. Um disparo preso numa janela
  bloqueada não aparece mais como "enviando" sem nada saindo.

## Hand-traces

**1. Teto diário estoura no meio de um disparo.** Item X é o próximo devido; claim marca
`SENT`; `sendOffer` → `whatsapp.checkQuota` lança `WhatsAppRetryableError`; `dispatch.ts`
marca a oferta `FAILED` e relança o mesmo erro. No catch do worker: item X volta a
`PENDING` (`sentAt: null`), oferta volta a `DISPATCHING`, cauda inteira (item X e tudo que
vem depois, ainda `PENDING`) é reagendada a partir de `agora + 30min` (ajustado por janela
bloqueada se aplicável), respeitando `intervalMinutes`. Disparo continua `SENDING` (nunca
tocado). Próximo tick (1min depois): nada devido pra este disparo (tudo na cauda foi
empurrado pra frente) — zero burn. ~30min depois: item X fica devido de novo; se ainda é o
mesmo dia UTC, `checkQuota` estoura de novo — mesmo ciclo se repete a cada ~30min até a
virada do dia. Na virada (novo `day` string em `sendLog`), `checkQuota` passa (`count` novo
começa em 0) e o envio segue normal.

**2. Restart logo depois que a mensagem saiu do Baileys, antes de qualquer outra coisa.**
Não é reenviado. O claim (`PENDING -> SENT`) é commitado no banco *antes* de `sendOffer` ser
sequer chamado — a chamada de rede (`sock.sendMessage`) acontece com o item já marcado
`SENT` no banco. Se o processo morre logo depois que a mensagem saiu (mesmo antes do
`prisma.sendLog.update` ou do `offer.update` pra SENT em `dispatch.ts`), o `DisparoItem` já
está `SENT` — a query `due` de `runDisparos` filtra `status: PENDING`, então esse item nunca
mais aparece pra reenvio. (Resíduo aceito e fora de escopo: a `Offer` pode ficar presa em
`DISPATCHING` se o `offer.update` pra SENT não rodou — inconsistência de exibição, não de
reenvio; é o mesmo tipo de gap que a tarefa marcou como "stats/overview" fora de escopo.)

**3. Cancelar durante o sleep de `waitInterval`.** Item X já está `SENT` (claimed) quando o
cancelamento roda — o `updateMany` do cancelamento (`where: status PENDING`) não o alcança.
Itens realmente `PENDING` (ainda não devidos ou aguardando o gate de pacing) viram `FAILED`
com motivo "Disparo cancelado", e as ofertas correspondentes (sem item `SENT` neste disparo)
voltam pra `PENDING`. Disparo vira `CANCELLED`. Quando o `waitInterval` termina:
- **Sucesso**: claim já tinha gravado `SENT`, nada mais a escrever pro item. `restam` (count
  de `PENDING`) é 0 (cancelamento já flipou tudo mais). `disparo.updateMany` guardado por
  `status in [DRAFT, SENDING]` não bate (já é `CANCELLED`) — fica `CANCELLED`. Estado final:
  item X `SENT`, oferta de X `SENT`, disparo `CANCELLED`, demais ofertas de volta na Fila.
- **Falha terminal**: item X `SENT -> FAILED` (update direto, seguro — nada mais toca um
  item já `SENT`). Mesma guarda no fim: disparo permanece `CANCELLED`. Estado final: item X
  `FAILED`, oferta de X `FAILED` (presa — ver gap residual do Item 7 acima, se essa oferta
  não tiver outro item `SENT`).

## Build

`npm run build` (raiz do worktree): `tsc -p tsconfig.json` (api) e `tsc -b && vite build`
(web) — ambos saíram com exit 0, sem erros de tipo.

## O que NÃO fechei (com motivo)

- **Oferta com múltiplos grupos: status flapping entre SENT/FAILED.** `dispatch.ts` seta o
  `status` da OFERTA (não do item) a cada chamada de `sendOffer` — se o mesmo item de oferta
  já tiver ido `SENT` pro grupo A e depois falhar (retryable ou não) pro grupo B, o status da
  oferta pode ser sobrescrito. Pré-existente, não introduzido por essas mudanças, e
  consertar direito exigiria não usar `Offer.status` pra representar estado por-grupo — fora
  do escopo pedido (mesma família dos itens marcados "pular": accounting/estatística
  agregada por oferta).
- **Cancel durante envio de multi-grupo da mesma oferta**: se a oferta tem item A em voo
  (SENT/claimed) e item B ainda PENDING pro mesmo `offerId`, cancelar reverte a oferta pra
  `PENDING` (Fila) via o item B, mesmo com o item A ainda em voo. Também herda do mesmo
  design de `Offer.status` único por oferta, não por item — fora de escopo.
