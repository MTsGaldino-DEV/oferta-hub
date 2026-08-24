# Redesign visual preto + amarelo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin visual completo de `apps/web` (fundo preto no tema escuro, off-white no claro, cards em véu translúcido, Space Grotesk, raio 12px, chips pill amarelos) e adicionar um feedback de "protocolo" (som sintetizado + overlay central) em 3 ações.

**Architecture:** O trabalho é majoritariamente em `apps/web/src/styles.css` — os tokens CSS (`--canvas`, `--surface`, `--line`, `--r`, …) já existem e são consumidos por todas as ~20 páginas via classes utilitárias, então trocar os valores dos tokens redesenha o app inteiro sem tocar JSX. Três tokens novos (`--on-brand`, `--slate`, `--raise`) substituem a pilha de overrides pontuais `[data-theme='dark'] { color: #16171a }` que existe hoje no fim do arquivo. O feedback de protocolo entra como dois arquivos novos (`protocol-sound.ts` com Web Audio puro, `ProtocolToast.tsx` com um Context pequeno) e três pontos de chamada.

**Tech Stack:** React 18 + TypeScript, Vite, CSS puro (sem framework de estilo), Web Audio API nativa. Zero dependências novas.

**Spec:** `plano-redesign.md` (raiz do worktree)

---

## Global Constraints

Valores copiados literalmente da spec. Valem pra **todas** as tarefas.

- **NUNCA rodar `npm run dev` / `dev:api` / `dev:web`.** A API conecta automático numa conta REAL de WhatsApp via Baileys assim que sobe.
- **NUNCA rodar `prisma db push` / `migrate` / `studio`.** Este redesign é puramente visual. Se parecer que precisa de mudança de schema, PARE e pergunte.
- **Verificação = `npm run build --workspace=apps/web`** (roda `tsc -b` + `vite build`) + revisão de diff. Não existe test runner configurado neste projeto e a spec proíbe o dev server, então as tarefas usam build + asserções por `grep` no lugar de testes de UI. A única tarefa com teste runnable de verdade é a Task 3 (áudio), que roda em Node puro.
- Nome do app: **Hub Ofertas** — não muda.
- Cor de marca: **`#ffe01b`** — não muda, e não muda entre temas. Não adotar a paleta laranja/âmbar da referência.
- **Os dois temas continuam existindo** (claro e escuro). O toggle em `apps/web/src/theme.ts` não muda.
- Rotas, nav e funcionalidade **não mudam**. Não tocar em lógica de negócio, chamadas de API, ou schema do Prisma.
- Sem dependências novas — nada de `lucide-react`, nada de lib de áudio. SVG inline e Web Audio nativo.
- Trabalhar no worktree `.claude/worktrees/redesign-preto-amarelo`, branch `worktree-redesign-preto-amarelo` (base = `docker-e-identidade` @ `4e08627`). Nunca commitar direto na branch principal.

### Tokens alvo (referência única — copie daqui, não reinvente)

Tema claro (`:root`) / tema escuro (`[data-theme='dark']`):

| Token | Claro | Escuro |
|---|---|---|
| `--canvas` | `#f4f4f2` | `#0c0c11` |
| `--surface` | `rgba(22, 23, 26, 0.04)` | `rgba(255, 255, 255, 0.055)` |
| `--line` | `rgba(22, 23, 26, 0.1)` | `rgba(255, 255, 255, 0.1)` |
| `--ink` | `#16171a` | `#f2f2f0` |
| `--muted` | `#74787f` | `#9a9da3` |
| `--brand` | `#ffe01b` | `#ffe01b` (não redeclarar no dark) |
| `--drop` | `#d93a1e` | `#ff6b52` |
| `--gain` | `#0c7c4a` | `#22a866` |
| `--raise` | `#16171a` | `#2f3037` |
| `--r` | `12px` | `12px` (não redeclarar) |

Tokens novos que não mudam entre temas (declarar só em `:root`):

- `--on-brand: #16171a` — texto que vai **sobre** `--brand`. `--brand` não muda entre temas, então esse texto não pode seguir o flip de `--ink`.
- `--slate: #16171a` — fundo escuro fixo pra superfície que não pode seguir o flip de `--ink` (sidebar, mark do login).
- `--r-sm: 8px`, `--r-pill: 999px`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `apps/web/index.html` | import da fonte, `color-scheme` | 1 |
| `apps/web/src/styles.css` | tokens + todas as regras de componente (arquivo central do redesign) | 1, 2, 4 |
| `apps/web/src/components/PriceTag.tsx` | badge de desconto no canto da imagem | 2 |
| `apps/web/src/protocol-sound.ts` | **novo** — AudioContext lazy + receitas Web Audio | 3 |
| `apps/web/src/protocol-sound.check.ts` | **novo** — self-check runnable em Node puro | 3 |
| `apps/web/src/components/ProtocolToast.tsx` | **novo** — Provider + hook + overlay | 4 |
| `apps/web/src/App.tsx` | envolve `<Layout>` no Provider | 4 |
| `apps/web/src/pages/Disparos.tsx` | disparar/cancelar → feedback | 5 |
| `apps/web/src/pages/Conexoes.tsx` | tema, WhatsApp on/off → feedback; 1 raio inline | 5 |

## Ordem de execução (ondas)

Regra de formação de onda em `.claude/rules/parallel-subagent-driven-development.md`: mesma onda só quando os `Files:` são disjuntos e não há dependência.

- **Onda A (paralela):** Task 1 (`index.html`, `styles.css` bloco de tokens) ‖ Task 3 (`protocol-sound.ts`, `protocol-sound.check.ts`)
- **Onda B:** Task 2 (`styles.css` componentes, `PriceTag.tsx`, `Disparos.tsx` raio inline)
- **Onda C:** Task 4 (`ProtocolToast.tsx`, `styles.css` append, `App.tsx`)
- **Onda D:** Task 5 (`Disparos.tsx`, `Conexoes.tsx`)
- **Onda E:** Task 6 (varredura final, só verificação)

Implementadores **não commitam**. O controlador commita por tarefa, em ordem de onda.

---

### Task 1: Fonte e tokens

**Files:**
- Modify: `apps/web/index.html:6`, `apps/web/index.html:16-19`
- Modify: `apps/web/src/styles.css:8-41` (blocos `:root` e `[data-theme='dark']`), `apps/web/src/styles.css:53-61` (`body`)

**Interfaces:**
- Consumes: nada.
- Produces: os tokens `--canvas`, `--surface`, `--line`, `--ink`, `--muted`, `--brand`, `--drop`, `--gain`, `--raise`, `--on-brand`, `--slate`, `--r`, `--r-sm`, `--r-pill`, `--display`, `--mono`, `--shadow`. Todas as tarefas seguintes consomem esses nomes exatos.

