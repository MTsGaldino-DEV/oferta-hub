# Fase 2 — Garimpar: busca, filtros e pesquisas prontas

Data: 2026-08-24
Status: aprovado para planejamento (autonomia delegada pelo usuário)

## Contexto

`Garimpar` hoje faz uma coisa só: você clica numa categoria da Shopee na árvore
à esquerda, escolhe uma ordenação, e vê uma tabela de produtos. Não há busca por
palavra-chave, não há como combinar categorias, não há filtro de comissão, e —
o mais grave — **não há como mandar um resultado para a fila**. O próprio texto
da página admite: "sem passar pela fila". Garimpar é uma vitrine sem saída.

A fase 1 removeu a rota `/nichos`, então o editor de regras de nicho ficou
inacessível. Esta fase o traz de volta dentro de Garimpar, como o usuário pediu:
os nichos passam a ser "pesquisas prontas" — um clique executa a busca
já filtrada.

## O que já existe e será reaproveitado

O levantamento do código mostrou que a maior parte do motor já está construída.
Esta fase liga peças existentes muito mais do que escreve peças novas:

- **`services/nichos.ts` → `buscarPorNicho`** já faz o loop sobre várias
  categorias, com dedupe por `externalId` e resumo por categoria. É o motor do
  multiselect, pronto.
- **`POST /api/nichos/:id/testar`** já executa um nicho e devolve os produtos
  filtrados com `porCategoria`. É a "pesquisa pronta" já funcionando.
- **`POST /api/offers/from-product`** com `{ platform, externalId }` já
  transforma um resultado de busca em oferta na fila.
- **`GET /api/categorias?platform=&q=`** já devolve a árvore de categorias com
  busca por nome.
- **`connectors/shopee.ts → search`** já aceita `keyword`, `categoryId`,
  `maxPrice` e `sort`. Só a rota HTTP é que exige categoria.
- **`SORT_TYPE`** já mapeia relevância, vendas, menor preço, maior comissão e
  desconto.
- **`Nichos.tsx`** (437 linhas) é o editor de regras, intacto no disco.

## O que a API da Shopee realmente oferece

A API de afiliados da Shopee não é documentada. Fizemos introspecção do schema
e confirmamos cada achado com buscas reais. Os resultados mudam o desenho:

- `commissionRate` é **fração, não percentual**: `0.53` significa 53%. E é a
  soma de `sellerCommissionRate` com `shopeeCommissionRate`.
- `shopeeCommissionRate` ficou fixo em `0.03` em todos os testes. Toda a
  variação está em `sellerCommissionRate` — a comissão que o vendedor põe por
  cima. **Portanto "comissão extra" não é um booleano: é um piso de
  `sellerCommissionRate`.**
- `isAMSOffer: true` devolveu resultado **idêntico** a não passar filtro
  nenhum. Não discrimina nada útil e **não será usado**.
- `isKeySeller: true` devolveu resultado **diferente** — esse filtro funciona.
  Entra como "vendedor destaque".
- `page` funciona, e `pageInfo { page limit hasNextPage }` volta correto.
  `limit` é no máximo 50 por página, então paginação é o único caminho para
  passar de 50 resultados.
- `productCatId` aceita **uma** categoria por query. Multiselect exige N
  queries e merge — que é exatamente o que `buscarPorNicho` já faz.
- Campos úteis que o conector ainda não expõe: `sellerCommissionRate`,
  `shopeeCommissionRate`, `commission` (valor em reais), `shopType`,
  `periodStartTime`/`periodEndTime` (janela de vigência da oferta).

## Arquitetura

### Conector Shopee

`apps/api/src/connectors/shopee.ts`:

- `PRODUCT_FIELDS` ganha `sellerCommissionRate`, `shopeeCommissionRate`,
  `commission` e `shopType`.
- `normalize` passa a preencher os campos novos de `NormalizedProduct`.
- `search` aceita `page`, `minCommissionPct`, `keySeller` e devolve também o
  `hasNextPage` da Shopee.

`apps/api/src/connectors/types.ts`:

- `NormalizedProduct` ganha `sellerCommissionPct?`, `commissionBrl?` e
  `shopType?` — todos opcionais, porque só a Shopee os informa.
- `SearchParams` ganha `page?`, `minCommissionPct?` e `keySeller?`.
- A assinatura de `Connector.search` continua devolvendo
  `Promise<NormalizedProduct[]>`. O `hasNextPage` viaja por um método
  novo e opcional, `searchPage?`, que só a Shopee implementa — assim
  nenhum outro conector precisa mudar.

Como `commissionRate` é fração, a conversão para percentual (`× 100`) fica em um
lugar só, dentro de `normalize`, como já acontece hoje. O restante do sistema
continua vendo percentual.

### Rota de busca

`apps/api/src/routes/garimpar.ts` — a rota `GET /api/garimpar/produtos` passa a
aceitar:

| Parâmetro | Tipo | Nota |
|---|---|---|
| `keyword` | string, opcional | mínimo 2 caracteres quando presente |
| `categoryIds` | lista de inteiros, opcional | repetível na query string |
| `sort` | enum atual | inalterado |
| `minCommissionPct` | número 0–100, opcional | piso de `sellerCommissionPct` |
| `keySeller` | booleano, opcional | mapeia para `isKeySeller` |
| `maxPrice` | número, opcional | já suportado pelo conector |
| `page` | inteiro ≥ 1, padrão 1 | |
| `limit` | 1–50, padrão 40 | inalterado |

Regra de validação: pelo menos um entre `keyword` e `categoryIds` é
obrigatório. Sem nenhum dos dois, 400 com mensagem em português — é a mesma
regra que o conector já impõe internamente, agora aplicada na borda com Zod.

