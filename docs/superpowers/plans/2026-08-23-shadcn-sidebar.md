# Sidebar shadcn/ui (Radix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a sidebar de `apps/web` por um componente shadcn/ui (Radix UI) de verdade — colapsável pra ícone, com Sheet no mobile — sem mudar rota, nav data ou comportamento de negócio, e sem tocar nenhuma das ~19 páginas.

**Architecture:** Instala Tailwind CSS v4 (`@tailwindcss/vite`, sem config file) + Radix UI + `lucide-react` no projeto, escopado nesta rodada só pra sidebar. Uma primitiva `components/ui/sidebar.tsx` (porta do componente Sidebar do shadcn, trimada pro que este projeto usa) fica genérica e reutilizável; `components/app-sidebar.tsx` é o conteúdo específico do Hub Ofertas (GROUPS, ícones, footer). `Layout.tsx` troca `<aside className="rail">` por `<SidebarProvider><AppSidebar /><SidebarInset></SidebarProvider>`. A paleta atual (`--brand`, `--slate`, `--on-brand` etc, já definida em `styles.css`) vira a fonte de verdade via alias em `@theme inline` — shadcn não traz cor nenhuma própria.

**Tech Stack:** React 18 + Vite + TypeScript (existente). Novo: Tailwind CSS v4, `@tailwindcss/vite`, Radix UI (`react-dialog`, `react-tooltip`, `react-slot`), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`.

**Spec:** `docs/superpowers/specs/2026-08-23-shadcn-sidebar-design.md`

---

## Global Constraints

- **NUNCA rodar `npm run dev` / `npm run dev:api` / `npm run dev:web`.** A API conecta automático numa conta REAL de WhatsApp via Baileys assim que sobe. Verificação é só `npm run build --workspace=apps/web` e revisão de diff.
- **NUNCA rodar `prisma db push`/`migrate`/`studio`.** Esta migração é puramente de front-end.
- Cor de marca `#ffe01b` (`--brand`) não muda. Não adotar a paleta padrão zinc/slate do shadcn.
- Rotas, `GROUPS`, e toda a lógica de negócio (polling de `pending`/`wa`, logout) continuam idênticas — só a camada visual muda.
- **Nenhuma das ~19 páginas em `apps/web/src/pages/*.tsx` é tocada.** `apps/web/src/styles.css` não perde nenhuma regra nesta rodada — classes `.rail`/`.rail__*`/`.shell` ficam órfãs (não usadas, não apagadas).
- Sem instalar nada além do listado no Tech Stack. Em particular: sem `tailwind.config.js` nem `postcss.config.js` (Tailwind v4 + `@tailwindcss/vite` não precisa).
- `theme.ts` não muda. O seletor de tema do shadcn é adaptado pra `[data-theme='dark']`, não `.dark`.
- Trabalhar no worktree `.claude/worktrees/sidebar-shadcn`, branch `worktree-sidebar-shadcn`. Nunca commitar direto na branch principal.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `apps/web/package.json`, `vite.config.ts`, `tsconfig.json` | dependências, plugin Tailwind, alias `@/*` | 1 |
| `apps/web/src/tailwind.css` | import do Tailwind + `@theme inline` com os aliases de token | 1 |
| `apps/web/src/main.tsx` | importa `tailwind.css` | 1 |
| `apps/web/src/lib/utils.ts` | `cn()` | 2 |
| `apps/web/src/hooks/use-mobile.ts` | `useIsMobile()` | 2 |
| `apps/web/src/components/ui/button.tsx` | primitiva Button (usada por Trigger e footer) | 2 |
| `apps/web/src/components/ui/sheet.tsx` | primitiva Sheet (drawer mobile) | 2 |
| `apps/web/src/components/ui/tooltip.tsx` | primitiva Tooltip (labels no modo ícone) | 2 |
| `apps/web/src/components/ui/sidebar.tsx` | primitiva Sidebar completa (trimada) | 3 |
| `apps/web/src/components/app-sidebar.tsx` | conteúdo do Hub Ofertas: GROUPS+ícones, header, footer | 4 |
| `apps/web/src/components/Layout.tsx` | troca `.rail` por `<SidebarProvider>` | 5 |

