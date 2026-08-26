# Fase 2 — Garimpar: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar Garimpar de vitrine de categoria única em busca de verdade: palavra-chave, múltiplas categorias, filtros reais da Shopee, paginação, pesquisas prontas e envio direto para a fila.

**Architecture:** O motor já existe. `buscarPorNicho` já faz multi-categoria com dedupe, `/api/offers/from-product` já cria oferta na fila, `/api/nichos/:id/testar` já executa uma pesquisa pronta. Esta fase expõe campos que o conector Shopee já podia ler, relaxa a rota de busca para aceitar palavra-chave e várias categorias, e reescreve a tela em componentes. Nenhuma alteração de schema Prisma.

**Tech Stack:** Node 20+, TypeScript ESM, Fastify 4, Prisma 5, Zod 3, React 18, React Router, Vite, Tailwind + CSS custom em `styles.css`.

**Spec:** `docs/superpowers/specs/2026-08-24-fase2-garimpar-design.md`

## Global Constraints

- Ambos os workspaces são ESM (`"type": "module"`). Todo import relativo termina em `.js`, mesmo apontando para um arquivo `.ts`/`.tsx`. Import sem extensão quebra em runtime.
- Validação de entrada da API sempre com Zod.
- Prisma é a única camada de acesso a dados. Nenhuma alteração em `apps/api/prisma/schema.prisma`.
- Nenhuma dependência nova.
- Todo texto de interface e toda mensagem de erro em português do Brasil.
- Comentários no código explicam **por quê**, não o quê, e são escritos sem acentuação — é o padrão do repositório.
- Classes de CSS já existentes, a reusar em vez de inventar: `head`, `panel`, `panel__title`, `field`, `row`, `split`, `btn`, `btn--ghost`, `btn--sm`, `chip`, `notice`, `empty`, `tabs`, `tabs__item`, `taglist`, `table`, `num`, `cell-product`, `catbox`, `catbox__grupo`, `catbox__raiz`, `catbox__item`.
- Não existe runner de testes. A verificação é `npm run build` mais scripts `.check.ts` rodados com `npx tsx`.
- Commits em português, no formato Conventional Commits.

## Fatos da API da Shopee (levantados por introspecção e confirmados com buscas reais)

Estes valores são **medidos**, não supostos. Não os re-derive; use como estão.

- `commissionRate` é **fração**: `0.53` significa 53%. É a soma de `sellerCommissionRate` com `shopeeCommissionRate`.
- `shopeeCommissionRate` ficou fixo em `0.03` em todos os testes. A variação está em `sellerCommissionRate`.
- `isAMSOffer: true` devolveu resultado **idêntico** a não passar filtro. **Não usar.**
- `isKeySeller: true` devolveu resultado **diferente**. Funciona.
- `page` funciona. `pageInfo { page limit hasNextPage }` volta correto. `limit` máximo é 50 por página.
- `productCatId` aceita **uma** categoria por query.
- Campos disponíveis e ainda não usados: `sellerCommissionRate`, `shopeeCommissionRate`, `commission` (valor em reais), `shopType`, `periodStartTime`, `periodEndTime`.

---

### Task 1: Conector Shopee expõe comissão do vendedor, página e vendedor destaque

**Files:**
- Modify: `apps/api/src/connectors/types.ts`
- Modify: `apps/api/src/connectors/shopee.ts`

**Interfaces:**
- Produces:
  - `NormalizedProduct` ganha `sellerCommissionPct?: number`, `commissionBrl?: number`, `shopType?: number`.
  - `SearchParams` ganha `page?: number`, `minCommissionPct?: number`, `keySeller?: boolean`.
  - `Connector.searchPage?(params: SearchParams): Promise<{ produtos: NormalizedProduct[]; hasNextPage: boolean }>` — opcional, só a Shopee implementa.
- Consumes: nada de tarefas anteriores.

**Depends-on:** none.

- [ ] **Step 1: Estender os tipos**

Em `apps/api/src/connectors/types.ts`, dentro de `NormalizedProduct`, depois de `commissionPct`:

```ts
  /**
   * Parte da comissao que o vendedor poe por cima da base da loja. Na Shopee a
   * base ficou fixa em 3% em toda medicao, entao e este campo que separa
   * oferta boa de oferta comum -- e o que a tela chama de "comissao extra".
   */
  sellerCommissionPct?: number;
  /** Comissao em reais, quando a API informa o valor absoluto. */
  commissionBrl?: number;
  /** Classificacao da loja na plataforma (Shopee: 1, 2, ...). */
  shopType?: number;
```

Em `SearchParams`, depois de `sort`:

```ts
  /** Pagina, base 1. A Shopee limita 50 itens por pagina. */
  page?: number;
  /** Piso de `sellerCommissionPct`, em percentual (20 = 20%). */
  minCommissionPct?: number;
  /** Só vendedores que a loja marca como destaque. */
  keySeller?: boolean;
```

Em `Connector`, depois de `search`:

```ts
  /**
   * Busca sabendo se ha proxima pagina. Opcional: so a Shopee expoe pageInfo,
   * e sem isso a tela nao consegue desabilitar o botao de avancar.
   */
  searchPage?(params: SearchParams): Promise<{ produtos: NormalizedProduct[]; hasNextPage: boolean }>;
```

E corrigir a mensagem de `MissingCredentialsError`, que aponta para uma tela que não existe mais:

```ts
    super(`Sem credencial ativa para ${platform}. Cadastre em Configuracoes > Plataformas.`);
```

- [ ] **Step 2: Pedir os campos novos e normalizar**

Em `apps/api/src/connectors/shopee.ts`, acrescentar os quatro campos a `PRODUCT_FIELDS`:

```ts
const PRODUCT_FIELDS = `
  itemId shopId productName imageUrl productLink offerLink price priceMin
  priceDiscountRate commissionRate ratingStar sales productCatIds
  sellerCommissionRate shopeeCommissionRate commission shopType
`;
```

E dentro de `normalize`, depois da linha de `commissionPct`:

```ts
    // A Shopee manda comissao como fracao (0.53 = 53%), mesma escala de
    // commissionRate -- por isso os dois multiplicam por 100 aqui.
    sellerCommissionPct: node.sellerCommissionRate ? Number(node.sellerCommissionRate) * 100 : undefined,
    commissionBrl: node.commission ? Number(node.commission) : undefined,
    shopType: node.shopType !== undefined && node.shopType !== null ? Number(node.shopType) : undefined,
```

- [ ] **Step 3: Aceitar página, piso de comissão e vendedor destaque**

Ainda em `shopee.ts`, substituir o método `search` por uma dupla: `searchPage` faz o trabalho e devolve `hasNextPage`; `search` chama `searchPage` e devolve só a lista, preservando a assinatura que todo o resto do sistema já usa.