- [ ] **Step 1: Trocar o import da fonte no `index.html`**

Substituir as linhas 16-19 (o `<link>` do Google Fonts) por:

```html
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
```

E na linha 6, trocar:

```html
    <meta name="color-scheme" content="light" />
```

por:

```html
    <meta name="color-scheme" content="light dark" />
```

(O app tem dois temas; declarar só `light` faz o navegador pintar scrollbar e controles nativos claros mesmo no tema escuro.)

- [ ] **Step 2: Substituir o bloco `:root` (linhas 8-27) inteiro**

```css
:root {
  /* Amarelo da marca: mesma tinta do logo, do favicon e da etiqueta de preco.
     Fonte unica da verdade -- --tag existe so como apelido semantico. */
  --brand: #ffe01b;

  --ink: #16171a;
  --canvas: #f4f4f2;
  --surface: rgba(22, 23, 26, 0.04);
  --tag: var(--brand);
  --drop: #d93a1e;
  --gain: #0c7c4a;
  --muted: #74787f;
  --line: rgba(22, 23, 26, 0.1);

  /* Superficie elevada opaca: botao primario e passo ativo. Nao pode usar
     --ink, que no tema escuro vira texto claro. */
  --raise: #16171a;

  /* Texto que vai SOBRE --brand. --brand nao muda entre temas, entao esse
     texto tambem nao pode mudar -- senao no escuro vira quase-branco sobre
     amarelo. Mesma tecnica dos overrides pontuais que existiam antes. */
  --on-brand: #16171a;

  /* Fundo escuro fixo pra superficie que nao segue o flip de --ink:
     sidebar e mark do login. */
  --slate: #16171a;

  --display: 'Space Grotesk', system-ui, sans-serif;
  --mono: 'Space Grotesk', system-ui, sans-serif;

  --r: 12px;
  --r-sm: 8px;
  --r-pill: 999px;
  --shadow: 0 1px 0 rgba(22, 23, 26, 0.04), 0 2px 8px rgba(22, 23, 26, 0.05);
}
```

Notas de decisão (não mudar sem falar com o usuário):
- `--mono` continua existindo apontando pra Space Grotesk. A spec permite: evita caçar os ~40 usos de `var(--mono)` no arquivo. Ele agora significa "número/preço", não "fonte monoespaçada".
- `--surface` translúcido aninha: um `input` dentro de um `.panel` recebe dois véus e fica visivelmente recuado em relação ao painel. Isso é intencional e é o que substitui a borda forte que existia antes.

- [ ] **Step 3: Substituir o bloco `[data-theme='dark']` (linhas 31-41) inteiro**

```css
/* Modo escuro: mesmos nomes de token, valores invertidos. --brand/--tag,
   --on-brand, --slate, --display, --mono e os raios ficam de fora -- não
   mudam entre temas. */
[data-theme='dark'] {
  --ink: #f2f2f0;
  --canvas: #0c0c11;
  --surface: rgba(255, 255, 255, 0.055);
  --drop: #ff6b52;
  --gain: #22a866;
  --muted: #9a9da3;
  --line: rgba(255, 255, 255, 0.1);
  --raise: #2f3037;

  --shadow: 0 1px 0 rgba(0, 0, 0, 0.4), 0 2px 10px rgba(0, 0, 0, 0.5);
}
```

- [ ] **Step 4: Adicionar `tabular-nums` aos números**

Space Grotesk tem algarismos tabulares, mas não por padrão. Sem isso os preços dançam de largura entre linhas da tabela. Logo depois do bloco `body` (linha ~61), adicionar:

```css
/* Space Grotesk substituiu a mono: sem tabular-nums os precos mudam de
   largura a cada digito e a coluna numerica da tabela treme. */
.table .num,
.kpi__value,
.kpi__delta,
.card__agora,
.card__antes,
.tag__now,
.tag__was {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5: Verificar — build e asserções de grep**

```bash
npm run build --workspace=apps/web
```
Esperado: `✓ built in ...`, sem erro de tsc.

```bash
grep -c "Archivo\|IBM Plex Mono" apps/web/index.html apps/web/src/styles.css
```
Esperado: `0` em ambos os arquivos.

```bash
grep -n "Space Grotesk" apps/web/index.html apps/web/src/styles.css
```
Esperado: 1 acerto no `index.html`, 2 no `styles.css` (`--display` e `--mono`).

```bash
grep -n -- "--r: 12px\|--on-brand\|--slate\|--raise\|--r-pill" apps/web/src/styles.css
```
Esperado: `--r: 12px` uma vez; `--on-brand`, `--slate`, `--r-pill` uma vez cada (só em `:root`); `--raise` duas vezes (`:root` e `[data-theme='dark']`).

- [ ] **Step 6: Reportar (NÃO commitar)**

Reportar ao controlador: arquivos tocados, saída do build, e as saídas dos greps acima. O controlador commita.

---

### Task 2: Componentes — raio, chips pill, botões, cards, hero, limpeza dos overrides

**Files:**
- Modify: `apps/web/src/styles.css` (todo o corpo do arquivo depois do bloco de tokens; principalmente linhas ~83-1472)
- Modify: `apps/web/src/components/PriceTag.tsx:52-64`
- Modify: `apps/web/src/pages/Disparos.tsx:278`

**Interfaces:**
- Consumes: todos os tokens produzidos pela Task 1.
- Produces: a classe `.card__off--badge` (badge de desconto absoluto no poço da imagem), consumida só pelo `PriceTag.tsx`.

- [ ] **Step 1: Sidebar — fixar no `--slate` e apagar o override do dark**

Em `.rail` (linha ~84), trocar `background: var(--ink);` por `background: var(--slate);`.

Em `.rail__link` (linha ~145), trocar `border-radius: var(--r);` por `border-radius: var(--r-sm);` — 12px num item de 9px de padding fica bojudo demais.

Em `.rail__user` (linha ~181), trocar `border-radius: var(--r);` por `border-radius: var(--r-sm);`.

Em `.rail__count` (linhas ~163-171), trocar `border-radius: 20px;` por `border-radius: var(--r-pill);` e `color: var(--ink);` por `color: var(--on-brand);`.

No fim do arquivo, **apagar** o bloco:

```css
[data-theme='dark'] .rail {
  background: #16171a;
}
```

- [ ] **Step 2: Botões — raio, transição simples, sem transform**

Substituir o bloco `.btn` … `.btn--sm` (linhas ~252-297) por:

```css
.btn {
  border: 1px solid var(--raise);
  background: var(--raise);
  color: #fff;
  padding: 9px 16px;
  border-radius: var(--r);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  /* A referencia nao usa animacao de entrada, keyframe, nem transicao de
     pagina. So opacidade e cor. */
  transition: opacity 0.1s ease, background 0.15s ease, border-color 0.15s ease;
}