## Ondas

Cadeia estritamente serial — Task 2 consome o `@theme` da Task 1, Task 3 consome `cn()`/`useIsMobile`/Button/Sheet/Tooltip da Task 2, Task 4 consome a primitiva da Task 3, Task 5 consome `AppSidebar` da Task 4. Não há par de tarefas com `Files` disjuntos e sem dependência — pela regra de formação de onda do projeto, isso degrada pra **uma tarefa por onda**, idêntico a execução serial. Task 6 é só verificação.

---

### Task 1: Tailwind v4 + alias de path

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/src/main.tsx`
- Create: `apps/web/src/tailwind.css`

**Interfaces:**
- Consumes: nada.
- Produces: classes utilitárias Tailwind disponíveis em todo `apps/web/src`; alias de import `@/*` apontando pra `apps/web/src/*`; tokens Tailwind `--color-sidebar`, `--color-sidebar-foreground`, `--color-sidebar-accent`, `--color-sidebar-accent-foreground`, `--color-sidebar-border`, `--color-sidebar-ring`, `--radius` disponíveis via `@theme inline`, resolvendo em runtime pros tokens existentes de `styles.css`. Todas as tarefas seguintes consomem essas classes e esse alias.

- [ ] **Step 1: Instalar as dependências**

```bash
npm install --workspace=apps/web tailwindcss @tailwindcss/vite tw-animate-css @radix-ui/react-dialog @radix-ui/react-tooltip @radix-ui/react-slot class-variance-authority clsx tailwind-merge lucide-react
```

- [ ] **Step 2: Adicionar o plugin e o alias em `apps/web/vite.config.ts`**

Substituir o arquivo inteiro por:

```ts
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3333', changeOrigin: true },
      '/r': { target: 'http://localhost:3333', changeOrigin: true },
    },
  },
});
```

- [ ] **Step 3: Adicionar o path alias em `apps/web/tsconfig.json`**

Substituir o arquivo inteiro por:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"]
}
```

(O alias existe pra bater com a convenção shadcn, mas nenhum arquivo desta rodada é obrigado a usá-lo — imports relativos `../../lib/utils.js` continuam válidos e são o que as tarefas seguintes usam, seguindo a convenção ESM `.js` já estabelecida no projeto. `@/*` fica disponível pra rodadas futuras.)

- [ ] **Step 4: Criar `apps/web/src/tailwind.css`**

```css
@import 'tailwindcss';
@import 'tw-animate-css';

/* Tokens do shadcn Sidebar apontando pros tokens que ja existem em
   styles.css -- "inline" pra resolver em runtime (reage a troca de tema),
   nao virar cor fixa no build. Nenhum valor novo, so alias. */
@theme inline {
  --color-sidebar: var(--slate);
  --color-sidebar-foreground: #ffffff;
  --color-sidebar-accent: rgba(255, 255, 255, 0.12);
  --color-sidebar-accent-foreground: #ffffff;
  --color-sidebar-border: rgba(255, 255, 255, 0.1);
  --color-sidebar-ring: var(--brand);

  --radius: var(--r);
  --radius-sm: var(--r-sm);
  --radius-md: var(--r-sm);
  --radius-lg: var(--r);
}
```

Sem bloco `[data-theme='dark']` aqui: `--slate`, `--brand`, `--on-brand` e `--r` não mudam entre temas em `styles.css` (confirme lendo `apps/web/src/styles.css:8-58` se tiver dúvida) — a sidebar já era um elemento sempre-escuro nos dois temas do app antes desta migração (`.rail` usava `var(--slate)` fixo), então não existe valor nenhum aqui que precise variar. Se uma tarefa futura precisar que algum token do shadcn siga o tema, o padrão é `[data-theme='dark'] { --color-x: outro-valor; }` no mesmo arquivo, não a classe `.dark`.

- [ ] **Step 5: Importar em `apps/web/src/main.tsx`**

Adicionar, depois do `import './styles.css';` (linha 5):

```tsx
import './tailwind.css';
```

`tailwind.css` importado DEPOIS de `styles.css`: nenhuma das ~19 páginas usa classe utilitária Tailwind, então a ordem não afeta elas — mas garante que, se algum componente novo tiver empate de especificidade com uma regra antiga, a utility Tailwind vence, que é o esperado pra código novo.

- [ ] **Step 6: Verificar**

```bash
npm run build --workspace=apps/web
```
Esperado: build verde. Ainda não há nenhum componente novo usando Tailwind, então isso só confirma que o plugin/alias não quebrou nada.

```bash
grep -n "tailwindcss\|@tailwindcss/vite\|tw-animate-css\|@radix-ui\|class-variance-authority\|clsx\|tailwind-merge\|lucide-react" apps/web/package.json
```
Esperado: as 9 dependências novas presentes.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/vite.config.ts apps/web/tsconfig.json apps/web/src/main.tsx apps/web/src/tailwind.css package-lock.json
git commit -m "build(web): setup Tailwind v4 + alias @/* pra migracao da sidebar"
```

