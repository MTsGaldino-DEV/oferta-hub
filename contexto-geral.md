# Oferta Hub — Contexto Geral

## O que é

Painel para operar um grupo de ofertas no WhatsApp. Busca produtos em várias
APIs de afiliado, monitora preço, calcula uma nota (0–100) para cada oferta e
só envia para o grupo depois de aprovação manual do operador. Não é um bot
totalmente automático — o humano aprova cada envio na fila de curadoria.

Aplicação single-tenant: uma instância = uma pessoa/operação, uma sessão de
WhatsApp, um dashboard protegido por senha única (sem multiusuário).

## Stack

- **Monorepo npm workspaces**: `apps/api` (backend) + `apps/web` (frontend)
- **API**: Fastify + TypeScript (ESM), Prisma ORM sobre PostgreSQL, Zod para
  validação, Pino para logs
- **Web**: React 18 + Vite + React Router, sem framework de CSS (styles.css
  próprio)
- **WhatsApp**: Baileys (`@whiskeysockets/baileys`) — biblioteca não oficial
  que fala o protocolo do WhatsApp Web direto (não é a API oficial da Meta,
  que não permite grupos)
- **Cron**: `node-cron`, 4 workers em `apps/api/src/workers/index.ts`
- **Infra alvo**: uma VPS simples, Docker só para o Postgres, deploy via
  systemd, Nginx + Certbot na frente

## Estrutura

```
apps/api/src/
  connectors/     um arquivo por plataforma de afiliado, todos implementam a interface Connector (types.ts)
                  amazon, mercadolivre, shopee, aliexpress, awin, lomadee
  services/
    scoring.ts    calcula a nota 0-100 de cada oferta (ver "Como a nota é calculada" abaixo)
    message.ts    monta o texto da mensagem enviada ao grupo
    ingest.ts     captura/normaliza produtos vindos dos connectors
    dispatch.ts   envio efetivo (WhatsApp) respeitando limites
  whatsapp/baileys.ts   pareamento, grupos, sessão (auth_state/)
  workers/index.ts      4 crons: agenda, monitor de preço, garimpo (discovery), sync de vendas
  routes/         API REST (credentials, offers, stats, watch, whatsapp) + /r/:code (redirect público)
  plugins/auth.ts sessão via cookie, senha única do dashboard
  lib/crypto.ts   AES-256-GCM para criptografar credenciais de API no banco
  prisma/schema.prisma  schema do banco (ver modelos abaixo)

apps/web/src/
  pages/          Fila, Desempenho, Produtos (vigiados), Agenda, Conexoes
  components/     PriceTag, Sparkline
  api.ts          client HTTP para a API
```

## Modelo de dados (Prisma)

- **Credential** — credenciais de cada `Platform`, payload criptografado
- **Product** — produto normalizado de qualquer plataforma (preço atual,
  preço de lista, comissão, rating)
- **PriceSnapshot** — histórico de preço (base do "menor preço em 90 dias")
- **Offer** — uma oferta candidata/enviada: `status` (PENDING → QUEUED →
  SENT/SKIPPED/FAILED), `source` (MANUAL/WATCHLIST/DISCOVERY), `score`
- **ShortLink** / **Click** — link curto próprio (`/r/:code`) e rastreio de
  cliques (IP é armazenado como hash, nunca em texto puro)
- **Conversion** — vendas confirmadas (só a Awin devolve via API; as outras
  plataformas dependem de import manual/relatório)
- **WatchItem** — produto vigiado com gatilho de preço/desconto
- **DiscoveryRule** — regra de garimpo automático (palavra-chave, filtros)
- **WhatsappGroup**, **SendLog** — grupo de destino e contador diário de
  envios (teto anti-ban)

## Como a nota (score) é calculada

`apps/api/src/services/scoring.ts`, pesos deliberados:

- **+40** preço histórico (está abaixo do mínimo/média dos últimos 90 dias?)
- **+20** desconto anunciado pela loja (peso baixo de propósito — "de/por" é
  inflável)
- **+20** comissão em reais (oferta boa que não paga nada não sobe a fila)
- **+15** reputação (rating × log do volume de avaliações)
- **−25** fadiga (mesmo produto enviado na mesma semana desce)

## Segurança e limites de envio (anti-ban do WhatsApp)

Baileys viola os ToS do WhatsApp — risco real de ban do número pareado. O
código mitiga com:
- Intervalo mínimo entre envios (`WA_MIN_INTERVAL_SECONDS`, padrão 90s + jitter)
- Teto diário de envios (`WA_DAILY_CAP`, padrão 40), reforçado via `SendLog`
- Simulação de "digitando..." antes de enviar
- Mensagens sem CAPS LOCK / spam de emoji

Recomendação do próprio projeto: usar chip secundário, nunca o número
pessoal.

## Plataformas de afiliado suportadas

Amazon, Mercado Livre, Shopee, AliExpress, Awin, Lomadee — cada uma com
particularidades de autenticação documentadas no README (ex.: Amazon exige 3
vendas em 180 dias para liberar a PA-API; Shopee usa assinatura SHA256
sensível a clock skew; Mercado Livre usa OAuth com refresh token de uso
único, renovado automaticamente; Awin é a única com conversão automática via
API).

## Credenciais e segredos

- Cadastradas preferencialmente pelo dashboard (**Conexões**), criptografadas
  com AES-256-GCM (`MASTER_KEY`) e gravadas no banco — `.env` é só fallback
- Perder `MASTER_KEY` inutiliza todas as credenciais salvas (fazer backup
  fora do repo)
- `scripts/mercadolivre-oauth.mjs` — script auxiliar para gerar o refresh
  token do Mercado Livre via fluxo OAuth manual (sem servidor local)

## Comandos principais

```bash
npm install
npm run keygen        # gera MASTER_KEY
npm run dev            # API :3333 + web :5173
npm run db:push        # aplica schema.prisma no Postgres
npm run build           # build de api + web
docker compose up -d db # sobe só o Postgres
```

## Coisas a ter em mente ao mexer no código

- APIs das plataformas (Shopee, AliExpress, Lomadee) mudam com frequência —
  a estrutura de connectors isolados existe justamente para conter isso
- Atribuição de venda é imperfeita fora da Awin; outras plataformas dependem
  de `POST /api/conversions` manual/importado
- Toda mensagem enviada precisa manter a divulgação "link de afiliado"
  (exigência legal/contratual, não é só estética)
- Para adicionar uma plataforma nova: criar arquivo em `connectors/`,
  implementar a interface `Connector`, registrar em `connectors/index.ts` e
  adicionar ao enum `Platform` no `schema.prisma` — o dashboard monta o
  formulário de credenciais sozinho a partir do array `fields`
