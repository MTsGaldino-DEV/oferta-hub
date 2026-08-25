# Extensão multi-loja: extração robusta + widget on-page

Data: 2026-08-25
Status: aprovado para planejamento

## Contexto

A extensão hoje (`extensao/`) só captura Mercado Livre. O usuário comparou com
a GarimpaLinks Connect, extensão concorrente que cobre ML, Amazon, Shopee e
Magalu, tem um widget flutuante bem mais trabalhado on-page, e tem uma
extração de card sensivelmente mais robusta (recuperação de campo incompleto
por retry, escolha de melhor imagem, tratamento de preço por papel em vez de
por classe/tamanho).

Levantamento no backend (`apps/api`) mudou o escopo do que precisa ser
construído: `ingestProduct()` (`src/services/ingest.ts:143`) já monta o link
de afiliado **no servidor**, por conector, quando a extensão não manda um
pronto:

- `connectors/amazon.ts` reescreve a URL com `tag=` da credencial salva —
  puro server-side, já pronto.
- `connectors/shopee.ts` chama a API GraphQL oficial da Shopee
  (`generateShortLink`) — server-side, oficial, já pronto.
- `connectors/mercadolivre.ts` só monta o `matt_tool` fraco; o link forte
  continua vindo da extensão via `linkPronto` (sessão do navegador é
  obrigatória pro ML, isso não muda).
- Magalu não existe: nem `Platform.MAGALU` no enum, nem `connectors/magalu.ts`.

Consequência: para Amazon e Shopee a extensão **não precisa mintar nada
client-side** — só captura e manda os dados brutos; o servidor gera o link de
afiliado sozinho, contanto que a credencial (`partnerTag` / API key) esteja
configurada no admin. Hoje elas **não estão** configuradas — isso é tarefa do
usuário no painel, fora do escopo desta implementação.

**Risco conhecido, não resolvido por esta spec:** a concorrente mediu, em
produção, que a extração por DOM da Shopee é sensivelmente pior que a leitura
feita pelo próprio servidor deles a partir da URL (imagem: 48,5% vs 100%;
título sujo: 71,7% vs 0%) — por isso ela nunca manda Shopee direto, só copia
link. Nós não temos um "buscar pela URL" server-side pra Shopee além do
`generateShortLink` (que só gera o link, não busca metadado de produto). As
melhorias de `shared.js` (melhor imagem, retry-até-completar) devem reduzir
esse gap, mas não necessariamente fecham — a verificação manual da Fase 1
inclui checar a qualidade real dos dados de Shopee antes de considerar essa
loja pronta pra uso sério.

## Decisões do usuário

- Expandir para Amazon, Shopee e Magalu, além de Mercado Livre.
- **Manter a revisão manual com checkbox no side panel** para todas as lojas —
  não adotar o modelo de envio direto da concorrente. Só a etapa de
  *captura/trigger* on-page muda de aparência; enviar continua sendo uma ação
  explícita do usuário depois de revisar.
- Estrutura de código: **Abordagem B** — um módulo de helpers compartilhado
  (`content/shared.js`) com a lógica boa (preço por papel, melhor imagem,
  retry-até-completar, autoscroll) + um arquivo por loja
  (`content/{ml,amazon,shopee,magalu}.js`) só com os seletores e o que é
  específico daquela loja. Evita duplicar a lógica de preço/imagem quatro
  vezes (o que aconteceria copiando o arquivo único da concorrente).
- Ordem de entrega: **Fase 1** = Mercado Livre (refatorado) + Amazon + Shopee
  — infraestrutura de link de afiliado já existe nas três. **Fase 2** =
  Magalu — precisa de migration + conector novos.
- Paleta da extensão continua clara/amarela, nunca a dark+dourado da
  concorrente — mesma decisão já tomada para `apps/web`
  ([[feedback-frontend-brand-yellow]]), estendida aqui por consistência de
  marca entre o app e a extensão.

## Arquitetura

### `content/shared.js` — o que sai da extração de cada loja

Funções puras e utilitários de DOM reaproveitados pelas 4 lojas:

- **`lerPrecos(raiz)`** — separa preço atual do preço "de" por **papel**, não
  por tamanho do número: ignora parcela (`RUIDO_DE_PRECO` + heurística "começa
  com `Nx`"), ignora preço por unidade de medida (regra nova, vinda do bug
  documentado da concorrente: `R$ 243 / 105ml` não pode virar "preço R$ 2,31").
  Riscado é lido por classe conhecida quando existe; sem classe estável (caso
  Shopee), cai no fallback por `getComputedStyle().textDecorationLine ===
  'line-through'`, escopado a poucos elementos com "R$" no texto pra não pagar
  o custo em todo o card.
