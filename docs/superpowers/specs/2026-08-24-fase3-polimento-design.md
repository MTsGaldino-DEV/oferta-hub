# Fase 3 — Polimento: Fila, Meus Grupos e Desempenho

Data: 2026-08-24
Status: aprovado para planejamento

## Contexto

As fases 1 e 2 mexeram em estrutura e capacidade. Esta mexe no que o usuário
olha todo dia. São três telas, com pedidos concretos que ele fez olhando o
produto em uso.

Nenhuma das três precisa de conceito novo: é redesenho, ordenação, paginação e
um contador que ainda não existe.

## O que muda

### 1. Fila

**"Adicionar oferta" ocupa a tela sem merecer.** O bloco fica sempre aberto no
topo, com destaque amarelo, e empurra a fila para baixo. Ele é usado poucas
vezes por sessão — o normal é olhar a fila, não adicionar à mão.

- O bloco vira um **accordion fechado por padrão**. Um cabeçalho discreto com
  "Adicionar oferta" e um chevron; clicar expande o formulário no lugar,
  empurrando a lista para baixo só enquanto estiver aberto.
- Sem destaque amarelo: o cabeçalho tem o mesmo peso visual de qualquer outro
  controle da página. O amarelo da marca fica reservado para a ação principal
  do produto, que é enviar.
- O estado aberto/fechado **não** persiste entre visitas. Abrir é barato, e um
  formulário que reabre sozinho recria o problema.

**Os botões de ação do card** (`apps/web/src/components/PriceTag.tsx`) ganham
resposta ao passar o mouse:

- **"Enviar ao grupo"** — fundo amarelo da marca, texto preto.
- **"Pular"** — fundo vermelho, texto preto.

Hoje os dois usam a cor padrão do botão e não reagem. A cor no hover carrega
significado: o amarelo da marca para a ação que leva a oferta adiante, vermelho
para a que descarta.

**"Ver texto" sai do card.** O usuário considera o botão inútil ocupando
espaço. Mas ele é hoje o **único** caminho para editar a mensagem antes de
enviar, e essa capacidade não pode ser perdida.

O card **não exibe a mensagem** hoje, então não há prévia para clicar.

Solução: o botão desaparece, e o **corpo do card** vira o alvo de clique —
clicar em qualquer parte que não seja "Pular", "Enviar ao grupo" ou "Por quê?"
abre o mesmo editor. O cursor muda para indicar que é clicável, e um
`title`/`aria-label` explica a ação. A capacidade fica, o botão sai.

Como o card passa a ser clicável, ele precisa ser alcançável por teclado: o
alvo recebe `role`, `tabIndex` e responde a Enter e Espaço. Um card que só
responde ao mouse troca um botão acessível por uma área que teclado nenhum
alcança.

### 2. Meus Grupos

Hoje é uma tabela de cinco colunas. O usuário quer o formato da referência que
enviou: cartões, com números grandes e variação no período.

**Faixa de indicadores no topo**, três números:

- **Grupos ativos** — quantos grupos sincronizados.
- **Membros alcançados** — soma de `memberCount` de todos os grupos.
- **Mensagens enviadas** — total de envios no período.

**Um cartão por grupo**, contendo: nome do grupo, contagem de membros em
destaque, a variação do período (entraram `↑` em verde, saíram `↓` em vermelho),
e quantas mensagens aquele grupo recebeu. Grupo sem nenhum envio mostra "Sem
envios ainda" em vez de zero.

O aviso sobre `trackingSince` — que período anterior ao início do registro é
desconhecido, não zero — **permanece**. É informação honesta e a mudança visual
não pode engolir isso: cada cartão sem histórico marca isso no próprio cartão.

O seletor de período (7/30/90 dias) continua, e passa a valer também para os
indicadores do topo.

**Backend:** não existe contagem de envios por grupo. `SendLog` é um contador
global por dia. Mas `Offer.groupJid` e `DisparoItem.groupJid` existem, então dá
para contar somando os dois:

- `Offer` com status enviado e `groupJid` preenchido, no período.
- `DisparoItem` com status enviado e `groupJid` preenchido, no período.

`GET /api/groups` passa a devolver `sent` por grupo e um bloco `totais` com os
três indicadores. Nenhuma alteração de schema Prisma.

