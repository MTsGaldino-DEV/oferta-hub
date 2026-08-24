# Disparos — relatório de implementação

## O que foi construído

**Schema** (`apps/api/prisma/schema.prisma`)
- `OfferStatus` ganhou `DISPATCHING` (reservada por um Disparo, fora da fila até terminar/cancelar).
- Dois modelos novos: `Disparo` (status `DisparoStatus`: DRAFT/SENDING/DONE/CANCELLED; grupos alvo; template; `startAt`; `intervalMinutes`; três guardas: `avoidNightHours`, `avoidWeekends`, `skipExpiredOffers`) e `DisparoItem` (par oferta×grupo; status `DisparoItemStatus`: PENDING/SENT/FAILED; `scheduledFor`/`sentAt`/`failReason`; índices `[status, scheduledFor]` e `[disparoId]`).
- Back-relations obrigatórias do Prisma: `Offer.disparoItems` e `MessageTemplate.disparos`.
- `npx prisma generate` rodado com sucesso (client regenerado, **nenhuma conexão ao banco**).

**Serviço** `apps/api/src/services/disparo.ts`
- `criarDisparo`: valida que todas as ofertas ainda estão `PENDING` e o template existe; monta os pares (oferta × grupo) na ordem "para cada oferta, todos os grupos"; cria o `Disparo` + `DisparoItem`s e already reserva as ofertas (`PENDING` → `DISPATCHING`) numa única transação.
- `cancelarDisparo`: marca itens `PENDING` como `FAILED` ("Disparo cancelado."), devolve à `PENDING` só as ofertas que ainda estavam `DISPATCHING`, marca o disparo `CANCELLED`.
- `runDisparos`: worker chamado pelo cron a cada minuto — ver seção própria abaixo.
- Guarda de horário (`bloqueado`) e adiamento (`proximoLiberado`, `adiar`) — ver seção de adiamento.

**Rotas** `apps/api/src/routes/disparos.ts`, registradas no bloco autenticado de `server.ts`
- `POST /api/disparos` — cria (Zod valida `intervalMinutes >= 5`, listas não vazias, `startNow` ou `scheduledFor`).
- `GET /api/disparos` — lista com progresso calculado (total/enviados/falharam/pendentes/estimativa de término).
- `GET /api/disparos/:id` — um disparo com todos os itens (oferta, grupo, status, horário).
- `POST /api/disparos/:id/cancelar`.

**Worker** — `apps/api/src/workers/index.ts` ganhou `cron.schedule('*/1 * * * *', () => void runDisparos(), ...)`, no mesmo ritmo do agendador existente.

**Frontend** `apps/web/src/pages/Disparos.tsx`, roteado em `/disparos`, no grupo "Automação" do nav (ao lado de Automações).
- Duas abas: "Novo disparo" (wizard de 3 passos com indicador visual) e "Em andamento".
- Passo 1 (Ofertas): lista `PENDING` da Fila, todas marcadas por padrão, contador, marcar/desmarcar todas.
- Passo 2 (Mensagem): escolha de template **obrigatória, sem pré-seleção** (não usa `isDefault`), pré-visualização via `POST /api/templates/preview` (reaproveitado, sem duplicar lógica de render no browser).
- Passo 3 (Destinos): grupos multi-select (nenhum marcado por padrão), Agora/Agendar, intervalo (mínimo e padrão 5), as três guardas, resumo "N ofertas × M grupos = X envios" + previsão de término.
- "Em andamento": status, grupos, barra de progresso, "X/Y envios · Z%", previsão de término, botão Cancelar com `confirm()` (mesmo padrão do "Limpar fila" da Fila), clique no card expande a lista de itens (usa o `GET /:id`).
- CSS novo em `apps/web/src/styles.css`: `.steps`/`.steps__*` (indicador de passos) e `.progress`/`.progress__bar` (barra de progresso) — nenhum equivalente existia. Ajuste de modo escuro espelhando o padrão já usado em `.btn`/`.tabs__item` (fundo preso em tom escuro fixo, porque `--ink` vira texto claro no dark).

## Conflito do `sendOffer` já-SENT em multi-grupo — solução

`sendOffer(offerId, groupJid)` bloqueava qualquer reenvio de oferta `SENT`. Um disparo manda a MESMA oferta pra vários grupos em sequência — o primeiro envio já marca `SENT`, então o segundo grupo bateria nesse guard.

**Solução**: acrescentei um terceiro parâmetro opcional `options?: { message?: string; allowResend?: boolean }` a `sendOffer`. O guard virou `if (offer.status === SENT && !options?.allowResend) throw ...`. O worker de Disparos é o único chamador que passa `allowResend: true`. `message` sobrepõe o texto enviado ao WhatsApp sem tocar no campo `Offer.message` gravado (que continua sendo o texto do fluxo manual da Fila) — é o texto renderizado pelo template do disparo, com CTA sorteada por item.

