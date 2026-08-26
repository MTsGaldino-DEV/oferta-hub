# Aba Manual: revisão centralizada de garimpo por scan + sinal de aprendizado

Data: 2026-08-25
Status: aprovado para planejamento

## Contexto

Hoje a extensão (ML + Amazon, ver [[2026-08-25-extensao-multi-loja-design]])
já escaneia uma listagem inteira, deixa revisar com checkbox no painel
lateral, e manda pro Hub em `/api/extensao/produtos`. Esse endpoint cria a
oferta **direto em `PENDING`** (`source=MANUAL`) — cai misturada na Fila de
curadoria normal. Pra não embaralhar captura crua com fila já pontuada,
`offers.ts:74-94` tem um caso especial que fixa captura de ML no topo, fora
da ordem por nota.

Uso real do usuário: ele visita várias páginas de ofertas (relâmpago na
Shopee, Amazon, Mercado Livre), escaneia cada uma, e só DEPOIS quer decidir
oferta por oferta o que vale mandar — numa tela só, não em três painéis
laterais estreitos por loja. Além disso, quer que toda oferta que ele
escolher mandar fique registrada num lugar único, resistente ao tempo, pra
uma automação futura aprender que tipo de produto/palavra-chave ele
realmente escolhe.

## Decisões do usuário

- Aba nova "Manual" no app, separada da Fila: mostra as capturas cruas de
  extensão pra revisão final, uma por uma, com foto grande — não a Fila
  (que já é curadoria aprovada esperando agendamento).
- Shopee entra nesta rodada, mesmo com risco de seletor: sem página real pra
  inspecionar aqui, primeira versão provavelmente precisa de ajuste do
  usuário testando ao vivo. **Isso amenda, não reverte,** a decisão anterior
  de não raspar Shopee por DOM — aquela decisão era sobre BUSCA (a API
  oficial já cobre melhor); aqui o alvo é a página de "ofertas relâmpago",
  que a API GraphQL não expõe (só busca por palavra-chave/categoria,
  conferido em `connectors/shopee.ts`). Busca geral de Shopee continua só
  pela API, via Garimpar.
- Checkbox de revisão grosseira no painel lateral da extensão continua
  existindo (filtra lixo óbvio antes de sair do navegador); a decisão fina
  de "vale a pena" passa a acontecer só no app.
- Card da aba Manual reaproveita o `PriceTag` da Fila, nota visível incluída
  — não esconde a pontuação.
- Toda oferta **enviada ao grupo** (por qualquer caminho: botão da Fila,
  agendamento, worker de Disparos) grava uma linha permanente numa tabela
  dedicada — não basta o histórico solto em `Offer`, porque `Product` muda
  de preço com o tempo (monitor reescreve `currentPrice` a cada ciclo) e uma
  consulta futura via `Offer`/`Product` mostraria o preço de HOJE, não o que
  convenceu o envio.

## Arquitetura

```
extensão (scan ML/Amazon/Shopee)
  → checkbox no painel lateral (filtro grosso, já existe)
  → POST /api/extensao/produtos
  → Offer nasce em status=SCANNED, source=SCAN
       │
       ├─ aba Manual (status=SCANNED) ── "Descartar" ──► status=SKIPPED (fim)
       │                              └─ "Mandar pra fila" ──► status=PENDING
       │                                                         (Fila normal)
       └────────────────────────────────────────────────────────────┘
                                                                       │
                                                          Fila → Disparo → sendOffer()
                                                                       │
                                                          grava ManualSelection (snapshot)
```

## Modelo de dados

### `OfferStatus` — novo valor `SCANNED`

```prisma
enum OfferStatus {
  SCANNED     // capturado por scan de extensão, aguardando revisão na aba Manual
  PENDING
  QUEUED
  DISPATCHING
  SENT
  SKIPPED
  FAILED
}
```

