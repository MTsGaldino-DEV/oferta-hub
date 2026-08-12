# Oferta Hub

Painel para operar um grupo de ofertas no WhatsApp. Captura produtos das APIs de afiliado, monitora preço, calcula uma nota para cada oferta, e só envia depois que você aprova.

---

## O que ele faz

| Recurso | Como funciona |
|---|---|
| **Modo manual** | Você cola o link, o sistema busca na API da loja, gera o link de afiliado, encurta com rastreio e monta a mensagem. |
| **Monitor de preço** | De hora em hora lê os produtos vigiados, grava o histórico e joga na fila quando bate o gatilho. |
| **Garimpo automático** | A cada 3 horas varre suas palavras-chave nas lojas conectadas e traz o que passa dos filtros. |
| **Fila de curadoria** | Tudo cai aqui ordenado por nota. Nada é enviado sem seu clique. |
| **Rastreio de cliques** | Cada oferta ganha um link curto próprio (`/r/abc1234`). É assim que você mede o que funciona. |
| **Comparativo de rede** | Mostra R$ por clique e R$ por oferta de cada plataforma — não só o percentual anunciado. |
| **Agenda** | Marca horário e o worker envia, respeitando o intervalo mínimo e o teto diário. |

### Como a nota é calculada

De 0 a 100, em `apps/api/src/services/scoring.ts`. Os pesos são deliberados:

- **40 pts — preço histórico.** Está abaixo do que já esteve nos últimos 90 dias?
- **20 pts — desconto anunciado.** Vale pouco de propósito: o "de/por" é inflável.
- **20 pts — comissão em reais.** Oferta ótima que não paga nada não sobe a fila.
- **15 pts — reputação** (nota × volume de avaliações).
- **−25 pts — fadiga.** Produto repetido na mesma semana desce.

Mexa nos pesos quando entender o que seu grupo responde melhor. É um arquivo só.

---

## Contas e credenciais que você precisa

Cadastre tudo pelo dashboard, em **Conexões** — grava criptografado (AES-256-GCM) no banco. O `.env` é só fallback.

### Amazon Associados
1. Painel de Associados → Ferramentas → Product Advertising API → **Access Key** e **Secret Key**
2. Sua **tag de afiliado** (ex: `seugrupo-20`)
3. Host `webservices.amazon.com.br`, região `us-east-1`

> A Amazon só libera a PA-API depois de **3 vendas qualificadas em 180 dias**, e revoga se você ficar 30 dias sem vender. Até lá, o `getProduct` vai falhar — mas o `buildAffiliateLink` continua funcionando, então use o modo manual com a URL do produto.

### Mercado Livre
1. Crie um app em `developers.mercadolivre.com.br` → **Client ID** e **Client Secret**
2. Rode o fluxo OAuth uma vez para obter o **refresh token**
3. Sua tag do programa de afiliados

> O access token vale 6h e o refresh token é de uso único — o sistema renova e regrava sozinho. Para links `mercadolivre.com/sec/...` gerados no painel deles, cole o link já encurtado.

### Shopee Afiliados
1. Painel Shopee Affiliate → Open API → **App ID** e **Secret**

> A API é GraphQL com assinatura SHA256. Timestamp fora de 5 minutos dá erro — mantenha o relógio do servidor sincronizado (`timedatectl set-ntp true`).

### AliExpress
1. `open.aliexpress.com` → crie o app → **App Key** e **App Secret**
2. **Tracking ID** do seu canal no Affiliate Portals

### Awin
1. Awin → Conta → Credenciais API → **API Token**
2. Seu **Publisher ID**

> A Awin não tem busca de produto na API (isso exige o Product Feed em CSV). Aqui ela serve para gerar deep links e **importar as vendas confirmadas** — é a única rede do conjunto que devolve conversão automaticamente.

### Lomadee
1. **App Token** e **Source ID**

> Cobre Magalu, Americanas, Casas Bahia e outras lojas grandes que não têm API própria acessível.

### Infra
- **VPS** com 2 GB de RAM já roda tudo (a sessão do Baileys precisa de disco persistente)
- **PostgreSQL** — o `docker-compose.yml` sobe um
- Um **domínio com HTTPS** apontando pra API: os links curtos precisam ser públicos e estáveis

---

## Instalação

```bash
git clone <seu-repo> oferta-hub && cd oferta-hub
npm install

cp .env.example .env
npm run keygen          # copie o MASTER_KEY pro .env
# preencha também DASHBOARD_PASSWORD, SESSION_SECRET e PUBLIC_URL

docker compose up -d db
npm run db:push

npm run dev             # API na 3333, dashboard na 5173
```

Abra `http://localhost:5173`, entre com a senha do `.env` e vá em **Conexões**.

### Ordem recomendada no primeiro uso

1. Cadastre **uma** plataforma e clique em "Salvar e testar" até dar verde
2. Pareie o WhatsApp (leia o aviso abaixo antes)
3. Escolha o grupo de destino
4. Cole um link no modo manual e envie **uma** oferta para validar a ponta a ponta
5. Só então crie regras de garimpo e produtos vigiados

---

## Sobre o WhatsApp — leia antes de parear

