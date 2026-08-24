# Prompt para a próxima sessão — Redesign visual completo (preto + amarelo)

> Cole este arquivo inteiro como prompt inicial da sessão (modelo recomendado: Opus 5, effort high).
> Este arquivo é o resultado de uma sessão de brainstorming já aprovada pelo usuário — as decisões de
> design abaixo estão travadas, não re-negocie com o usuário a menos que ele peça mudança. Comece
> direto pela fase de execução: **use a skill `superpowers:writing-plans` pra transformar isto num
> plano de implementação tarefa-a-tarefa, depois `superpowers:subagent-driven-development` pra
> executar.** Antes de tudo, use `superpowers:using-git-worktrees` pra isolar o trabalho — não mexa
> direto em `docker-e-identidade`.

## Objetivo

Redesenhar visualmente o app inteiro (`apps/web`) — cores, tipografia, raio de borda, componentes,
transições — inspirado no visual do site de referência (concorrente direto), **mantendo**:

- Nome do app: **Hub Ofertas** (não muda).
- Cor de marca: **amarelo** `#ffe01b` (`--brand` atual) continua sendo a cor de destaque/CTA — não
  adote a paleta laranja/âmbar da referência, só a estrutura visual (fundo preto, cards em véu
  translúcido, tipografia, raio, chips, badges).
- **Os dois temas continuam existindo** (claro e escuro, toggle já implementado em
  `apps/web/src/theme.ts` + `Configuracoes.tsx`). O preto vira o tema escuro oficial redesenhado; o
  tema claro é redesenhado em paralelo com a mesma lógica de componentes, só invertendo a base
  clara/escura (ver seção de tokens abaixo).
- Estrutura de rotas, nav e funcionalidade **não muda** — isto é reskin visual, não reestruturação
  (a reestruturação de nav/grupos já foi feita numa sessão anterior). Não toque em lógica de negócio,
  chamadas de API, ou schema do Prisma.

## Referência

Site de referência: `https://app.garimpalinks.com.br` (concorrente direto, ferramenta similar de
curadoria de ofertas). Páginas inspecionadas nesta sessão: `/visao-geral` e `/garimpar`, via
`agent-browser` (chrome-devtools MCP) — screenshot + `evaluate_script` pra pegar valores computados
reais (não é chute visual). Se precisar reconferir algo, abra essas URLs de novo com o MCP
`chrome-devtools` (`new_page`/`navigate_page` + `take_screenshot`/`evaluate_script`).

Valores reais medidos na referência (via `getComputedStyle`):
- `body` background: `rgb(12, 12, 17)`
- sidebar background: `rgba(17, 17, 20, 0.66)`
- card: `background: rgba(255, 255, 255, 0.055)` sobre o canvas, `border: 1px solid rgba(255, 255, 255, 0.1)`, `border-radius: 12px`
- fonte: **Space Grotesk** em tudo, inclusive números/preços (peso 600 nos preços, 400 no preço riscado) — sem fonte mono separada
- botão/link: `transition: opacity 0.1s` — nada de animação elaborada

## Estado atual do projeto (pra não redescobrir)

- `apps/web/index.html:14-17` — importa Google Fonts `Archivo` (400-800) + `IBM+Plex+Mono` (400-600).
  Troca pra `Space Grotesk` (400/500/600/700).
- `apps/web/src/styles.css`:
  - `:root` (tema claro, linhas ~1-25): `--brand: #ffe01b`, `--tag: var(--brand)`, `--drop: #d93a1e`,
    `--gain: #0c7c4a`, `--display: 'Archivo', system-ui, sans-serif`, `--mono: 'IBM Plex Mono', ...`,
    `--r: 3px` (raio atual, pequeno — vira 12px no redesign).
  - `[data-theme='dark']` (linhas ~26-40ish): já existe, `--drop: #ff6b52`, `--gain: #22a866`,
    `--brand`/`--tag` não mudam entre temas (mantenha assim). Essa é a base que você vai redesenhar,
    não recriar do zero — é bem menos trabalho estender o que já existe do que reescrever.
  - Ver `.superpowers/dark-mode-report.md` no histórico do repo pra entender os overrides pontuais
    que já existem (`.rail`, `.login__mark`, `.btn`, `.tabs__item[data-on='true']`, etc.) — o redesign
    vai mexer nessas mesmas superfícies, não recrie a lógica de override do zero.
