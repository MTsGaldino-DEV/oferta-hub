# Garimpar — relatorio

## Arquivos alterados
- `apps/api/src/routes/garimpar.ts` (novo) — `GET /api/garimpar/produtos`
- `apps/api/src/server.ts` — registro de `garimparRoutes` (alfabetico, entre `extensaoAdminRoutes` e `groupRoutes`)
- `apps/web/src/pages/Garimpar.tsx` (novo)
- `apps/web/src/App.tsx` — rota `/garimpar`
- `apps/web/src/components/Layout.tsx` — item "Garimpar" no grupo Catalogo (primeiro, antes de Nichos)

## Build
- `npm run build --workspace=apps/api` — OK (tsc limpo)
- `npm run build --workspace=apps/web` — OK (`tsc -b && vite build`, sem erros)

## Decisoes nao explicitas no brief
- Destaque da categoria selecionada: sem classe CSS pronta pra "picked" dentro do `.catbox`, apliquei `style` inline (`background: rgba(22,23,26,.06)` + `fontWeight: 700`) direto no `.catbox__item` quando `categoriaId === f.id` — mesmo padrao de estilo inline ja usado em `Nichos.tsx`, sem tocar `styles.css`.
- Categoria selecionada virou `<div className="catbox__item" onClick=...>` em vez do `<label>` com checkbox que `Nichos.tsx` usa (aqui e single-select, nao multi-select).
- Arredondamento do desconto: `Math.round((1 - price/listPrice) * 100)`, mesmo estilo dos outros `%` da tela (sem casas decimais).
- Estado de carregamento: reaproveitei o bloco `.empty` pra mensagem "Buscando..." em vez de criar um spinner/classe nova.
- `sort` e `limit` na query da API sao validados com Zod (`categoryId` obrigatorio positivo, `sort` enum das 5 opcoes default `vendas`, `limit` 1-60 default 40) — erros de validacao caem no `setErrorHandler` global do Fastify (ZodError -> 400), entao a rota nao precisou de try/catch propria pra isso; o try/catch cobre so a chamada ao connector, como pedido.
- Nao toquei em `.superpowers/overnight-progress.md` nem nos `.diff` soltos em `.superpowers/reviews/` que ja estavam modificados/untracked no worktree antes desta tarefa — ficam de fora do commit.