- **`extrairMelhorImagem(cardEl)`** — não pega a primeira `<img>`: prioriza
  quem veio de `data-src` (lazy-load real, banner carregado não é lazy);
  empate, fica com a de maior área renderizada. Normaliza foto da Amazon pro
  padrão de catálogo (`_SL1600_`) preservando a extensão original.
  Amazon-específico, mas vive aqui porque a função é genérica; o `if`
  de normalização só dispara quando a URL bate o padrão da Amazon.
- **`registrar(acc, id, dadosParciais)`** — Map com **completar em vez de
  congelar**: cada nova leitura do mesmo card preenche só o que falta, sem
  sobrescrever campo que já veio bom. Teto de releituras por id (mesmo
  `MAX_RELEITURAS = 6` já usado no hub) pra não custar infinito em card que
  nunca completa (ex.: Shopee, que não carrega preço/imagem em alguns casos).
- **`rolarAcumulando(alvo, extrairDaPagina, opções)`** — autoscroll genérico:
  rola, chama o extrator específico da loja a cada N frames, para no fundo da
  página ou depois de M passos sem novo produto. Generaliza o que já existe
  em `content/ml.js` (hoje só usado no hub) pra servir também listagem comum.
  Inclui a remontagem de host órfão que a concorrente documentou (Amazon
  re-renderiza a grade durante o scroll e derruba nós desanexados) —
  `MutationObserver` no body + no `documentElement`, reataching o mesmo
  elemento (preserva estado) em vez de recriar.
- **`montarWidget(config)`** — widget Shadow DOM (`mode: "closed"`)
  compartilhado por todas as lojas: badge da loja detectada (favicon da
  própria página), botão "Capturar", contador durante o scroll, e mensagem
  final ("N produtos prontos — abra o painel lateral"). **Não envia nada
  sozinho** — só chama `chrome.storage.local.set({ captura_pendente })`,
  igual ao mecanismo atual dos botões do hub. Paleta: reaproveita os tokens
  que já existem pro app (`--brand` amarelo, `--ink`, `--muted`) — não os
  tokens dark/dourado da concorrente.

### `content/{ml,amazon,shopee}.js` (Fase 1) — o que muda por loja

Cada arquivo só declara:

- `detect()` → nome da loja + seletor de card + seletores de junk (header,
  footer, recomendados, patrocinado) — mesmo papel do `JUNK`/`CARD_SELECTORS`
  da concorrente, mas por arquivo em vez de mapa central.
- `extrairId(href)` — regex específico da loja (ML já existe em
  `resolverUrlMl`; Amazon usa `/dp/` ou `/gp/product/`; Shopee usa
  `-i\.(\d+)\.(\d+)` ou `/product/(\d+)/(\d+)`).
- `extrairTitulo(cardEl)` quando a heurística padrão (heading/aria-label) não
  bastar — só a Amazon precisa da heurística extra (título no `alt` da
  imagem, ver comentário original sobre os dois layouts da Amazon).
- Chama `shared.montarWidget(...)` com esses três itens.

`content/ml.js` existente é **refatorado**, não reescrito do zero: PDP e o
scan do hub continuam como estão (já funcionam e têm hardening específico
documentado), só passam a usar `lerPrecos`/`extrairMelhorImagem`/`registrar`
de `shared.js` em vez da versão local duplicada.

Amazon e Shopee **não têm mint client-side** — o arquivo captura, empacota
`{ platform, externalId, title, canonicalUrl, imageUrl, price, listPrice }` e
manda direto pro service worker existente (`tipo: 'capturar'`), que já chama
`/api/extensao/produtos` sem `affiliateUrl`; o conector do servidor gera o
link sozinho.

### `manifest.json`

- `host_permissions`: soma `*://*.amazon.com.br/*`, `*://*.shopee.com.br/*`
  (Fase 2 soma Magalu).
- `content_scripts`: um único bloco cobrindo os hosts das lojas ativas na
  fase, `js: ["content/shared.js", "content/ml.js", "content/amazon.js",
  "content/shopee.js"]`. Cada arquivo se auto-guarda checando se a própria
  loja foi detectada (mesmo padrão da concorrente) — carregar os 4 em todo
  domínio é barato (arquivos pequenos, sem rede) e evita manter 4 blocos de
  manifest sincronizados.

