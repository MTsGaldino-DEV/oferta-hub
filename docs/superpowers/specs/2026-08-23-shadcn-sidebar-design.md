# Sidebar shadcn/ui (Radix) — Design

> Primeira rodada da migração de `apps/web` pra Tailwind. Escopo desta rodada:
> só `Layout.tsx`/sidebar. As demais ~19 páginas continuam em `styles.css`
> como estão, migram depois, uma de cada vez.

## Contexto

`apps/web` é React 18 + Vite + TypeScript, hoje 100% CSS puro com custom
properties em `apps/web/src/styles.css` (sem framework de estilo, sem lib de
componente, sem lib de ícone). O usuário não gostou do resultado visual do
redesign anterior (preto+amarelo, CSS à mão) e pediu pra trocar a sidebar por
algo baseado no componente Sidebar do shadcn/ui — colapsável pra ícone, com
`SidebarProvider`/`SidebarTrigger`/`SidebarMenu` etc.

Decisão confirmada com o usuário: adotar o shadcn/ui **de verdade** (Tailwind
+ Radix UI + `lucide-react`), não recriar o visual em CSS puro. Isso muda o
stack de estilo do projeto — é o início de uma migração maior, começando pela
sidebar.

## Decisões

1. **Variante shadcn: clássica (Radix UI)**, não a variante "base" (Base UI)
   do doc que o usuário colou como referência visual. Radix é mais maduro,
   mais documentado; a API usa `asChild` em vez de `render={<Componente />}`.
