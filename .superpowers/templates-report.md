# Sistema de modelos de mensagem com CTA rotativo

## O que foi implementado

### 1. Prisma model — `apps/api/prisma/schema.prisma`

`MessageTemplate`, adicionado logo depois de `WhatsappGroup` (perto de `AppSetting`/`SendLog`, o
cluster de configuração/mensageria no fim do arquivo):

```prisma
/// Modelo de mensagem reaproveitavel. Corpo com tokens ({TITULO} {PRECO}
/// {PRECO_ANTIGO} {LINK} {CUPOM}) trocados pelos dados da oferta na hora do
/// envio. `ctas` e um pool de chamadas finais -- uma sorteada por envio, pra
/// nao repetir sempre a mesma linha. Ainda nao e usado por nada: existe pra
/// alimentar a futura tela de Disparos.
model MessageTemplate {
  id        String   @id @default(cuid())
  name      String   @unique
  body      String
  ctas      String[] @default([])
  showImage Boolean  @default(true)
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Segue as convenções existentes: cuid, `createdAt`/`updatedAt`, doc-comment `///` em português
explicando o "porquê" (por que `ctas` existe, por que o modelo ainda não é consumido por nada).

### 2. Serviço de renderização — `apps/api/src/services/template.ts` (novo)

`renderTemplate(body, data, ctas?, escolherCta?)`, pura, sem I/O. Reaproveita o `brl()` de
`message.ts` (só recebeu `export`, nenhuma outra mudança nesse arquivo — ver seção de
self-review).

`escolherCta` é injetável (default: `Math.random()`), exatamente pra deixar a escolha
"testável por inspeção" sem precisar de framework de teste, como pedido.

### 3. Rotas — `apps/api/src/routes/templates.ts` (novo)

CRUD completo + preview, seguindo o estilo de `nichos.ts`/`automacoes.ts` (Zod no corpo, erro
`reply.code(400/404/409).send({ error })`, função `serialize`):

- `GET /api/templates` — lista, padrão primeiro, depois por nome.
- `POST /api/templates` — cria; 409 se o nome já existe.
- `PUT /api/templates/:id` — atualiza; 404 se não existe; 409 se o novo nome colide com outro
  registro.
- `DELETE /api/templates/:id` — remove.
- `POST /api/templates/preview` — renderiza um corpo (ainda não salvo) contra uma oferta de
  mentira fixa (`OFERTA_EXEMPLO`), pra UI mostrar o resultado sem precisar de oferta real.

Registrada em `apps/api/src/server.ts`, dentro do bloco autenticado, entre `statsRoutes` e
`watchRoutes` (ordem alfabética mantida, tanto no import quanto no register).

### 4. Página — `apps/web/src/pages/Templates.tsx` (novo)

Modelada em cima de `Automacoes.tsx`: mesmo layout de lista de painéis + formulário inline de
criar/editar, mesmas classes (`panel`, `head`, `field`, `row`, `btn`, `chip`, `taglist`,
`empty`, `notice`, `split`). Nenhuma classe CSS nova foi necessária — `.split` (dois-colunas, já
usada em Nichos pra "catálogo | escolhidos") serve perfeitamente pro par "textarea | preview".

Tem: lista com nome, badge "padrão", badge "sem foto"; formulário com nome, toggle "Anexar
foto", toggle "Padrão", botões-chip que inserem token no cursor da textarea (via
`selectionStart`/`selectionEnd` + `requestAnimationFrame` pra reposicionar o cursor depois do
insert), lista de CTAs (input + Enter/botão "Adicionar", cada chip com um "×" pra remover), e
preview ao vivo (debounce de 300ms, chama `POST /api/templates/preview`).

Rota `/templates` em `App.tsx`, entrada de nav "Modelos" em `Layout.tsx`.

## Decisões (conforme pedido no prompt)

