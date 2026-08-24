# Final review fixes — relatorio

Onda unica corrigindo os 3 Important + 5 Minor do review final do branch.

1. **[Important] stats API sem DISPATCHING** — `apps/api/src/routes/stats.ts`: adicionado `prisma.offer.count({ where: { status: OfferStatus.DISPATCHING } })` em paralelo com `pending`/`queued`, retornado como `dispatching` no payload de `/api/stats/overview`. Feito.

2. **[Important] painel Disparos desatualizado em VisaoGeral.tsx** — interface `Overview` ganhou `dispatching: number`; painel "Disparos" trocado: mostra `N oferta(s) em disparo agora` + link "Ver disparos em andamento →" quando `dispatching > 0`, senao "Nenhum disparo em andamento" + link "Começar um disparo →". Ambos linkam pra `/disparos` usando o `Link` ja importado. Feito.

3. **[Important] DELETE /api/templates/:id sem guarda de FK** — `apps/api/src/routes/templates.ts`: adicionado `prisma.disparo.count({ where: { templateId } })` antes do delete; retorna 409 com mensagem clara se o modelo estiver em uso por algum Disparo. Logica de promocao do `isDefault` mantida intacta. Feito.

4. **[Minor] contraste do item selecionado em Garimpar no dark mode** — trocado `style` inline por `data-picked={categoriaId === f.id}`; CSS novo `.catbox__item[data-picked='true']` usa `var(--brand)` (amarelo, estavel nos dois temas); `[data-theme='dark'] .catbox__item[data-picked='true']` adicionado ao grupo existente de selectors que fixam `color: #16171a` sobre fundo amarelo (mesmo grupo de `.rail__count`, `.btn--tag`, etc). Feito.

5. **[Minor] doc-comment desatualizado de MessageTemplate** — `apps/api/prisma/schema.prisma`: removida a frase "Ainda nao e usado por nada: existe pra alimentar a futura tela de Disparos", substituida por referencia ao uso real via `Disparo.templateId`. Feito.

6. **[Minor] RESUME-AMANHA.md fora de lugar** — movido pra `.superpowers/RESUME-AMANHA.md` via `git mv`, conteudo inalterado. Nenhuma referencia de codigo ao caminho antigo (confirmado por grep). Feito.

7. **[Minor] sem rota catch-all** — `apps/web/src/App.tsx`: import de `Navigate` adicionado; rota `<Route path="*" element={<Navigate to="/" replace />} />` adicionada como ultima rota do `<Routes>`. Feito.

8. **[Minor] MeusGrupos.tsx cita "Conexões" que nao existe mais** — texto do empty-state trocado de "em Conexões" pra "em Configurações". Feito.

## Nao mexido (fora de escopo, conforme instrucao)
- Duplicacao cosmetica de `overview.pending` em dois lugares de VisaoGeral.tsx.
- Drift de `memberCount` em evento `group-participants.update` pra grupo nao sincronizado (auto-cura no proximo boot).

## Verificacao
- `npm run build --workspace=apps/api` — exit 0.
- `npm run build --workspace=apps/web` — exit 0 (vite build ok, 53 modulos).
- Grep por `RESUME-AMANHA` fora de `.superpowers/reviews/*.diff` (artefatos historicos) — nenhuma referencia de codigo.