`SCANNED` fica fora de tudo que já assume `PENDING` como "fila de
curadoria" — não entra em `/api/offers` (default `status=PENDING`), não
entra em `/api/offers/por-nicho`, não entra nas rotinas de limpeza de fila.

### `OfferSource` — novo valor `SCAN`

```prisma
enum OfferSource {
  MANUAL      // link colado a mão na Fila
  SCAN        // capturado por scan de extensão (ML/Amazon/Shopee)
  WATCHLIST
  DISCOVERY
}
```

Separar de `MANUAL` importa porque os dois têm proveniência diferente pro
aprendizado futuro: link colado a mão é decisão pontual sem contexto de
página; captura de scan carrega o contexto da campanha (ofertas relâmpago)
de onde veio.

### `ManualSelection` (tabela nova)

```prisma
/// Foto de toda oferta que chegou a ser ENVIADA ao grupo, capturada no
/// instante do envio. Existe pra sobreviver ao Product mudando de preço com
/// o tempo -- sem isso, consultar essa base depois mostraria o preço de
/// HOJE, nao o que convenceu o envio. Alimenta a automacao futura de
/// palavra-chave/categoria (nao construida nesta fase).
model ManualSelection {
  id            String      @id @default(cuid())
  offerId       String
  platform      Platform
  externalId    String
  title         String
  category      String?
  price         Decimal     @db.Decimal(12, 2)
  commissionPct Decimal?    @db.Decimal(6, 3)
  commissionBrl Decimal?    @db.Decimal(12, 2)
  source        OfferSource
  sentAt        DateTime    @default(now())

  offer Offer @relation(fields: [offerId], references: [id])

  @@index([platform])
  @@index([sentAt])
}
```

Sem `onDelete: Cascade` — `Offer` nunca é apagada no código atual
(confirmado: nenhum `prisma.offer.delete*` no repo), então o relacionamento
não precisa lidar com órfão. `model Offer` ganha o lado inverso da relação
(`manualSelections ManualSelection[]`), exigido pelo Prisma nos dois lados.

## Backend

### `services/ingest.ts`

`ingestProduct` (e o caminho que a extensão usa) passa a aceitar o status
inicial em vez de assumir `PENDING` sempre. Extensão chama com
`status: OfferStatus.SCANNED, source: OfferSource.SCAN`. Link colado a mão
na Fila (`ingestUrl`) continua `PENDING`/`MANUAL`, sem mudança de
comportamento.

### `routes/extensao.ts`

Troca `OfferSource.MANUAL` por `OfferSource.SCAN` na chamada de
`ingestProduct`, soma `status: OfferStatus.SCANNED`.

### `routes/offers.ts`

- **Remove** o caso especial de `offers.ts:74-94` (captura de ML fixada no
  topo). Sem sentido depois que captura de extensão para de nascer em
  `PENDING` — `/api/offers` volta a ser sempre ordenado por nota, sem
  bifurcação.
- **Endpoint novo** `POST /api/offers/:id/promover`: exige `status=SCANNED`,
  atualiza pra `PENDING`. Único jeito de uma oferta sair do `SCANNED` pro
  fluxo normal.
- **Descartar** reaproveita `POST /api/offers/:id/skip` já existente (seta
  `SKIPPED` incondicional de status de origem — funciona pra `SCANNED` sem
  mudança).
- `GET /api/offers?status=SCANNED` já funciona sem tocar a assinatura da
  rota (o tipo já aceita `OfferStatus` livre); só passa a ser um valor
  válido a mais.

### `services/dispatch.ts`

Dentro de `sendOffer()`, logo após `prisma.offer.update(... SENT ...)` ter
sucesso: grava um `ManualSelection` com os dados do `offer.product` no
instante do envio. Ponto único — cobre botão "Enviar ao grupo" da Fila,
agendamento (`schedule`), e o worker de Disparos, sem duplicar a gravação
em cada chamador.

## Frontend (`apps/web`)