(O `package-lock.json` da raiz também muda, por causa do workspace npm — inclua os dois.)

---

### Task 2: Primitivas base (`cn`, `useIsMobile`, Button, Sheet, Tooltip)

**Files:**
- Create: `apps/web/src/lib/utils.ts`
- Create: `apps/web/src/hooks/use-mobile.ts`
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/sheet.tsx`
- Create: `apps/web/src/components/ui/tooltip.tsx`

**Interfaces:**
- Consumes: classes Tailwind e tokens da Task 1.
- Produces:
  - `cn(...inputs: ClassValue[]): string`
  - `useIsMobile(): boolean`
  - `Button`, `buttonVariants` — `Button` aceita `variant?: 'default'|'outline'|'ghost'`, `size?: 'default'|'sm'|'icon'`, `asChild?: boolean`
  - `Sheet`, `SheetTrigger`, `SheetContent` (`side?: 'left'|'right'`), `SheetTitle`, `SheetDescription`
  - `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`
  A Task 3 importa todos esses nomes exatos.

- [ ] **Step 1: `apps/web/src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: `apps/web/src/hooks/use-mobile.ts`**

```ts
import { useEffect, useState } from 'react';

/* 860px pra bater com o breakpoint que o resto do app ja usa (styles.css
   @media max-width: 860px) -- mantem a pagina inteira mudando de modo
   mobile no mesmo ponto, sidebar incluida. */
const MOBILE_BREAKPOINT = 860;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => window.innerWidth < MOBILE_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
```

