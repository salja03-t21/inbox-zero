# Bouncer Project Configuration — inbox-zero (salja03-t21 fork)

Bouncer v3.2 config. Derived from the repo's own norms (CLAUDE.md, apps/web/CLAUDE.md,
.cursor/rules/) on 2026-07-03. Update when commands or conventions change.

## Project shape

- Turborepo + pnpm workspaces. Main app: `apps/web` (Next.js 15 App Router, TypeScript strict,
  Prisma + PostgreSQL, Better Auth, Inngest, shadcn/ui). Secondary app: `apps/unsubscriber`
  (Fastify). Shared packages under `packages/`.
- Fork-specific surfaces: TIGER 21 deployment (docker-compose.tiger21.yml, deploy-tiger21.sh,
  TIGER21_*.md, scripts/tiger21-*.sh) and personal deployment (docker-compose.prod.yml,
  deploy-production.sh). Upstream is elie222/inbox-zero — mirrored code, not ours to audit
  unless a diff touches it.

## Commands (Gates 5, 6, 7)

- lint_command: `pnpm format-and-lint` (Biome/Ultracite). Known-flaky in pre-commit hooks;
  a pre-existing failure in files untouched by the diff is non-blocking — note it, don't fail.
- typecheck_command: `pnpm tsc --noEmit` — CRITICAL before any deploy; local dev doesn't use
  Docker, so this is the only TypeScript validation in the workflow.
- test_command: `pnpm test` (Vitest, non-AI). Single file: `pnpm test __tests__/<file>.test.ts`
  from `apps/web`. AI tests (`pnpm test-ai`) only when AI prompt/LLM code changes.
- coverage_command: none — no repo-wide coverage baseline exists. Gate 6 SKIPs with a note.
  For meaningful new backend/shared code, use feature-scoped coverage judgment (~75% target)
  and file a follow-up rather than blocking.
- shell_check: `bash -n <script>` for every changed `*.sh`.
- compose_check: `docker compose -f <file> config -q` where a daemon is available; otherwise
  YAML-parse + env-interpolation review by inspection.

## Commit convention

- Conventional commits: `type(scope): subject` — e.g. `fix(outlook): ...`, `feat(digest): ...`,
  `test(bulk-process): ...`.
- Commit ONLY to `origin` = salja03-t21/inbox-zero. NEVER `upstream` = elie222/inbox-zero.
  Verify `git remote -v` before EVERY commit — hard precondition, no exceptions.
- The Bouncer commits on approval; dev agents and the orchestrator never commit mid-phase.
- Deploys happen only via deploy scripts (deploy-tiger21.sh / deploy-production.sh), never
  as a side effect of a gate.

## Diff classification hints (Gate skip matrix)

- `docs`: `*.md` (README, TIGER21_*, guides) → skip Gates 2 (code parts), 4, 5, 6, 7, 9, 10.
- `infra`: `docker-compose*.yml`, `docker/*`, `.env*.example`, `turbo.json` → run 1, 2, 3, 8;
  skip 4, 5, 6, 9 (unless new public HTTP path), 10.
- `code`: `*.ts`, `*.tsx`, `*.sh`, `package.json`, lockfiles → full gate set per v3.2 defaults.
- Mixed diffs → safest superset. Unknown extensions default to `code`.

## Extra security rules (Gate 3)

- No secrets in git — secrets live in Doppler / 1Password / server-side `.env.tiger21`.
  Mask any secret values in reports; login patterns only, never tokens.
- `INNGEST_DEV` must NEVER be set on web app services in production compose files — it
  disables Inngest signature verification on the public `/api/inngest` endpoint. (Shipped
  fix 2026-07-03; regression here is CRITICAL.) It is permitted on the dedicated inngest
  SERVER service only, where it is inert.
- Compose env interpolation for credentials must be fail-fast (`${VAR:?...}`), never a weak
  literal default. New `${VAR:-something}` on a credential is a HIGH finding.
- API routes must use `withAuth`/`withEmailAccount` middleware; mutations via server actions
  (`next-safe-action` + Zod), not bare POST routes.
- Zod validation at every trust boundary (API input, Inngest event payloads, form input).

## Craftsmanship (Gate 2)

- max_file_lines: TypeScript/TSX 500; shell 400; YAML/compose exempt (declarative);
  Markdown exempt.
- Grandfathered oversized files may be touched but must not grow; list any growth as MEDIUM.
- Comments explain WHY in plain language (restart_policy rationale, prisma-pin rationale are
  house style). No narration of WHAT the next line does.
- Shell: scripts run under `set -e`; `if [ $? -ne 0 ]` after multiple commands is dead code —
  use explicit `|| { echo ...; exit 1; }` handlers where a failure needs a distinct message.
- TypeScript: strict mode, `@/` path alias, functional components + hooks, `'use client'` /
  `'use server'` directives where required, `LoadingContent` for async UI data.
- Match existing style; no drive-by refactors of untouched code (surgical-changes rule).

## Excluded paths

- `node_modules/**`, `.next/**`, `.turbo/**`, `.worktrees/**`, `.serena/memories/**`,
  `apps/web/prisma/migrations/**` (generated), `*.lock`/`pnpm-lock.yaml` content review
  (Gate 4 reviews the dependency delta, not the lockfile text).
- Upstream-mirrored `apps/web/**` code is in scope only where the diff touches it.

## Gate 9 — Deploy smoke test (conditional)

- Trigger: diff adds new public HTTP paths (new `app/api/**/route.ts` or route segments).
- TIGER 21: probe `https://iz.tiger21.com/api/health/simple` (expect 200) plus the new
  path(s) through the edge; unsigned-POST checks for `/api/inngest`-class endpoints must be
  verified from origin (Cloudflare WAF 403 masks origin behavior).
- Personal instance (iz.salsven.com / 192.168.3.2) is reachable only from the home
  192.168.3.x network — SKIP with a note when off-network.

## Gate 10 — Visual / UI verification (conditional)

- Trigger: diff touches visual components (`apps/web/app/**/*.tsx`,
  `apps/web/components/**`, Tailwind/global CSS).
- Method: run `pnpm dev` locally, capture screenshots of affected pages/states, READ them,
  verify rendering + layout + that the change is visibly present; attach to the report.
- Standards: shadcn/ui patterns, responsive mobile-first, `LoadingContent` for loading/error
  states, no raw unstyled fallbacks.

## Known pre-existing conditions (don't re-block on these)

- Ultracite/Biome pre-commit hook flakiness (documented in CLAUDE.md).
- 4 lint warnings in `apps/web/__tests__/ai-process-user-request.test.ts` and
  `apps/web/store/archive-queue.ts` (pre-existing, untracked to any current phase).
- `deploy-tiger21.sh:99,203` retain two dead `if [ $? -ne 0 ]` blocks (pre-existing;
  optional follow-up sweep).
- Personal instance `production` branch is ~24 commits behind `main` (branching-model drift).