**Token ausente (`{PRECO_ANTIGO}` sem `comparePrice`, `{CUPOM}` sem `couponCode`):** duas
regras, aplicadas por linha:
1. Se a linha só existe por causa de token(s) ausente(s) (nenhum outro token conhecido com
   valor nela), a linha inteira é removida — não sobra linha em branco.
2. Caso especial pro risco do WhatsApp: o par `~{PRECO_ANTIGO}~` é tratado como uma unidade só.
   Se `comparePrice` está ausente, `~{PRECO_ANTIGO}~` inteiro vira `''` (nunca sobra um `~~`
   solto). Isso significa que, numa linha tipo `"De ~{PRECO_ANTIGO}~ por *{PRECO}*"`, o preço
   antigo ausente deixa `"De por *R$ 99*"` — sem artefato de markup, mas sem reescrever a
   moldura "De ... por" (o serviço é genérico sobre texto livre do usuário, não conhece a
   gramática ao redor do token; ajustar isso exigiria um mini-parser de frase, fora de escopo).
   Documentado como limitação conhecida.

**Token desconhecido (typo, ex. `{TITULOO}`):** fica intacto no texto de saída, sem
substituição e sem remoção de linha. Decisão deliberada: apagar silenciosamente esconderia o
erro de digitação de quem escreveu o modelo — melhor o usuário ver o `{TITULOO}` cru na
pré-visualização e perceber o typo.

**Apagar o modelo padrão:** o DELETE promove automaticamente o modelo mais recente
(`createdAt desc`) que sobrou a `isDefault: true`, se houver algum. Também espelhei a mesma
invariante na criação: o primeiro modelo criado do zero (contagem 0) já nasce padrão
independente do que veio no corpo — assim a lista nunca fica "sem padrão" enquanto existir pelo
menos um modelo.

**Seção de navegação:** "Automação" (ao lado de Agenda/Automações), não "Configurações". A
justificativa do próprio Layout.tsx é a divisão temática: "Configurações" hoje só tem Conexões
(config de infraestrutura/WhatsApp), enquanto Templates é conteúdo que a futura tela de
Disparos vai consumir — o mesmo papel que Automações já tem hoje (regras que disparam
sozinhas). Fica mais perto do vizinho certo.

## Hand-trace das 4 substituições pedidas

Dados de exemplo usados (iguais ao `OFERTA_EXEMPLO` da rota de preview):
`title="Fone de Ouvido Bluetooth XYZ Pro"`, `price=89.9` → `brl` = `"R$ 89,90"`,
`comparePrice=149.9` → `brl` = `"R$ 149,90"`, `couponCode="PROMO10"`,
`link="https://oferta.hub/r/exemplo"`.

Corpo de modelo usado no traço (mistura os 5 tokens, replica o padrão "De/por" do `message.ts`):

```
{TITULO}

De ~{PRECO_ANTIGO}~ por *{PRECO}*
Cupom: {CUPOM}

{LINK}
```

**Caso 1 — todos os tokens presentes** (comparePrice e couponCode preenchidos):
```
Fone de Ouvido Bluetooth XYZ Pro

De ~R$ 149,90~ por *R$ 89,90*
Cupom: PROMO10

https://oferta.hub/r/exemplo
```
Com `ctas=["Corre que acaba!"]`, sorteando o único item, sai mais `\n\nCorre que acaba!` no
final. Limpo, sem artefatos.

**Caso 2 — sem preço antigo** (`comparePrice: null`, cupom presente):
```
Fone de Ouvido Bluetooth XYZ Pro

De por *R$ 89,90*
Cupom: PROMO10

https://oferta.hub/r/exemplo
```
`~{PRECO_ANTIGO}~` some inteiro (sem `~~` sobrando); a linha do cupom, que tem valor, fica
intacta. "De por" é o efeito colateral documentado acima.

**Caso 3 — sem cupom** (`couponCode: null`, preço antigo presente):
```
Fone de Ouvido Bluetooth XYZ Pro

De ~R$ 149,90~ por *R$ 89,90*

https://oferta.hub/r/exemplo
```
A linha `"Cupom: {CUPOM}"` some inteira — não sobra `"Cupom: "` nem linha em branco extra no
lugar dela (o `\n{3,} → \n\n` limpa qualquer sobra de espaçamento ao redor da linha removida).