- [ ] **Step 3: `apps/web/src/components/ui/button.tsx`**

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
  {
    variants: {
      variant: {
        default: 'bg-[var(--raise)] text-white hover:opacity-90',
        outline: 'border border-[var(--line)] bg-transparent text-[var(--ink)] hover:bg-[var(--surface)]',
        ghost: 'hover:bg-[var(--surface)]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-md px-2 text-xs',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { buttonVariants };
```

- [ ] **Step 4: `apps/web/src/components/ui/sheet.tsx`**

```tsx
import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

interface SheetContentProps extends React.ComponentProps<typeof SheetPrimitive.Content> {
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export function SheetContent({ className, children, side = 'right', ...props }: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-[var(--slate)] text-white shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
          side === 'left' &&
            'inset-y-0 left-0 h-full w-3/4 border-r border-white/10 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-xs',
          side === 'right' &&
            'inset-y-0 right-0 h-full w-3/4 border-l border-white/10 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-xs',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Fechar</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn('text-sm font-semibold text-white', className)} {...props} />;
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn('sr-only', className)} {...props} />;
}
```

- [ ] **Step 5: `apps/web/src/components/ui/tooltip.tsx`**

```tsx
import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils.js';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 overflow-hidden rounded-md bg-[var(--slate)] px-3 py-1.5 text-xs text-white shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
```

- [ ] **Step 6: Verificar**

```bash
npm run build --workspace=apps/web
```
Esperado: build verde (nenhum desses arquivos é importado por nada ainda, então isso só confirma que compilam isoladamente).

```bash
grep -rn "export function cn\|export function useIsMobile\|export const Button\|export const Sheet\b\|export const Tooltip\b" apps/web/src/lib/utils.ts apps/web/src/hooks/use-mobile.ts apps/web/src/components/ui/button.tsx apps/web/src/components/ui/sheet.tsx apps/web/src/components/ui/tooltip.tsx
```
Esperado: um acerto em cada arquivo.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/utils.ts apps/web/src/hooks/use-mobile.ts apps/web/src/components/ui/button.tsx apps/web/src/components/ui/sheet.tsx apps/web/src/components/ui/tooltip.tsx
git commit -m "feat(web): primitivas base pro shadcn -- cn, useIsMobile, Button, Sheet, Tooltip"
```

---

### Task 3: Primitiva Sidebar

**Files:**
- Create: `apps/web/src/components/ui/sidebar.tsx`

**Interfaces:**
- Consumes: `cn` (`../../lib/utils.js`), `useIsMobile` (`../../hooks/use-mobile.js`), `Button` (`./button.js`), `Sheet`/`SheetContent`/`SheetTitle`/`SheetDescription` (`./sheet.js`), `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider` (`./tooltip.js`) — todos da Task 2.
- Produces: `SidebarProvider`, `useSidebar()`, `Sidebar`, `SidebarTrigger`, `SidebarInset`, `SidebarHeader`, `SidebarFooter`, `SidebarContent`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton` (props: `asChild?`, `isActive?`, `tooltip?: string`, `size?`), `SidebarMenuBadge`. A Task 4 e a Task 5 importam esses nomes exatos.

Nota de escopo: esta é uma versão trimada da primitiva Sidebar do shadcn — sem `SidebarMenuAction`, `SidebarMenuSub`, `SidebarMenuSkeleton`, `SidebarInput`, `SidebarGroupAction`, `SidebarSeparator`, variante `variant="inset"`, nem `collapsible="offcanvas"` no desktop. Nenhum consumidor deste projeto precisa desses agora (Hub Ofertas não tem submenu, não tem loading assíncrono de nav, não tem separador visual, e usa só `collapsible="icon"`). Adicionar quando/se uma página futura precisar — não é trabalho perdido, é a primitiva ganhando superfície sob demanda real.

Nota técnica: como este projeto é uma SPA client-only sem SSR, o branch mobile/desktop já é decidido em JavaScript (`isMobile`) antes de qualquer render — por isso as classes `hidden md:block`/`md:flex` que a versão oficial do shadcn usa (pensadas pra evitar flash de conteúdo errado durante hydration de SSR) foram omitidas aqui. Sem SSR, elas seriam só peso morto e ainda corriam risco de descasar do breakpoint de `useIsMobile` (860px) com o breakpoint padrão do Tailwind `md:` (768px).

- [ ] **Step 1: Escrever `apps/web/src/components/ui/sidebar.tsx`**

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeftIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { useIsMobile } from '../../hooks/use-mobile.js';
import { Button } from './button.js';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js';

const SIDEBAR_COOKIE_NAME = 'sidebar_state';
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH_ICON = '3rem';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

interface SidebarContextValue {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar precisa estar dentro de <SidebarProvider>');
  return ctx;
}

interface SidebarProviderProps extends React.ComponentProps<'div'> {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const SidebarProvider = React.forwardRef<HTMLDivElement, SidebarProviderProps>(
  ({ defaultOpen = true, open: openProp, onOpenChange, className, style, children, ...props }, ref) => {
    const isMobile = useIsMobile();
    const [openMobile, setOpenMobile] = React.useState(false);
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
    const open = openProp ?? internalOpen;

    const setOpen = React.useCallback(
      (value: boolean) => {
        if (onOpenChange) onOpenChange(value);
        else setInternalOpen(value);
        // So persistencia de preferencia -- sem backend envolvido.
        document.cookie = `${SIDEBAR_COOKIE_NAME}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
      },
      [onOpenChange],
    );

    const toggleSidebar = React.useCallback(() => {
      isMobile ? setOpenMobile((v) => !v) : setOpen(!open);
    }, [isMobile, open, setOpen]);

    React.useEffect(() => {
      function onKeyDown(event: KeyboardEvent) {
        if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          toggleSidebar();
        }
      }
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [toggleSidebar]);

    const state = open ? 'expanded' : 'collapsed';

    const contextValue = React.useMemo<SidebarContextValue>(
      () => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
      [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar],
    );

    return (
      <SidebarContext.Provider value={contextValue}>
        <TooltipProvider delayDuration={0}>
          <div
            ref={ref}
            data-slot="sidebar-wrapper"
            style={
              {
                '--sidebar-width': '16rem',
                '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
                ...style,
              } as React.CSSProperties
            }
            className={cn('flex min-h-svh w-full', className)}
            {...props}
          >
            {children}
          </div>
        </TooltipProvider>
      </SidebarContext.Provider>
    );
  },
);
SidebarProvider.displayName = 'SidebarProvider';