```ts
  async searchPage({
    keyword,
    categoryId,
    maxPrice,
    minCommissionPct,
    keySeller,
    sort = 'vendas',
    limit = 20,
    page = 1,
  }) {
    if (!keyword && !categoryId) throw new Error('Informe um nicho ou uma palavra-chave.');

    // Com teto de preco ou piso de comissao pede lote maior pra sobrar
    // resultado depois do corte. 50 e o maximo que a Shopee aceita por pagina.
    const cortaNoCliente = Boolean(maxPrice || minCommissionPct);
    const lote = Math.min(cortaNoCliente ? limit * 3 : limit, 50);

    const filtros = [
      categoryId ? `productCatId: ${categoryId}` : '',
      keyword ? `keyword: $keyword` : '',
      keySeller ? `isKeySeller: true` : '',
      `sortType: ${SORT_TYPE[sort]}`,
      `page: $page`,
      `limit: $limit`,
    ]
      .filter(Boolean)
      .join(', ');

    const data = await gql<any>(
      `query (${keyword ? '$keyword: String!, ' : ''}$limit: Int, $page: Int) {
        productOfferV2(${filtros}) {
          nodes { ${PRODUCT_FIELDS} }
          pageInfo { hasNextPage }
        }
      }`,
      keyword ? { keyword, limit: lote, page } : { limit: lote, page },
    );

    let produtos: NormalizedProduct[] = (data.productOfferV2?.nodes ?? []).map(normalize);

    if (maxPrice) {
      produtos = produtos.filter((p) => p.price !== undefined && p.price <= maxPrice);
    }
    if (minCommissionPct) {
      // Sem o campo o produto nao prova que atinge o piso, entao fica fora.
      produtos = produtos.filter(
        (p) => p.sellerCommissionPct !== undefined && p.sellerCommissionPct >= minCommissionPct,
      );
    }

    // A API nao tem ordenacao por desconto. Puxamos por vendas e reordenamos
    // aqui -- ordenar so por desconto traria o catalogo parado com "de/por" inflado.
    if (sort === 'desconto') {
      produtos.sort((a, b) => descontoPct(b) - descontoPct(a));
    }

    return {
      produtos: produtos.slice(0, limit),
      hasNextPage: Boolean(data.productOfferV2?.pageInfo?.hasNextPage),
    };
  },

  async search(params) {
    const { produtos } = await this.searchPage!(params);
    return produtos;
  },
```

Atenção a dois detalhes:

- `searchPage` precisa vir **antes** de `search` no objeto, ou `this.searchPage` fica indefinido em tempo de execução? Não: a propriedade existe no objeto literal inteiro antes de qualquer chamada. A ordem no arquivo é livre; mantenha `searchPage` antes por legibilidade.
- O `!` em `this.searchPage!` é necessário porque o método é opcional na interface. Se o TypeScript reclamar de `this` implícito, tipar o objeto exportado como `Connector` já resolve — ele já é assim hoje (`export const shopee: Connector = { ... }`).

- [ ] **Step 4: Compilar**

Run: `npm run build --workspace @oferta-hub/api`
Expected: sem erro de tipo. Se algum outro conector reclamar de `searchPage`, é porque o método não ficou opcional — voltar ao Step 1.

- [ ] **Step 5: Confirmar contra a API real**

O ambiente do usuário roda em Docker. A API tem as credenciais no banco.

```bash
docker compose exec -T api sh -c 'cat > /tmp/t1.mjs' <<'EOF'
import { shopee } from '/app/apps/api/dist/connectors/shopee.js';
const r = await shopee.searchPage({ keyword: 'fone bluetooth', sort: 'comissao', limit: 5, page: 1 });
console.log('itens:', r.produtos.length, 'hasNextPage:', r.hasNextPage);
for (const p of r.produtos.slice(0, 3)) {
  console.log(`  ${p.title?.slice(0, 35)} | total ${p.commissionPct?.toFixed(1)}% | vendedor ${p.sellerCommissionPct?.toFixed(1)}% | R$ ${p.commissionBrl} | shopType ${p.shopType}`);
}
const f = await shopee.searchPage({ keyword: 'fone bluetooth', minCommissionPct: 20, limit: 5 });
console.log('com piso de 20%:', f.produtos.length, 'itens; menor vendedor:', Math.min(...f.produtos.map((p) => p.sellerCommissionPct ?? 0)).toFixed(1) + '%');
EOF
```

Rebuild a imagem antes (`docker compose build api && docker compose up -d api`), porque o container roda o `dist`. Rode com `MSYS_NO_PATHCONV=1 docker compose exec -T api node /tmp/t1.mjs`.

Expected: itens listados com `vendedor` preenchido; com piso de 20%, todo item restante tem comissão de vendedor ≥ 20%.

**Não derrube o container `db`.** A sessão de WhatsApp sobrevive ao rebuild da `api` (bind mount), mas o serviço fica fora do ar por ~1 min.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/connectors/types.ts apps/api/src/connectors/shopee.ts
git commit -m "feat(api): conector Shopee expoe comissao do vendedor, pagina e vendedor destaque"
```

---

### Task 2: Rota de busca com palavra-chave, várias categorias e filtros

**Files:**
- Create: `apps/api/src/routes/garimpar-merge.ts`
- Create: `apps/api/src/routes/garimpar-merge.check.ts`
- Modify: `apps/api/src/routes/garimpar.ts`

**Interfaces:**
- Consumes: da Task 1 — `SearchParams` com `page`/`minCommissionPct`/`keySeller`, `NormalizedProduct` com `sellerCommissionPct`/`commissionBrl`/`shopType`, e `shopee.searchPage`.
- Produces:
  - `mesclar(listas: NormalizedProduct[][], sort: SearchSort, limit: number): NormalizedProduct[]` — junta, remove duplicado por `externalId`, ordena e corta.
  - `GET /api/garimpar/produtos` com o contrato descrito abaixo.

**Depends-on:** Task 1.

O contrato da resposta, que a Task 4 e a Task 5 consomem:

```ts
{
  ok: true,
  categorias: { id: number; nome: string }[],   // as pedidas, com nome resolvido
  bruto: number,                                 // total antes de dedupe e corte
  produtos: {
    externalId: string; platform: string; title: string; imageUrl: string | null;
    price: number | null; listPrice: number | null; commissionPct: number | null;
    sellerCommissionPct: number | null; commissionBrl: number | null;
    soldCount: number | null; rating: number | null; shopName: string | null;
  }[],
  pageInfo: { page: number; hasNextPage: boolean },
  falhas: { categoryId: number | null; motivo: string }[],
}
```

- [ ] **Step 1: Escrever o self-check que falha**

A única lógica nova com risco real é o merge. Ela é pura, então testa sem rede.

Criar `apps/api/src/routes/garimpar-merge.check.ts`:

```ts
/**
 * Self-check do merge de varias categorias. Roda sem rede e sem banco:
 *   npx tsx apps/api/src/routes/garimpar-merge.check.ts
 *
 * O que precisa valer: duplicado sai (a mesma oferta aparece em duas
 * categorias e a Shopee cobra uma query por categoria), a ordem final respeita
 * o sort pedido, e o corte em `limit` acontece DEPOIS de ordenar -- cortar
 * antes devolveria os piores itens de cada lista.
 */
import assert from 'node:assert/strict';
import { Platform } from '@prisma/client';
import { mesclar } from './garimpar-merge.js';
import type { NormalizedProduct } from '../connectors/types.js';

const p = (
  externalId: string,
  extra: Partial<NormalizedProduct> = {},
): NormalizedProduct => ({
  platform: Platform.SHOPEE,
  externalId,
  title: externalId,
  canonicalUrl: `https://x/${externalId}`,
  available: true,
  ...extra,
});

// Duplicado entre listas sai, e a primeira ocorrencia e a que fica.
const dedup = mesclar([[p('a'), p('b')], [p('b'), p('c')]], 'vendas', 10);
assert.deepEqual(
  dedup.map((x) => x.externalId).sort(),
  ['a', 'b', 'c'],
  'b aparece nas duas listas e deve sobrar uma vez',
);