- Cerca de 20 páginas em `apps/web/src/pages/*.tsx`, todas usando as classes utilitárias já definidas
  em `styles.css` (`.panel`, `.panel--hero`, `.card`, `.tabs`/`.tabs__item`, `.chip`, `.btn`/`.btn--ghost`/
  `.btn--tag`, `.table`, `.catbox`, `.empty`, `.notice`, `.kpi`, `.grid-kpi`, etc.). O redesign deve ser
  feito **majoritariamente em `styles.css`** (tokens + regras de componente), não reescrevendo o JSX de
  cada página — a estrutura HTML/classes já existe, é troca de valores visuais.

## Tokens novos — tema escuro (substituem os valores atuais em `[data-theme='dark']`)

| Token | Valor | Uso |
|---|---|---|
| `--canvas` | `#0c0c11` | fundo da página |
| `--surface` | `rgba(255,255,255,.055)` sobre `--canvas` | cards/painéis (véu translúcido, não cor sólida) |
| `--line` | `rgba(255,255,255,.1)` | bordas |
| `--ink` | `#f2f2f0` | texto principal |
| `--muted` | `#9a9da3` | texto secundário |
| `--brand` | `#ffe01b` (inalterado) | hero, CTA, estado ativo de chip/tab |
| `--drop` | `#ff6b52` (mantém o valor atual do dark) | badge de desconto |
| `--gain` | `#22a866` (mantém o valor atual do dark) | comissão/ganho |
| `--r` | `12px` | raio padrão de card/painel |

Sidebar (`.rail`) já é fixa em `#16171a` nos dois temas hoje — mantenha, é equivalente ao
`rgba(17,17,20,.66)` da referência (não precisa virar translúcida, o valor sólido atual já funciona).

## Tokens novos — tema claro (mesma lógica, invertida)

| Token | Valor | Uso |
|---|---|---|
| `--canvas` | `#f4f4f2` (quase-branco, não branco puro) | fundo da página |
| `--surface` | `rgba(22,23,26,.04)` sobre `--canvas` | cards/painéis (véu escuro translúcido, invertido) |
| `--line` | `rgba(22,23,26,.1)` | bordas |
| `--ink` | `#16171a` | texto principal |
| `--muted` | `#74787f` | texto secundário |
| `--brand` | `#ffe01b` (inalterado) | hero, CTA |
| `--drop` | `#d93a1e` (mantém valor atual do claro) | badge de desconto |
| `--gain` | `#0c7c4a` (mantém valor atual do claro) | comissão/ganho |
| `--r` | `12px` | mesmo raio do escuro — consistência entre temas |

## Tipografia

- Fonte única **Space Grotesk** (Google Fonts, pesos 400/500/600/700) em todo o app — texto normal,
  títulos, e números/preços. Remove `Archivo` e `IBM Plex Mono` do import e das variáveis CSS
  (`--display`, `--mono` colapsam pra uma variável só, ou mantenha os dois nomes de variável apontando
  pra Space Grotesk se preferir não caçar todo uso de `var(--mono)` no código — decisão de execução,
  não vale a pena forçar um jeito só).
- Preços/números: peso 600. Preço riscado/secundário: peso 400, cor `--muted`.

## Componentes a redesenhar

- **Chips de filtro** (plataforma, ordenação — já existem em `.tabs__item`, `.chip`, `.catbox__item`):
  pill (`border-radius: 999px`), fundo neutro por padrão, estado ativo (`[data-on='true']` ou
  equivalente) vira `--brand` com texto escuro fixo (`#16171a`, não `var(--ink)` — se não, no tema
  escuro o texto vira quase-branco sobre fundo amarelo e perde contraste; ver o padrão que já existe
  em `.rail__count`/`.btn--tag`/`.tag__score` no `[data-theme='dark']` de `styles.css` pra copiar a
  mesma técnica de "pin de cor").
- **Badge de desconto**: canto superior esquerdo de imagem de produto, fundo vermelho (`--drop`),
  texto branco, pequeno e absoluto.
- **Comissão/ganho**: texto `--gain`, igual já é feito hoje.
- **Card de produto** (ex: `.card` na Fila, grid do futuro Garimpar): imagem cheia no topo sem
  padding, título até 2 linhas, preço atual + preço riscado, rodapé "vendas · comissão", raio 12px,
  borda `--line`.
