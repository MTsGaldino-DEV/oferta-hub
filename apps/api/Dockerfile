# Build context = raiz do monorepo (precisa do package.json de workspaces).
#   docker build -f apps/api/Dockerfile .

# ---------------------------------------------------------------
# builder: instala deps do workspace da API e compila TS -> dist/
# ---------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# openssl: o engine do Prisma linka contra ele em runtime e no generate.
# git: o Baileys puxa `libsignal` de git+https, o npm precisa clonar.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# Os tres package.json primeiro: npm workspaces exige que todo workspace
# declarado exista, mesmo instalando so o da API. Camada cacheavel.
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# schema.prisma precisa existir ANTES do install: o postinstall da API
# roda `prisma generate` e le esse arquivo.
COPY apps/api/prisma apps/api/prisma

RUN npm install --workspace=apps/api --include-workspace-root --no-audit --no-fund

COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src

RUN npm run build --workspace=apps/api

# ---------------------------------------------------------------
# runtime
# ---------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copia a arvore inteira do builder (node_modules hoisted na raiz + client do
# Prisma ja gerado + dist). O CLI do Prisma vem junto de proposito: o boot
# roda `prisma db push` pra criar/sincronizar o schema no Postgres.
COPY --from=builder /app /app

WORKDIR /app/apps/api

EXPOSE 3333

# db push antes de subir: idempotente, e este projeto usa db push (nao migrations).
CMD ["sh", "-c", "npx prisma db push --skip-generate && exec node dist/server.js"]
