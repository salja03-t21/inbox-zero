# TIGER 21 Deployment Principles

## CRITICAL: Clean Server Architecture

### The Golden Rule

**PRODUCTION SERVERS MUST NEVER CONTAIN SOURCE CODE**

This is a fundamental security and operational principle for Docker Swarm deployments.

### Why This Matters

1. **Security**: Source code on production servers is a security risk
   - Exposes application logic and potential vulnerabilities
   - Increases attack surface
   - Makes it easier for attackers to find exploits

2. **Separation of Concerns**: Build ≠ Runtime
   - Building is a development/CI activity
   - Running is a production activity
   - These should never mix on production infrastructure

3. **Immutability**: Servers should be cattle, not pets
   - Servers should be replaceable
   - Configuration should be declarative
   - No manual builds or compilation on production servers

4. **Audit Trail**: Container registry is the source of truth
   - Every deployed version is tagged and traceable
   - Easy to rollback to previous versions
   - Clear history of what was deployed when

## The Correct Deployment Pattern

### What SHOULD be on the server

```
~/IT-Configs/docker_swarm/inbox-zero/   # LEGACY tree — superseded by the
├── docker-compose.tiger21.yml          # tiger21-infrastructure checkout on
├── .env.tiger21                        # node 01; kept as rollback history
└── .env.tiger21.example                # only. New deploys use gitops-deploy.
```

### What should NEVER be on the server

- ❌ Source code (`.js`, `.ts`, `.tsx` files)
- ❌ Git repository (`.git` directory)
- ❌ `node_modules`
- ❌ Build tools (`pnpm`, `npm`, `yarn`)
- ❌ Compilers (TypeScript, Babel, etc.)
- ❌ Development dependencies
- ❌ `.next` build output
- ❌ Any files from the repository except `docker-compose.yml`

## The Deployment Workflow

The clean-server principle is now enforced by an automated GitOps pipeline. Nobody builds locally and nobody SSHes to deploy. This repo builds the image in CI; the stack's compose lives in the `tiger21-infrastructure` repo and deploys itself when a PR merges.

### Step 1: Merge to `main` (this repo)

A merge to `main` triggers `.github/workflows/tiger21-build-release.yml`. It builds an immutable, sha-tagged **amd64** image (`docker/Dockerfile.tiger21.prod`, `--build-arg NEXT_PUBLIC_BASE_URL=https://iz.tiger21.com`) on a native amd64 CI runner and pushes it to `registry.digitalocean.com/t21-docker-registry/inbox-zero`. No local build, no architecture mismatch, no floating tag.

### Step 2: Digest-bump PR (auto-opened)

The same workflow opens a PR against `TIGER21-LLC/tiger21-infrastructure` that pins the new `sha-<commit>@sha256:<digest>` in `stacks/inbox-zero-tiger21/compose.yml`.

### Step 3: Merge the infra PR = deploy

Merging that PR runs `tiger21-infrastructure`'s `stacks-deploy.yml`, which SSHes to node 01 and runs `gitops-deploy inbox-zero-tiger21`. The server pulls the pinned image and deploys it. Secrets are injected on-box from Doppler (`swarm-apps/inboxzero`); no secret value ever reaches CI.

### Step 4: Migrations

Prisma migrations run inside the deployed image via the infra pipeline. See `tiger21-infrastructure` `stacks/inbox-zero-tiger21/README.md` for the exact mechanism.

## Automated Deployment Script (retired)

`deploy-tiger21.sh` is **retired** — it no longer builds, pushes, or deploys, and simply prints the new flow and exits non-zero. The old "build locally, push, SSH deploy" script pattern has been fully replaced by the CI pipeline above.

## What the Server Does

The production server's role is simple:

1. **Pull** pre-built images from registry
2. **Run** containers using those images
3. **Route** traffic via Traefik
4. **Store** data in volumes
5. **Monitor** service health

That's it. No building, no compiling, no source code.

## Benefits of This Approach

### Security
- ✅ No source code exposure on production
- ✅ Minimal attack surface
- ✅ Secrets managed via environment variables only
- ✅ Immutable deployments

### Reliability
- ✅ Exact same image from dev to prod
- ✅ No "works on my machine" issues
- ✅ Reproducible builds
- ✅ Easy rollbacks

### Performance
- ✅ No build time on production server
- ✅ Faster deployments
- ✅ Server resources dedicated to running apps, not building them

### Maintainability
- ✅ Clean, minimal server configuration
- ✅ Easy to replicate servers
- ✅ Clear separation of build and runtime
- ✅ Easier debugging (container logs, not build errors)

## Common Anti-Patterns to Avoid

### ❌ DON'T: Clone repository to server
```bash
# WRONG - Never do this!
ssh root@167.99.116.99
git clone https://github.com/TIGER21-LLC/inbox-zero.git
cd inbox-zero
docker build ...
```

### ❌ DON'T: Use rsync to copy source code
```bash
# WRONG - Never do this!
rsync -avz . root@167.99.116.99:~/src/inbox-zero/
```

### ❌ DON'T: Build on the server
```bash
# WRONG - Never do this!
ssh root@167.99.116.99 "cd ~/src/inbox-zero && docker build ..."
```

### ❌ DON'T: Run pnpm/npm on server
```bash
# WRONG - Never do this!
ssh root@167.99.116.99 "cd ~/src/inbox-zero && pnpm install && pnpm build"
```

### ✅ DO: Merge to `main` and let CI build + GitOps deploy
```text
# CORRECT - This is the way!
# 1. Merge to main -> tiger21-build-release.yml builds + pushes a sha-tagged
#    image to the DO registry.
# 2. It auto-opens a digest-bump PR on tiger21-infrastructure.
# 3. Merge that PR -> stacks-deploy.yml runs gitops-deploy on node 01.
```

## Exceptions

There are NO exceptions to this rule for production deployments.

For development/staging environments, you might use different patterns, but production should ALWAYS follow the clean server principle.

## Emergency Rollback

Rollback is a git operation on the infra repo (or a one-line Swarm command):

```bash
# Fast, no files: revert to the immediately-previous task spec on the Swarm
docker --context tiger21-swarm service rollback inbox-zero-tiger21_app

# Tracked: git-revert the digest-bump PR in tiger21-infrastructure and merge it.
# Merging the revert redeploys the previously-pinned digest via stacks-deploy.yml.
```

Every deployed image is an immutable `sha-<commit>@sha256:<digest>` pin in `tiger21-infrastructure/stacks/inbox-zero-tiger21/compose.yml`, so any prior version is recoverable by reverting to that commit's pin.

## Server Audit Checklist

Before any deployment, verify the server is clean:

```bash
ssh root@167.99.116.99

# These should all be EMPTY or NOT EXIST
ls -la ~/src/                     # Should not exist or be empty
ls -la ~/inbox-zero/              # Should not exist
ls -la ~/code/                    # Should not exist
find ~ -name "node_modules" -type d  # Should find nothing
find ~ -name ".git" -type d       # Should find nothing (except maybe in tools)

# Only this should exist (legacy tree, retained as rollback history;
# the deploy source is the tiger21-infrastructure checkout on node 01)
ls -la ~/IT-Configs/docker_swarm/inbox-zero/
# Should show:
# - docker-compose.tiger21.yml
# - .env.tiger21
```

## Summary

**Remember**: Production servers are for **running** containers, not **building** them.

- Build locally or in CI/CD
- Push to registry
- Deploy from registry
- Keep servers clean

This is not just a best practice—it's a fundamental security and operational requirement.
