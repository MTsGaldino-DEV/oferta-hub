# Build context = raiz do monorepo.
#   docker build -f apps/web/Dockerfile .

# ---------------------------------------------------------------
# builder: Vite -> estatico
# ---------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# git: mesmo instalando so o workspace do web, o npm resolve a arvore inteira
# do monorepo, e o Baileys (na API) traz `libsignal` via git+https.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm install --workspace=apps/web --include-workspace-root --no-audit --no-fund

COPY apps/web apps/web

RUN npm run build --workspace=apps/web

# ---------------------------------------------------------------
# runtime: nginx serve o estatico e faz proxy de /api e /r pra API.
# Mesma origem => o cookie de sessao (httpOnly, sameSite lax) funciona
# sem CORS, igual ao proxy do vite em dev.
# ---------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