- **Hero/CTA principal** (`.panel--hero`, já existe): fundo `--brand` cheio, texto preto — não muda de
  cor, só ajusta raio/espaçamento pro padrão novo.
- **Botões**: manter `.btn`/`.btn--ghost` como classes, mas revisar raio (pill ou 12px, decidir na
  implementação olhando o conjunto) e transição (`opacity .1s` ou `background .15s`, nada mais
  elaborado que isso — a referência não usa animação de entrada, keyframe, ou transição de página).

## Escopo

**App inteiro** — todas as páginas em `apps/web/src/pages/*.tsx`, `Layout.tsx` (sidebar), `App.tsx`
(login screen também). Como é majoritariamente CSS (tokens + regras de componente reaproveitando
classes existentes), a maior parte do trabalho cabe num plano com poucas tarefas grandes
(`styles.css` como arquivo central) em vez de uma tarefa por página — só crie tarefa por página se
alguma tiver estilo inline (`style={{...}}`) que precise virar classe pra herdar os novos tokens (isso
já aconteceu antes nesta sessão em `Garimpar.tsx`, por exemplo — procure outros casos assim com
`grep -rn "style={{" apps/web/src`).

## Feature extra — feedback de "protocolo" (som sintetizado + overlay central)

Descoberto inspecionando `https://app.garimpalinks.com.br/grupos` (aba Proteção) com `agent-browser`
(chrome-devtools MCP) — cliquei no toggle "Escudo", capturei o áudio via monkeypatch de
`AudioContext`/`createOscillator`, e **baixei e li o bundle JS de produção deles direto**
(`_next/static/chunks/*.js`) pra confirmar a implementação real, não é chute visual. Mecanismo
confirmado:

**Som — sintetizado, não é arquivo de áudio.** Um `AudioContext` único, criado só na primeira vez que
precisa tocar algo (lazy singleton), reaproveitado depois (dá `resume()` se estiver suspenso). Uma
função `playProtocolSound(chave)` com uma receita por ação — cada receita é osciladores +
`GainNode` (envelope de volume via `setValueAtTime`/`exponentialRampToValueAtTime`) + às vezes um
"thump" de ruído (um `AudioBuffer` preenchido com `Math.random()*2-1` por amostra, passado por um
`BiquadFilterNode`). Exemplo real da receita "escudo" (delta de ativação, ~400ms de duração total):
- Oscilador seno, frequência caindo de 180Hz pra 80Hz em 80ms (`exponentialRampToValueAtTime`), gain
  subindo rápido (8ms de ataque) e caindo em 340ms — o "thump" grave principal.
- Um `BufferSource` com ruído filtrado passa-baixa (820Hz→180Hz), gain curto — textura de impacto.
- Dois osciladores triangulares em paralelo (110Hz + 165Hz) tocando ~30ms depois do thump principal,
  decaindo em 600ms — o "chime" agudo que dá a sensação de "confirmado".

Cada ação (`"escudo"`, `"filtro"`, `"disparo"`, guilhotina/outros) tem sua própria receita, mas todas
seguem o mesmo formato: osciladores com pitch caindo/subindo + envelope de gain rápido + opcionalmente
uma camada de ruído filtrado. Não precisa (nem deve) copiar as receitas exatas deles — é só escrever
o equivalente com Web Audio puro, sem nenhuma lib nova.

**Visual — um estado só, tipo toast.** Um contador de id + um objeto de config
(`{title, subtitle, accent, Icon, iconAnim, id}`) setado no mesmo `onClick` que dispara o som. Ex.:
`{title:"ESCUDO", subtitle:"Ativado", accent:"#2bbd7e", Icon:ShieldCheck, iconAnim:"pop"}`. Um
componente renderiza esse estado como overlay central fixo (fundo com leve blur/glass, borda com a
cor `accent`, ícone grande com animação nomeada — `"pop"` = escala com bounce, `"swing"` = balanço,
vistos nos dois exemplos capturados), auto-desaparece depois de ~1.2-1.8s.

### Onde aplicar no Hub Ofertas

Decisão do usuário: aplicar em 3 pontos (não em tudo — é um efeito forte, não deve virar ruído visual
constante):

