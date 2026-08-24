# Redesign estrutural: sidebar agrupada, card de status, hero na Fila

## Contexto

Referência visual: Garimpa Links (concorrente direto, mesmo nicho de garimpo
de ofertas), inspecionado ao vivo via chrome-devtools MCP em
`app.garimpalinks.com.br/visao-geral`. Usa tema dark, sidebar com nav
agrupada em seções, card de usuário no rodapé da sidebar, e um card de ação
principal em destaque no topo do dashboard.

Nosso frontend (`apps/web`) tem identidade própria e deliberada — tema claro,
motivo de "etiqueta de gôndola" documentado em `styles.css` (recorte
tracejado, furo, adesivo torto). Decisão: manter essa identidade, adotar só
os três padrões **estruturais** do concorrente, reimplementados com nossos
tokens visuais (`--brand`, `--ink`, `--muted`, `--line`, fontes Archivo/mono).

Sem pivô pra dark mode, sem novos componentes reutilizáveis (cada padrão é
usado uma vez só no código atual — extrair componente seria abstração
prematura).

## Escopo

Arquivos tocados: `apps/web/src/components/Layout.tsx`,
`apps/web/src/pages/Fila.tsx`, `apps/web/src/styles.css`. Nenhuma mudança de
API, schema ou lógica de negócio — é reorganização visual/estrutural sobre
dados que já existem.

## 1. Sidebar em seções

`LINKS` (hoje array plano de 7 itens) vira array de grupos:

```ts
const GROUPS: { label: string | null; items: typeof LINKS }[] = [
  { label: null, items: [{ to: '/', label: 'Fila', end: true }] },
  { label: 'Catálogo', items: [
    { to: '/nichos', label: 'Nichos' },
    { to: '/produtos', label: 'Preços vigiados' },
  ]},
  { label: 'Automação', items: [
    { to: '/agenda', label: 'Agenda' },
    { to: '/automacoes', label: 'Automações' },
  ]},
  { label: 'Métricas', items: [{ to: '/desempenho', label: 'Desempenho' }] },
  { label: 'Configurações', items: [{ to: '/conexoes', label: 'Conexões' }] },
];
```

`.rail__nav` passa a mapear grupos em vez de links direto; grupo sem `label`
não renderiza cabeçalho (caso da Fila, que fica solta no topo como entrada
principal — igual ao "Visão geral" da referência).

CSS novo: `.rail__group + .rail__group { margin-top: 14px }` e
`.rail__group-label` (uppercase, 11px, `--muted`, `letter-spacing: 0.07em`,
padding `0 10px`, margin-bottom 4px) — mesmo padrão visual já usado em
`.panel__title`, só que na sidebar escura (cor ajustada pra
`rgba(255,255,255,.4)` em vez de `--muted`, que é pensado pro fundo claro).

O badge de contagem (`rail__count`, hoje só na Fila) continua igual,
inalterado pela mudança de estrutura.

## 2. Rodapé da sidebar → card de status

Hoje `.rail__foot` é texto solto (status WhatsApp, quota, botão Sair). Vira
um card fechado:

- Container `.rail__user`: fundo `rgba(255,255,255,.06)`, borda
  `rgba(255,255,255,.1)`, `border-radius: var(--r)`, padding `10px 12px`.
- Linha 1: bolinha de status (8px, `background: var(--tag)` se conectado /
  `rgba(255,255,255,.3)` se offline) + texto "Conectado"/"Offline".
- Linha 2 (se `wa` carregado): "Envios hoje: X/Y", `font-size: 11px`,
  `color: rgba(255,255,255,.5)`.
- Botão Sair: mesmo `btn btn--ghost btn--sm` de hoje, mas alinhado à direita
  do card via `justify-content: space-between` na linha 1, em vez de
  empilhado abaixo.

Sem nome de usuário — login é senha única (`/api/me` só retorna
`authenticated`, sem identidade). O card usa status operacional, não perfil
de pessoa.

## 3. Card hero na Fila

O painel "Adicionar oferta" (primeiro `.panel` em `Fila.tsx`) ganha classe
extra `panel--hero`:

- `background`: leve tint de `--brand` (`color-mix(in srgb, var(--brand) 6%, var(--surface))`).
- `border-color`: `var(--brand)`.
- padding um pouco maior que `.panel` padrão (`24px` vs `20px`).
- `.panel__title` dentro de um hero fica maior (`14px` → `15px`, peso 700 em
  vez de herdado).

Só o invólucro muda — campos, labels, lógica de `addUrl`/`search` continuam
idênticos.

## Testing

Sem suite de teste configurada no projeto (front não tem test runner). A
verificação é visual: subir `npm run dev:web`, usar o chrome-devtools MCP
(agent-browser) pra navegar no app local, tirar screenshot de cada página
afetada (Fila, e qualquer uma pra conferir a sidebar) e comparar contra o
estado atual e contra a referência. Checar responsivo (`@media max-width:
860px` já existe pro rail — grupos precisam continuar legíveis em linha,
igual ao nav atual).

## Error handling

Nenhum caminho novo de erro — os três itens são CSS/estrutura sobre dados
que já são buscados e já tratam falha (`.catch(() => {})` existente em
`Layout.tsx`). Sem mudança de comportamento em falha de rede.