### `ui/panel.js` e `ui/panel.html` — generalizar pra multi-loja

- `ehPaginaMl(url)` vira `ehPaginaSuportada(url)`, testando os hosts das 4
  lojas.
- Card de item na lista ganha um selo pequeno com o nome da loja
  (`produto.platform`), porque a lista pode ter itens de origens diferentes
  se o usuário navegar entre abas antes de enviar.
- Mensagem de "fora da loja" fica genérica ("Abra uma página de Mercado
  Livre, Amazon, Shopee ou Magalu nesta aba").
- Resto do fluxo (checkbox, marcar todos, enviar, logs) não muda — já é
  agnóstico de loja porque só lê `produto.*`.

### Backend — Fase 2 (Magalu)

- Migration Prisma: `MAGALU` no enum `Platform`.
- `connectors/magalu.ts` novo: `buildAffiliateLink` reescreve a URL pro
  storefront Magazine Você com o slug do usuário — mesma regra client-side
  que a concorrente usa (`magazineluiza.com.br/X` →
  `magazinevoce.com.br/<slug>/X`), só que rodando no servidor com a
  credencial salva em vez de no navegador. Sem API externa, sem sessão.
- `connectors/index.ts`: registra o novo conector no mapa `connectors`.
- `connectors/credentials.ts`: novo campo de credencial (`slug`, label "Loja
  Magazine Você", não-secreto — mesmo padrão do `partnerTag` da Amazon).
- `content/magalu.js`: mesmo modelo dos outros arquivos de loja.

## O que não muda

- `apps/web` não é tocado por esta spec.
- Fluxo de revisão manual (checkbox → "Enviar ao Hub") continua igual, agora
  pras 4 lojas.
- Mint client-side do ML (`service-worker.js`, `gerarLinkNaPagina`) não muda —
  já funciona e é a única loja que exige sessão do navegador.
- Paleta clara/amarela da extensão; não se copia o tema dark/dourado da
  concorrente, só a estrutura (widget flutuante, badge de loja, retry de
  extração).
- `lib/log.js` e o mecanismo de logs no side panel não mudam.

## Erros e casos de borda

- Amazon/Shopee sem credencial configurada no admin: `buildAffiliateLink`
  lança, o item cai em `falhas` na resposta de `/api/extensao/produtos`
  (comportamento já existente, por item — não derruba o lote). O side panel
  mostra quantos falharam; a mensagem de erro chega ao console (mesmo padrão
  de `avisoLink` hoje).
- Card sem preço nem imagem depois de `MAX_RELEITURAS` tentativas: entra
  mesmo assim com os campos que tiver — front do painel já trata campo
  ausente (não mostra o `<span>` de preço se não tiver).
- Amazon remonta a grade durante o autoscroll: `shared.js` reataching de host
  órfão evita o widget sumir em silêncio (bug medido e documentado pela
  concorrente).
- Extensão recarregada com aba já aberta ("context invalidated"): mesma
  mensagem já tratada em `ml.js` hoje, generalizada pro shared.
- Loja sem produto na página (ex.: home, carrinho): widget mostra "nenhum
  produto encontrado", nada é guardado.
- Página de loja sem loja suportada nos 4 domínios: content script nem monta
  (guard de `detect()` em cada arquivo).

## Testes

- Não há bundler/CI configurado pra `extensao/` (JS puro, Manifest V3) — sem
  build automatizado pra rodar.
- Funções puras de `shared.js` que não dependem de DOM real
  (`parsePrecoBR`, `extrairId` de cada loja, escolha de melhor imagem dado um
  array de candidatos já resolvidos) ganham um `content/shared.check.mjs`
  rodável via `node` puro, sem dependência nova — cobre: preço BR com/sem
  milhar, parcela descartada, preço-por-unidade descartado, riscado menor
  que atual descartado, escolha de imagem por prioridade `data-src` e por
  maior área.
- Verificação manual por loja (Fase 1: ML, Amazon, Shopee): abrir uma busca
  e uma página de produto de cada, clicar capturar, conferir no side panel
  que título/preço/imagem vieram certos e que o envio cria oferta na fila
  (ou cai em `falhas` de forma legível, se a credencial ainda não estiver
  configurada).
- Fase 2: migration aplicada (`npm run db:push`), `connectors/magalu.ts`
  testado com uma URL de exemplo (`magazineluiza.com.br` → storefront correto
  com slug fake).
