# Contribuindo com o Aurial

> Projeto proprietário — contribuições apenas por convite. Este guia vale para todo o time (humanos e agentes).
> Leia antes: [`ARCHITECTURE.md`](ARCHITECTURE.md) (regras de código, é a fonte da verdade) e [`DESIGN.md`](DESIGN.md) (UI).

## Setup

Siga o **Começando** do [`README.md`](../README.md) (node 22 + pnpm 10 + docker). Os hooks do Husky são instalados automaticamente pelo `pnpm install` (script `prepare`).

## Fluxo de branches

- `main` é protegida: só recebe merge via **Pull Request** com CI verde. Nunca commite direto.
- Crie branches curtas a partir de `main`:

```
feat/player-crossfade
fix/api-playlist-reorder
chore/ci-cache
docs/deploy-tls
```

- Rebase sobre `main` antes de abrir o PR (`git fetch && git rebase origin/main`). PRs pequenos e focados — um assunto por PR.

## Commits (Conventional Commits)

Validados pelo hook `commit-msg` (commitlint). Formato:

```
<tipo>(<escopo>): <descrição no imperativo, minúscula, sem ponto final>
```

- **Tipos**: os do [config-conventional](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional) — `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`.
- **Escopos permitidos** (`commitlint.config.js`): `web` · `api` · `shared` · `infra` · `ci` · `docs` · `deps` · `release` · `player` · `auth` · `db`.

Exemplos:

```
feat(player): crossfade configurável entre faixas
fix(api): corrige reorder de faixas em playlists colaborativas
chore(deps): atualiza prisma para 6.x
ci(infra): adiciona cache de pnpm no workflow de CI
```

Breaking change: `feat(api)!: ...` + rodapé `BREAKING CHANGE: ...`.

## Qualidade antes do push

Os hooks já cobrem o mínimo (`pre-commit` roda `lint-staged`: ESLint + Prettier nos arquivos staged). Antes de abrir PR, rode o que o CI vai rodar:

```bash
pnpm lint
pnpm -r typecheck
pnpm -r test        # Vitest (api services, componentes web, schemas shared)
pnpm -r build
pnpm e2e            # Playwright — para mudanças na web
```

Testes acompanham a mudança: service novo → teste com repositório mockado; componente novo → Testing Library; schema novo em `@aurial/shared` → teste de parse.

## Padrões de código (resumo — detalhes no ARCHITECTURE.md)

- **API**: controller → service → repository, sem atalhos. Controllers não tocam Prisma; services não tocam `req`/`res`; repositories não têm regra de negócio. Toda entrada validada com Zod de `@aurial/shared`; toda resposta no envelope `{ data, meta? }` / `{ error: { code, message } }`; erros via hierarquia `AppError`.
- **Web**: estado de servidor só em TanStack Query, estado de cliente só em Zustand — nunca duplicar. Formulários com react-hook-form + zodResolver. O player é global e nunca desmonta.
- **UI**: só tokens do design system (nunca hex cru), radius/espaçamentos do `DESIGN.md`, toda tela verificada em **dark e light**, `prefers-reduced-motion` respeitado.
- **Shared primeiro**: DTOs/schemas usados por web **e** api nascem em `packages/shared` — nunca duplique contratos.
- TypeScript **strict**; sem `any` sem justificativa em comentário.

## Pull Requests

1. Preencha o template (`.github/PULL_REQUEST_TEMPLATE.md`) — inclua screenshots (dark **e** light) para mudanças visuais.
2. CI (`ci.yml`) precisa passar: lint → typecheck → test → build.
3. Pelo menos **1 aprovação** de review; resolva todos os comentários antes do merge.
4. Merge por **squash** — o título do PR vira a mensagem do commit, então ele também segue Conventional Commits.

## Infra e deploy

Mudanças em `infra/**` ou nos workflows: descreva no PR o impacto em produção e como testou (ex.: `docker compose -f infra/docker/docker-compose.prod.yml config` valida a sintaxe). Scripts `*.sh` mantêm `set -euo pipefail`, finais de linha **LF** (garantido por `infra/.gitattributes`) e estilo shellcheck-clean. Deploy: [`DEPLOY.md`](DEPLOY.md).
