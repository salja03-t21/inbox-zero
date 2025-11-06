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

### Git Repository Safety
- **CRITICAL**: This is a fork of the upstream repository
- Always verify with `git remote -v` before committing
- Commits should ONLY go to `origin` (salja03-t21/inbox-zero), NEVER to `upstream` (elie222/inbox-zero)
- Never commit or push to upstream unless explicitly instructed

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
- Uses Cloudflared tunnel for external access
- Local Redis for caching, Upstash for queues

## Premium Features

Many features require premium tier. To test premium features locally:
1. Set `ADMINS=your@email.com` in `.env`
2. Visit `http://localhost:3000/admin` to upgrade yourself

## Useful Links

- Production: https://www.getinboxzero.com
- Documentation: https://docs.getinboxzero.com
- Discord: https://www.getinboxzero.com/discord
- Architecture Doc: See `ARCHITECTURE.md` for LLM-generated architecture overview
- Development Guidelines: See `apps/web/CLAUDE.md` for detailed development patterns
