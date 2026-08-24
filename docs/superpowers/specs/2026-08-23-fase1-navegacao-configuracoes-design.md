# Fase 1 — Reestruturação da navegação e da tela de Configurações

Data: 2026-08-23
Status: aprovado para planejamento

## Contexto

A navegação atual espalha onze rotas em grupos (`Catálogo`, `Automação`,
`Métricas`, `Configurações`) que não correspondem a como o produto é usado.
Três páginas — `Agenda`, `Nichos` e `Preços vigiados` — ocupam espaço de
primeiro nível sem justificar: a Agenda duplica um recurso que já existe
dentro de Disparos, Nichos é um editor de regras que serve às automações e à
busca, e Preços vigiados é um ajuste que pertence à criação de uma automação.

A tela de Configurações tem hoje apenas duas sub-abas (Conexões e Modelos de
mensagem) e não cobre canais de envio, cupons nem dados da conta. O produto
caminha para um SaaS, então a conta precisa existir como tela mesmo que a
maior parte dela ainda seja estática.

Esta fase trata apenas de estrutura de navegação e da tela de Configurações.
Garimpar (fase 2), polimento visual (fase 3) e Proteção de grupos (fase 4)
têm specs próprias.

## Vocabulário

Para as próximas conversas:

- **Seção** — item de primeiro nível da barra lateral.
- **Aba** — sub-aba dentro de uma seção, renderizada no topo da página.

## Navegação alvo

| Seção | Abas |
|---|---|
| Início | Visão geral · Fila |
| Garimpar | (página única) |
| Automações | Disparos · Automatizar · Vigiar |
| Métricas | Desempenho · Meus Grupos |
| Configurações | Canais · Plataformas · Mensagens · Cupons · Conta |

Início e Métricas aparecem como grupo rotulado na barra lateral, com os dois
itens visíveis. Automações e Configurações são um item só, com as abas dentro
da página.

Rotas removidas: `/agenda`, `/nichos`, `/produtos`. O conteúdo de
`/produtos` não é descartado: vira a aba Vigiar dentro de Automações.

## Arquitetura

### Barra lateral

`apps/web/src/components/app-sidebar.tsx` — reescrever a constante `GROUPS`
para a tabela acima. Os ícones `CalendarClock`, `Tags` e `Eye` deixam de ser
importados. O badge de pendentes continua ancorado em `/fila`.

### Roteamento

`apps/web/src/App.tsx` — remover as rotas `/agenda`, `/nichos` e `/produtos`.
O catch-all `*` já redireciona para `/`, então links antigos não quebram em
tela branca.

`apps/web/src/pages/Agenda.tsx` é deletado. Disparos já oferece agendamento
(`quando: 'agora' | 'agendar'`) e nenhuma rota da API depende da página.

### Automações

`Automacoes.tsx` (391 linhas) passa a ser uma casca com três abas, no mesmo
padrão que `Configuracoes.tsx` usa hoje:

- **Disparos** — renderiza `Disparos.tsx` sem alteração. É a aba inicial.
- **Automatizar** — o conteúdo atual de `Automacoes.tsx`, extraído para
  `apps/web/src/pages/automacoes/AutomacoesLista.tsx`.
- **Vigiar** — o conteúdo atual de `Produtos.tsx`, movido para
  `apps/web/src/pages/automacoes/Vigiar.tsx`.

As duas extrações são recortes mecânicos: o corpo atual de cada página vira o
novo arquivo, e `Automacoes.tsx` fica só com o estado da aba e os três
`import`.

### Vigia de preço e garimpo automático

A página `Produtos.tsx` ("Preços vigiados") mistura dois assuntos que batem em
models diferentes:

- "Vigiar um produto" cria `WatchItem` — uma URL específica, monitorada por
  queda de preço.
- "Garimpo automático" cria `DiscoveryRule` — palavra-chave mais loja, que
  varre e joga achados na fila.

Nenhum dos dois é `AutomationRule`, que é o que a aba Automatizar edita.
Fundir os três num único formulário juntaria conceitos distintos numa tela só,
então os dois blocos ficam juntos na aba Vigiar, sem reescrita. O que a fase
entrega é a saída da barra lateral, não a fusão dos formulários.

As rotas `/api/watch` e `/api/discovery` permanecem intactas.

### Configurações

`Configuracoes.tsx` passa de duas para cinco abas. Cada aba é um componente
em `apps/web/src/pages/configuracoes/`:

1. **Canais** (`Canais.tsx`) — o card do WhatsApp que hoje vive em
   `Conexoes.tsx:188-272` (status, QR, sincronizar grupos, grupo padrão,
   sair), movido para cá sem reescrever a lógica. Ao lado, um card do Telegram
   desabilitado, marcado "Em breve". Abaixo, um botão "Adicionar outro número
   ou bot" que abre um aviso de indisponibilidade — o backend mantém uma
   sessão Baileys única, e suportar várias é trabalho de outra fase.
