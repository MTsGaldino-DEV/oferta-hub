# Fase 4 — Proteção de grupos: Escudo, Filtro de DDI e Guilhotina

Data: 2026-08-24
Status: aprovado para planejamento

## Contexto

As fases anteriores mexeram em telas e em dados. Esta é diferente: ela **age no
WhatsApp em produção**, removendo pessoas de grupos. Remoção é irreversível,
visível para todos os membros ("Fulano foi removido"), e remoção automatizada em
massa é um padrão que o WhatsApp detecta e pode punir com banimento do número —
que é o ganha-pão do usuário.

Por isso o desenho inteiro é conservador: nada sai sem o usuário ver, tudo fica
registrado, e o ritmo é espaçado com teto diário.

O usuário enviou uma referência visual (de outro produto) com três funções:
Escudo, Filtro de DDI e Guilhotina. Elas entram como uma sub-aba "Proteção"
dentro de Meus Grupos.

## Decisões do usuário

- **Guilhotina lista, não executa sozinha.** Escanear mostra quem se encaixa,
  com o grupo de cada um; o usuário marca quem sai e confirma.
- **Escudo e Filtro de DDI removem na entrada, e registram.** Sempre fica um
  registro do que foi removido e por quê, para auditar se algo sair errado.
- **Ritmo espaçado com teto diário**, no mesmo espírito que os envios já têm.

## A limitação que define o Filtro de DDI

O WhatsApp moderno identifica participantes de duas formas:

- `<numero>@s.whatsapp.net` — o número real é visível.
- `<id>@lid` — identificador opaco; **o número não está ali**.

O Filtro de DDI depende de ler o código do país. Quando o participante chega
como LID, **não há número para avaliar** — e nenhuma quantidade de código
resolve isso, porque a informação não foi enviada. A própria referência do
usuário admite: "fora do +55, **onde o WhatsApp mostra o número**".

Consequência para o desenho: o filtro de DDI **avalia apenas participantes com
número visível**. Quem chega como LID é registrado como "não avaliável" e
**fica** — nunca removido por suposição. E a tela diz isso na cara, com a
contagem de quantos não puderam ser avaliados. Um filtro que silenciosamente
ignora metade dos casos é pior que um filtro que declara o que não consegue ver.

**Pendência de levantamento:** o Docker do usuário estava desligado na hora de
escrever esta spec, então não foi possível medir a proporção real de LID contra
número visível no banco dele. A primeira tarefa da implementação faz essa
medição e reporta — se a maioria for LID, o Filtro de DDI entrega pouco na
prática, e vale o usuário saber antes de contar com ele.

## Arquitetura

### Schema Prisma

Esta é a primeira fase que altera o schema. Três mudanças:

```prisma
/// Numeros barrados em todos os grupos. `phone` guarda so digitos, com DDI,
/// normalizado -- e a chave de comparacao contra quem entra.
model BlockedNumber {
  id        String   @id @default(cuid())
  phone     String   @unique
  note      String?
  createdAt DateTime @default(now())
}

/// Registro de toda acao de moderacao, inclusive as que falharam ou foram
/// puladas. Remocao e irreversivel: sem log nao ha como auditar depois.
model ModerationLog {
  id          String           @id @default(cuid())
  groupJid    String
  participant String
  action      ModerationAction
  reason      ModerationReason
  detail      String?
  occurredAt  DateTime         @default(now())

  @@index([groupJid, occurredAt])
  @@index([occurredAt])
}

enum ModerationAction {
  REMOVED
  FAILED
  SKIPPED
}

enum ModerationReason {
  BLOCKLIST
  FOREIGN_DDI
  MANUAL
}
```

E `WhatsappGroup` ganha um campo:

```prisma
  /// Se o numero conectado e admin do grupo. Sem admin nao ha como remover
  /// ninguem, e a tela precisa dizer isso em vez de deixar o usuario ligar uma
  /// protecao que nunca vai agir. Preenchido no syncGroups().
  botIsAdmin Boolean @default(false)
```

Os liga-desliga (Escudo ativo, Filtro de DDI ativo) vão para `AppSetting`, que
já existe como chave/valor — não precisam de tabela.

### Normalização de número

Comparar números de WhatsApp é onde erros silenciosos nascem. A regra, num
módulo próprio com self-check:

- Tira tudo que não é dígito.
- Um número brasileiro pode chegar com ou sem o nono dígito. `5511987654321`
  e `551187654321` são a mesma pessoa. A normalização produz uma forma canônica
  para os dois.
- Se não sobrar quantidade plausível de dígitos, o número é rejeitado na entrada
  do formulário, com mensagem em português — não guardado torto para falhar
  depois em silêncio.

O JID de comparação vem de `<numero>@s.whatsapp.net`. Para `@lid`, não há
número: a função devolve nulo, e quem chama trata como "não avaliável".

### Ritmo e teto

Um módulo de moderação com as mesmas garantias que o envio já tem:

- Intervalo mínimo entre remoções.
- Teto diário de remoções, contado em `AppSetting` por dia.
- Ao atingir o teto, as remoções pendentes ficam para o dia seguinte e o fato é
  registrado — não some em silêncio.