// Ordena por vendas, decrescente.
const vendas = mesclar(
  [[p('baixo', { soldCount: 10 }), p('alto', { soldCount: 900 })], [p('meio', { soldCount: 100 })]],
  'vendas',
  10,
);
assert.deepEqual(vendas.map((x) => x.externalId), ['alto', 'meio', 'baixo']);

// Ordena por comissao do vendedor, decrescente.
const comissao = mesclar(
  [[p('x', { sellerCommissionPct: 5 }), p('y', { sellerCommissionPct: 40 })]],
  'comissao',
  10,
);
assert.deepEqual(comissao.map((x) => x.externalId), ['y', 'x']);

// Menor preco, crescente.
const preco = mesclar([[p('caro', { price: 90 }), p('barato', { price: 9 })]], 'menor-preco', 10);
assert.deepEqual(preco.map((x) => x.externalId), ['barato', 'caro']);

// Desconto usa listPrice contra price.
const desc = mesclar(
  [[p('pouco', { price: 90, listPrice: 100 }), p('muito', { price: 10, listPrice: 100 })]],
  'desconto',
  10,
);
assert.deepEqual(desc.map((x) => x.externalId), ['muito', 'pouco']);

// O corte vem DEPOIS de ordenar: com limit 1 sobra o melhor do conjunto todo,
// nao o primeiro da primeira lista.
const cortado = mesclar(
  [[p('fraco', { soldCount: 1 })], [p('forte', { soldCount: 999 })]],
  'vendas',
  1,
);
assert.deepEqual(cortado.map((x) => x.externalId), ['forte'], 'cortar antes de ordenar perderia o forte');

// Campo ausente nao pode jogar o item pra frente da fila.
const semDado = mesclar([[p('sem'), p('com', { soldCount: 5 })]], 'vendas', 10);
assert.deepEqual(semDado.map((x) => x.externalId), ['com', 'sem']);

// Lista vazia nao explode.
assert.deepEqual(mesclar([], 'vendas', 10), []);
assert.deepEqual(mesclar([[], []], 'vendas', 10), []);

console.log('garimpar-merge.check: ok');
```

- [ ] **Step 2: Rodar o check e ver falhar**

Run: `npx tsx apps/api/src/routes/garimpar-merge.check.ts`
Expected: FALHA com `Cannot find module` apontando para `./garimpar-merge.js`.

- [ ] **Step 3: Escrever o merge**

Criar `apps/api/src/routes/garimpar-merge.ts`:

```ts
import type { NormalizedProduct, SearchSort } from '../connectors/types.js';

/** Desconto anunciado, usado so pra ordenar. */
function descontoPct(p: NormalizedProduct): number {
  if (!p.listPrice || !p.price || p.listPrice <= p.price) return 0;
  return ((p.listPrice - p.price) / p.listPrice) * 100;
}

/**
 * Cada `sort` vira uma nota: maior nota primeiro. Preco e o unico invertido,
 * porque "menor preco" quer o menor no topo.
 */
const NOTA: Record<SearchSort, (p: NormalizedProduct) => number> = {
  vendas: (p) => p.soldCount ?? 0,
  comissao: (p) => p.sellerCommissionPct ?? p.commissionPct ?? 0,
  desconto: descontoPct,
  'menor-preco': (p) => -(p.price ?? Number.MAX_SAFE_INTEGER),
  // A Shopee ja devolve cada lista na ordem de relevancia dela, e nao ha nota
  // comparavel entre categorias diferentes -- entao mantem a ordem de chegada.
  relevancia: () => 0,
};

/**
 * Junta o resultado de varias categorias numa lista so.
 *
 * O dedupe importa porque a Shopee cobra uma query por categoria e a mesma
 * oferta costuma aparecer em mais de uma. O corte vem depois da ordenacao: com
 * N categorias chegam até N x limit itens, e cortar antes devolveria os piores
 * de cada lista em vez dos melhores do conjunto.
 */
export function mesclar(
  listas: NormalizedProduct[][],
  sort: SearchSort,
  limit: number,
): NormalizedProduct[] {
  const vistos = new Set<string>();
  const juntos: NormalizedProduct[] = [];

  for (const lista of listas) {
    for (const p of lista) {
      if (vistos.has(p.externalId)) continue;
      vistos.add(p.externalId);
      juntos.push(p);
    }
  }

  const nota = NOTA[sort];
  // Ordenacao estavel (padrao no V8), entao com nota igual a ordem de chegada
  // sobrevive -- e o que faz `relevancia` preservar a ordem da Shopee.
  juntos.sort((a, b) => nota(b) - nota(a));

  return juntos.slice(0, limit);
}
```

- [ ] **Step 4: Rodar o check e ver passar**

Run: `npx tsx apps/api/src/routes/garimpar-merge.check.ts`
Expected: imprime `garimpar-merge.check: ok`.

- [ ] **Step 5: Reescrever a rota**

Substituir `apps/api/src/routes/garimpar.ts` inteiro:

```ts
import { Platform } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { connectors } from '../connectors/index.js';
import type { NormalizedProduct } from '../connectors/types.js';
import { mesclar } from './garimpar-merge.js';

/**
 * `categoryIds` chega repetido na query string (`?categoryIds=1&categoryIds=2`).
 * Com um valor só o Fastify entrega string, com vários entrega array -- por
 * isso o preprocess normaliza para lista antes de validar.
 */
const listaDeIds = z.preprocess(
  (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]),
  z.array(z.coerce.number().int().positive()).max(10),
);

const query = z
  .object({
    keyword: z.string().trim().min(2, 'Digite pelo menos 2 caracteres.').optional(),
    categoryIds: listaDeIds,
    sort: z.enum(['relevancia', 'vendas', 'comissao', 'menor-preco', 'desconto']).default('vendas'),
    minCommissionPct: z.coerce.number().min(0).max(100).optional(),
    maxPrice: z.coerce.number().positive().optional(),
    // Nao usar z.coerce.boolean aqui: ele transforma a string "false" em true,
    // porque toda string nao vazia e truthy. So a string "true" liga o filtro.
    keySeller: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(60).default(40),
  })
  .refine((q) => q.keyword || q.categoryIds.length > 0, {
    message: 'Escolha uma categoria ou digite uma palavra-chave.',
  });

function serialize(p: NormalizedProduct) {
  return {
    externalId: p.externalId,
    platform: p.platform,
    title: p.title,
    imageUrl: p.imageUrl ?? null,
    price: p.price ?? null,
    listPrice: p.listPrice ?? null,
    commissionPct: p.commissionPct ?? null,
    sellerCommissionPct: p.sellerCommissionPct ?? null,
    commissionBrl: p.commissionBrl ?? null,
    soldCount: p.soldCount ?? null,
    rating: p.rating ?? null,
    shopName: p.shopName ?? null,
  };
}