As sub-abas Monitor / Proteção / Campanhas da referência **não** entram aqui.
Proteção é a fase 4; Campanhas não existe como conceito no produto.

### 3. Desempenho

**A tabela "Ofertas enviadas" não pagina.** `GET /api/stats/offers` aceita
`limit` e devolve uma lista fechada. Com o tempo, ou some informação, ou a
página fica gigante.

- A rota passa a aceitar `page` e devolver `{ linhas, total, pageInfo }`.
- A tela ganha controles de página, no mesmo padrão que Garimpar já usa.
- **Pendentes primeiro:** a ordenação padrão põe no topo as ofertas cuja
  **comissão ainda não foi confirmada pela loja** — venda registrada, dinheiro
  não liberado. São as linhas que pedem acompanhamento.

  Atenção ao dado real: `Conversion.status` é texto livre vindo da Shopee, e a
  caixa é inconsistente — o banco tem `approved` em minúsculo e `CANCELLED` em
  maiúsculo, com default `pending`. A comparação tem que normalizar a caixa, e
  "pendente" é definido por exclusão: não é aprovada nem cancelada. Definir por
  inclusão (`status === 'pending'`) perderia qualquer rótulo novo que a Shopee
  inventar, e o certo nesse caso é a linha aparecer como pendente, não sumir da
  contagem.
- **Colunas ordenáveis:** clicar no cabeçalho ordena por aquela coluna,
  alternando crescente e decrescente, com indicador visual de qual coluna está
  ativa. A ordenação acontece no backend, sobre o conjunto todo — ordenar só a
  página visível daria uma resposta errada.

**O gráfico de cliques e comissão não diz que números representa.** Ele é um
componente local em `Desempenho.tsx` (`Chart`), desenhado em SVG.

Ao passar o mouse, mostrar o valor daquele ponto: a data, os cliques e a
comissão. Uma linha vertical marca o ponto sob o cursor. Em telas de toque,
tocar no gráfico mostra o mesmo.

## O que não muda

- Nenhuma alteração no schema Prisma.
- O amarelo da marca (`var(--brand)`) continua sendo a identidade. A referência
  que o usuário enviou é de outro produto: copiamos estrutura, não paleta.
- A lógica de envio, de fila e de disparo não é tocada.
- Proteção de grupos é a fase 4.

## Erros e casos de borda

- Grupo sem `memberCount` (nunca sincronizado): o cartão mostra "—", não zero.
- Nenhum grupo sincronizado: mantém o estado vazio atual, que já orienta a
  conectar o WhatsApp e sincronizar.
- Período em que nada foi enviado: os indicadores mostram zero, e cada cartão
  mostra "Sem envios ainda".
- Tabela de ofertas vazia: estado vazio, sem controles de página.
- Página além do fim (URL montada à mão): devolve lista vazia com `pageInfo`
  coerente, não erro.
- Gráfico com um ponto só, ou com todos os valores zerados: não pode quebrar o
  cálculo de escala nem dividir por zero.

## Testes

Verificação por etapa:

- `npm run build` limpo nos dois workspaces.
- Um `.check.ts` para a ordenação e a paginação de `/api/stats/offers` — é a
  única lógica nova com risco real, e a parte de ordenação pode ser extraída
  pura, rodando sem banco: recebe linhas falsas e confere que pendente vem
  primeiro, que cada coluna ordena nos dois sentidos, e que a página é fatiada
  depois de ordenar.
- Na Fila: o formulário começa fechado; abre e fecha no clique; adicionar uma
  oferta continua funcionando com ele aberto.
- Hover em "Enviar ao grupo" fica amarelo com texto preto; em "Pular", vermelho
  com texto preto.
- "Ver texto" não existe mais, e clicar no corpo do card abre o editor —
  inclusive por teclado, com Tab até o card e Enter.
- Em Meus Grupos: os três indicadores batem com a soma dos cartões; o seletor de
  período muda os números; grupo sem envio mostra "Sem envios ainda".
- Em Desempenho: pendentes aparecem primeiro; clicar num cabeçalho reordena o
  conjunto todo, não só a página; a página 2 traz linhas diferentes; o tooltip
  do gráfico mostra data, cliques e comissão do ponto sob o cursor.
