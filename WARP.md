# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Inbox Zero is an open-source AI-powered email assistant that helps users manage their inbox efficiently. It's built as a monorepo using Turborepo with the main application being a Next.js 15 web app.

**Key Features:**
- AI Personal Assistant with rule-based email automation
- Reply Zero: Email reply tracking
- Cold Email Blocker: AI-based cold email detection
- Bulk Unsubscriber: Automated email unsubscription
- Smart Categories: Automatic sender categorization
- Email Analytics: Activity tracking via Tinybird

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: PostgreSQL with Prisma ORM
- **Caching**: Local Redis for caching, Upstash Redis for queue management
- **Monorepo**: Turborepo with pnpm workspaces
- **UI**: React 19, Tailwind CSS, shadcn/ui components
- **Testing**: Vitest
- **Auth**: Better Auth with Google/Microsoft OAuth
- **AI**: Multiple LLM providers (OpenAI, Anthropic, Google, Groq, Ollama, etc.)
- **Email API**: Gmail API, Microsoft Graph API

## Repository Structure

```
inbox-zero/
├── apps/
│   ├── web/                    # Main Next.js application (production)
│   │   ├── app/
│   │   │   ├── (app)/          # Main app pages (assistant, reply-zero, settings, etc.)
│   │   │   ├── (landing)/      # Marketing/landing pages
│   │   │   ├── api/            # API routes
│   │   │   └── blog/           # Blog pages
│   │   ├── utils/              # Utilities and core logic
│   │   │   ├── actions/        # Next.js Server Actions
│   │   │   ├── ai/             # AI logic (rule choosing, prompts)
│   │   │   ├── gmail/          # Gmail API integration
│   │   │   ├── llms/           # LLM provider integrations
│   │   │   └── redis/          # Redis utilities
│   │   ├── components/         # React components
│   │   ├── prisma/             # Database schema
│   │   └── __tests__/          # AI tests
│   └── unsubscriber/           # Browser automation service (not in production)
├── packages/                   # Shared packages
│   ├── tinybird/               # Analytics integration
│   ├── tinybird-ai-analytics/  # AI usage analytics
│   ├── loops/                  # Marketing emails
│   └── resend/                 # Transactional emails
└── docker/                     # Docker configurations
```

## Common Development Commands

### Setup and Installation

```bash
# Install dependencies
pnpm install

# Start local services (Postgres & Redis)
docker-compose up -d

# Run database migrations
pnpm --filter=web prisma migrate dev

# Generate Prisma client
pnpm --filter=web prisma generate
```

### Development

```bash
# Start dev server (from root)
turbo dev

# Start dev server (from apps/web)
cd apps/web && pnpm dev

# Build the application
pnpm build

# Start production build
cd apps/web && pnpm start
```

### Database Operations

```bash
# Run migrations
pnpm --filter=web prisma migrate dev

# Create a new migration
pnpm --filter=web prisma migrate dev --name migration_name

# Reset database (caution: destroys data)
pnpm --filter=web prisma migrate reset

# Open Prisma Studio
pnpm --filter=web prisma studio

# Generate Prisma client after schema changes
pnpm --filter=web prisma generate
```

### Testing

```bash
# Run all tests (excludes AI tests)
pnpm test

# Run AI tests (uses real LLM, requires API keys)
cd apps/web && pnpm test-ai

# Run specific AI test
cd apps/web && pnpm test-ai ai-categorize-senders

# Run single test file
cd apps/web && pnpm test path/to/test-file.test.ts

# Run tests in watch mode
cd apps/web && pnpm test --watch
```

### Code Quality

```bash
# Lint and format check
pnpm format-and-lint

# Auto-fix linting and formatting
pnpm format-and-lint:fix

# Run lint only
pnpm lint
```

## Architecture Deep Dive

### AI Personal Assistant Architecture

The AI assistant uses a **hybrid approach** combining database-backed rules with prompt files:

1. **Prompt File → Database Rules**: Users write rules in a prompt file which gets parsed into individual database rules
2. **Two-Way Sync**: Changes to either prompt file or database rules sync bidirectionally (can be messy)
3. **LLM Decision Process**: 
   - The LLM receives database rules (not the raw prompt file)
   - AI primarily matches conditions rather than generating full actions
   - Actions are statically defined unless using templates
4. **Benefits**:
   - Precise action control without LLM interference
   - Trackable rule execution metrics
   - Condition matching is more reliable than full-prompt decisions

**Limitations**:
- Two-way sync complexity (historical artifact of product evolution)
- Prompt file style guidelines don't naturally map to database rules
- Separate "about" section on Settings page for global instructions

### Reply Tracking

Built as a special rule type within the AI assistant system:
- Integrated with existing assistant features
- Each user has their own reply tracking prompt
- Downside: Hard to globally update prompts for all users (unlike cold email blocker)

### Cold Email Blocker

Standalone feature separate from AI assistant:
- Monitors incoming emails from new senders
- LLM determines if email is cold outreach
- Easier to globally update prompts for all users

### Email Processing Flow

1. Gmail webhook receives email notifications
2. Webhook handler (`/api/google/webhook`) fetches email details
3. Email data passed to AI rule engine (`utils/ai/choose-rule`)
4. Matching rules executed with AI-generated actions (`utils/ai/actions`)
5. Actions performed via Gmail API (archive, label, reply, etc.)
6. Execution logged in database

### Data Architecture

- **Redis**: Used locally for caching and general data storage
- **Upstash Redis**: Used specifically for queue management (QStash)
- **Postgres**: Primary database for all persistent data
- **Tinybird**: Real-time analytics for email activity tracking

## Development Patterns

### Fullstack Development Workflow

1. **GET API Route** (`apps/web/app/api/user/*/route.ts`):
   - Wrap with `withAuth` or `withEmailAccount` middleware
   - Export response type for client type safety
   
2. **Server Action** (`apps/web/utils/actions/*.ts`):
   - Use `next-safe-action` with `actionClient`
   - Define Zod schemas in `*.validation.ts` files
   - Call `revalidatePath()` after mutations

3. **Data Fetching**:
   - Use SWR hooks for client-side fetching
   - Import response types from API routes

4. **Form Handling**:
   - React Hook Form with Zod validation via `zodResolver`
   - Use `LoadingContent` component for consistent loading/error states

### Environment Variables

When adding new environment variables:
1. Add to `apps/web/.env.example`
2. Add to `apps/web/env.ts` (server or client section)
3. Add to `turbo.json` under `tasks.build.env`
4. Client vars must have `NEXT_PUBLIC_` prefix

### Component Guidelines

- Use shadcn/ui components from `components/ui/`
- Place reusable components in `components/`
- Colocate feature-specific components with their pages
- Client components require `'use client'` directive
- Server actions require `'use server'` directive
- Use `LoadingContent` wrapper for async data display

### File Naming Conventions

- Route directories: kebab-case (`api/hello-world/route.ts`)
- Components: PascalCase (`components/Button.tsx`)
- Utilities: camelCase (`utils/formatEmail.ts`)
- Test files: `*.test.ts` (colocated) or `__tests__/` (AI tests)

## Key Configuration Files

- `turbo.json`: Turborepo pipeline configuration
- `apps/web/env.ts`: Environment variable validation (Zod)
- `apps/web/prisma/schema.prisma`: Database schema
- `apps/web/next.config.ts`: Next.js configuration
- `biome.json`: Code formatting and linting rules
- `docker-compose.yml`: Local services (Postgres, Redis)

## External Services Required

### Essential for Development
- **Google OAuth**: Client ID/Secret for Gmail integration
- **Google PubSub**: For real-time email notifications (optional for basic dev)
- **LLM Provider**: At least one (OpenAI, Anthropic, Ollama, etc.)