2. **Tailwind CSS v4** via `@tailwindcss/vite` — sem `postcss.config.js` nem
   `tailwind.config.js`; tema declarado em CSS via `@theme`. Setup fica
   global no projeto (sem prefixo/escopo), preparando pras próximas rodadas
   de migração, mesmo essa rodada só tocando a sidebar. Pacotes novos:
   `tailwindcss`, `@tailwindcss/vite`, `tw-animate-css` (utilities
   `animate-in`/`fade-in-0`/`slide-in-from-left` etc. -- não vêm no core do
   Tailwind v4; é o sucessor do `tailwindcss-animate` compatível com v4,
   usado pelo Sheet e pelo Tooltip), `@radix-ui/react-dialog` (Sheet),
   `@radix-ui/react-tooltip`, `@radix-ui/react-slot`,
   `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.
3. **Paleta preservada.** Os tokens atuais (`--brand`, `--ink`, `--canvas`,
   `--surface`, `--line`, `--drop`, `--gain`, `--raise`, `--on-brand`,
   `--slate`, `--r`) continuam sendo a fonte da verdade. As variáveis que o
   shadcn Sidebar espera (`--sidebar`, `--sidebar-foreground`,
   `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`,
   `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`)
   viram aliases apontando pros tokens existentes — não substituem, não
   duplicam valores.
4. **Seletor de tema adaptado.** `theme.ts` alterna via `data-theme='dark'`
   no `<html>` (não a classe `.dark` que o shadcn usa por padrão nos
   tutoriais). As variáveis do shadcn são declaradas sob `[data-theme='dark']`
   em vez de `.dark` — zero mudança em `theme.ts`.
5. **Ícones: lucide-react**, um por item de nav (necessário pro modo
   colapsado — ícone sozinho, sem texto). Lista completa na seção
   "Ícones por item".
6. **Mobile: Sheet deslizante** (comportamento padrão do shadcn Sidebar),
   substituindo a barra horizontal com scroll que existe hoje abaixo de
   860px.
7. **Sem dropdown de workspace nem menu de usuário no footer.** O demo do
   shadcn tem um `DropdownMenu` de troca de workspace no header e um menu de
   usuário no footer — Hub Ofertas não tem múltiplo workspace nem menu de
   usuário, isso seria over-engineering. O header mantém logo + "HubOfertas"
   simples; o footer mantém status online + cota + botão Sair, só que
   remontados em `SidebarFooter`/`SidebarMenu`.
8. **Escopo desta rodada:** só os arquivos abaixo. Nenhuma das ~19 páginas em
   `apps/web/src/pages/*.tsx` é tocada. `styles.css` não perde nenhuma regra
   — as classes que a sidebar usava (`.rail`, `.rail__*`) ficam órfãs no
   arquivo (não apagadas nesta rodada; apagar classe órfã de página que
   ainda não migrou é decisão de rodada futura).

## Risco conhecido, não verificável nesta sessão

O `preflight` do Tailwind (reset de CSS) zera margem/padding de heading,
lista, etc. **globalmente** — inclusive nas 19 páginas que não estão sendo
tocadas nesta rodada. Pela leitura de `styles.css`, a maioria dos elementos
que importam (`.panel__title`, `.head h1`, listas dentro de `.tag__reasons`
etc.) já sobrescreve margem explicitamente por classe, então o risco de
regressão visível é baixo — mas **isso não é verificável nesta sessão**: a
regra do projeto proíbe subir `npm run dev` (a API conecta uma conta real de
WhatsApp via Baileys assim que sobe). A confirmação visual fica pro usuário,
depois do build/rebuild do container, igual nas rodadas anteriores.

## Estrutura de arquivos

**Criar:**
```
apps/web/src/lib/utils.ts               -- cn() (clsx + tailwind-merge)
apps/web/src/components/ui/button.tsx
apps/web/src/components/ui/sheet.tsx
apps/web/src/components/ui/tooltip.tsx
apps/web/src/components/ui/sidebar.tsx  -- primitiva shadcn trimada (Provider, Sidebar, Header, Content, Footer, Group, GroupLabel, GroupContent, Menu, MenuItem, MenuButton com tooltip, MenuBadge, Trigger, Inset). Sem MenuAction/MenuSub/MenuSkeleton/Input/GroupAction/Separator -- zero consumidor nesta rodada (GROUPS é lista estática, sem submenu, sem divisor visual no design atual). Adicionar quando/se uma página futura precisar.
apps/web/src/components/app-sidebar.tsx -- conteúdo do Hub Ofertas: GROUPS, header, footer
apps/web/src/tailwind.css               -- @import "tailwindcss"; @theme com os aliases da seção 3
```

**Modificar:**
```
apps/web/package.json      -- dependências novas
apps/web/vite.config.ts    -- plugin @tailwindcss/vite + resolve.alias @/* -> src/*
apps/web/tsconfig.json     -- compilerOptions.paths @/* -> src/* (convenção shadcn; precisa nos dois lugares -- tsc resolve por paths, vite/esbuild por resolve.alias)
apps/web/index.html        -- nada (Google Fonts já importado, sem mudança)
apps/web/src/main.tsx      -- import de tailwind.css
apps/web/src/components/Layout.tsx -- troca <aside className="rail"> por <SidebarProvider><AppSidebar /><SidebarInset>. SidebarProvider fica aqui, não em App.tsx -- Layout.tsx é o único consumidor de contexto de sidebar no app inteiro (diferente do ProtocolToastProvider, que App.tsx precisa expor pra Disparos.tsx e Conexoes.tsx via hook). Colocar em App.tsx seria escopo maior que o necessário sem ganho nenhum.
```

**Não tocar:** `apps/web/src/pages/*.tsx` (19 arquivos), `apps/web/src/styles.css`
(além de nenhuma remoção — classes `.rail*` ficam órfãs, não apagadas).

## Ícones por item (lucide-react)

| Rota | Label | Ícone |
|---|---|---|
| `/` | Visão geral | `LayoutDashboard` |
| `/fila` | Fila | `ListChecks` |
| `/garimpar` | Garimpar | `Search` |
| `/nichos` | Nichos | `Tags` |
| `/produtos` | Preços vigiados | `Eye` |
| `/agenda` | Agenda | `CalendarClock` |
| `/automacoes` | Automações | `Workflow` |
| `/disparos` | Disparos | `Send` |
| `/desempenho` | Desempenho | `BarChart3` |
| `/grupos` | Meus Grupos | `Users` |
| `/configuracoes` | Configurações | `Settings` |

## Comportamento preservado (sem mudar lógica de negócio)

- Badge de pendentes na Fila: `SidebarMenuBadge` no lugar de `.rail__count`,
  mesma lógica (`pending > 0`, mesmo polling em `Layout.tsx`).
- Status online + cota + botão Sair: `SidebarFooter` com marcação Tailwind
  simples (não `SidebarMenu` -- não é item de navegação clicável, é card
  informativo, igual era `.rail__user` antes), mesmo `useEffect`/`api.get`
  que já existe em `Layout.tsx`.
- Rota ativa: `SidebarMenuButton isActive` calculado a partir do mesmo
  `NavLink`/`useLocation` já usado.
- Toggle de colapso: `SidebarTrigger` no topo da área de conteúdo (dentro de
  `SidebarInset`) + atalho `Ctrl+B` (padrão embutido no componente).
- Grupos com label (`Catálogo`, `Automação`, `Métricas`, `Configurações`):
  `SidebarGroup` + `SidebarGroupLabel`, mesma estrutura de `GROUPS` que já
  existe em `Layout.tsx`.

## Verificação

Sem test runner no projeto, sem dev server permitido (regra fixa: nunca
`npm run dev`/`dev:api`/`dev:web`, a API conecta WhatsApp real via Baileys).
Verificação = `npm run build --workspace=apps/web` (typecheck + vite build) +
revisão de diff. Confirmação visual (os dois temas, colapso pra ícone, Sheet
no mobile) fica pro usuário depois do rebuild do container `web`.