interface SidebarProps extends React.ComponentProps<'div'> {
  side?: 'left' | 'right';
  collapsible?: 'icon' | 'none';
}

export const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ side = 'left', collapsible = 'icon', className, children, ...props }, ref) => {
    const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

    if (collapsible === 'none') {
      return (
        <div
          ref={ref}
          data-slot="sidebar"
          className={cn('flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground', className)}
          {...props}
        >
          {children}
        </div>
      );
    }

    if (isMobile) {
      return (
        <Sheet open={openMobile} onOpenChange={setOpenMobile}>
          <SheetContent side={side} className="w-3/4 p-0 sm:max-w-xs">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Navegação do Hub Ofertas</SheetDescription>
            <div className="flex h-full w-full flex-col">{children}</div>
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <div
        data-state={state}
        data-collapsible={state === 'collapsed' ? collapsible : ''}
        data-side={side}
        className="group peer text-sidebar-foreground"
      >
        {/* Sizer: reserva o espaco no layout flex. A sidebar de verdade,
            abaixo, e position:fixed (fora do fluxo), entao sem isso o
            conteudo principal nao saberia quanto espaco deixar. */}
        <div
          className={cn(
            'relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear',
            'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
          )}
        />
        <div
          ref={ref}
          data-slot="sidebar-container"
          className={cn(
            'fixed inset-y-0 z-10 flex h-svh w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground transition-[left,right,width] duration-200 ease-linear',
            side === 'left' ? 'left-0' : 'right-0',
            'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  },
);
Sidebar.displayName = 'Sidebar';

export const SidebarTrigger = React.forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({ className, onClick, ...props }, ref) => {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={cn('size-7', className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Alternar sidebar</span>
    </Button>
  );
});
SidebarTrigger.displayName = 'SidebarTrigger';

export const SidebarInset = React.forwardRef<HTMLDivElement, React.ComponentProps<'main'>>(
  ({ className, ...props }, ref) => (
    <main
      ref={ref}
      data-slot="sidebar-inset"
      className={cn('relative flex w-full flex-1 flex-col bg-[var(--canvas)]', className)}
      {...props}
    />
  ),
);
SidebarInset.displayName = 'SidebarInset';

export const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="sidebar-header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
  ),
);
SidebarHeader.displayName = 'SidebarHeader';

export const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="sidebar-footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
  ),
);
SidebarFooter.displayName = 'SidebarFooter';

export const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-content"
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        className,
      )}
      {...props}
    />
  ),
);
SidebarContent.displayName = 'SidebarContent';

export const SidebarGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-group"
      className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      {...props}
    />
  ),
);
SidebarGroup.displayName = 'SidebarGroup';

export const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-group-label"
      className={cn(
        'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/60 outline-none transition-[margin,opacity] duration-200 ease-linear',
        'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
        className,
      )}
      {...props}
    />
  ),
);
SidebarGroupLabel.displayName = 'SidebarGroupLabel';

export const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="sidebar-group-content" className={cn('w-full text-sm', className)} {...props} />
  ),
);
SidebarGroupContent.displayName = 'SidebarGroupContent';