export async function garimparRoutes(app: FastifyInstance) {
  /**
   * Busca ao vivo na Shopee. Aceita palavra-chave, varias categorias, ou os
   * dois. A Shopee so aceita uma categoria por query, entao N categorias viram
   * N buscas em paralelo, mescladas depois.
   */
  app.get('/api/garimpar/produtos', async (req, reply) => {
    const q = query.parse(req.query);
    const shopee = connectors[Platform.SHOPEE];
    const buscar = shopee.searchPage ?? (async (p) => ({ produtos: await shopee.search(p), hasNextPage: false }));

    const base = {
      keyword: q.keyword,
      sort: q.sort,
      minCommissionPct: q.minCommissionPct,
      maxPrice: q.maxPrice,
      keySeller: q.keySeller,
      page: q.page,
      limit: q.limit,
    };

    // Sem categoria e uma busca so, por palavra-chave.
    const alvos: (number | null)[] = q.categoryIds.length > 0 ? q.categoryIds : [null];

    const respostas = await Promise.allSettled(
      alvos.map((categoryId) => buscar({ ...base, categoryId: categoryId ?? undefined })),
    );

    const listas: NormalizedProduct[][] = [];
    const falhas: { categoryId: number | null; motivo: string }[] = [];
    let bruto = 0;
    let hasNextPage = false;

    respostas.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        listas.push(r.value.produtos);
        bruto += r.value.produtos.length;
        // Com varias categorias, basta uma ter mais pagina pra valer avancar.
        hasNextPage = hasNextPage || r.value.hasNextPage;
      } else {
        falhas.push({
          categoryId: alvos[i],
          motivo: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });

    // Todas falharam: devolve o erro da loja em vez de "nada encontrado", que
    // mandaria o usuario procurar problema no filtro.
    if (listas.length === 0) {
      return reply.code(400).send({ error: falhas[0]?.motivo ?? 'A busca falhou.' });
    }

    const cats =
      q.categoryIds.length > 0
        ? await prisma.category.findMany({
            where: { platform: Platform.SHOPEE, externalId: { in: q.categoryIds } },
            select: { externalId: true, nameBr: true },
          })
        : [];

    return {
      ok: true,
      categorias: q.categoryIds.map((id) => ({
        id,
        nome: cats.find((c) => c.externalId === id)?.nameBr ?? `Categoria ${id}`,
      })),
      bruto,
      produtos: mesclar(listas, q.sort, q.limit).map(serialize),
      pageInfo: { page: q.page, hasNextPage },
      falhas,
    };
  });
}
```

Conferir antes de compilar: o campo de nome em `prisma.category` é `nameBr` — é o que a versão antiga da rota usava. Se o `select` reclamar, olhar o model `Category` no schema e usar o nome real.

- [ ] **Step 6: Compilar e rodar o check**

Run: `npm run build --workspace @oferta-hub/api && npx tsx apps/api/src/routes/garimpar-merge.check.ts`
Expected: build limpo e `garimpar-merge.check: ok`.

- [ ] **Step 7: Confirmar a rota contra o ambiente real**

Rebuild da API no Docker (`docker compose build api && docker compose up -d api`), esperar o health, e então:

```bash
# palavra-chave sozinha
curl -s 'http://127.0.0.1:3333/api/garimpar/produtos?keyword=fone%20bluetooth&limit=5' -b cookie.txt
# nenhum dos dois: espera 400 com a mensagem em portugues
curl -s 'http://127.0.0.1:3333/api/garimpar/produtos'
```

A rota exige sessão. Para obter o cookie: `curl -s -c cookie.txt -X POST http://127.0.0.1:3333/api/login -H 'content-type: application/json' --data-binary @senha.json`, onde `senha.json` contém `{"password":"..."}` — **corpo JSON com acento quebra em `curl -d` no Git Bash, por isso `--data-binary @arquivo`.** A senha está em `DASHBOARD_PASSWORD` no `.env` da raiz. Apague `cookie.txt` e `senha.json` ao terminar e **não** os commite.

Se não conseguir a sessão, não bloqueie: teste a rota chamando o handler pelo `dist` dentro do container, como a Task 1 fez com o conector, e reporte o que ficou sem verificar.

Expected: palavra-chave sozinha devolve produtos com `sellerCommissionPct` preenchido; sem parâmetro nenhum devolve 400 com "Escolha uma categoria ou digite uma palavra-chave."

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/garimpar.ts apps/api/src/routes/garimpar-merge.ts apps/api/src/routes/garimpar-merge.check.ts
git commit -m "feat(api): busca do Garimpar aceita palavra-chave, varias categorias e filtros"
```

---

### Task 3: Pesquisa pronta respeita os mesmos filtros da busca manual

**Files:**
- Modify: `apps/api/src/services/nichos.ts`
- Modify: `apps/api/src/routes/nichos.ts`

**Interfaces:**
- Consumes: da Task 1 — `SearchParams` com `minCommissionPct` e `keySeller`.
- Produces: `buscarPorNicho` aceita `minCommissionPct?: number` e `keySeller?: boolean` em `opcoes`; `POST /api/nichos/:id/testar` aceita os dois no corpo.

**Depends-on:** Task 1.

- [ ] **Step 1: Repassar os filtros em `buscarPorNicho`**

Em `apps/api/src/services/nichos.ts`, na assinatura de `buscarPorNicho`, acrescentar os dois campos ao tipo de `opcoes`:

```ts
  opcoes: {
    porCategoria?: number;
    maxPrice?: number;
    limiarDedup?: number;
    minCommissionPct?: number;
    keySeller?: boolean;
  } = {},
```

E dentro do loop, na chamada de `connector.search`, passar os dois adiante:

```ts
      const produtos = await connector.search({
        categoryId: entry.categoryId,
        maxPrice: opcoes.maxPrice,
        minCommissionPct: opcoes.minCommissionPct,
        keySeller: opcoes.keySeller,
        sort: 'vendas',
        limit: porCategoria,
      });