Os valores vêm de variáveis de ambiente com padrão conservador, no mesmo modelo
de `WA_MIN_INTERVAL_SECONDS` e `WA_DAILY_CAP`.

### Ação na entrada

O listener de `group-participants.update` já existe em `whatsapp/baileys.ts` e
já grava `GroupMemberEvent`. Ele ganha, **depois** de gravar o evento, a
avaliação de quem entrou:

1. Se nem Escudo nem Filtro de DDI estiverem ligados, não faz nada.
2. Se o bot não for admin do grupo, registra `SKIPPED` com o motivo e para.
3. Se o participante está na blocklist, marca para remoção por `BLOCKLIST`.
4. Senão, se o Filtro de DDI está ligado e o número é visível e o DDI não é 55,
   marca para remoção por `FOREIGN_DDI`.
5. Se o número não é visível (LID), registra `SKIPPED` e **mantém a pessoa**.

Tudo dentro do `try/catch` que já protege o handler — o comentário existente é
explícito sobre isso: exceção ali pode derrubar a conexão usada para enviar
oferta. A moderação nunca pode custar o envio.

### Guilhotina

Duas rotas, deliberadamente separadas:

- **Escanear** — lê os participantes dos grupos e devolve quem se encaixa nos
  critérios marcados, com grupo, motivo e se o número é avaliável. **Não remove
  nada.** É leitura pura.
- **Remover** — recebe a lista explícita que o usuário marcou e remove só ela,
  respeitando ritmo e teto, registrando cada resultado.

A remoção nunca recebe "remova tudo que se encaixa": ela recebe identificadores
escolhidos. Assim, o que o usuário viu na tela é exatamente o que sai — sem
janela entre escanear e remover onde alguém novo entraria na conta.

### Tela

`Meus Grupos` ganha sub-abas: **Monitor** (o que a fase 3 construiu) e
**Proteção**. Campanhas não entra — não existe como conceito no produto.

Na aba Proteção, seguindo a referência:

- **Escudo** — cartão com liga-desliga, campo para adicionar número com DDI,
  botão de adicionar, e a lista do que está barrado com ação de remover. Um
  aviso de que precisa ser admin do grupo.
- **Filtro de DDI** — cartão com liga-desliga e a explicação de que remove quem
  entra com número fora do +55, **incluindo a ressalva de que só age quando o
  WhatsApp mostra o número**.
- **Guilhotina** — cartão com os dois critérios em caixas de seleção ("Na
  blocklist", "DDI estrangeiro") e o botão "Escanear grupos". O resultado
  aparece como lista com caixa de seleção por pessoa, e o botão de remover diz
  quantos serão removidos. Confirmação antes de executar.

Grupos onde o bot não é admin aparecem marcados, e seus membros não entram na
lista de remoção — mostrar alguém que não dá para remover é prometer o que não
se cumpre.

## O que não muda

- A lógica de envio, fila, disparo e garimpo não é tocada.
- O amarelo da marca continua. A Guilhotina, sendo destrutiva, usa o vermelho de
  perda (`--drop`) para a ação de remover.
- Nenhuma remoção acontece sem o usuário ter ligado a proteção ou ter marcado
  explicitamente na Guilhotina.

## Erros e casos de borda

- Bot não é admin: nada é removido; registra `SKIPPED`, e a tela mostra o grupo
  como desprotegido.
- Participante chega como LID: nunca removido pelo DDI; registra `SKIPPED`.
- Número já na blocklist: adicionar de novo não duplica nem dá erro feio.
- Número inválido no formulário: rejeitado na hora, com mensagem em português.
- Teto diário atingido: para, registra, e a tela informa quantas ficaram para
  depois.
- Remoção falha na API do WhatsApp: registra `FAILED` com o motivo; não repete
  em laço.
- WhatsApp desconectado: escanear e remover respondem com erro claro apontando
  para Configurações › Canais.
- Escanear com nenhum critério marcado: erro pedindo para marcar pelo menos um.
- O próprio número conectado, ou um admin do grupo, nunca entra na lista de
  remoção — remover a si mesmo ou outro admin é sempre engano.

## Testes

- `npm run build` limpo nos dois workspaces.
- Um `.check.ts` para a normalização de número e para a decisão de remoção —
  são a lógica com risco real, e ambas são puras, rodando sem banco e sem rede.
  Cobrindo: número com e sem nono dígito batendo como o mesmo; DDI estrangeiro
  detectado; LID devolvendo "não avaliável"; blocklist tendo precedência sobre
  DDI; e número da própria conta nunca marcado para remoção.
- Medição no banco real da proporção LID contra número visível, reportada ao
  usuário.
- Escanear em ambiente real devolve lista coerente com o que o WhatsApp mostra.
- **A remoção não é testada em grupo real do usuário sem autorização explícita
  dele para um alvo específico.** É irreversível e visível. A verificação de
  ponta a ponta da remoção fica para o usuário decidir quando e com quem.