**Por que não quebra o fluxo manual**: o botão "Enviar ao grupo" da Fila (`routes/offers.ts`) e o agendador (`runScheduler`) continuam chamando `sendOffer(id, groupJid)` com dois argumentos — `options` fica `undefined`, `allowResend` fica falsy, o guard se comporta exatamente como antes. `executarRodada` (Automações) também não muda. É uma mudança puramente aditiva.

**Efeito colateral aceito**: depois do segundo envio (2º grupo), `Offer.groupJid`/`sentAt` passam a refletir o *último* grupo enviado, não uma lista — é um comportamento pré-existente do campo (ele sempre foi singular). O histórico por grupo de verdade mora no `DisparoItem` (que tem seu próprio `groupJid`/`sentAt`/`status`), que é a fonte de verdade pra progresso do disparo. Não achei necessidade de dar a `Offer` um histórico multi-grupo — seria escopo não pedido.

## `OfferStatus.` — toda ocorrência conferida, e o que mudou

Grep por `OfferStatus\.` (mais o literal `'PENDING'|'QUEUED'` da extensão, que não usa o enum importado) cobriu:

| Local | Uso | DISPATCHING vaza? | Ação |
|---|---|---|---|
| `workers/index.ts:184` `runScheduler` | `where status=QUEUED` | Não — `DISPATCHING ≠ QUEUED`, exatamente a garantia pedida | nenhuma |
| `workers/index.ts:151` `runDiscovery` (dedup por produto) | `OR: [{status in [PENDING,QUEUED]}, {sentAt recente}]` | Sim, por omissão — um produto em disparo (ainda não enviado) não bloqueava recaptura, criando oferta duplicada pro mesmo produto no meio de um disparo | **adicionei `DISPATCHING` na lista `in`** |
| `routes/extensao.ts:122` (dedup da extensão) | mesma lógica, literais `'PENDING'`/`'QUEUED'` | Mesmo caso do garimpo, mesma causa | **adicionei `'DISPATCHING'`** |
| `routes/offers.ts` (GET /api/offers, todas as variações) | filtro por `status` explícito (default `PENDING`) | Não — não é filtro "não-X", é `status === PENDING` literal | nenhuma |
| `routes/offers.ts:145` limpar-duplicados | `where status=PENDING` | Não — exclusão correta, uma oferta em disparo não deveria ser recolapsada por dedup manual | nenhuma |
| `routes/offers.ts:188` limpar-fila | `where status=PENDING (+nicheId)` | Não — é exatamente por isso que `DISPATCHING` precisa ser distinto de `PENDING`: "Limpar fila" não pode arrastar oferta comprometida com um disparo em andamento | nenhuma |
| `routes/offers.ts:301` `/schedule` | seta status arbitrário pra `QUEUED` por id | Risco teórico pré-existente (endpoint aceita qualquer id, sem checar status atual) — mas a Agenda só lista ofertas `PENDING`, então não é alcançável pelo fluxo normal; não é uma regressão introduzida agora | nenhuma (fora de escopo) |
| `services/dispatch.ts:22` `sendOffer` guard | `status === SENT` | É o ponto que resolvi acima, não é "vazamento" | ver seção anterior |
| `services/automacoes.ts:56` elegibilidade de automação | `where status=PENDING` | Não — e é um efeito **desejado**: uma oferta reservada por disparo não pode ser pega por uma automação ao mesmo tempo | nenhuma (funciona certo de graça) |
| `services/automacoes.ts:50`, `routes/offers.ts:129`, `routes/stats.ts` (todas), `services/scoring.ts:97` | todos filtram só por `SENT` | Não | nenhuma |

Resumo: só as duas rotinas de **deduplicação por produto** (garimpo automático e captura da extensão) precisavam enxergar `DISPATCHING` como "já ativo" — ambas corrigidas. Todo o resto ou já filtra por um status exato que não é `DISPATCHING`, ou se beneficia automaticamente de `DISPATCHING` ser diferente de `PENDING`.

## Semântica de adiamento (guarda de horário) — por que não vira rajada

Quando o worker acha um item vencido mas o instante atual cai numa janela bloqueada (23h–06h e/ou fim de semana, conforme os toggles do disparo), ele **desliza a cauda inteira**, não só o item: busca todos os `DisparoItem` `PENDING` daquele disparo com `scheduledFor >= ` o do item atual (ou seja, ele mesmo e todo o resto que ainda não foi enviado), acha o próximo instante livre andando minuto a minuto (`proximoLiberado`), e reatribui `scheduledFor = proximoLivre + i·intervalo` pra cada um, preservando o espaçamento configurado.