O envio usa **Baileys**, biblioteca não oficial que fala o protocolo do WhatsApp Web direto. Isso **viola os Termos de Serviço do WhatsApp** e o número pareado pode ser banido, normalmente em definitivo.

A API oficial (Meta Cloud API) não é alternativa aqui: ela não envia mensagens para grupos, só conversas 1:1 iniciadas pelo usuário. Não existe caminho oficial para o seu caso de uso.

O que o sistema já faz para reduzir o risco:

- **Intervalo mínimo** de 90s entre envios, com jitter aleatório (`WA_MIN_INTERVAL_SECONDS`)
- **Teto diário** de 40 envios, que o código recusa ultrapassar (`WA_DAILY_CAP`)
- Simula "digitando..." antes de enviar
- Mensagens sem CAPS LOCK e sem enxurrada de emoji

O que depende de você:

- Use um **chip secundário**, nunca o seu número pessoal
- Deixe o número em uso normal por alguns dias antes de automatizar
- Grupo com opt-in real aguenta bem; **denúncia de usuário é o que de fato derruba número**
- Faça backup da pasta `auth_state/` — é a sessão pareada

---

## Deploy numa VPS

```bash
npm run build
docker compose up -d db

# systemd
sudo tee /etc/systemd/system/ofertahub.service > /dev/null << 'EOF'
[Unit]
Description=Oferta Hub API
After=network.target docker.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/oferta-hub/apps/api
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now ofertahub
```

Sirva `apps/web/dist` como estático no Nginx e faça proxy de `/api` e `/r` para a porta 3333. Use Certbot para o HTTPS — os links curtos precisam dele.

---

## Estrutura

```
apps/api/src/
  connectors/     um arquivo por plataforma, todos implementam a mesma interface
  services/       scoring (nota), message (texto), ingest (captura), dispatch (envio)
  whatsapp/       Baileys: pareamento, grupos, limites de envio
  workers/        4 crons: agenda, monitor de preço, garimpo, sincronia de vendas
  routes/         API REST + /r/:code público
apps/web/src/
  pages/          Fila, Desempenho, Preços vigiados, Agenda, Conexões
  components/     etiqueta de preço e gráfico de histórico
```

### Adicionar uma plataforma nova

Crie o arquivo em `connectors/`, implemente a interface `Connector`, registre em `connectors/index.ts` e adicione o valor no enum `Platform` do `schema.prisma`. O dashboard monta o formulário de credenciais sozinho a partir do array `fields`.

---

## Avisos honestos

**As APIs mudam.** Endpoints e formatos de assinatura de Shopee, AliExpress e Lomadee mudaram várias vezes. Se um conector der erro de assinatura ou campo faltando, confira a documentação atual da plataforma antes de mexer no código — a estrutura está isolada justamente para isso.

**Atribuição de venda é imperfeita.** Só a Awin devolve transações por API aqui. Para as outras, exporte o relatório e use `POST /api/conversions`, ou lance manualmente. Cliques você mede sozinho; vendas dependem da rede.

**Divulgação de afiliado.** O template já assina "link de afiliado" em toda mensagem. O CDC brasileiro exige transparência em publicidade e as próprias redes exigem em contrato — não tire isso.

**Backup.** Perder o `MASTER_KEY` inutiliza todas as credenciais salvas. Guarde fora do repositório e junto com o backup do banco.

---

## Gerar o refresh token do Mercado Livre

O Client ID e o Client Secret sozinhos não bastam — falta o refresh token, que só sai autorizando o app uma vez via OAuth. Tem um script pronto pra isso.

O painel do Mercado Livre exige que a URI de redirect comece com `https://` (não aceita `http://localhost`), então o script usa um fluxo manual: você loga, o Mercado Livre te manda pra uma página https qualquer com o código na URL, e você copia essa URL de volta pro terminal. Sem servidor local, sem certificado.

```bash
# 1. No painel do app, na configuração da aplicação, em "URIs de redirect", cadastre:
#    https://example.com/
#
# 2. Confirme que "Authorization Code" está marcado em "Fluxos OAuth"
#    (o toggle "PKCE necessário" pode ficar ligado ou desligado, o script já manda PKCE de qualquer forma)
#
# 3. Nas permissões, não precisa mexer em nada — "Usuários" já vem liberado
#    por padrão e é só o que a integração usa

ML_CLIENT_ID=seu_client_id ML_CLIENT_SECRET=seu_client_secret node scripts/mercadolivre-oauth.mjs
```

O script abre o navegador sozinho. Você loga na conta que vai ser a afiliada, autoriza, e cai numa página em `https://example.com/?code=...` — parece vazia, é esperado, ela não faz nada com o código. O que importa é a URL. Copie ela inteira e cole no terminal quando o script pedir.

Ele troca por token e imprime os três valores prontos para colar no dashboard (Conexões → Mercado Livre). O código de autorização vale só alguns minutos — se demorar demais entre autorizar e colar a URL, rode tudo de novo.

Prefere não passar o secret na linha de comando? Crie um arquivo `.env.ml` na raiz do projeto (já está no `.gitignore`, nunca é versionado):

```
ML_CLIENT_ID=seu_client_id
ML_CLIENT_SECRET=seu_client_secret
```

e rode só `node scripts/mercadolivre-oauth.mjs`.