1. **Iniciar/cancelar Disparo** — `apps/web/src/pages/Disparos.tsx`, no handler que chama
   `api.post('/api/disparos', {...})` (linha ~194, criação) e no que chama
   `api.post(\`/api/disparos/${id}/cancelar\`)` (linha ~552, cancelamento). Sugestão de config:
   iniciar → título "DISPARO", subtítulo "Iniciado", accent `--brand`; cancelar → título "DISPARO",
   subtítulo "Cancelado", accent `--drop`.
2. **Alternar modo escuro/claro** — `apps/web/src/pages/Conexoes.tsx`, no `AparenciaCard`, dentro do
   `onClick` que chama `setTheme(next)` (linha ~236). Sugestão: título "MODO ESCURO"/"MODO CLARO"
   conforme o novo estado, accent `--brand`.
3. **Conectar/desconectar WhatsApp** — `apps/web/src/pages/Conexoes.tsx`, nos handlers que chamam
   `api.post('/api/whatsapp/connect')` (linha ~190, e o de "apagar sessão e parear do zero" na linha
   ~201) e `api.post('/api/whatsapp/logout')` (linhas ~170 e ~200). Sugestão: conectar → título
   "WHATSAPP", subtítulo "Conectado", accent verde (`--gain`); desconectar → subtítulo
   "Desconectado", accent `--drop`. Cuidado: o connect é assíncrono e só conecta de verdade quando o
   QR é lido — não dispare o feedback no clique do botão "Parear número" (isso só abre o QR), dispare
   quando `wa.status` transicionar pra `'connected'` (dá pra fazer com um `useEffect` observando essa
   mudança de estado, já que a página já faz polling do status a cada 4s).

### Implementação sugerida (arquitetura, não código pronto — decidir no plano)

- Um módulo novo `apps/web/src/protocol-sound.ts`: `AudioContext` lazy singleton + uma função
  `playProtocolSound(chave: 'disparo' | 'tema' | 'whatsapp-on' | 'whatsapp-off')` com uma receita
  Web Audio por chave, no mesmo espírito do exemplo acima — mas com receitas próprias (não precisa,
  nem deve, soar idêntico à referência).
- Um componente novo `apps/web/src/components/ProtocolToast.tsx` + um jeito simples de disparar de
  qualquer página — como o app não tem um provedor de contexto global hoje além do que já existe em
  `Layout.tsx`, o mais barato é um `Context` pequeno (`ProtocolToastProvider` envolvendo `<Layout>`
  em `App.tsx`, expondo um hook `useProtocolToast()` que devolve uma função `show(config)` chamando
  `playProtocolSound` junto). Evite over-engineering aqui — não precisa de fila de múltiplos toasts
  simultâneos, um estado único (substitui o anterior se dois dispararem em sequência) já cobre os 3
  pontos de uso acima.
- Ícones: o projeto não tem nenhuma lib de ícones hoje (checar antes de assumir) — usar SVG inline
  simples (2-3 ícones bastam: escudo/check, sol/lua, WhatsApp) em vez de instalar `lucide-react` só
  pra isso, a menos que o plano decida que vale a pena pro resto do app também.

## Restrições rígidas (não negociáveis, valem pra qualquer sessão neste projeto)

- **Nunca rode `npm run dev` / `npm run dev:api` / `npm run dev:web`** — a API conecta automático
  numa conta REAL de WhatsApp via Baileys assim que sobe. Verificação é só
  `npm run build --workspace=apps/web` (typecheck + vite build) e revisão de diff — nunca dev server.
- **Nunca rode `prisma db push`/`migrate`/`studio`** — este redesign não deveria precisar de nenhuma
  mudança de schema (é puramente visual). Se em algum ponto parecer que precisa, pare e pergunte —
  provavelmente é sinal de que o escopo saiu do que foi pedido aqui.
- Isole o trabalho num git worktree (`superpowers:using-git-worktrees`), branch nova a partir de
  `docker-e-identidade`. Nunca commite/rebuild direto na branch principal sem o usuário revisar.
- Depois de pronto e revisado: siga o mesmo padrão desta madrugada — merge local, rebuild dos
  containers Docker (`web`+`api` se algo de backend mudar, provavelmente só `web` aqui), checagem de
  log/health — sempre com o usuário revisando antes de qualquer rebuild/deploy em produção.