.btn:hover {
  opacity: 0.86;
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn--ghost {
  background: transparent;
  color: var(--ink);
  border-color: var(--line);
}

.btn--ghost:hover {
  border-color: var(--ink);
  opacity: 1;
}

.btn--tag {
  background: var(--tag);
  border-color: var(--tag);
  color: var(--on-brand);
}

.btn--sm {
  padding: 6px 12px;
  font-size: 13px;
  border-radius: var(--r-sm);
}
```

(Sumiu o `.btn:active { transform: translateY(1px) }` — a spec diz "nada mais elaborado que isso".)

No fim do arquivo, **apagar** o bloco:

```css
[data-theme='dark'] .btn:not(.btn--ghost):not(.btn--tag) {
  background: #3a3b40;
  border-color: #3a3b40;
}
```

(`--raise` já cobre isso.)

- [ ] **Step 3: Inputs e painéis — raio novo**

Em `input, select, textarea` (linha ~323), trocar `border-radius: var(--r);` por `border-radius: var(--r-sm);`.

Em `.panel` (linha ~350), `.kpi` (linha ~396), `.catbox` (linha ~861), `.empty` (linha ~710), `.notice` (linha ~729), `.login form` (linha ~747), `.tag` (linha ~442), `.picked__item` (linha ~938): já usam `border-radius: var(--r)` — nada a fazer, herdam os 12px. Confirme por leitura, não edite.

Em `.taglist__item` (linha ~966), trocar `border-radius: var(--r);` por `border-radius: var(--r-pill);` — é um chip de tag, deve ser pill.

Em `.card` (linha ~1051), trocar `border-radius: 8px;` por `border-radius: var(--r);`.

Conferir por leitura (a spec pede peso 600 no preço e 400 + `--muted` no riscado; o CSS atual já está assim, então **não edite** se conferir):
- `.card__agora` (linha ~1201) e `.tag__now` (linha ~533): `font-weight: 600`
- `.kpi__value` (linha ~412): `font-weight: 600`
- `.card__antes` (linha ~1185) e `.tag__was` (linha ~540): sem `font-weight` (herda 400) e `color: var(--muted)`

Se algum divergir, ajuste pro valor da spec.

- [ ] **Step 4: Hero — fundo amarelo cheio**

Substituir `.panel--hero` e `.panel--hero .panel__title` (linhas ~367-377) por:

```css
.panel--hero {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--on-brand);
  padding: 24px;
}

/* Tudo dentro do hero vai sobre amarelo: nada ali pode seguir --ink nem
   --muted, que invertem com o tema. */
.panel--hero .panel__title,
.panel--hero p,
.panel--hero a,
.panel--hero strong {
  color: var(--on-brand);
}

.panel--hero .panel__title {
  font-size: 15px;
  font-weight: 700;
}

.panel--hero p {
  margin: 0 0 14px;
  max-width: 62ch;
}

/* Botao preto sobre o amarelo: --raise no tema escuro e cinza-chumbo e
   sumiria contra o hero. */
.panel--hero .btn {
  background: var(--slate);
  border-color: var(--slate);
  color: #fff;
  display: inline-block;
  text-decoration: none;
}
```

(O único `.panel--hero` do app está em `apps/web/src/pages/VisaoGeral.tsx:42-48`: um `h2.panel__title`, um `p`, e um `Link.btn`. As regras acima cobrem exatamente esses três.)

- [ ] **Step 5: Chips, abas e itens de catálogo — pill + ativo amarelo**

Em `.chip` (linha ~683), trocar `border-radius: 20px;` por `border-radius: var(--r-pill);`.

Substituir `.tabs__item` … `.tabs__item[data-on='true'] span` (linhas ~993-1030) por:

```css
.tabs__item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--muted);
  padding: 7px 14px;
  border-radius: var(--r-pill);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.tabs__item:hover {
  border-color: var(--ink);
  color: var(--ink);
}

.tabs__item[data-on='true'] {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--on-brand);
  font-weight: 600;
}

.tabs__item span {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  background: var(--surface);
  color: var(--ink);
  border-radius: var(--r-pill);
  padding: 1px 7px;
}

/* O contador vai sobre o amarelo da aba ativa: veu escuro + texto preso. */
.tabs__item[data-on='true'] span {
  background: rgba(22, 23, 26, 0.14);
  color: var(--on-brand);
}
```

Em `.catbox__item[data-picked='true']` (linhas ~905-908), substituir por:

```css
.catbox__item[data-picked='true'] {
  background: var(--brand);
  color: var(--on-brand);
  font-weight: 700;
}
```

Em `.catbox__item:hover` (linha ~902), trocar `background: rgba(22, 23, 26, 0.04);` por `background: var(--surface);` — o valor fixo escurece sobre fundo já escuro e não aparece.

`.catbox__raiz` (linha ~878) fica como está: `background: var(--canvas)` é sticky sobre o canvas opaco e funciona nos dois temas. Confirme por leitura, não edite.

- [ ] **Step 6: Passos e progresso**

Substituir `.steps__item[data-on='true'] .steps__num` (linhas ~1384-1388) por:

```css
.steps__item[data-on='true'] .steps__num {
  background: var(--raise);
  border-color: var(--raise);
  color: #fff;
}
```

No fim do arquivo, **apagar** o bloco:

```css
[data-theme='dark'] .steps__item[data-on='true'] .steps__num {
  background: #3a3b40;
  border-color: #3a3b40;
}
```

Em `.progress` (linha ~1405), trocar `border-radius: 20px;` por `border-radius: var(--r-pill);`.

- [ ] **Step 7: Card de produto — poço sem padding, hover sem elevação, badge de desconto**

Substituir `.card:hover` (linhas ~1059-1062) por:

```css
.card:hover {
  border-color: color-mix(in srgb, var(--ink) 28%, transparent);
}
```

(Some o `box-shadow` de elevação: a referência não levanta card no hover, e o valor era `rgba(22,23,26,.08)` — invisível sobre fundo preto.)

Substituir `.card__well` e `.card__well img` (linhas ~1070-1083) por:

```css
/* Poço da imagem: branco fixo nos dois temas. Foto recortada de loja
   assume fundo branco -- seguir --surface deixaria o recorte com halo
   escuro no tema claro e o produto flutuando no escuro. */
