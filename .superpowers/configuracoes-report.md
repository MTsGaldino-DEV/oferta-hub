# Configurações: fusão de Conexões + Templates em abas

## Arquivos alterados
- `apps/web/src/pages/Configuracoes.tsx` (novo) — estado local `tab`, barra `.tabs` com dois `.tabs__item` ("Conexões" / "Modelos de mensagem"), renderiza `<Conexoes />` ou `<Templates />` sem alterar nada dentro delas.
- `apps/web/src/App.tsx` — trocou os imports de `Templates`/`Conexoes` por `Configuracoes`; removeu as rotas `/templates` e `/conexoes`; adicionou `/configuracoes`.
- `apps/web/src/components/Layout.tsx` — grupo "Automação" perdeu o item `Modelos` (`/templates`); grupo "Configurações" agora aponta pra `/configuracoes` com label "Configurações" (antes era "Conexões" → `/conexoes`).

## Build
`npm run build --workspace=apps/web` (tsc -b && vite build) — passou, exit 0, sem erros de tipo.

## Decisões/observações não explícitas no pedido
- O label do item de nav em "Configurações" foi trocado de "Conexões" para "Configurações", já que a página agora cobre conexões + modelos, não só conexões. A task não especificou o texto do label, só a rota; achei a troca óbvia dado o novo escopo da página.
- `Conexoes.tsx` e `Templates.tsx` não foram tocados — seus `export function` continuam iguais, cada um ainda renderiza seu próprio `<div className="head">` com h1/subtítulo, agora abaixo da barra de abas.
- Grep confirmou que não sobrou nenhuma referência a `/templates` ou `/conexoes` como rota em `apps/web/src` (chamadas a `/api/templates` e `/api/platforms` em `Disparos.tsx`/`Templates.tsx`/`Conexoes.tsx` foram preservadas, são endpoints de API, não rotas de página).