### Optional Services
- **Microsoft OAuth**: For Outlook/Microsoft email support
- **Upstash Redis**: Required for queue functionality (you're using this for queues)
- **Tinybird**: For analytics features
- **Lemon Squeezy** or **Stripe**: For payment processing
- **PostHog**: Feature flags and analytics
- **Sentry**: Error tracking
- **Resend**: Transactional emails

## Testing Strategy

- **Vitest** for unit and integration tests
- Tests colocated with source files (`*.test.ts`)
- AI tests in `__tests__/` directory (require LLM API keys)
- Mock Prisma using `vi.mock("@/utils/prisma")`
- Use test helpers from `@/__tests__/helpers`
- Set `RUN_AI_TESTS=true` to run AI tests

## Important Notes

### Git Repository Safety & Branching Model
- **CRITICAL**: This is a fork of the upstream repository
- Always verify with `git remote -v` before committing
- Commits should ONLY go to `origin` (salja03-t21/inbox-zero), NEVER to `upstream` (elie222/inbox-zero)
- Never commit or push to upstream unless explicitly instructed

#### Branch Structure
This fork uses a **feature branch workflow** for maintainability:

- **`main`**: Mirrors `upstream/main` exactly - always kept clean and in sync with elie222/inbox-zero
- **`feature/*`**: Long-lived feature branches containing custom functionality:
  - `feature/outlook-deep-clean` - Outlook-specific deep clean functionality
  - `feature/meeting-scheduler` - Email-triggered meeting scheduling
  - `feature/prompt-injection-defense` - Security hardening for AI prompts
  - `feature/documentation` - WARP.md and documentation updates
  - `feature/deployment-setup` - Docker/Traefik production deployment configs
  - `feature/auth-issues` - Authentication fixes and improvements
- **`production`**: Integration branch for deployment = `main` + all feature branches
- **`backup/main-pre-feature-split-YYYY-MM-DD`**: Safety backup before branch restructuring

#### Workflow Safety Rules
1. **Never push to upstream** - Only push to `origin` (your fork)
2. **Force pushes** are allowed ONLY on:
   - `main` (when syncing with upstream)
   - `feature/*` branches (after rebasing)
   - Use `--force-with-lease` to prevent accidental overwrites
3. **Deploy from `production`** - Never deploy from `main` or feature branches directly

### Data Safety
- **CRITICAL**: Always check with the user before destroying ANY volume data
- Never run `docker volume rm`, `docker compose down -v`, or `prisma migrate reset` without explicit permission
- This applies to both local development and production databases

### Authentication
- Uses Better Auth with `withAuth` and `withEmailAccount` middleware
- Server actions automatically receive auth context

### Mutations
- **Always use Server Actions** for mutations (create/update/delete)
- Do NOT use POST API routes for mutations

### Database Rules vs Prompt Files
The two-way sync between database rules and prompt files is a known complexity due to product evolution. When working on AI assistant features, be mindful that:
- LLM sees database rules, not raw prompt file
- Global styling instructions in prompt file may not reach LLM
- Use the "about" section in Settings for user-wide instructions

### Docker Development
- Local development uses Docker Compose for Postgres and Redis
- Local Redis for caching
- Upstash Redis (via environment variables) for queue management
- Build arg `NEXT_PUBLIC_BASE_URL` must be set at Docker build time

## Deployment

### Local Development Instance
- Runs on laptop at `http://localhost:3000`
- Uses Cloudflared tunnel for external access
- Local Redis for caching, Upstash for queues

### Production Instance
- Domain: `iz.salsven.com`
- Hosted on Docker server at `192.168.3.2`
- Docker Compose files at `~/docker/inbox-zero`
- Persistent volumes at `/mnt/nfs/inbox-zero`
- Uses Traefik for reverse proxy and SSL
- Local Redis for caching, Upstash for queues

### Production Deployment Process

**Automated Deployment Script:**
```bash
./deploy-production.sh
```

The deployment script handles:
1. Verifying you're on the `production` branch
2. Pushing latest changes to origin
3. Pulling code on server
4. Backing up existing `docker-compose.yml` with timestamp
5. Copying `docker-compose.prod.yml` → `docker-compose.yml`
6. Copying `.env` configuration
7. Building Docker image with correct `NEXT_PUBLIC_BASE_URL`
8. Starting containers
9. Running database migrations

**Important Notes:**
- The production server uses `docker-compose.yml` (not `docker-compose.prod.yml`) to start containers
- `docker-compose.prod.yml` is the SOURCE OF TRUTH for production configuration
- The deployment script automatically copies `docker-compose.prod.yml` to `docker-compose.yml` on the server
- To modify production Docker config, edit `docker-compose.prod.yml` in the repo, commit, and redeploy
- Old `docker-compose.yml` files are backed up with timestamps before being replaced

**Manual Deployment (if script fails):**
```bash
# SSH to server
ssh james@192.168.3.2
cd ~/docker/inbox-zero

# Pull latest code
git fetch origin
git checkout production
git pull origin production

# Backup and update docker-compose
cp docker-compose.yml docker-compose.yml.backup-$(date +%Y%m%d-%H%M%S)
cp docker-compose.prod.yml docker-compose.yml

# Build and restart
docker compose down
docker compose build --build-arg NEXT_PUBLIC_BASE_URL=https://iz.salsven.com
docker compose up -d

# Run migrations
docker compose exec -T app pnpm --filter=web prisma migrate deploy
```

## Premium Features

Many features require premium tier. To test premium features locally:
1. Set `ADMINS=your@email.com` in `.env`
2. Visit `http://localhost:3000/admin` to upgrade yourself

## Known Issues

### Microsoft OAuth Re-consent Required
Users are prompted to re-consent Microsoft permissions on each login. This needs investigation - likely related to session storage or token refresh configuration in Better Auth.

### Auth Provider Buttons
Setting `ENABLE_GOOGLE_AUTH=false` and `ENABLE_SSO_AUTH=false` in .env doesn't hide the buttons because the login page is statically generated. The page needs to be forced to dynamic rendering. The env vars ARE correctly read at runtime in the container.

## Ongoing Maintenance: Syncing with Upstream

### Weekly/As-Needed Update Process

To pull latest changes from upstream while preserving your custom features:

**Step 1: Sync `main` with upstream**
```bash
git switch main
git fetch upstream --prune
git pull --ff-only upstream main
git push origin main
```

**Step 2: Rebase each feature branch onto updated `main`**
```bash
for branch in feature/outlook-deep-clean feature/meeting-scheduler feature/prompt-injection-defense feature/documentation feature/deployment-setup feature/auth-issues
do
  git switch ${branch}
  git fetch origin
  git rebase main
  # If conflicts: fix files, then:
  # git add -A && git rebase --continue
  git push --force-with-lease origin ${branch}
done
```

**Step 3: Rebuild `production` with latest changes**
```bash
git switch production
git fetch origin
git reset --hard origin/main  # Start fresh from updated main

# Cherry-pick all feature commits in order
# (This recreates production from scratch with latest main + features)
git cherry-pick origin/feature/documentation
git cherry-pick origin/feature/deployment-setup  
git cherry-pick origin/feature/prompt-injection-defense
git cherry-pick origin/feature/outlook-deep-clean
git cherry-pick origin/feature/meeting-scheduler
git cherry-pick origin/feature/auth-issues

# Validate before deploying
pnpm install && pnpm build && pnpm test

git push --force-with-lease origin production
```

**Step 4: Deploy updated production**
```bash
# SSH to production server and pull latest
ssh user@192.168.3.2
cd ~/docker/inbox-zero
git fetch origin
git checkout production
git pull origin production
docker-compose up -d --build
```

### Tips
- **Rerere**: Git's `rerere` (reuse recorded resolution) is enabled - it remembers how you resolved conflicts
- **Tag releases**: Tag production deployments: `git tag -a prod-$(date +%Y%m%d) -m "Release notes" && git push origin --tags`
- **Upstreaming features**: To contribute a feature back to upstream, create a clean PR branch from your feature branch

## Useful Links

- Production: https://www.getinboxzero.com
- Documentation: https://docs.getinboxzero.com
- Discord: https://www.getinboxzero.com/discord
- Architecture Doc: See `ARCHITECTURE.md` for LLM-generated architecture overview
- Development Guidelines: See `apps/web/CLAUDE.md` for detailed development patterns