export const SidebarMenu = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} data-slot="sidebar-menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />
  ),
);
SidebarMenu.displayName = 'SidebarMenu';

export const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} data-slot="sidebar-menu-item" className={cn('group/menu-item relative', className)} {...props} />
  ),
);
SidebarMenuItem.displayName = 'SidebarMenuItem';

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!",
  {
    variants: {
      size: {
        default: 'h-8 text-sm',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

interface SidebarMenuButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string;
}

export const SidebarMenuButton = React.forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  ({ asChild = false, isActive = false, tooltip, size, className, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const { isMobile, state } = useSidebar();

    const button = (
      <Comp
        ref={ref}
        data-slot="sidebar-menu-button"
        data-active={isActive}
        className={cn(sidebarMenuButtonVariants({ size }), className)}
        {...props}
      />
    );

    if (!tooltip || state !== 'collapsed' || isMobile) return button;

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" align="center">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    );
  },
);
SidebarMenuButton.displayName = 'SidebarMenuButton';

export const SidebarMenuBadge = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="sidebar-menu-badge"
      className={cn(
        'pointer-events-none absolute right-1 top-1.5 flex h-5 min-w-5 select-none items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  ),
);
SidebarMenuBadge.displayName = 'SidebarMenuBadge';
```

- [ ] **Step 2: Verificar**

```bash
npm run build --workspace=apps/web
```
Esperado: build verde. `sidebar.tsx` ainda não é importado por nada — isso confirma que compila e que os imports da Task 2 resolvem certo.

```bash
grep -c "^export " apps/web/src/components/ui/sidebar.tsx
```
Esperado: 13 (contando `export function useSidebar` + os 12 `export const`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/sidebar.tsx
git commit -m "feat(web): primitiva Sidebar (shadcn/Radix, trimada pro Hub Ofertas)"
```

---

### Task 4: Conteúdo do Hub Ofertas (`app-sidebar.tsx`)

**Files:**
- Create: `apps/web/src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: toda a primitiva da Task 3 (`Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarMenuBadge`), `Button` (Task 2), `Logo` (`./Logo.js`, já existe).
- Produces: `AppSidebar(props: { pending: number; online: boolean; quota: { used: number; cap: number } | null; onLogout: () => void })`. A Task 5 renderiza `<AppSidebar pending={...} online={...} quota={...} onLogout={...} />`.

- [ ] **Step 1: Escrever `apps/web/src/components/app-sidebar.tsx`**

```tsx
import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  CalendarClock,
  Eye,
  LayoutDashboard,
  ListChecks,
  Search,
  Send,
  Settings,
  Tags,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { Logo } from './Logo.js';
import { Button } from './ui/button.js';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar.js';

type NavItem = { to: string; label: string; end?: boolean; icon: LucideIcon };

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ to: '/', label: 'Visão geral', end: true, icon: LayoutDashboard }] },
  { label: null, items: [{ to: '/fila', label: 'Fila', icon: ListChecks }] },
  {
    label: 'Catálogo',
    items: [
      { to: '/garimpar', label: 'Garimpar', icon: Search },
      { to: '/nichos', label: 'Nichos', icon: Tags },
      { to: '/produtos', label: 'Preços vigiados', icon: Eye },
    ],
  },
  {
    label: 'Automação',
    items: [
      { to: '/agenda', label: 'Agenda', icon: CalendarClock },
      { to: '/automacoes', label: 'Automações', icon: Workflow },
      { to: '/disparos', label: 'Disparos', icon: Send },
    ],
  },
  {
    label: 'Métricas',
    items: [
      { to: '/desempenho', label: 'Desempenho', icon: BarChart3 },
      { to: '/grupos', label: 'Meus Grupos', icon: Users },
    ],
  },
  { label: 'Configurações', items: [{ to: '/configuracoes', label: 'Configurações', icon: Settings }] },
];

interface AppSidebarProps {
  pending: number;
  online: boolean;
  quota: { used: number; cap: number } | null;
  onLogout: () => void;
}