2. **Plataformas** (`Conexoes.tsx`) — a página atual **sem** o card do
   WhatsApp, reorganizada em um card por loja, com selo "Conectado" ou
   "Pendente" no canto, campos da credencial, e os botões "Salvar" e "Validar
   conexão". Os cards de Aparência (`Conexoes.tsx:274`) e Extensão
   (`Conexoes.tsx:309`) descem para a aba Conta, onde ajuste pessoal faz mais
   sentido que credencial de loja.
3. **Mensagens** (`Templates.tsx`) — a página atual, mais uma faixa de cinco
   presets clicáveis acima do editor.
4. **Cupons** (`Cupons.tsx`) — novo, apenas um estado vazio explicando que a
   função chega depois.
5. **Conta** (`Conta.tsx`) — novo. Nome, e-mail e plano como texto estático.
   Formulário de troca de senha funcional. Botão de sair. Recebe também os
   cards de Aparência e Extensão vindos de `Conexoes.tsx`.

### Presets de mensagem

Cinco modelos entram como registros de `MessageTemplate` semeados na
inicialização, no mesmo padrão de `connectors/nichos-prontos.ts`: um módulo
`apps/api/src/services/templates-prontos.ts` exporta a lista, e o boot faz
`upsert` por `name`, que já é `@unique`. Um `upsert` não sobrescreve edições
que o usuário tenha feito no corpo, porque só cria o que falta.

Os cinco: "Direto e agressivo" (primeiro da lista), "Curto (volume)",
"Vendedor e humanizado", "Urgência e escassez" e "Sensação de achado". Os
corpos usam os marcadores já suportados pelo renderizador atual:
`{TITULO}`, `{PRECO}`, `{PRECO_ANTIGO}` e `{LINK}`.

Antes de semear, o plano precisa confirmar contra `services/template.ts`
que esses quatro marcadores são exatamente os nomes que o renderizador
reconhece. Se divergirem, os corpos são ajustados para os nomes reais — não
o contrário.

### Troca de senha

Hoje `plugins/auth.ts` compara a senha recebida com `env.dashboardPassword`,
que vem do `.env` em texto plano. Para permitir a troca sem migração de
schema, a senha passa a poder viver em `AppSetting`, que já existe:

- Chave `dashboard_password_hash`, valor no formato `salt:hash`, derivado com
  `crypto.scrypt` — biblioteca padrão do Node, sem dependência nova.
- No login: se a chave existir, valida contra o hash. Se não existir, valida
  contra `env.dashboardPassword` como hoje. Instalações existentes continuam
  entrando com a senha do `.env` até trocarem.
- `POST /api/senha` recebe `{ atual, nova }`, valida a atual pelo mesmo
  caminho do login, grava o hash da nova e limpa o cookie de sessão, forçando
  um login novo.
- A comparação de hash usa `crypto.timingSafeEqual`, como o código atual já
  faz. A nova senha exige no mínimo oito caracteres, validado com Zod na
  rota.

`env.dashboardPassword` continua obrigatório: é o que permite o primeiro
acesso de uma instalação limpa.

## O que não muda

- As rotas `/api/nichos` permanecem. As automações consomem essas regras, e a
  fase 2 vai reaproveitá-las em Garimpar.
- As rotas `/api/watch` permanecem.
- Nenhuma alteração no schema Prisma. `AppSetting` e `MessageTemplate` já
  cobrem o que a fase precisa.
- Nenhum trabalho de Baileys, envio ou conector.

## Erros e casos de borda

- Senha atual errada em `POST /api/senha`: responde 401 com a mesma pausa de
  600 ms que o login usa contra força bruta.
- Nova senha com menos de oito caracteres: 400, mensagem em português.
- Seed de templates falhando no boot (banco indisponível): registra em log e
  segue. O servidor não deve deixar de subir por causa de conteúdo de
  exemplo.
- Aba desconhecida na URL de Configurações: cai na primeira aba (Canais).

## Testes

O projeto ainda não tem runner de testes configurado; `lib/mutex.test.ts` é o
único arquivo de teste e não roda em CI. Esta fase não introduz um runner.

Verificação por etapa:

- `npm run build` conclui sem erro de tipo nos dois workspaces.
- Navegar as cinco seções e todas as abas sem tela branca nem 404.
- `/agenda`, `/nichos` e `/produtos` redirecionam para `/`.
- Trocar a senha, ser deslogado, e entrar com a nova.
- Após a troca, a senha antiga do `.env` deixa de funcionar.
- Os cinco presets aparecem em Mensagens e carregam no editor ao clique.
- Na aba Vigiar, cadastrar um item vigiado e conferir que o `WatchItem` foi
  criado; cadastrar uma regra de garimpo e conferir o `DiscoveryRule`.
- Na aba Canais, o WhatsApp conecta e desconecta como fazia em Conexões.

A lógica de derivação e comparação de senha ganha uma verificação executável
em `apps/api/src/plugins/auth.check.ts`, no mesmo estilo de
`apps/web/src/protocol-sound.check.ts`: derivar, comparar certo e errado,
falhar com `assert` se quebrar.