A alternativa óbvia — só adiar o item bloqueado pro instante em que a janela reabre e deixar os outros com o horário original — quebra: como a janela bloqueada emperra *todos* os itens da cauda ao mesmo tempo (todos com `scheduledFor` no passado quando o worker olha de novo), no instante em que a janela reabre eles apareceriam **todos vencidos ao mesmo tempo**, e o worker os despacharia um atrás do outro a cada tick de 1 minuto — exatamente a rajada que o intervalo mínimo de 5 minutos existe pra proibir. Deslizando a cauda inteira de uma vez, o espaçamento nunca comprime: ele só se desloca no tempo.

## Reentrância do worker

`runDisparos` usa uma trava booleana em memória de processo (`let rodando`). Sem ela, duas rodadas do cron sobrepostas (só acontece se um envio de um tick anterior ainda não tivesse terminado quando o próximo tick de 1 minuto disparasse) poderiam ler o mesmo `DisparoItem` `PENDING` antes de qualquer uma marcá-lo `SENT`/`FAILED`, e as duas chamariam `sendOffer` pro mesmo par (oferta, grupo) — mensagem duplicada de verdade.

Isso é **mais estrito** que o `runScheduler` existente, que não tem nenhuma trava (documentado no código: `whatsapp.sendOffer` já serializa o envio real por baixo com um lock próprio, então o pior que acontece hoje sem trava é dois ticks brigarem pela mesma oferta QUEUED — preexistente, não mexi). Optei por adicionar a trava no worker novo porque aqui a consequência de uma corrida (mensagem duplicada) é mais visível e mais fácil de acontecer (uma janela de bloqueio reaberta pode deixar vários itens vencidos ao mesmo tempo, aumentando a chance de dois ticks pegarem trabalho sobreposto).

`ponytail`: a trava só funciona com uma instância da API rodando (é o caso hoje — Docker Compose sobe um container só). Com mais de um processo, precisaria de lock no banco (ex.: `SELECT ... FOR UPDATE SKIP LOCKED` ou uma tabela de lock).

## Três hand-traces

### 1) 2 ofertas (A, B) × 2 grupos (G1, G2), intervalo 5 min, "Agora" às 10:00

Ordem de criação: para cada oferta, todos os grupos → A-G1, A-G2, B-G1, B-G2.

| item | par | scheduledFor |
|---|---|---|
| 1 | A→G1 | 10:00 |
| 2 | A→G2 | 10:05 |
| 3 | B→G1 | 10:10 |
| 4 | B→G2 | 10:15 |

`disparo.status` nasce `SENDING` (é "Agora"). O worker manda um item por tick conforme cada `scheduledFor` vence — nunca dois no mesmo minuto. Total do lote: 4 envios em 15 minutos (fórmula: `(total-1) × intervalo`), consistente com o exemplo do enunciado (8×2 = 16 envios em ~80 min = 15×5).

### 2) Mesmo lote, item 3 caindo em 23:30 com a guarda de noite ligada

Ajustando só o horário de início pra ilustrar (intervalo 35 min, início 22:20, `avoidNightHours=true`):

| item | par | scheduledFor original | resultado |
|---|---|---|---|
| 1 | A→G1 | 22:20 | enviado normalmente (antes das 23h) |
| 2 | A→G2 | 22:55 | enviado normalmente (antes das 23h) |
| 3 | B→G1 | **23:30** | **bloqueado** (hora ≥ 23) → `adiar()` |
| 4 | B→G2 | 00:05 (dia seguinte) | também estava na cauda pendente → recalculado junto |

Quando o worker chega no item 3 e vê que agora (23:30) está na janela bloqueada, ele busca a cauda `PENDING` com `scheduledFor >= 23:30` (itens 3 e 4 — 1 e 2 já são `SENT`, saem do filtro), acha o próximo horário livre (`proximoLiberado` anda minuto a minuto até `06:00` do dia seguinte) e reescreve:

| item | novo scheduledFor |
|---|---|
| 3 (B→G1) | **06:00 do dia seguinte** |
| 4 (B→G2) | **06:35 do dia seguinte** (06:00 + 35 min, intervalo preservado) |

Os itens 1 e 2 continuam `SENT`, intocados. Nenhum item vence "atrasado em lote" às 06:00 — só o 3 vence primeiro, o 4 continua 35 min depois dele.

### 3) Cancelar depois de 1 de 4 itens enviados