- Rota/página nova `Manual.tsx`, entrada no menu lateral.
- Busca `GET /api/offers?status=SCANNED`, mesmo grid (`.shelf`) da Fila.
- Reaproveita `PriceTag`: prop de variante (`variante: 'fila' | 'manual'`)
  troca rótulo e ação dos dois botões —
  `Pular`/`Enviar ao grupo` (Fila) vira `Descartar`/`Mandar pra fila`
  (Manual). Sem editor de mensagem na aba Manual — a mensagem já foi
  montada no ingest; editar continua sendo coisa da Fila, depois que a
  oferta for promovida.
- Sem oferta `SCANNED`: estado vazio explicando que a lista enche quando a
  extensão manda uma captura.

## Extensão

### ML + Amazon

Sem mudança de comportamento pro usuário (captura, checkbox, "Enviar ao
Hub" continuam iguais). Só o destino no backend muda de `PENDING` pra
`SCANNED` — transparente pra extensão.

### Shopee (`content/shopee.js`, novo)

Mesmo padrão de `amazon.js`: usa `shared.js` (`lerPrecos`,
`extrairMelhorImagem`, `registrar`, `rolarAcumulando`, `montarWidget`).
Faltam, especificamente pra Shopee: extrair id do produto e URL canônica a
partir do link do card (padrão Shopee: `/product/<shopId>/<itemId>` ou
slug), e os seletores de preço/junk daquela página. **Sem acesso a uma
página real da Shopee neste ambiente** — primeira versão é uma tentativa
educada com base em atributos conhecidos, marcada como precisando de
validação ao vivo; se os seletores não baterem, o widget mostra "nenhum
produto encontrado" (falha visível, não silenciosa) e o ajuste é uma
segunda passada depois de inspecionar o DOM real.

Link de afiliado: diferente do ML, Shopee **não precisa mintar no
navegador** — `connectors/shopee.ts` já gera via GraphQL oficial
(`generateShortLink`) a partir do `canonicalUrl`/id, mesmo caminho que
Amazon já usa hoje. Content script só entrega dado bruto.

`manifest.json`: soma host_permissions e bloco de content_scripts pros
domínios `*.shopee.com.br`.

## Erros e casos de borda

- `POST /api/offers/:id/promover` numa oferta que não está `SCANNED`:
  rejeita (400) — evita promover algo que já saiu do estado esperado (ex.:
  clique duplo).
- Scan de Shopee sem produto reconhecido: mesma mensagem genérica de "nada
  encontrado" que ML/Amazon já usam — sem crash silencioso.
- `ManualSelection` gravada mesmo em reenvio (`allowResend`, disparo pra
  vários grupos): aceito — cada envio real é um sinal válido, não precisa
  dedupe aqui.

## O que não muda

- Fluxo de "colar link" na Fila (`ingestUrl`) — continua `PENDING`/`MANUAL`.
- Garimpar (busca Shopee via API) — inalterado, é o caminho de busca geral.
- Painel lateral da extensão — checkbox, "Enviar ao Hub", logs, tudo igual.
- `ManualSelection` é só gravação neste momento — nenhum leitor/consumidor
  (a automação de palavra-chave) é construído nesta fase. YAGNI: guardar o
  sinal certo agora, construir quem lê depois que houver volume pra
  justificar.

## Testes

- Backend: teste de rota confirmando que `/api/extensao/produtos` cria
  `SCANNED`/`SCAN` (não mais `PENDING`/`MANUAL`); teste de `promover`
  rejeitando origem que não é `SCANNED`; teste de `sendOffer` gravando
  `ManualSelection` com os valores esperados.
- `content/shopee.check.mjs` (mesmo padrão de `shared.check.mjs`): funções
  puras de extração de id/URL canônica, sem depender de DOM real.
- Verificação manual: aba Manual populada por uma captura real de ML/Amazon
  (fluxo velho, comportamento preservado); Shopee testado ao vivo pelo
  usuário, com iteração de seletor esperada como próximo passo se a
  primeira versão não capturar nada.
