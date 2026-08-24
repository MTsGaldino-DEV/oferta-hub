# Instalação global — Vibe Coding Toolkit

> Isso roda **uma vez por máquina**, nunca por projeto. Se você já rodou
> isso aqui, não precisa repetir em cada repositório — os plugins ficam
> ativos em toda sessão do Claude Code, em qualquer pasta.
>
> Pra reinstalar numa máquina nova (ou depois de reinstalar o Claude Code),
> cole este arquivo inteiro pro Claude Code e peça: *"Execute os passos
> deste arquivo."* Todo comando aqui é idempotente — rodar de novo em cima
> do que já está instalado não quebra nada.

## Status desta máquina

| Item | Status | Versão | Instalado em |
|---|---|---|---|
| Claude Code | ✅ instalado | 2.1.123 | já estava presente |
| `superpowers@claude-plugins-official` | ✅ instalado (scope: user) | 6.3.0 | 2026-08-21 |
| `ponytail@ponytail` | ✅ instalado (scope: user) | 4.9.0 | 2026-08-21 |
| `caveman@caveman` | ✅ instalado (scope: user) | (commit `2f49f0e1a352`) | 2026-08-21 |

## Passo a passo (para uma máquina nova)

### 1. Instalar o Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

### 2. Instalar os 3 plugins-base

Todos via CLI (`claude plugin ...`), sem precisar abrir uma sessão
interativa e digitar `/plugin`:

```bash
# Superpowers — disciplina de processo (brainstorm → plano → implementação → revisão)
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install superpowers@claude-plugins-official

# Ponytail — persona "engenheiro sênior preguiçoso", evita over-engineering
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail

# Caveman — corta enrolação da comunicação do agente
claude plugin marketplace add JuliusBrussee/caveman
claude plugin install caveman@caveman
```

### 3. Verificar

```bash
claude plugin list
```

Esperado: os três plugins acima com `Status: ✔ enabled` e `Scope: user`.

### 4. (Opcional) CLIs standalone

Só se o projeto que você for tocar precisar — não são obrigatórios pro
fluxo básico:

```bash
# Graphify — grafo de conhecimento de código, útil em projetos grandes
uv tool install graphifyy
graphify claude install

# agent-browser — automação de navegador nativa pra agentes
npm i -g agent-browser
agent-browser install
```

## Troubleshooting

**`claude plugin marketplace add` falha ou não encontra o repo.**
Confira a versão do CLI (`claude --version`) — plugins exigem uma versão
recente. Depois confira se o marketplace foi mesmo adicionado:
`claude plugin marketplace list`. Erro mais comum: typo no `usuário/repo`.

**Quero confirmar que Superpowers está realmente influenciando as respostas.**
Numa sessão nova, peça algo propositalmente ambíguo (ex: "adiciona um jeito
de exportar relatórios"). Se o agente for direto pro código sem levantar
perguntas de escopo, o plugin não pegou — repita o passo 2 acima.

## Depois disso

A instalação global está feita — ela não precisa de nenhum arquivo dentro
dos seus projetos. O que entra em cada repositório individual (CLAUDE.md,
`.claude/settings.json`, etc.) está em
[`SETUP-POR-PROJETO.md`](SETUP-POR-PROJETO.md) — um arquivo separado,
autocontido, pra colar em cada projeto novo.
