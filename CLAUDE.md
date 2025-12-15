# CLAUDE.md - Claude Code Development Guidelines

**IMPORTANT**: This is a forked custom version. Always verify you're working with `origin` (salja03-t21/inbox-zero), NEVER `upstream` (elie222/inbox-zero).

## Initialization Checklist

When starting a new conversation or resuming work:

1. **Use Serena MCP** for code navigation:
   - Call `mcp__serena__get_current_config` to check active project
   - Call `mcp__serena__check_onboarding_performed` to see if onboarding is needed
   - If needed, call `mcp__serena__onboarding` to create project understanding
   - Use Serena's symbolic tools (`find_symbol`, `get_symbols_overview`, `find_referencing_symbols`) for code exploration
   - Use `mcp__serena__search_for_pattern` for flexible text searches across the codebase

2. **Load context as needed**:
   - Read `Warp.md` for comprehensive project overview (only when architecture/deployment questions arise)
   - Access `.cursor/rules/*.mdc` files only when needed for specific feature work
   - Use Serena's memory system to recall past decisions and patterns

3. **Verify environment**:
   - Check git branch: `git branch --show-current` (should be on a `feature/*` or `production` branch)
   - Verify remote: `git remote -v` (confirm you're on your fork, not upstream)

## Quick Project Overview

**What**: AI-powered email assistant (Gmail/Outlook) with rule-based automation, bulk unsubscriber, cold email blocker, and reply tracker.

**Stack**: Next.js 15 (App Router), Prisma + PostgreSQL, Redis (local + Upstash), Better Auth, AI SDK with multiple LLM providers, shadcn/ui.

**Monorepo**: Turborepo with pnpm workspaces. Main app: `apps/web/`. Shared packages: `packages/`.

## Common Commands

```bash
# Development
pnpm dev                              # Start dev server
pnpm build                            # Build
pnpm test                             # Run tests (no AI)
pnpm test-ai                          # Run AI tests
pnpm tsc --noEmit                     # Type check (CRITICAL before deploy)

# Database
pnpm --filter=web prisma migrate dev  # Run migrations
pnpm --filter=web prisma studio       # Open Prisma Studio
pnpm --filter=web prisma generate     # Generate Prisma client

# Deployment
./deploy-production.sh                # Deploy to production
```

## Development Patterns (Load Detail as Needed)

### When working on features:
- **API Routes**: Read `.cursor/rules/get-api-route.mdc` for GET route patterns
- **Server Actions**: Read `.cursor/rules/server-actions.mdc` for mutation patterns
- **Forms**: Read `.cursor/rules/form-handling.mdc` for React Hook Form + Zod
- **Data Fetching**: Read `.cursor/rules/data-fetching.mdc` for SWR patterns
- **Email APIs**: Read `.cursor/rules/gmail-api.mdc` for Gmail integration patterns

### When adding environment variables:
Read `.cursor/rules/environment-variables.mdc` for the 4-step process (`.env.example`, `env.ts`, `turbo.json`, naming conventions).

### When writing tests:
Read `.cursor/rules/testing.mdc` for Vitest patterns and `.cursor/rules/llm-test.mdc` for AI tests.

### When working with UI:
Read `.cursor/rules/ui-components.mdc` for shadcn/ui component usage and `LoadingContent` patterns.

### When working with database:
Read `.cursor/rules/prisma.mdc` for schema patterns and migration workflows.

## Feature-Specific Context (Load Only When Needed)

- **Reply Tracker**: `.cursor/rules/features/reply-tracker.mdc`
- **Cleaner (Bulk Unsubscribe)**: `.cursor/rules/features/cleaner.mdc`
- **Delayed Actions**: `.cursor/rules/features/delayed-actions.mdc`
- **Digest**: `.cursor/rules/features/digest.mdc`
- **Knowledge Base**: `.cursor/rules/features/knowledge.mdc`
- **Scheduler**: `.cursor/rules/features/schedule.mdc`

## Critical Safety Rules

### Git Repository Safety
- **NEVER** commit or push to `upstream` (elie222/inbox-zero)
- **ALWAYS** commit to `origin` (salja03-t21/inbox-zero)
- **Verify** before EVERY commit: `git remote -v`

### Data Safety
- **NEVER** destroy volume data without explicit user permission
- **NO** `docker volume rm`, `docker compose down -v`, or `prisma migrate reset` without asking
- This applies to BOTH local and production databases

### Deployment Safety
- **ALWAYS** run `pnpm tsc --noEmit` before deploying (local dev doesn't use Docker, so this is the only TypeScript validation)
- **ONLY** deploy from `production` branch
- **NEVER** skip pre-commit hooks unless linting fails (use `--no-verify` sparingly)

## Branching Model

- **`main`**: Mirrors upstream - kept clean, never deploy from here
- **`feature/*`**: Custom features (outlook-deep-clean, meeting-scheduler, etc.)
- **`production`**: Integration branch = main + all features - DEPLOY FROM HERE
- Use `./deploy-production.sh` to deploy

## Production Instance

- **Domain**: https://iz.salsven.com
- **Server**: 192.168.3.2
- **Docker Path**: `~/docker/inbox-zero`
- **Volumes**: `/mnt/nfs/inbox-zero`
- **Proxy**: Traefik with SSL

## Using Serena MCP Efficiently

### At Start of Conversation
```
1. mcp__serena__get_current_config - Check active project
2. mcp__serena__check_onboarding_performed - See if onboarding exists
3. mcp__serena__list_memories - Check for relevant project memories
```

### During Development
- **Find code**: `mcp__serena__find_symbol` with name_path (e.g., "ChatProvider/useEffect")
- **Explore file**: `mcp__serena__get_symbols_overview` to see top-level symbols
- **Find usage**: `mcp__serena__find_referencing_symbols` to see where code is called
- **Search text**: `mcp__serena__search_for_pattern` for flexible regex searches
- **Edit code**: Use `mcp__serena__replace_symbol_body`, `mcp__serena__insert_after_symbol`, or `mcp__serena__replace_regex`

### At Exit
```
1. mcp__serena__write_memory - Save important decisions, patterns, or context
2. mcp__serena__think_about_whether_you_are_done - Validate task completion
```

## When to Load Full Documentation

- **Warp.md**: When you need architecture overview, deployment details, or sync-with-upstream workflows
- **.cursor/rules/**: Only when actively working on specific features (don't preload)
- **Serena Memories**: Check at start, write at end

## Code Style & Quality

- TypeScript strict mode
- Use `@/` path alias for imports
- Functional components with hooks
- Client components need `'use client'`
- Server actions need `'use server'`
- Use `LoadingContent` for async data
- Follow shadcn/ui patterns
- Run `pnpm format-and-lint:fix` before committing

## Known Issues to Be Aware Of

1. **Ultracite linting** often fails in pre-commit hook - use `--no-verify` if needed
2. **Microsoft OAuth re-consent** required on each login (known issue)
3. **Two-way sync** between database rules and prompt files (historical complexity)
4. **Auth provider buttons** remain visible even when disabled (static generation issue)

## Additional Resources

- **Comprehensive docs**: `Warp.md` (load when needed)
- **Feature-specific**: `.cursor/rules/features/*.mdc`
- **Development patterns**: `.cursor/rules/*.mdc`
- **Architecture overview**: Search for "Architecture Deep Dive" in Warp.md

---

**Remember**: Use Serena MCP as your primary code navigation tool. Only load documentation files when you need specific context for the task at hand. This keeps conversations focused and efficient.