```

Nada mais muda: o filtro é aplicado dentro do conector, e `passaNoFiltro` continua cuidando dos termos do nicho.

- [ ] **Step 2: Aceitar os filtros na rota**

Em `apps/api/src/routes/nichos.ts`, na rota `POST /api/nichos/:id/testar`, trocar o schema do corpo:

```ts
      const { maxPrice, minCommissionPct, keySeller } = z
        .object({
          maxPrice: z.number().positive().optional(),
          minCommissionPct: z.number().min(0).max(100).optional(),
          keySeller: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      const { achados, resumo } = await buscarPorNicho(nicho, {
        maxPrice,
        minCommissionPct,
        keySeller,
        porCategoria: 50,
      });
```

E no `map` de `produtos` da resposta, acrescentar os campos novos, para a tela mostrar a mesma coluna de comissão do vendedor que a busca manual mostra:

```ts
          sellerCommissionPct: a.produto.sellerCommissionPct ?? null,
          commissionBrl: a.produto.commissionBrl ?? null,
```

Conferir o tipo do `Body` no genérico da rota (`app.post<{ Params: ...; Body: { maxPrice?: number } }>`) e estendê-lo com os dois campos, ou o TypeScript reclama.

- [ ] **Step 3: Compilar**

Run: `npm run build --workspace @oferta-hub/api`
Expected: sem erro de tipo.

- [ ] **Step 4: Verificar**

Com a API rebuildada no Docker e uma sessão válida, chamar `POST /api/nichos/<id>/testar` com `{"minCommissionPct": 20}` e conferir que todo produto devolvido tem `sellerCommissionPct` maior ou igual a 20. Pegar um `id` em `GET /api/nichos`.

Se não conseguir a sessão, chame `buscarPorNicho` direto pelo `dist` no container e reporte o que ficou sem verificar.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/nichos.ts apps/api/src/routes/nichos.ts
git commit -m "feat(api): pesquisa pronta aceita piso de comissao e vendedor destaque"
```

---

### Task 4: Tela de Garimpar — casca, filtros e seleção múltipla de categorias

**Files:**
- Rewrite: `apps/web/src/pages/Garimpar.tsx`
- Create: `apps/web/src/pages/garimpar/tipos.ts`
- Create: `apps/web/src/pages/garimpar/FiltrosBusca.tsx`
- Create: `apps/web/src/pages/garimpar/CategoriaMultiSelect.tsx`
- Create: `apps/web/src/pages/garimpar/ResultadoBusca.tsx` (esqueleto; a Task 5 completa)
- Create: `apps/web/src/pages/garimpar/PesquisasProntas.tsx` (esqueleto; a Task 6 completa)

**Interfaces:**
- Consumes: da Task 2 — o contrato de `GET /api/garimpar/produtos`. `GET /api/categorias` já existe e devolve `{ id, nome, itens, filhas: { id, nome, itens }[] }[]`.
- Produces:
  - `tipos.ts` exporta `Produto`, `Resultado`, `Filtros`, `Raiz` e `ORDENS`.
  - `FiltrosBusca({ filtros, onChange, onBuscar, buscando }): JSX.Element`
  - `CategoriaMultiSelect({ arvore, selecionadas, onChange }): JSX.Element`
  - `Garimpar()` — casca com abas Buscar e Pesquisas prontas.

**Depends-on:** Task 2 (contrato da rota).

- [ ] **Step 1: Tipos compartilhados**

Criar `apps/web/src/pages/garimpar/tipos.ts`:

```ts
export interface Produto {
  externalId: string;
  platform: string;
  title: string;
  imageUrl: string | null;
  price: number | null;
  listPrice: number | null;
  commissionPct: number | null;
  sellerCommissionPct: number | null;
  commissionBrl: number | null;
  soldCount: number | null;
  rating: number | null;
  shopName: string | null;
}

export interface Resultado {
  categorias: { id: number; nome: string }[];
  bruto: number;
  produtos: Produto[];
  pageInfo: { page: number; hasNextPage: boolean };
  falhas: { categoryId: number | null; motivo: string }[];
}

export interface Raiz {
  id: number;
  nome: string;
  itens: number;
  filhas: { id: number; nome: string; itens: number }[];
}

export const ORDENS = [
  { valor: 'vendas', rotulo: 'Mais vendidos' },
  { valor: 'relevancia', rotulo: 'Relevância' },
  { valor: 'comissao', rotulo: 'Maior comissão' },
  { valor: 'menor-preco', rotulo: 'Menor preço' },
  { valor: 'desconto', rotulo: 'Maior desconto' },
] as const;

export type Ordem = (typeof ORDENS)[number]['valor'];

export interface Filtros {
  keyword: string;
  categorias: number[];
  sort: Ordem;
  minCommissionPct: string;
  maxPrice: string;
  keySeller: boolean;
}

export const filtrosVazios: Filtros = {
  keyword: '',
  categorias: [],
  sort: 'vendas',
  minCommissionPct: '',
  maxPrice: '',
  keySeller: false,
};

/** Monta a query string, omitindo o que esta vazio. */
export function queryDeBusca(f: Filtros, page: number): string {
  const p = new URLSearchParams();
  if (f.keyword.trim()) p.set('keyword', f.keyword.trim());
  for (const id of f.categorias) p.append('categoryIds', String(id));
  p.set('sort', f.sort);
  if (f.minCommissionPct) p.set('minCommissionPct', f.minCommissionPct);
  if (f.maxPrice) p.set('maxPrice', f.maxPrice);
  if (f.keySeller) p.set('keySeller', 'true');
  p.set('page', String(page));
  return p.toString();
}
```

- [ ] **Step 2: Seleção múltipla de categorias**

Criar `apps/web/src/pages/garimpar/CategoriaMultiSelect.tsx`. Reusa as classes `catbox`, `catbox__grupo`, `catbox__raiz` e `catbox__item` que a tela antiga já usava, trocando clique único por checkbox.

```tsx
import { useMemo, useState } from 'react';
import { int } from '../../api.js';
import type { Raiz } from './tipos.js';

interface Props {
  arvore: Raiz[];
  selecionadas: number[];
  onChange: (ids: number[]) => void;
}

export function CategoriaMultiSelect({ arvore, selecionadas, onChange }: Props) {
  const [filtro, setFiltro] = useState('');

  // A arvore tem ~276 categorias: sem o filtro por nome a lista e longa demais
  // pra achar uma categoria especifica.
  const visivel = useMemo(() => {
    const termo = filtro.trim().toLowerCase();
    if (!termo) return arvore;
    return arvore
      .map((r) => ({ ...r, filhas: r.filhas.filter((f) => f.nome.toLowerCase().includes(termo)) }))
      .filter((r) => r.filhas.length > 0 || r.nome.toLowerCase().includes(termo));
  }, [arvore, filtro]);

  function alternar(id: number) {
    onChange(selecionadas.includes(id) ? selecionadas.filter((x) => x !== id) : [...selecionadas, id]);
  }

  return (
    <div className="field">
      <label htmlFor="filtro-cat">
        Categorias
        {selecionadas.length > 0 && (
          <span className="chip" data-tone="on" style={{ marginLeft: 8 }}>
            {selecionadas.length} selecionada{selecionadas.length === 1 ? '' : 's'}
          </span>
        )}
      </label>

      <div className="row" style={{ marginBottom: 6 }}>
        <input
          id="filtro-cat"
          value={filtro}
          placeholder="Filtrar categoria pelo nome"
          onChange={(e) => setFiltro(e.target.value)}
          style={{ flex: '1 1 auto' }}
        />
        {selecionadas.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([])}>
            Limpar
          </button>
        )}
      </div>

      <div className="catbox">
        {visivel.length === 0 && <div className="empty">Nenhuma categoria com esse nome.</div>}
        {visivel.map((r) => (
          <div key={r.id} className="catbox__grupo">
            <div className="catbox__raiz">
              {r.nome} <span>{int(r.itens)}</span>
            </div>
            {r.filhas.map((f) => (
              <label key={f.id} className="catbox__item" data-picked={selecionadas.includes(f.id)}>
                <input
                  type="checkbox"
                  checked={selecionadas.includes(f.id)}
                  onChange={() => alternar(f.id)}
                  style={{ marginRight: 8 }}
                />
                <span>{f.nome}</span>
                <em>{int(f.itens)}</em>
              </label>
            ))}
          </div>
        ))}
      </div>
      <small style={{ color: 'var(--muted)' }}>
        Cada categoria é uma consulta à Shopee. Selecionar muitas deixa a busca mais lenta.
      </small>
    </div>
  );
}
```

A rota aceita no máximo 10 categorias (`.max(10)` no Zod). Se `selecionadas.length` chegar a 10, desabilite os checkboxes ainda não marcados e mostre um aviso dizendo que o limite é 10 — melhor barrar na tela que receber 400.

- [ ] **Step 3: Painel de filtros**

Criar `apps/web/src/pages/garimpar/FiltrosBusca.tsx`:

```tsx
import type { Filtros } from './tipos.js';
import { ORDENS } from './tipos.js';

interface Props {
  filtros: Filtros;
  onChange: (f: Filtros) => void;
  onBuscar: () => void;
  buscando: boolean;
}

export function FiltrosBusca({ filtros, onChange, onBuscar, buscando }: Props) {
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => onChange({ ...filtros, [k]: v });
  const podeBuscar = filtros.keyword.trim().length >= 2 || filtros.categorias.length > 0;

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (podeBuscar && !buscando) onBuscar();
      }}
    >
      <div className="row">
        <div className="field" style={{ flex: '2 1 260px' }}>
          <label htmlFor="kw">Palavra-chave</label>
          <input
            id="kw"
            value={filtros.keyword}
            placeholder="fone bluetooth"
            onChange={(e) => set('keyword', e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: '1 1 160px' }}>
          <label htmlFor="ordem">Ordenar por</label>
          <select id="ordem" value={filtros.sort} onChange={(e) => set('sort', e.target.value as Filtros['sort'])}>
            {ORDENS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="comissao">Comissão mínima do vendedor (%)</label>
          <input
            id="comissao"
            type="number"
            min={0}
            max={100}
            value={filtros.minCommissionPct}
            placeholder="20"
            onChange={(e) => set('minCommissionPct', e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="teto">Preço até (R$)</label>
          <input
            id="teto"
            type="number"
            min={0}
            value={filtros.maxPrice}
            placeholder="200"
            onChange={(e) => set('maxPrice', e.target.value)}
          />
        </div>
        <label className="field" style={{ flex: '0 1 190px', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}>
          <input
            type="checkbox"
            checked={filtros.keySeller}
            onChange={(e) => set('keySeller', e.target.checked)}
          />
          <span>Só vendedor destaque</span>
        </label>
      </div>

      <button className="btn" disabled={buscando || !podeBuscar}>
        {buscando ? 'Buscando...' : 'Buscar'}
      </button>
      {!podeBuscar && (
        <small style={{ display: 'block', marginTop: 6, color: 'var(--muted)' }}>
          Digite uma palavra-chave com 2 letras ou mais, ou marque pelo menos uma categoria.
        </small>
      )}
    </form>
  );
}
```

A busca dispara no submit, **não** a cada tecla: cada busca custa uma ou mais chamadas à Shopee.

- [ ] **Step 4: Esqueletos dos dois componentes que as tarefas seguintes completam**

Criar `apps/web/src/pages/garimpar/ResultadoBusca.tsx`:

```tsx
import type { Resultado } from './tipos.js';

interface Props {
  resultado: Resultado | null;
  buscando: boolean;
  onPagina: (page: number) => void;
}

export function ResultadoBusca({ resultado, buscando }: Props) {
  if (buscando) return <div className="empty"><strong>Buscando...</strong></div>;
  if (!resultado) return <div className="empty"><strong>Faça uma busca</strong>Use os filtros acima.</div>;
  return <div className="empty">{resultado.produtos.length} produtos.</div>;
}
```

Criar `apps/web/src/pages/garimpar/PesquisasProntas.tsx`:

```tsx
export function PesquisasProntas() {
  return <div className="empty">Em breve.</div>;
}
```

- [ ] **Step 5: A casca**

Substituir `apps/web/src/pages/Garimpar.tsx` inteiro:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { CategoriaMultiSelect } from './garimpar/CategoriaMultiSelect.js';
import { FiltrosBusca } from './garimpar/FiltrosBusca.js';
import { PesquisasProntas } from './garimpar/PesquisasProntas.js';
import { ResultadoBusca } from './garimpar/ResultadoBusca.js';
import { filtrosVazios, queryDeBusca, type Filtros, type Raiz, type Resultado } from './garimpar/tipos.js';

type Aba = 'buscar' | 'prontas';

export function Garimpar() {
  const [aba, setAba] = useState<Aba>('buscar');
  const [arvore, setArvore] = useState<Raiz[]>([]);
  const [filtros, setFiltros] = useState<Filtros>(filtrosVazios);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Raiz[]>('/api/categorias')
      .then(setArvore)
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar as categorias.'));
  }, []);

  async function buscar(page = 1) {
    setBuscando(true);
    setErro(null);
    try {
      setResultado(await api.get<Resultado>(`/api/garimpar/produtos?${queryDeBusca(filtros, page)}`));
    } catch (e) {
      setResultado(null);
      setErro(e instanceof Error ? e.message : 'A busca falhou.');
    } finally {
      setBuscando(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Garimpar</h1>
          <p>Busque na Shopee ao vivo e mande o que valer direto pra fila.</p>
        </div>
      </div>

      <div className="tabs">
        <button className="tabs__item" data-on={aba === 'buscar'} onClick={() => setAba('buscar')}>
          Buscar
        </button>
        <button className="tabs__item" data-on={aba === 'prontas'} onClick={() => setAba('prontas')}>
          Pesquisas prontas
        </button>
      </div>

      {erro && <div className="notice">{erro}</div>}

      {aba === 'prontas' ? (
        <PesquisasProntas />
      ) : (
        <div className="split">
          <div>
            <CategoriaMultiSelect
              arvore={arvore}
              selecionadas={filtros.categorias}
              onChange={(categorias) => setFiltros((f) => ({ ...f, categorias }))}
            />
          </div>
          <div>
            <FiltrosBusca
              filtros={filtros}
              onChange={setFiltros}
              onBuscar={() => void buscar(1)}
              buscando={buscando}
            />
            <ResultadoBusca resultado={resultado} buscando={buscando} onPagina={(p) => void buscar(p)} />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: Compilar**

Run: `npm run build --workspace @oferta-hub/web`
Expected: sem erro de tipo.

- [ ] **Step 7: Verificar na tela**

`cd apps/web && npx vite --port 5199 --strictPort`, abrir `http://localhost:5199/garimpar`. Há um Docker do usuário servindo a API na porta 3333 — **não derrube nenhum container**.

- As duas abas aparecem, Buscar é a inicial.
- A árvore de categorias carrega, e o filtro por nome reduz a lista.
- Marcar três categorias mostra o contador "3 selecionadas"; Limpar zera.
- Com nada preenchido, o botão Buscar está desabilitado e a dica aparece.
- Palavra-chave com 2+ letras habilita o botão; buscar devolve resultado.
- Marcar 10 categorias desabilita os checkboxes restantes.

Derrube o Vite ao terminar.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/Garimpar.tsx apps/web/src/pages/garimpar/
git commit -m "feat(web): Garimpar com busca por palavra-chave e categorias em multiselect"
```

---

### Task 5: Resultados com comissão do vendedor, paginação e envio para a fila

**Files:**
- Rewrite: `apps/web/src/pages/garimpar/ResultadoBusca.tsx`

**Interfaces:**
- Consumes: da Task 4 — `Produto` e `Resultado` de `./tipos.js`, e a prop `onPagina`. `POST /api/offers/from-product` com `{ platform, externalId }` já existe e devolve a oferta criada.
- Produces: `ResultadoBusca({ resultado, buscando, onPagina }): JSX.Element` completo.

**Depends-on:** Task 4.

- [ ] **Step 1: Escrever o componente**

Substituir `apps/web/src/pages/garimpar/ResultadoBusca.tsx` inteiro:

```tsx
import { useState } from 'react';
import { api, brl, int } from '../../api.js';
import type { Produto, Resultado } from './tipos.js';

interface Props {
  resultado: Resultado | null;
  buscando: boolean;
  onPagina: (page: number) => void;
}

/** Estado do envio pra fila, por produto. */
type Envio = 'enviando' | 'na-fila' | { erro: string };

function desconto(p: Produto): string {
  if (p.listPrice && p.price && p.listPrice > p.price) {
    return `${Math.round((1 - p.price / p.listPrice) * 100)}%`;
  }
  return '—';
}

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}%`);

export function ResultadoBusca({ resultado, buscando, onPagina }: Props) {
  const [envios, setEnvios] = useState<Record<string, Envio>>({});

  async function mandarPraFila(p: Produto) {
    setEnvios((e) => ({ ...e, [p.externalId]: 'enviando' }));
    try {
      await api.post('/api/offers/from-product', { platform: p.platform, externalId: p.externalId });
      setEnvios((e) => ({ ...e, [p.externalId]: 'na-fila' }));
    } catch (err) {
      setEnvios((e) => ({
        ...e,
        [p.externalId]: { erro: err instanceof Error ? err.message : 'Não consegui adicionar.' },
      }));
    }
  }

  if (buscando) {
    return (
      <div className="empty">
        <strong>Buscando...</strong>
        Cada categoria marcada é uma consulta à Shopee.
      </div>
    );
  }

  if (!resultado) {
    return (
      <div className="empty">
        <strong>Faça uma busca</strong>
        Use a palavra-chave, as categorias, ou os dois juntos.
      </div>
    );
  }

  if (resultado.produtos.length === 0) {
    return (
      <>
        {resultado.falhas.length > 0 && (
          <div className="notice">
            {resultado.falhas.length} categoria(s) falharam: {resultado.falhas[0].motivo}
          </div>
        )}
        <div className="empty">
          <strong>Nada sobrou</strong>
          {resultado.bruto > 0
            ? `A Shopee devolveu ${int(resultado.bruto)} itens, mas os filtros cortaram todos. Tente baixar a comissão mínima ou subir o teto de preço.`
            : 'A Shopee não devolveu nada pra essa combinação.'}
        </div>
      </>
    );
  }

  return (
    <>
      {resultado.falhas.length > 0 && (
        <div className="notice">
          Resultado parcial: {resultado.falhas.length} categoria(s) falharam. Primeiro erro:{' '}
          {resultado.falhas[0].motivo}
        </div>
      )}

      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        {int(resultado.produtos.length)} de {int(resultado.bruto)} encontrados
        {resultado.categorias.length > 0 && ` em ${resultado.categorias.length} categoria(s)`}
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Produto</th>
            <th className="num">Preço</th>
            <th className="num">Desconto</th>
            <th className="num">Comissão</th>
            <th className="num">Vendedor</th>
            <th className="num">Vendas</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {resultado.produtos.map((p) => {
            const envio = envios[p.externalId];
            return (
              <tr key={p.externalId}>
                <td>
                  <div className="cell-product">
                    {p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" />}
                    <span>
                      {p.title}
                      <br />
                      <small style={{ color: 'var(--muted)' }}>{p.shopName ?? '—'}</small>
                      {typeof envio === 'object' && (
                        <>
                          <br />
                          <small style={{ color: 'var(--danger, #f66)' }}>{envio.erro}</small>
                        </>
                      )}
                    </span>
                  </div>
                </td>
                <td className="num">{brl(p.price)}</td>
                <td className="num">{desconto(p)}</td>
                <td className="num">{pct(p.commissionPct)}</td>
                <td className="num">
                  <strong>{pct(p.sellerCommissionPct)}</strong>
                  {p.commissionBrl !== null && (
                    <>
                      <br />
                      <small style={{ color: 'var(--muted)' }}>{brl(p.commissionBrl)}</small>
                    </>
                  )}
                </td>
                <td className="num">
                  <strong>{int(p.soldCount)}</strong>
                </td>
                <td className="num">
                  {envio === 'na-fila' ? (
                    <span className="chip" data-tone="on">
                      na fila
                    </span>
                  ) : (
                    <button
                      className="btn btn--ghost btn--sm"
                      disabled={envio === 'enviando'}
                      onClick={() => void mandarPraFila(p)}
                    >
                      {envio === 'enviando' ? 'Enviando...' : 'Mandar pra fila'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
        <button
          className="btn btn--ghost btn--sm"
          disabled={resultado.pageInfo.page <= 1}
          onClick={() => onPagina(resultado.pageInfo.page - 1)}
        >
          Anterior
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>Página {resultado.pageInfo.page}</span>
        <button
          className="btn btn--ghost btn--sm"
          disabled={!resultado.pageInfo.hasNextPage}
          onClick={() => onPagina(resultado.pageInfo.page + 1)}
        >
          Próxima
        </button>
      </div>
    </>
  );
}
```

Uma nota sobre o estado `envios`: ele é indexado por `externalId` e **não** é limpo quando a busca muda de página. Isso é de propósito — se o mesmo produto reaparecer, a marca "na fila" continua correta. O estado morre quando o usuário sai da tela, o que é aceitável para uma sessão de garimpo.

Confira se existe a variável CSS `--danger` em `styles.css`. Se não existir, use a cor que o projeto já usa para erro (procure em `.notice` ou no chip com `data-tone="off"`) em vez de inventar uma.

- [ ] **Step 2: Compilar**

Run: `npm run build --workspace @oferta-hub/web`
Expected: sem erro de tipo.

- [ ] **Step 3: Verificar na tela**

Com o Vite em 5199 e a API do Docker na 3333:

- Buscar `fone bluetooth` devolve tabela com as colunas Comissão e Vendedor preenchidas.
- Ordenar por "Maior comissão" põe os maiores percentuais no topo.
- Comissão mínima 20 reduz a lista, e toda linha restante mostra 20% ou mais na coluna Vendedor.
- Comissão mínima 99 devolve o estado vazio explicando que o filtro cortou tudo, citando o número bruto.
- "Próxima" traz produtos diferentes; "Anterior" volta. Na página 1, "Anterior" está desabilitado.
- Clicar em "Mandar pra fila" troca o botão por "na fila", e a oferta aparece em Início › Fila.
- Clicar de novo no mesmo produto (após recarregar a busca) não duplica a oferta na fila.

Derrube o Vite ao terminar.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/garimpar/ResultadoBusca.tsx
git commit -m "feat(web): resultado do Garimpar com comissao do vendedor, paginacao e envio pra fila"
```

---

### Task 6: Pesquisas prontas e editor de regras de nicho

**Files:**
- Rewrite: `apps/web/src/pages/garimpar/PesquisasProntas.tsx`
- Create: `apps/web/src/pages/garimpar/EditorNicho.tsx`
- Delete: `apps/web/src/pages/Nichos.tsx`

**Interfaces:**
- Consumes: da Task 3 — `POST /api/nichos/:id/testar` aceitando `minCommissionPct` e `keySeller`, e devolvendo `sellerCommissionPct`/`commissionBrl` em cada produto. `GET /api/nichos` já lista os nichos. Da Task 4 — os tipos de `./tipos.js`.
- Produces: `PesquisasProntas()` completo, e `EditorNicho()` — o conteúdo de `Nichos.tsx`.

**Depends-on:** Task 3, Task 4.

- [ ] **Step 1: Mover o editor de nichos**

`git mv apps/web/src/pages/Nichos.tsx apps/web/src/pages/garimpar/EditorNicho.tsx`

No arquivo movido:
- Renomear a função exportada de `Nichos` para `EditorNicho`.
- Corrigir os imports relativos: o arquivo desceu um nível, então `from '../api.js'` vira `from '../../api.js'`. Fazer isso em **todo** import que comece com `../`.
- No `<div className="head">`, trocar o `<h1>` para "Regras de nicho", já que agora ele vive dentro de Garimpar e não é mais uma página de primeiro nível.

Nada mais muda no corpo. `Nichos.tsx` estava sem rota desde a fase 1, então nenhum import em outro arquivo aponta para ele — confirme com uma busca antes de commitar.

- [ ] **Step 2: Escrever as pesquisas prontas**

Substituir `apps/web/src/pages/garimpar/PesquisasProntas.tsx` inteiro:

```tsx
import { useEffect, useState } from 'react';
import { api, int } from '../../api.js';
import { EditorNicho } from './EditorNicho.js';
import { ResultadoBusca } from './ResultadoBusca.js';
import type { Produto } from './tipos.js';

interface Nicho {
  id: string;
  name: string;
  platform: string;
  minSales: number;
  builtIn: boolean;
  active: boolean;
  regras: number;
}

/** Resposta de POST /api/nichos/:id/testar. */
interface Teste {
  bruto: number;
  aceitos: number;
  porCategoria: { categoryId: number; nome: string; bruto: number; aceitos: number; erro?: string }[];
  produtos: (Produto & { categoria: string | null })[];
}

export function PesquisasProntas() {
  const [nichos, setNichos] = useState<Nicho[]>([]);
  const [editando, setEditando] = useState(false);
  const [rodando, setRodando] = useState<string | null>(null);
  const [teste, setTeste] = useState<{ nicho: Nicho; dados: Teste } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setNichos(await api.get<Nicho[]>('/api/nichos'));
  }

  useEffect(() => {
    void carregar().catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar os nichos.'));
  }, []);

  async function rodar(n: Nicho) {
    setRodando(n.id);
    setErro(null);
    setTeste(null);
    try {
      const dados = await api.post<Teste>(`/api/nichos/${n.id}/testar`, {});
      setTeste({ nicho: n, dados });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A pesquisa falhou.');
    } finally {
      setRodando(null);
    }
  }

  if (editando) {
    return (
      <>
        <button
          className="btn btn--ghost btn--sm"
          style={{ marginBottom: 12 }}
          onClick={() => {
            setEditando(false);
            // As regras podem ter mudado enquanto o editor estava aberto.
            void carregar().catch(() => {});
          }}
        >
          ← Voltar pras pesquisas
        </button>
        <EditorNicho />
      </>
    );
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
          Buscas já montadas: categoria, termos obrigatórios e mínimo de vendas num clique.
        </p>
        <button className="btn btn--ghost" onClick={() => setEditando(true)}>
          Editar regras
        </button>
      </div>

      {erro && <div className="notice">{erro}</div>}

      {nichos.length === 0 && (
        <div className="empty">
          <strong>Nenhum nicho montado</strong>
          Clique em "Editar regras" pra criar o primeiro.
        </div>
      )}

      <div className="split">
        {nichos.map((n) => (
          <div key={n.id} className="panel">
            <h2 className="panel__title">
              {n.name}
              {!n.active && (
                <span className="chip" style={{ marginLeft: 8 }}>
                  inativo
                </span>
              )}
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 10px' }}>
              {n.regras} categoria{n.regras === 1 ? '' : 's'} · mínimo de {int(n.minSales)} vendas
            </p>
            <button className="btn" disabled={rodando !== null} onClick={() => void rodar(n)}>
              {rodando === n.id ? 'Buscando...' : 'Buscar agora'}
            </button>
          </div>
        ))}
      </div>

      {teste && (
        <div style={{ marginTop: 16 }}>
          <h2 className="panel__title">
            {teste.nicho.name}: {int(teste.dados.aceitos)} de {int(teste.dados.bruto)} passaram no filtro
          </h2>

          {teste.dados.porCategoria.some((c) => c.erro) && (
            <div className="notice">
              Algumas categorias falharam: {teste.dados.porCategoria.find((c) => c.erro)?.erro}
            </div>
          )}

          <ResultadoBusca
            resultado={{
              categorias: teste.dados.porCategoria.map((c) => ({ id: c.categoryId, nome: c.nome })),
              bruto: teste.dados.bruto,
              produtos: teste.dados.produtos,
              // O endpoint de nicho nao pagina: ele varre as categorias do
              // nicho de uma vez. Sem proxima pagina pra oferecer.
              pageInfo: { page: 1, hasNextPage: false },
              falhas: teste.dados.porCategoria
                .filter((c) => c.erro)
                .map((c) => ({ categoryId: c.categoryId, motivo: c.erro! })),
            }}
            buscando={false}
            onPagina={() => {}}
          />
        </div>
      )}
    </>
  );
}
```

Reusar `ResultadoBusca` aqui é o ponto: a tabela, o botão "Mandar pra fila" e os estados de envio vêm de graça, e o resultado de uma pesquisa pronta se comporta igual ao de uma busca manual.

Confira o formato real de `GET /api/nichos` antes de compilar — a interface `Nicho` acima foi montada a partir do que `Nichos.tsx` consumia, e o campo `regras` pode ter outro nome. Use os nomes reais.

- [ ] **Step 3: Compilar**

Run: `npm run build --workspace @oferta-hub/web`
Expected: sem erro de tipo. Se acusar import não usado, é sobra do Step 1.

- [ ] **Step 4: Verificar na tela**

Com o Vite em 5199:

- A aba Pesquisas prontas lista os nichos com nome, número de categorias e mínimo de vendas.
- "Buscar agora" num nicho devolve produtos, com o placar "X de Y passaram no filtro".
- O botão "Mandar pra fila" funciona nesses resultados.
- "Editar regras" abre o editor; "Voltar pras pesquisas" retorna e a lista reflete alterações feitas.
- Salvar uma regra no editor persiste (recarregue a página e confira).

Derrube o Vite ao terminar.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/pages
git commit -m "feat(web): pesquisas prontas em Garimpar, com o editor de regras de nicho"
```

---

## Ordem de execução

Conflito de arquivo respeitado:

- **Onda 1:** Task 1 (conector).
- **Onda 2:** Task 2 (rota + merge) e Task 3 (nichos) — arquivos disjuntos, ambas dependem só da Task 1.
- **Onda 3:** Task 4 (casca + filtros + multiselect).
- **Onda 4:** Task 5 (resultados) e Task 6 (pesquisas prontas) — a Task 6 importa `ResultadoBusca`, que a Task 5 reescreve. **Serializar: Task 5 antes da Task 6.**

## Verificação final da fase

- [ ] `npm run build` limpo na raiz.
- [ ] `npx tsx apps/api/src/routes/garimpar-merge.check.ts` imprime `garimpar-merge.check: ok`.
- [ ] `npx tsx apps/api/src/plugins/senha.check.ts` continua imprimindo `senha.check: ok` (não deve ter sido afetado).
- [ ] Busca por palavra-chave sozinha devolve resultado.
- [ ] Busca com 3 categorias devolve resultado sem duplicatas.
- [ ] Piso de comissão em 20% reduz a lista, e todo item restante tem comissão de vendedor ≥ 20%.
- [ ] "Só vendedor destaque" muda o conjunto de resultados.
- [ ] Página 2 traz itens diferentes da página 1.
- [ ] "Mandar pra fila" cria a oferta e ela aparece em Início › Fila.
- [ ] Uma pesquisa pronta devolve os produtos daquele nicho, com o placar de filtro.
- [ ] "Editar regras" abre o editor e salvar persiste.
- [ ] A mensagem de credencial ausente cita "Configuracoes > Plataformas", não "Conexoes".
