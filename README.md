# Inbox Zero - TIGER 21 Deployment

AI-powered email assistant for TIGER 21 members, deployed at **[iz.tiger21.com](https://iz.tiger21.com)**.

## Overview

Inbox Zero is an AI email assistant that helps you:
- **AI Personal Assistant:** Organizes your inbox and pre-drafts replies in your tone and style
- **Smart Categories:** Automatically categorize every sender
- **Bulk Unsubscriber:** One-click unsubscribe and archive emails you never read
- **Cold Email Blocker:** Auto-block cold emails
- **Reply Zero:** Track emails to reply to and those awaiting responses
- **Email Analytics:** Track your activity and trends over time

## TIGER 21 Deployment Details

### Production Environment

- **Domain**: https://iz.tiger21.com
- **Server**: 167.99.116.99 (DigitalOcean)
- **Infrastructure**: Docker Swarm
- **Deployment Path**: `~/IT-Configs/docker_swarm/inbox-zero`
- **Data Volumes**: `/mnt/inbox-zero-tiger21/`

### Architecture

- **Application**: Next.js 15 (App Router) - 2 replicas for high availability
- **Database**: DigitalOcean Managed PostgreSQL
- **Cache**: Redis 7 (containerized)
- **Background Jobs**: Inngest
- **Reverse Proxy**: Traefik with automatic SSL via Cloudflare
- **Authentication**: Better Auth with Microsoft OAuth and SSO

### Access Control

- **Allowed Domains**: Only `tiger21.com` and `tiger21chair.com` email addresses can register
- **Authentication Methods**: Microsoft OAuth and SSO enabled, Gmail disabled

### Email Provider Support

- **Microsoft Outlook/Exchange**: Fully supported (primary provider for TIGER 21)
- **Gmail**: Disabled (`NEXT_PUBLIC_DISABLE_GMAIL=true`)

### AI/LLM Configuration

- **Provider**: Nebius AI (via OpenAI-compatible API)
- **Default Model**: Qwen/Qwen3-235B-A22B-Instruct-2507
- **Economy Model**: openai/gpt-oss-120b
- **Endpoint**: https://api.tokenfactory.nebius.com/v1/

## Deployment

Deploys are automated GitOps. This repo only **builds** the image; the production stack's compose lives in the separate `tiger21-infrastructure` repo. There is no local build and no SSH deploy.

### How a deploy works

1. Merge to `main` in this repo.
2. `.github/workflows/tiger21-build-release.yml` builds an immutable, sha-tagged amd64 image (`docker/Dockerfile.tiger21.prod`, with the `NEXT_PUBLIC_BASE_URL=https://iz.tiger21.com` build-arg) and pushes it to `registry.digitalocean.com/t21-docker-registry/inbox-zero`.
3. The same workflow opens a **digest-bump PR** against `TIGER21-LLC/tiger21-infrastructure`, editing `stacks/inbox-zero-tiger21/compose.yml` to pin the new `sha-<commit>@sha256:<digest>`.
4. **Merging that PR is the deploy** — `tiger21-infrastructure`'s `stacks-deploy.yml` runs `gitops-deploy inbox-zero-tiger21` on node 01.

The canonical compose is `tiger21-infrastructure/stacks/inbox-zero-tiger21/compose.yml`. The `docker-compose.tiger21.yml` in this repo is kept for local reference only and does not reach production.

### Secrets

- **Runtime** (container env): Doppler project/config `swarm-apps/inboxzero`, staged on-box at deploy (P-ENVFILE-STAGING).
- **Pipeline** (build/PR credentials): a **dedicated** Doppler CI config holding `DO_REGISTRY_TOKEN` and `TIGER21_INFRA_GITHUB_TOKEN`, reached via one GitHub Actions secret `DOPPLER_TOKEN`. These are kept out of `swarm-apps/inboxzero` so CI credentials never leak into the running app.

### Rollback

- Fast: `docker --context tiger21-swarm service rollback inbox-zero-tiger21_app`.
- Tracked: `git revert` the digest-bump PR in `tiger21-infrastructure` and merge it.

See `tiger21-infrastructure` `docs/00-overview/deployment-architecture.md` and `stacks/inbox-zero-tiger21/README.md` for full detail.

### Environment Configuration

Runtime environment variables are managed in Doppler (`swarm-apps/inboxzero`) and staged into the container at deploy. `.env.tiger21.example` documents the shape. Key configurations:

```bash
# Application
NEXT_PUBLIC_BASE_URL=https://iz.tiger21.com
NEXT_PUBLIC_DISABLE_GMAIL=true

# Access Control
ALLOWED_EMAIL_DOMAINS=tiger21.com,tiger21chair.com
ENABLE_GOOGLE_AUTH=false
ENABLE_MICROSOFT_AUTH=true
ENABLE_SSO_AUTH=true

# Database (DigitalOcean Managed PostgreSQL)
DATABASE_URL=postgresql://inbox_zero_user:PASSWORD@db-postgres-do-user-13034382-0.b.db.ondigitalocean.com:25060/inbox-zero?sslmode=require

# Microsoft OAuth
MICROSOFT_CLIENT_ID=d5886e83-a14e-4213-8615-74d2146e318f
MICROSOFT_CLIENT_SECRET=<secret>
MICROSOFT_TENANT_ID=89f2f6c3-aa52-4af9-953e-02a633d0da4d

# Nebius AI
DEFAULT_LLM_MODEL=Qwen/Qwen3-235B-A22B-Instruct-2507
ECONOMY_LLM_MODEL=openai/gpt-oss-120b
OPENAI_BASE_URL=https://api.tokenfactory.nebius.com/v1/
OPENAI_API_KEY=<nebius-jwt-token>
```

**IMPORTANT**: Never commit `.env.tiger21` to version control. Use `.env.tiger21.example` as a template.

## Monitoring & Maintenance

### Health Checks

- **Simple Health**: https://iz.tiger21.com/api/health/simple
- **Service Status**: `docker stack ps inbox-zero-tiger21`
- **Logs**: `docker service logs -f inbox-zero-tiger21_app`

### Scaling

The application is configured with 2 replicas for high availability. To scale:

```bash
docker service scale inbox-zero-tiger21_app=3
```

### Database Backups

DigitalOcean Managed PostgreSQL includes automatic daily backups with 7-day retention.

### Updates

To ship a change: merge it to `main`. The build-and-release workflow publishes a new sha-tagged image and opens a digest-bump PR against `tiger21-infrastructure`; merging that PR rolls it out. See [Deployment](#deployment) above.

## Development

### Local Development Setup

**Requirements:**
- Node.js >= 18.0.0
- pnpm >= 8.6.12
- Docker Desktop (for local PostgreSQL/Redis)

**Quick Start:**

```bash
# Clone repository
git clone https://github.com/TIGER21-LLC/inbox-zero.git
cd inbox-zero

# Install dependencies
pnpm install

# Copy environment template
cp apps/web/.env.example apps/web/.env

# Start local services (PostgreSQL + Redis)
docker-compose up -d

# Run database migrations
pnpm --filter=web prisma migrate dev

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI**: Tailwind CSS + shadcn/ui
- **Database**: Prisma + PostgreSQL
- **Cache**: Redis (Upstash-compatible)
- **Authentication**: Better Auth
- **Background Jobs**: Inngest
- **Monorepo**: Turborepo with pnpm workspaces

### Project Structure

```
inbox-zero/
├── apps/
│   └── web/               # Main Next.js application
│       ├── app/           # Next.js App Router pages
│       ├── components/    # React components
│       ├── utils/         # Utilities and helpers
│       ├── prisma/        # Database schema & migrations
│       └── providers/     # React context providers
├── packages/
│   ├── resend/           # Email sending (Resend API)
│   ├── tinybird/         # Analytics
│   └── tsconfig/         # Shared TypeScript configs
└── docker/
    └── Dockerfile.tiger21.prod  # Production Docker image
```

### Key Commands

```bash
# Development
pnpm dev                              # Start dev server
pnpm build                            # Build for production
pnpm test                             # Run tests
pnpm tsc --noEmit                     # Type check

# Database
pnpm --filter=web prisma migrate dev  # Create & run migrations
pnpm --filter=web prisma studio       # Open database GUI
pnpm --filter=web prisma generate     # Regenerate Prisma client

# Code Quality
pnpm format-and-lint:fix              # Auto-fix formatting/linting
```

### Testing Premium Features

To test premium features locally:

1. Set yourself as admin in `.env`:
   ```bash
   ADMINS=your-email@tiger21.com
   ```

2. Visit [http://localhost:3000/admin](http://localhost:3000/admin) and upgrade yourself to premium

## Microsoft OAuth Setup

The application uses Microsoft OAuth for authentication. Configuration:

### Azure AD App Registration

1. **App ID**: d5886e83-a14e-4213-8615-74d2146e318f
2. **Tenant ID**: 89f2f6c3-aa52-4af9-953e-02a633d0da4d
3. **Redirect URIs**:
   - `https://iz.tiger21.com/api/auth/callback/microsoft`
   - `https://iz.tiger21.com/api/outlook/linking/callback`

### Required API Permissions

- **Microsoft Graph Delegated Permissions**:
  - openid, profile, email
  - User.Read
  - offline_access
  - Mail.ReadWrite
  - Mail.Send
  - Mail.ReadBasic
  - Mail.Read
  - Mail.Read.Shared
  - MailboxSettings.ReadWrite
  - Contacts.ReadWrite

## Security

- **OAuth Tokens**: Encrypted at rest using `EMAIL_ENCRYPT_SECRET` and `EMAIL_ENCRYPT_SALT`
- **Session Storage**: Database-backed (PostgreSQL)
- **SSL/TLS**: Automatic via Traefik + Cloudflare
- **Secrets**: Managed via environment variables, never committed to git
- **Database**: Managed PostgreSQL with SSL required

## Support & Documentation

- **Architecture Overview**: See [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Deployment Guide**: See [TIGER21_DEPLOYMENT.md](./TIGER21_DEPLOYMENT.md)
- **Deployment Checklist**: See [TIGER21_DEPLOYMENT_CHECKLIST.md](./TIGER21_DEPLOYMENT_CHECKLIST.md)
- **Quick Reference**: See [TIGER21_QUICK_REFERENCE.md](./TIGER21_QUICK_REFERENCE.md)

## License

See [LICENSE](./LICENSE) file for details.

---

**Built with Next.js, Tailwind CSS, shadcn/ui, Prisma, and deployed on Docker Swarm**