.card__well {
  position: relative;
  aspect-ratio: 1;
  background: #fff;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.card__well img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
```

Substituir `.card__nota` (linhas ~1090-1102) por:

```css
.card__nota {
  position: absolute;
  top: 8px;
  right: 8px;
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 600;
  background: rgba(22, 23, 26, 0.82);
  color: #fff;
  border-radius: var(--r-pill);
  padding: 2px 8px;
  cursor: help;
}
```

Adicionar, logo depois de `.card__nota`, a classe nova do badge de desconto:

```css
/* Badge de desconto: canto superior esquerdo do poço, vermelho sobre
   branco fixo -- por isso o texto e branco literal, nao um token. */
.card__off--badge {
  position: absolute;
  top: 8px;
  left: 8px;
  background: var(--drop);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  border-radius: var(--r-sm);
  padding: 3px 7px;
}
```

Trocar `.card__selo` (linha ~1121) `color: var(--ink);` por `color: var(--on-brand);` e `border-radius: 3px;` por `border-radius: var(--r-sm);`.

Trocar `.card__nicho` (linhas ~1224-1232) `color: var(--ink);` por `color: var(--on-brand);` e `border-radius: 3px;` por `border-radius: var(--r-sm);`.

Trocar `.card__ganho` (linhas ~1169-1171) `background: rgba(12, 124, 74, 0.09);` por `background: color-mix(in srgb, var(--gain) 14%, transparent);` e `border-radius: 4px;` por `border-radius: var(--r-sm);` — o RGB fixo era o verde do tema claro e some sobre fundo preto.

Trocar `.card__off` (linhas ~1206-1210) `color: var(--gain);` por `color: var(--drop);` — desconto é `--drop` pela spec; estava verde por engano.

Trocar `.tag__score` (linha ~558) `color: var(--ink);` por `color: var(--on-brand);` e `border-radius: 2px;` por `border-radius: var(--r-sm);`.

Só **depois** dessas quatro trocas, no fim do arquivo, **apagar** o bloco de pin de cor (linhas ~1450-1458), que virou redundante com `--on-brand`:

```css
[data-theme='dark'] .rail__count,
[data-theme='dark'] .btn--tag,
[data-theme='dark'] .tag__score,
[data-theme='dark'] .tabs__item[data-on='true'] span,
[data-theme='dark'] .card__selo,
[data-theme='dark'] .card__nicho,
[data-theme='dark'] .catbox__item[data-picked='true'] {
  color: #16171a;
}
```

- [ ] **Step 8: Renderizar o badge de desconto no `PriceTag.tsx`**

Em `apps/web/src/components/PriceTag.tsx`, dentro do `.card__well` (linhas 52-64), adicionar o badge. A variável `desconto` já existe na linha 48. Substituir o bloco:

```tsx
      <div className="card__well">
        {offer.product.imageUrl ? (
          <img src={offer.product.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="card__semfoto">sem foto</span>
        )}
        <span
          className="card__nota"
          title="Nota de 0 a 100: histórico de preço, desconto, comissão e reputação"
        >
          {offer.score}
        </span>
      </div>
```

por:

```tsx
      <div className="card__well">
        {offer.product.imageUrl ? (
          <img src={offer.product.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="card__semfoto">sem foto</span>
        )}
        {desconto > 0 && <span className="card__off--badge">-{desconto}%</span>}
        <span
          className="card__nota"
          title="Nota de 0 a 100: histórico de preço, desconto, comissão e reputação"
        >
          {offer.score}
        </span>
      </div>
```

O `<span className="card__off">` da linha 94 continua onde está — o badge não substitui o texto na linha de preço, ele repete a informação onde o olho bate primeiro.

- [ ] **Step 9: Estado vazio, etiqueta e miniaturas — tirar os RGB fixos**

Em `.empty` (linha ~714), trocar `background: rgba(255, 255, 255, 0.5);` por `background: var(--surface);`.

No fim do arquivo, **apagar** o bloco (virou redundante):

```css
[data-theme='dark'] .empty {
  background: rgba(255, 255, 255, 0.04);
}
```

Em `.tag::before` (linha ~471), trocar `rgba(22, 23, 26, 0.055)` por `var(--surface)` dentro do `repeating-linear-gradient`:

```css
  background: repeating-linear-gradient(
    to bottom,
    transparent 0 9px,
    var(--surface) 9px 10px
  );
```

Em `.tag:hover` (linhas ~449-452), substituir por:

```css
.tag:hover {
  border-color: color-mix(in srgb, var(--ink) 28%, transparent);
}
```

Em `.tag__thumb` (linha ~498) e `.cell-product img` (linha ~662), trocar o `border-radius` por `var(--r-sm)` (a miniatura de 34px com 12px vira quase um círculo).

Em `.login__mark` (linha ~772), trocar `background: var(--ink);` por `background: var(--slate);` e `border-radius: 10px;` por `border-radius: var(--r);`. No fim do arquivo, **apagar**:

```css
[data-theme='dark'] .login__mark {
  background: #16171a;
}
```

**Manter** o último bloco do arquivo:

```css
[data-theme='dark'] .card__semfoto {
  color: #74787f;
}
```

Ele continua necessário: o poço agora é `#fff` fixo, então o texto "sem foto" não pode seguir o flip de `--muted`.

- [ ] **Step 10: Raio inline hardcoded em `Disparos.tsx`**

Em `apps/web/src/pages/Disparos.tsx:278`, trocar `borderRadius: 2` por `borderRadius: 'var(--r-sm)'` no `style` da miniatura do produto.

(O `borderRadius: 3` em `Conexoes.tsx:177` é da Task 5, que já vai tocar aquele arquivo — não mexa aqui, evita colisão entre ondas.)

- [ ] **Step 11: Verificar**

```bash
npm run build --workspace=apps/web
```
Esperado: build verde.

```bash
grep -n "3a3b40" apps/web/src/styles.css
```
Esperado: nenhum acerto.

```bash
grep -n "16171a" apps/web/src/styles.css
```
Esperado: exatamente 3 acertos — as declarações de `--raise`, `--on-brand` e `--slate` em `:root`. (O `rgba(22, 23, 26, ...)` dos tokens translúcidos é o mesmo tom em decimal e não conta aqui.)

```bash
grep -c "data-theme='dark'\]" apps/web/src/styles.css
```
Esperado: `2` — o bloco de tokens e o override remanescente de `.card__semfoto`.

```bash
grep -n "border-radius: [0-9]" apps/web/src/styles.css
```
Esperado: nenhum acerto (`border-radius: 50%` continua permitido — é `%`, não pixel). Se sobrar algum pixel cru, converta pro token mais próximo.

- [ ] **Step 12: Reportar (NÃO commitar)**

---

### Task 3: Módulo de som do protocolo

**Files:**
- Create: `apps/web/src/protocol-sound.ts`
- Create: `apps/web/src/protocol-sound.check.ts`

**Interfaces:**
- Consumes: nada (independente do CSS).
- Produces:
  - `export const PROTOCOL_KEYS` — tupla `readonly` com as 5 chaves.
  - `export type ProtocolKey = 'disparo' | 'disparo-off' | 'tema' | 'whatsapp-on' | 'whatsapp-off'`
  - `export function playProtocolSound(key: ProtocolKey): void` — nunca lança; se não houver `AudioContext` (SSR, navegador antigo, autoplay bloqueado) sai em silêncio.
  A Task 4 importa `playProtocolSound` e `ProtocolKey`.

- [ ] **Step 1: Escrever o self-check primeiro (ele vai falhar — o módulo ainda não existe)**

Este projeto não tem test runner, e Web Audio só existe no navegador. O check abaixo roda em Node puro (v24, type-stripping nativo) contra um `AudioContext` falso que grava as chamadas — cobre exatamente o que quebra em silêncio: nó não conectado, `start()`/`stop()` esquecido, chave sem receita.

Criar `apps/web/src/protocol-sound.check.ts`:

```ts
/**
 * Self-check do grafo de audio. Roda em Node puro:
 *   node apps/web/src/protocol-sound.check.ts
 *
 * Web Audio so existe no navegador, entao o check instala um AudioContext
 * falso que grava as chamadas e confere que cada receita monta um grafo
 * completo (oscilador conectado, com start e stop agendados).
 */
import assert from 'node:assert/strict';

const reg = { osciladores: 0, buffers: 0, conexoes: 0, starts: 0, stops: 0 };

const param = () => ({
  value: 0,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
});

const no = (): any => ({
  connect() {
    reg.conexoes += 1;
    return no();
  },
  start() {
    reg.starts += 1;
  },
  stop() {
    reg.stops += 1;
  },
  frequency: param(),
  gain: param(),
  Q: param(),
  type: '',
  buffer: null,
});

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = no();
  sampleRate = 48000;
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    reg.osciladores += 1;
    return no();
  }
  createGain() {
    return no();
  }
  createBiquadFilter() {
    return no();
  }
  createBufferSource() {
    reg.buffers += 1;
    return no();
  }
  createBuffer(_canais: number, tamanho: number) {
    return { getChannelData: () => new Float32Array(tamanho) };
  }
}

(globalThis as any).AudioContext = FakeAudioContext;

const { playProtocolSound, PROTOCOL_KEYS } = await import('./protocol-sound.ts');

for (const chave of PROTOCOL_KEYS) {
  Object.assign(reg, { osciladores: 0, buffers: 0, conexoes: 0, starts: 0, stops: 0 });
  playProtocolSound(chave);

  assert.ok(reg.osciladores > 0, `${chave}: nenhum oscilador criado`);
  assert.ok(reg.conexoes >= reg.osciladores, `${chave}: oscilador sem connect`);
  assert.equal(reg.starts, reg.stops, `${chave}: start e stop desbalanceados`);
  assert.ok(reg.starts >= reg.osciladores + reg.buffers, `${chave}: no sem start`);
}

// Sem AudioContext (SSR / navegador antigo) nao pode explodir.
delete (globalThis as any).AudioContext;
const fresco = await import(`./protocol-sound.ts?limpo=${Date.now()}`);
fresco.playProtocolSound('tema');

console.log(`ok — ${PROTOCOL_KEYS.length} receitas montam grafo completo`);
```

**Ruling pré-autorizado do controlador:** o último bloco depende do Node aceitar
query string (`?limpo=`) num `import()` de arquivo `.ts` com type-stripping. Se
isso falhar no Node desta máquina, **apague só esse bloco de três linhas** (o
`delete`, o `import` e a chamada), mantenha o resto do check, e registre no
relatório que a cobertura do caminho "sem AudioContext" foi removida. Não
invente outra forma de testar esse caminho, e não instale nada pra isso.

- [ ] **Step 2: Rodar o check e ver falhar**

```bash
node apps/web/src/protocol-sound.check.ts
```
Esperado: FALHA com `ERR_MODULE_NOT_FOUND` apontando `./protocol-sound.ts`.

- [ ] **Step 3: Escrever `apps/web/src/protocol-sound.ts`**

```ts
/**
 * Feedback sonoro de "protocolo": som sintetizado na hora, sem arquivo de
 * audio e sem dependencia. Cada receita e um thump grave (seno com pitch
 * caindo) + um chime (triangulares em paralelo) + opcionalmente uma camada
 * de ruido filtrado. Chime subindo = confirmado, chime caindo = desfeito.
 */

export const PROTOCOL_KEYS = [
  'disparo',
  'disparo-off',
  'tema',
  'whatsapp-on',
  'whatsapp-off',
] as const;

export type ProtocolKey = (typeof PROTOCOL_KEYS)[number];

interface Receita {
  /** Varredura do thump grave, em Hz: [inicio, fim]. */
  thump: [number, number];
  /** Frequencias dos triangulares do chime, em Hz. Vazio = sem chime. */
  chime: number[];
  /** Camada de ruido filtrado passa-baixa junto do thump. */
  ruido: boolean;
}

const RECEITAS: Record<ProtocolKey, Receita> = {
  disparo: { thump: [190, 70], chime: [523.25, 784.0], ruido: true },
  'disparo-off': { thump: [150, 55], chime: [392.0, 261.63], ruido: true },
  tema: { thump: [140, 90], chime: [440.0], ruido: false },
  'whatsapp-on': { thump: [170, 80], chime: [440.0, 659.25], ruido: false },
  'whatsapp-off': { thump: [140, 60], chime: [329.63, 246.94], ruido: false },
};

let ctx: AudioContext | null = null;

function pegarCtx(): AudioContext | null {
  const Ctor =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // O navegador suspende o contexto ate um gesto do usuario.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Envelope de volume: ataque rapido, decaimento exponencial. */
function envelope(g: GainNode, t0: number, pico: number, ataque: number, cauda: number): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(pico, t0 + ataque);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + cauda);
}

/**
 * Toca a receita da chave. Nunca lanca: sem AudioContext (SSR, navegador
 * antigo, autoplay bloqueado) sai em silencio, porque o feedback visual
 * sozinho ja cumpre o papel.
 */
export function playProtocolSound(key: ProtocolKey): void {
  const c = pegarCtx();
  if (!c) return;

  const receita = RECEITAS[key];
  if (!receita) return;

  try {
    const t0 = c.currentTime;
    const [de, para] = receita.thump;

    // Thump: seno caindo de `de` pra `para` em 80ms, cauda de 340ms.
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(de, t0);
    osc.frequency.exponentialRampToValueAtTime(para, t0 + 0.08);
    const gThump = c.createGain();
    envelope(gThump, t0, 0.5, 0.008, 0.34);
    osc.connect(gThump);
    gThump.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.4);

    // Ruido filtrado: textura de impacto, so 120ms.
    if (receita.ruido) {
      const amostras = Math.floor(c.sampleRate * 0.12);
      const buffer = c.createBuffer(1, amostras, c.sampleRate);
      const dados = buffer.getChannelData(0);
      for (let i = 0; i < amostras; i += 1) dados[i] = Math.random() * 2 - 1;

      const src = c.createBufferSource();
      src.buffer = buffer;
      const filtro = c.createBiquadFilter();
      filtro.type = 'lowpass';
      filtro.frequency.setValueAtTime(820, t0);
      filtro.frequency.exponentialRampToValueAtTime(180, t0 + 0.12);
      const gRuido = c.createGain();
      envelope(gRuido, t0, 0.22, 0.006, 0.12);
      src.connect(filtro);
      filtro.connect(gRuido);
      gRuido.connect(c.destination);
      src.start(t0);
      src.stop(t0 + 0.14);
    }

    // Chime: entra 30ms depois do thump, e o que da a sensacao de "pronto".
    const tChime = t0 + 0.03;
    for (const hz of receita.chime) {
      const tri = c.createOscillator();
      tri.type = 'triangle';
      tri.frequency.setValueAtTime(hz, tChime);
      const gChime = c.createGain();
      envelope(gChime, tChime, 0.16, 0.01, 0.6);
      tri.connect(gChime);
      gChime.connect(c.destination);
      tri.start(tChime);
      tri.stop(tChime + 0.62);
    }
  } catch {
    // Autoplay bloqueado ou contexto morto: o overlay visual ja avisa.
  }
}
```

- [ ] **Step 4: Rodar o check e ver passar**

```bash
node apps/web/src/protocol-sound.check.ts
```
Esperado: `ok — 5 receitas montam grafo completo`

- [ ] **Step 5: Garantir que o check não entra no bundle nem quebra o typecheck**

O `protocol-sound.check.ts` não é importado por nada em `main.tsx`, então o Vite não o inclui no bundle. Mas o `tsc -b` o typecheca. Rodar:

```bash
npm run build --workspace=apps/web
```

Se o `tsc` reclamar de `import assert from 'node:assert/strict'` (tipos de Node ausentes em `apps/web`), **não instale `@types/node`**. Em vez disso, adicione o arquivo ao `exclude` do tsconfig de `apps/web` que cobre `src/`:

```json
  "exclude": ["src/**/*.check.ts"]
```

Depois rode o build de novo e confirme verde. O check continua rodável por `node`, que não usa o tsconfig.

- [ ] **Step 6: Reportar (NÃO commitar)**

Reportar: saída do check, saída do build, e se precisou mexer no tsconfig (qual arquivo, qual linha).

---

### Task 4: Overlay do protocolo (componente, contexto, estilo, wiring)

**Files:**
- Create: `apps/web/src/components/ProtocolToast.tsx`
- Modify: `apps/web/src/styles.css` (append no fim do arquivo)
- Modify: `apps/web/src/App.tsx:1-16` (imports), `apps/web/src/App.tsx:82-99` (envolver `<Layout>`)

**Interfaces:**
- Consumes: `playProtocolSound`, `ProtocolKey` de `../protocol-sound.js` (Task 3). Tokens `--r`, `--brand`, `--line` (Task 1).
- Produces:
  - `export interface ProtocolConfig { title: string; subtitle: string; accent: string; icon: 'disparo' | 'tema' | 'whatsapp'; sound: ProtocolKey }`
  - `export function ProtocolToastProvider({ children }: { children: React.ReactNode }): JSX.Element`
  - `export function useProtocolToast(): (config: ProtocolConfig) => void`
  A Task 5 chama `useProtocolToast()` e monta `ProtocolConfig`.

- [ ] **Step 1: Criar `apps/web/src/components/ProtocolToast.tsx`**

Note o `.js` no import de `../protocol-sound.js` — é a convenção ESM já usada em todo o projeto (ver `App.tsx:3-16`).

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { playProtocolSound, type ProtocolKey } from '../protocol-sound.js';

export interface ProtocolConfig {
  /** Linha de cima, caixa alta e espacada. Ex.: "DISPARO". */
  title: string;
  /** Linha de baixo. Ex.: "Iniciado". */
  subtitle: string;
  /** Cor da borda e do icone. Aceita `var(--brand)` e afins. */
  accent: string;
  icon: 'disparo' | 'tema' | 'whatsapp';
  sound: ProtocolKey;
}

const MS_NA_TELA = 1500;

const Ctx = createContext<((config: ProtocolConfig) => void) | null>(null);

/** SVG inline: 3 icones nao pagam uma dependencia de icones inteira. */
function Icone({ nome }: { nome: ProtocolConfig['icon'] }) {
  const comum = {
    width: 44,
    height: 44,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (nome === 'disparo') {
    return (
      <svg {...comum}>
        <path d="M22 2 11 13" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    );
  }

  if (nome === 'tema') {
    return (
      <svg {...comum}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }

  return (
    <svg {...comum}>
      <path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3L3 21z" />
      <path d="M8.6 9.2c.3 2.6 3.6 5.9 6.2 6.2l1.3-1.6 2 1-.6 2c-3.8.6-8.7-4.3-9.3-8.1l2-.6 1 2-1.4 1.3z" />
    </svg>
  );
}

export function ProtocolToastProvider({ children }: { children: React.ReactNode }) {
  const [atual, setAtual] = useState<{ config: ProtocolConfig; id: number } | null>(null);
  const proximoId = useRef(0);

  const show = useCallback((config: ProtocolConfig) => {
    playProtocolSound(config.sound);
    proximoId.current += 1;
    setAtual({ config, id: proximoId.current });
  }, []);

  // Um estado so: dois disparos em sequencia substituem, nao empilham. O id
  // no dep reinicia o timer e remonta a animacao.
  useEffect(() => {
    if (!atual) return;
    const timer = setTimeout(() => setAtual(null), MS_NA_TELA);
    return () => clearTimeout(timer);
  }, [atual?.id]);

  return (
    <Ctx.Provider value={show}>
      {children}
      {atual && (
        <div className="protocol" role="status" aria-live="polite">
          <div
            key={atual.id}
            className="protocol__box"
            style={{ '--protocol-accent': atual.config.accent } as React.CSSProperties}
          >
            <span className="protocol__icon">
              <Icone nome={atual.config.icon} />
            </span>
            <span className="protocol__title">{atual.config.title}</span>
            <span className="protocol__subtitle">{atual.config.subtitle}</span>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useProtocolToast(): (config: ProtocolConfig) => void {
  const show = useContext(Ctx);
  if (!show) throw new Error('useProtocolToast precisa estar dentro de <ProtocolToastProvider>');
  return show;
}
```

- [ ] **Step 2: Adicionar o CSS do overlay no FIM de `apps/web/src/styles.css`**

Colar depois do último bloco existente (`[data-theme='dark'] .card__semfoto`):

```css
/* ---------------------------------------------------------------
   Feedback de protocolo
   Overlay central, um estado so, ~1.5s. E um efeito forte de
   proposito: so 3 acoes disparam ele (disparo, tema, WhatsApp).
   --------------------------------------------------------------- */

.protocol {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  z-index: 50;
}

.protocol__box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 220px;
  padding: 26px 34px;
  border-radius: var(--r);
  border: 1px solid var(--protocol-accent, var(--line));
  /* Vidro escuro fixo nos dois temas: o overlay e um estado de sistema,
     nao uma superficie do documento. */
  background: rgba(12, 12, 17, 0.74);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  color: #f2f2f0;
  box-shadow: 0 12px 44px rgba(0, 0, 0, 0.5);
  animation: protocol-in 160ms ease-out;
}

.protocol__icon {
  color: var(--protocol-accent, var(--brand));
  display: block;
  animation: protocol-pop 420ms cubic-bezier(0.2, 1.4, 0.4, 1);
}

.protocol__title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.protocol__subtitle {
  font-size: 14px;
  color: #9a9da3;
}

@keyframes protocol-in {
  from {
    opacity: 0;
    transform: scale(0.94);
  }
}

@keyframes protocol-pop {
  0% {
    transform: scale(0.3);
  }
  100% {
    transform: scale(1);
  }
}
```

O `@media (prefers-reduced-motion: reduce)` que já existe no arquivo (linha ~842) tem `animation: none !important` no seletor `*` — ele já neutraliza as duas animações acima. Não precisa de regra extra.

- [ ] **Step 3: Envolver o `<Layout>` no Provider em `App.tsx`**

Adicionar o import junto dos outros de `./components/` (depois da linha 5):

```tsx
import { ProtocolToastProvider } from './components/ProtocolToast.js';
```

E substituir o `return` do `App` (linhas 82-99) por:

```tsx
  return (
    <ProtocolToastProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<VisaoGeral />} />
          <Route path="/fila" element={<Fila />} />
          <Route path="/desempenho" element={<Desempenho />} />
          <Route path="/grupos" element={<MeusGrupos />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/nichos" element={<Nichos />} />
          <Route path="/garimpar" element={<Garimpar />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/automacoes" element={<Automacoes />} />
          <Route path="/disparos" element={<Disparos />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </ProtocolToastProvider>
  );
```

O Provider fica **fora** do `<Layout>` mas **dentro** do gate de autenticação — a tela de login não dispara feedback nenhum.

- [ ] **Step 4: Verificar**

```bash
npm run build --workspace=apps/web
```
Esperado: build verde. Se o `tsc` reclamar do `style={{ '--protocol-accent': ... }}`, o cast `as React.CSSProperties` já está no código do Step 1 — confirme que não foi perdido.

```bash
grep -n "ProtocolToastProvider" apps/web/src/App.tsx
```
Esperado: 2 acertos (import + abertura da tag).

```bash
grep -n "protocol__box\|--protocol-accent" apps/web/src/styles.css
```
Esperado: 3 acertos ou mais.

- [ ] **Step 5: Reportar (NÃO commitar)**

---

### Task 5: Ligar o feedback nos 3 pontos de uso

**Files:**
- Modify: `apps/web/src/pages/Disparos.tsx` (imports; `criar()` ~linha 187-210; `cancelar()` ~linha 543-559)
- Modify: `apps/web/src/pages/Conexoes.tsx` (import da linha 1; `Conexoes()` ~linha 110-223; `AparenciaCard()` ~linha 225-245; `borderRadius: 3` na linha 177)

**Interfaces:**
- Consumes: `useProtocolToast` de `../components/ProtocolToast.js` (Task 4).
- Produces: nada.

- [ ] **Step 1: `Disparos.tsx` — importar o hook**

Adicionar junto dos imports do topo:

```tsx
import { useProtocolToast } from '../components/ProtocolToast.js';
```

- [ ] **Step 2: `Disparos.tsx` — feedback ao criar o disparo**

No componente que tem a função `criar()` (linha ~187), declarar o hook junto dos outros `useState` do componente:

```tsx
  const protocolo = useProtocolToast();
```

E dentro de `criar()`, logo **depois** do `await api.post('/api/disparos', {...})` e **antes** de `onCriado()`:

```tsx
      protocolo({
        title: 'DISPARO',
        subtitle: 'Iniciado',
        accent: 'var(--brand)',
        icon: 'disparo',
        sound: 'disparo',
      });
      onCriado();
```

O feedback fica **depois** do `await`, não no `onClick`: se a API recusar o disparo, o `catch` assume e nenhum som toca.

- [ ] **Step 3: `Disparos.tsx` — feedback ao cancelar**

No componente que tem `cancelar(id)` (linha ~543), declarar o hook junto dos outros estados:

```tsx
  const protocolo = useProtocolToast();
```

E dentro de `cancelar()`, logo **depois** do `await api.post(\`/api/disparos/${id}/cancelar\`)` e antes de `await carregar()`:

```tsx
      protocolo({
        title: 'DISPARO',
        subtitle: 'Cancelado',
        accent: 'var(--drop)',
        icon: 'disparo',
        sound: 'disparo-off',
      });
      await carregar();
```

Se `criar()` e `cancelar()` estiverem no mesmo componente, declare `const protocolo = useProtocolToast();` uma vez só.

- [ ] **Step 4: `Conexoes.tsx` — importar o hook, `useRef`, e corrigir o raio inline**

Trocar a linha 1:

```tsx
import { useEffect, useRef, useState } from 'react';
```

Adicionar junto dos outros imports do topo:

```tsx
import { useProtocolToast } from '../components/ProtocolToast.js';
```

Na linha 177, trocar `style={{ borderRadius: 3 }}` por `style={{ borderRadius: 'var(--r)' }}` na `<img>` do QR code.

- [ ] **Step 5: `Conexoes.tsx` — feedback no toggle de tema**

Substituir o `AparenciaCard` (linhas 225-245) por:

```tsx
function AparenciaCard() {
  const [theme, setThemeState] = useState(getTheme());
  const protocolo = useProtocolToast();

  return (
    <div className="panel">
      <h2 className="panel__title">Aparência</h2>
      <div className="row">
        <button
          className="btn btn--ghost"
          onClick={() => {
            const next = theme === 'dark' ? 'light' : 'dark';
            setTheme(next);
            setThemeState(next);
            protocolo({
              title: next === 'dark' ? 'MODO ESCURO' : 'MODO CLARO',
              subtitle: 'Aplicado',
              accent: 'var(--brand)',
              icon: 'tema',
              sound: 'tema',
            });
          }}
        >
          {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `Conexoes.tsx` — feedback do WhatsApp por transição de estado**

O `connect` é assíncrono: clicar em "Parear número" só abre o QR, a conexão de verdade acontece quando o QR é lido. O componente já faz polling de `/api/whatsapp/status` a cada 4s (linha 121), então o gatilho certo é a **transição** de `wa.status`, não o clique.

Dentro do componente `Conexoes()` (linha 110), depois do `const [wa, setWa] = useState<WaStatus | null>(null);`, adicionar:

```tsx
  const protocolo = useProtocolToast();
  // Guarda o status anterior pra disparar so na transicao, nao a cada
  // resposta do polling (que chega de 4 em 4 segundos).
  const statusAnterior = useRef<WaStatus['status'] | null>(null);
```

E depois do `useEffect` de polling existente (linha ~123), adicionar:

```tsx
  useEffect(() => {
    if (!wa) return;
    const antes = statusAnterior.current;
    statusAnterior.current = wa.status;
    // Primeira leitura da pagina nao e transicao: sem isso, abrir a tela
    // com o WhatsApp ja conectado dispararia o feedback do nada.
    if (antes === null || antes === wa.status) return;

    if (wa.status === 'connected') {
      protocolo({
        title: 'WHATSAPP',
        subtitle: 'Conectado',
        accent: 'var(--gain)',
        icon: 'whatsapp',
        sound: 'whatsapp-on',
      });
    } else if (antes === 'connected') {
      protocolo({
        title: 'WHATSAPP',
        subtitle: 'Desconectado',
        accent: 'var(--drop)',
        icon: 'whatsapp',
        sound: 'whatsapp-off',
      });
    }
  }, [wa?.status]);
```

Os handlers de clique (`connect`, `logout`, "Apagar sessão e parear do zero") **não** ganham chamada de `protocolo` — o `useEffect` acima já cobre os quatro caminhos, porque todos terminam mudando `wa.status`.

- [ ] **Step 7: Verificar**

```bash
npm run build --workspace=apps/web
```
Esperado: build verde.

```bash
grep -n "useProtocolToast\|protocolo({" apps/web/src/pages/Disparos.tsx
```
Esperado: 1 import + 1 ou 2 declarações + 2 chamadas.

```bash
grep -n "useProtocolToast\|protocolo({" apps/web/src/pages/Conexoes.tsx
```
Esperado: 1 import + 2 declarações + 3 chamadas.

```bash
grep -rn "borderRadius: [0-9]" apps/web/src
```
Esperado: nenhum acerto.

- [ ] **Step 8: Reportar (NÃO commitar)**

---

### Task 6: Varredura final e revisão

**Files:** nenhum (só verificação — se achar problema, reporte em vez de corrigir por conta própria).

**Interfaces:** consome tudo; produz o relatório final.

- [ ] **Step 1: Build limpo do zero**

```bash
rm -rf apps/web/dist apps/web/tsconfig.tsbuildinfo apps/web/node_modules/.vite
npm run build --workspace=apps/web
```
Esperado: build verde, sem warning de TypeScript.

- [ ] **Step 2: Rodar o self-check do áudio**

```bash
node apps/web/src/protocol-sound.check.ts
```
Esperado: `ok — 5 receitas montam grafo completo`

- [ ] **Step 3: Caçar cor e raio hardcoded que sobraram**

```bash
grep -n "#[0-9a-fA-F]\{3,6\}" apps/web/src/styles.css
```

Só estes acertos são esperados (todos deliberados, cada um com comentário no arquivo explicando):
- os valores dos tokens nos blocos `:root` e `[data-theme='dark']`
- `#fff` como texto sobre `--raise` / `--slate` / `--drop` (botão primário, sidebar, badge de desconto, `.card__nota`, passos)
- `#fff` no `.card__well` (poço da foto de produto)
- `#f2f2f0` e `#9a9da3` no `.protocol__box` / `.protocol__subtitle` (overlay é vidro escuro fixo)
- `#74787f` no `[data-theme='dark'] .card__semfoto`

Qualquer outro acerto é uma cor que escapou do sistema de tokens — reporte com o número da linha.

```bash
grep -rn "style={{" apps/web/src
```
Esperado: só estilos de layout (`display`, `gap`, `marginTop`, `width`, `fontSize`, `flexShrink`, `paddingLeft`, `lineHeight`, `objectFit`, `cursor`, `textAlign`, `height`), cores via `var(--...)`, e o `Layout.tsx:82` (`rgba(255,255,255,.25)` / `#fff` — deliberado, é botão sobre a sidebar escura fixa). Nada de `borderRadius` numérico, nada de hex cru novo.

- [ ] **Step 4: Conferir que os overrides antigos do dark morreram**

```bash
grep -n "data-theme='dark'" apps/web/src/styles.css
```
Esperado: exatamente **2** acertos — o bloco de tokens e `[data-theme='dark'] .card__semfoto`. Todos os outros overrides pontuais foram substituídos por `--on-brand`, `--slate` e `--raise`.

- [ ] **Step 5: Conferir que nada de negócio foi tocado**

```bash
git diff --stat HEAD
```
Esperado: mudanças **apenas** em `apps/web/index.html`, `apps/web/src/styles.css`, `apps/web/src/App.tsx`, `apps/web/src/components/PriceTag.tsx`, `apps/web/src/components/ProtocolToast.tsx` (novo), `apps/web/src/protocol-sound.ts` (novo), `apps/web/src/protocol-sound.check.ts` (novo), `apps/web/src/pages/Disparos.tsx`, `apps/web/src/pages/Conexoes.tsx`, e possivelmente um `tsconfig` de `apps/web`. **Zero** arquivo em `apps/api/` ou `prisma/`.

```bash
git diff HEAD -- apps/web/src/pages/Disparos.tsx apps/web/src/pages/Conexoes.tsx
```
Ler o diff inteiro: as únicas mudanças permitidas nesses dois arquivos são imports, declarações de hook, chamadas de `protocolo({...})`, o `useEffect` de transição do WhatsApp, e os dois `borderRadius`. Qualquer alteração em chamada de API, payload, ou condicional de renderização é regressão — reporte.

- [ ] **Step 6: Relatório final ao controlador**

Reportar, nesta ordem:
1. Saída do build limpo.
2. Saída do self-check de áudio.
3. Lista de qualquer hex/raio hardcoded que sobrou fora da lista esperada.
4. `git diff --stat HEAD`.
5. Lista explícita do que **não** foi verificado: aparência real no navegador nos dois temas, e se os sons soam bem. A spec proíbe o dev server, então isso fica pro usuário conferir depois do merge e do rebuild do container `web`.

---

## Depois do plano executado (controlador, com o usuário)

Fora do escopo das tarefas acima, e só com o usuário revisando:

1. Usuário revisa o diff completo da branch.
2. Merge local em `docker-e-identidade`.
3. Rebuild do container Docker `web` (só `web` — nada de backend mudou neste plano).
4. Checagem de log/health.