Com múltiplas categorias, a rota dispara uma busca por categoria **em
paralelo** (`Promise.allSettled`), mescla os resultados, remove duplicados por
`externalId` e ordena o conjunto final pelo mesmo critério pedido. Categoria que
falhar não derruba a resposta: entra num campo `falhas` com o motivo, e o resto
é devolvido. Isso é o que o usuário quer ver — resultado parcial é melhor que
tela de erro.

O teto de 50 por página da Shopee vale por categoria. Com N categorias, a
resposta pode ter até N × limit itens antes do dedupe, então a rota corta em
`limit` depois de ordenar, e informa quanto veio bruto.

A resposta ganha `pageInfo: { page, hasNextPage }`. Com múltiplas categorias,
`hasNextPage` é verdadeiro se qualquer categoria tiver mais páginas.

### Pesquisas prontas

Nenhuma rota nova. `GET /api/nichos` já lista, e `POST /api/nichos/:id/testar`
já executa. A tela consome as duas.

O que muda no backend é pequeno: `POST /api/nichos/:id/testar` hoje aceita só
`maxPrice` no corpo. Passa a aceitar também `minCommissionPct` e `keySeller`,
repassados para `buscarPorNicho`, para que os filtros da tela valham igual numa
pesquisa pronta e numa busca manual.

### Tela

`apps/web/src/pages/Garimpar.tsx` é reescrita e quebrada em componentes, porque
a página passa a fazer três coisas distintas. Estrutura em
`apps/web/src/pages/garimpar/`:

- **`Garimpar.tsx`** (fica em `pages/`) — casca com duas abas: **Buscar** e
  **Pesquisas prontas**.
- **`garimpar/FiltrosBusca.tsx`** — campo de palavra-chave, seletor múltiplo de
  categorias, ordenação, piso de comissão, teto de preço, toggle "vendedor
  destaque". Um botão "Buscar" dispara; a busca **não** roda a cada tecla.
- **`garimpar/CategoriaMultiSelect.tsx`** — a árvore de categorias com
  checkbox, campo de filtro por nome, contador de selecionadas e ação de limpar.
  Substitui o `catbox` de clique único.
- **`garimpar/ResultadoBusca.tsx`** — a tabela de resultados, agora com coluna
  de comissão do vendedor e botão "Mandar pra fila" por linha, mais os controles
  de página.
- **`garimpar/PesquisasProntas.tsx`** — cards dos nichos (nome, plataforma,
  quantas categorias, mínimo de vendas). Um clique executa; um botão "Editar
  regras" abre o editor.
- **`garimpar/EditorNicho.tsx`** — o conteúdo de `Nichos.tsx`, movido para cá.
  A rota `/nichos` continua não existindo; o editor vive dentro desta aba.

O texto da página deixa de dizer "sem passar pela fila".

### Mandar pra fila

Cada linha de resultado ganha um botão que chama
`POST /api/offers/from-product` com `{ platform, externalId }`. Estados
visíveis: enviando, adicionado (a linha marca e o botão desabilita), e erro
(mensagem na linha). Um produto que já está na fila não é erro — a rota usa
`ingestProduct`, que já lida com repetido; a tela mostra "já está na fila".

## Erros e casos de borda

- Nem `keyword` nem `categoryIds`: 400, "Escolha uma categoria ou digite uma
  palavra-chave."
- `keyword` com menos de 2 caracteres: 400, mesma mensagem de
  `/api/search` já usa.
- Todas as categorias falharam: 400 com o primeiro motivo, para o usuário ver o
  erro da Shopee (credencial inválida, limite atingido) em vez de "nada
  encontrado".
- Algumas categorias falharam: 200, com os resultados que vieram e as falhas
  listadas.
- Credencial da Shopee ausente: a mensagem de `MissingCredentialsError` já
  aponta para a tela de credenciais — atualizá-la para dizer
  "Configurações › Plataformas", já que "Conexões" não existe mais.
- Zero resultados após o filtro de comissão: estado vazio que diz que o filtro
  cortou tudo, com o número bruto encontrado antes do corte.
- Produto sem `sellerCommissionRate` (outras lojas, ou campo ausente): o filtro
  de comissão o exclui apenas se um piso maior que zero foi pedido.

## O que não muda

- Nenhuma alteração no schema Prisma.
- `services/nichos.ts` mantém a assinatura de `buscarPorNicho`; só ganha
  parâmetros opcionais.
- Nenhum outro conector muda. `searchPage` é opcional.
- A fila, os disparos e as automações não são tocados.

## Testes

Verificação por etapa:

- `npm run build` limpo nos dois workspaces.
- `npx tsx` num script `.check.ts` novo para a lógica de merge/dedupe/ordenação
  de múltiplas categorias — é a única lógica nova com risco real de estar
  errada, e roda sem rede: recebe listas de produtos falsos e confere que
  duplicado sai, que a ordem final respeita o `sort` e que o corte em `limit`
  acontece depois de ordenar.
- Busca por palavra-chave sozinha devolve resultado.
- Busca com 3 categoriais marcadas devolve resultado sem duplicatas.
- Piso de comissão em 20% reduz a lista, e todo item restante tem comissão de
  vendedor ≥ 20%.
- "Vendedor destaque" muda o conjunto de resultados.
- Página 2 devolve itens diferentes da página 1.
- "Mandar pra fila" cria a oferta e ela aparece em Início › Fila.
- Um clique numa pesquisa pronta devolve os produtos daquele nicho.
- "Editar regras" abre o editor, e salvar uma regra persiste.