Usando o lote do trace 1 (A-G1, A-G2, B-G1, B-G2). Suponha que só o item 1 (A→G1, 10:00) já foi enviado quando o usuário clica em Cancelar; itens 2, 3, 4 seguem `PENDING`.

`cancelarDisparo`:
1. `pendentes` = itens 2, 3, 4. `offerIds` únicos entre eles = `{A, B}` (A aparece no item 2, B nos itens 3 e 4).
2. Todos os itens `PENDING` (2, 3, 4) viram `FAILED`, `failReason = "Disparo cancelado."`. Item 1 continua `SENT`, intocado.
3. `offer.updateMany({ id in [A,B], status: DISPATCHING } -> PENDING)`:
   - Oferta **A** já está `SENT` (o `sendOffer` do item 1 já a marcou assim) — **não bate** o filtro `status: DISPATCHING`, fica `SENT` (não volta pra Fila).
   - Oferta **B** nunca foi enviada, ainda está `DISPATCHING` — **bate** o filtro, volta pra `PENDING` (reaparece na Fila).
4. `disparo.status = CANCELLED`, `cancelledAt = agora`.

**Estado final:**
- Disparo: `CANCELLED`.
- Item 1 (A→G1): `SENT` (inalterado).
- Itens 2, 3, 4: `FAILED`, `failReason = "Disparo cancelado."`.
- Oferta A: `SENT`, `groupJid = G1`, `sentAt` do envio que já saiu — **não** volta pra Fila.
- Oferta B: `PENDING` — volta pra Fila, nunca foi enviada.

Esse resultado sai puro do filtro `status: DISPATCHING` na hora de reverter — não precisei nenhuma lógica extra pra distinguir "oferta parcialmente enviada" de "oferta nunca enviada": o próprio `sendOffer` já fez essa distinção ao marcar `SENT` no primeiro envio bem-sucedido.

## Build

```
npm run build   (raiz)
  apps/api  tsc -p tsconfig.json           → exit 0
  apps/web  tsc -b && vite build           → exit 0 (dist gerado, 246 KB JS / 18 KB CSS)
```

`npx prisma generate` rodado antes, sem erros, sem conexão ao banco.

## Arquivos alterados/criados

Alterados:
- `apps/api/prisma/schema.prisma`
- `apps/api/src/services/dispatch.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/routes/extensao.ts`
- `apps/api/src/server.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/components/Layout.tsx`
- `apps/web/src/styles.css`

Criados:
- `apps/api/src/services/disparo.ts`
- `apps/api/src/routes/disparos.ts`
- `apps/web/src/pages/Disparos.tsx`

## Autorrevisão — achados e ressalvas

- **Corrida cancelar × worker em processamento**: se o usuário clicar em Cancelar no exato intervalo em que `runDisparos` já leu um item `PENDING` na memória e está no meio de `sendOffer` (que pode levar dezenas de segundos por causa do intervalo mínimo do WhatsApp), a mensagem ainda sai pelo WhatsApp mesmo depois do cancelamento ter marcado o item como `FAILED`/a oferta como `PENDING` — o `update` final do worker sobrescreveria pra `SENT` depois. É uma janela pequena e de baixa probabilidade (exige clique de cancelar bem no segundo em que um tick já está em voo), efeito é só de contabilidade (o item mostraria `SENT` num disparo `CANCELLED`, não uma mensagem inesperada em duplicidade) — não implementei um lock cruzado pra isso; deixo registrado como limitação conhecida.
- **`/api/offers/:id/schedule` e `/skip` aceitam qualquer id/status** (pré-existente, não é regressão do `DISPATCHING`): tecnicamente dá pra chamar a API crua num id `DISPATCHING` e forçar `QUEUED` ou `SKIPPED`, escapando do controle do disparo. Não é alcançável pela UI (Agenda e Fila só listam `PENDING`), e o mesmo "problema" já existia pra qualquer status antes desta mudança — não mexi.
- Não toquei em `routes/stats.ts` nem na Visão Geral: ofertas `DISPATCHING` não aparecem no KPI "pendentes" nem em nenhum outro — ficam temporariamente "invisíveis" nos números gerais enquanto o disparo roda. Achei a semântica certa (não estão mais esperando decisão), e não foi pedido um KPI novo pra Disparos.
- `intervalMinutes` só tem piso (5), sem teto — igual ao padrão do restante do projeto (ex.: `AutomationRule.intervalMinutes` também só tem piso descrito como regra de negócio).

## Schema NÃO aplicado

**A migration não foi aplicada ao banco.** Rodei apenas `npx prisma generate` (regenera o client TypeScript, não conecta no banco). O controller precisa revisar `apps/api/prisma/schema.prisma` e rodar `db:push`/`migrate` conforme o processo do projeto.