export function AppSidebar({ pending, online, quota, onLogout }: AppSidebarProps) {
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Logo size={28} className="shrink-0 text-[var(--brand)]" />
          <span className="text-[15px] font-extrabold leading-none tracking-tight group-data-[collapsible=icon]:hidden">
            Hub<span className="text-[var(--brand)]">Ofertas</span>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((g, gi) => (
          <SidebarGroup key={gi}>
            {g.label && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  // Mesmo algoritmo de match do NavLink (end = exato,
                  // senao prefixo) -- so precisamos disso fora do NavLink
                  // porque SidebarMenuButton pinta o estado ativo via prop,
                  // nao via className/aria-current.
                  const active = item.end
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <NavLink to={item.to} end={item.end}>
                          <item.icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {item.to === '/fila' && pending > 0 && (
                        <SidebarMenuBadge className="bg-[var(--brand)] text-[var(--on-brand)]">
                          {pending}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] p-2.5 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-white">
              <span className={cn('size-2 shrink-0 rounded-full', online ? 'bg-[var(--brand)]' : 'bg-white/30')} />
              {online ? 'Conectado' : 'Offline'}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-white/25 text-white hover:bg-white/10"
              onClick={onLogout}
            >
              Sair
            </Button>
          </div>
          {quota && (
            <span className="text-[11px] text-white/50">
              Envios hoje: {quota.used}/{quota.cap}
            </span>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
```

- [ ] **Step 2: Verificar**

```bash
npm run build --workspace=apps/web
```
Esperado: build verde. `app-sidebar.tsx` ainda não é importado por nada — confirma que compila e que os 11 itens de `GROUPS` batem com as rotas existentes em `App.tsx`.

```bash
grep -c "to: '/" apps/web/src/components/app-sidebar.tsx
```
Esperado: `11` — mesma contagem de rotas em `apps/web/src/App.tsx`.

```bash
grep -n "^import { cn }" apps/web/src/components/app-sidebar.tsx
```
Esperado: 1 acerto (confirma que o Step 1 não foi esquecido).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/app-sidebar.tsx
git commit -m "feat(web): app-sidebar com GROUPS, icones lucide e footer do Hub Ofertas"
```

---

### Task 5: Ligar no `Layout.tsx`

**Files:**
- Modify: `apps/web/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `AppSidebar` (Task 4), `SidebarProvider`/`SidebarInset`/`SidebarTrigger` (Task 3).
- Produces: nada (folha da cadeia).

- [ ] **Step 1: Substituir `apps/web/src/components/Layout.tsx` inteiro**

```tsx
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { AppSidebar } from './app-sidebar.js';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './ui/sidebar.js';

export function Layout({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState(0);
  const [wa, setWa] = useState<{ status: string; quota: { used: number; cap: number } } | null>(null);
  const location = useLocation();

  useEffect(() => {
    api.get<{ pending: number }>('/api/stats/overview?days=30').then((s) => setPending(s.pending)).catch(() => {});
    api.get<any>('/api/whatsapp/status').then(setWa).catch(() => {});
  }, [location.pathname]);

  async function logout() {
    await api.post('/api/logout');
    window.location.href = '/';
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '13rem' } as React.CSSProperties}>
      <AppSidebar
        pending={pending}
        online={wa?.status === 'connected'}
        quota={wa?.quota ?? null}
        onLogout={() => void logout()}
      />
      <SidebarInset className="main">
        <SidebarTrigger className="mb-3" />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
```

Notas do que mudou em relação ao `Layout.tsx` anterior, pra conferir no self-review:
- `pending`/`wa`/`useEffect` de polling: **idênticos**, só movidos pro topo do mesmo componente (nada de lógica mudou).
- `logout()`: mesma chamada `api.post('/api/logout')` + `window.location.href = '/'`, só que virou função nomeada em vez de arrow inline (porque agora é passada como prop `onLogout` pro `AppSidebar`, que não sabe nada sobre `api`).
- `13rem` = 208px com root font-size 16px — mesma largura que `.rail` tinha antes (`.shell { grid-template-columns: 208px 1fr }`).
- `className="main"` no `SidebarInset`: **crítico** — é a classe que dá padding/max-width ao conteúdo de todas as 19 páginas (`.main { padding: 30px 34px 64px; max-width: 1180px }` em `styles.css`). Sem isso todas as páginas perdem o respiro lateral.
- `SidebarTrigger` fica dentro do `SidebarInset`, antes de `{children}` — é o botão que alterna colapsado/expandido.

- [ ] **Step 2: Verificar**

```bash
npm run build --workspace=apps/web
```
Esperado: build verde.

```bash
grep -n "className=\"rail\"\|className=\"shell\"" apps/web/src/components/Layout.tsx
```
Esperado: nenhum acerto — `Layout.tsx` não referencia mais `.rail`/`.shell`.

```bash
grep -n "className=\"main\"" apps/web/src/components/Layout.tsx
```
Esperado: 1 acerto, no `SidebarInset`.

```bash
grep -c "api.get\|api.post" apps/web/src/components/Layout.tsx
```
Esperado: `3` (2 `api.get` do polling + 1 `api.post` do logout) — mesma contagem de chamadas de API que o arquivo tinha antes, confirmando que nenhuma lógica de negócio foi perdida ou duplicada.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Layout.tsx
git commit -m "feat(web): Layout usa a nova AppSidebar (shadcn) no lugar do .rail"
```

---

### Task 6: Varredura final

**Files:** nenhum (só verificação).

- [ ] **Step 1: Build limpo do zero**

```bash
rm -rf apps/web/dist apps/web/tsconfig.tsbuildinfo apps/web/node_modules/.vite
npm run build --workspace=apps/web
```
Esperado: build verde, sem warning de TypeScript.

- [ ] **Step 2: Confirmar que nenhuma página foi tocada**

```bash
git diff --stat 71a8182 HEAD -- apps/web/src/pages
```
Esperado: saída vazia — zero arquivo em `apps/web/src/pages/` no diff da branch inteira.

- [ ] **Step 3: Confirmar que `styles.css` não perdeu regra nenhuma**

```bash
git diff --stat 71a8182 HEAD -- apps/web/src/styles.css
```
Esperado: saída vazia — `styles.css` não foi tocado (as classes `.rail*`/`.shell` ficam órfãs no arquivo, não removidas, conforme a spec).

- [ ] **Step 4: Confirmar as 11 rotas intactas em `App.tsx`**

```bash
git diff 71a8182 HEAD -- apps/web/src/App.tsx
```
Esperado: saída vazia — `App.tsx` não foi tocado nesta rodada (a spec corrigida moveu o `SidebarProvider` pra dentro de `Layout.tsx`).

- [ ] **Step 5: Caçar dependência instalada além do combinado**

```bash
git diff 71a8182 HEAD -- apps/web/package.json
```
Ler o diff: as únicas entradas novas devem ser as 9 do Tech Stack (`tailwindcss`, `@tailwindcss/vite`, `tw-animate-css`, `@radix-ui/react-dialog`, `@radix-ui/react-tooltip`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`). Qualquer outra é desvio de escopo — reportar.

- [ ] **Step 6: Relatório final**

Reportar, nesta ordem:
1. Saída do build limpo.
2. Saída dos Steps 2-5 (confirmações de escopo).
3. `git log --oneline 71a8182..HEAD`.
4. Lista explícita do que **não** foi verificado: aparência real no navegador (os dois temas, colapso pra ícone, Sheet no mobile, tooltip no modo colapsado, atalho Ctrl+B) e se o preflight do Tailwind quebrou alguma das 19 páginas não tocadas. A spec proíbe o dev server — isso fica pro usuário conferir depois do rebuild do container `web`.

---

## Depois do plano executado (controlador, com o usuário)

1. Usuário revisa o diff completo da branch.
2. Merge local na branch de origem.
3. Rebuild do container Docker `web`.
4. Usuário confirma visualmente: sidebar nos dois temas, colapso pra ícone, Sheet no mobile, e que nenhuma das 19 páginas quebrou visualmente por causa do preflight do Tailwind.