**Caso 4 — token com typo** (`{TITULOO}` no lugar de `{TITULO}`):

Corpo: `"{TITULOO}\n\n{PRECO}"` → saída:
```
{TITULOO}

R$ 89,90
```
`{TITULOO}` não bate em nenhum token conhecido (`"TITULOO" in vals` é falso), então a linha não
entra na regra de remoção e o regex de substituição devolve o `match` original — o typo fica
visível pro usuário, como pedido.

## Build

- `npx prisma generate --schema apps/api/prisma/schema.prisma` — OK, gerou o client sem tocar
  no banco (nenhuma conexão feita, só leitura do schema local).
- `npm run build` (raiz) — **api**: `tsc -p tsconfig.json` saiu 0. **web**: `tsc -b && vite
  build` saiu 0, bundle gerado normalmente.

## Arquivos alterados/criados

- `apps/api/prisma/schema.prisma` — model `MessageTemplate` adicionado.
- `apps/api/src/services/message.ts` — `brl` ganhou `export` (única mudança; `renderMessage`
  intocado).
- `apps/api/src/services/template.ts` — **novo**, `renderTemplate`.
- `apps/api/src/routes/templates.ts` — **novo**, CRUD + preview.
- `apps/api/src/server.ts` — import e register de `templateRoutes`.
- `apps/web/src/pages/Templates.tsx` — **novo**, página de gestão.
- `apps/web/src/App.tsx` — rota `/templates`.
- `apps/web/src/components/Layout.tsx` — item de nav "Modelos" no grupo "Automação".

## Self-review

- `message.ts`: diff confirmado com `git diff` — só a palavra `export` adicionada à linha do
  `brl`. Nenhuma outra linha tocada. `renderMessage()` e todo o fluxo da Fila continuam
  exatamente como estavam.
- Nenhum chamador existente de `renderMessage()` foi tocado (não toquei em `routes/offers.ts`
  nem em nenhum worker).
- `git diff --stat` em `package.json`/`package-lock.json` (raiz e dos dois workspaces) veio
  vazio — nenhuma dependência nova foi adicionada.
- Extensões `.js` em todos os imports relativos novos (ESM), conferido em `template.ts`,
  `templates.ts`, `server.ts`, `Templates.tsx`, `App.tsx`, `Layout.tsx`.
- Os 4 casos de substituição acima foram traçados à mão linha por linha contra o código de
  `renderTemplate` antes de escrever este relatório.

## Schema NÃO aplicado

**O schema NÃO foi aplicado no banco.** `prisma generate` só regenerou o client TypeScript
local a partir do arquivo `schema.prisma` — nenhuma conexão com o Postgres em Docker foi feita,
nenhum `db push`/`migrate` rodou. **O dono precisa rodar `npm run db:push
--workspace=apps/api` (ou equivalente) antes de qualquer rota `/api/templates/*` funcionar** —
até lá, a tabela `MessageTemplate` não existe no banco real e as chamadas vão falhar em tempo
de execução.

## Preocupações

- O efeito colateral "De por *R$ 89,90*" quando falta preço antigo (caso 2 do hand-trace) é
  esteticamente imperfeito, mas deliberado — documentado acima e não escondido.
- Nenhum teste automatizado foi adicionado (framework de teste não existe no projeto, e o
  prompt pediu explicitamente pra não adicionar um); verificação feita via hand-trace dos 4
  casos, documentada nesta seção acima.
- O botão "Tornar padrão" na lista faz um PUT reenviando o registro inteiro (nome, body, ctas,
  showImage) só pra trocar `isDefault` — segue o mesmo padrão que `alternarAtiva` já usa em
  `Automacoes.tsx` (reenviar o objeto todo no PUT), então não é uma inconsistência nova.
