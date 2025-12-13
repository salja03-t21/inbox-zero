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
~/IT-Configs/docker_swarm/inbox-zero/
├── docker-compose.tiger21.yml    # Service definitions
├── .env.tiger21                  # Secrets (NEVER in git)
├── deploy-tiger21.sh             # Optional deployment helper
└── .env.tiger21.example          # Template (in git, no secrets)
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

### Step 1: Build Locally (Development Machine)

```bash
# On your local development machine
cd /path/to/inbox-zero
git checkout production
pnpm tsc --noEmit  # Type check before building

docker build \
  -f docker/Dockerfile.tiger21.prod \
  --build-arg NEXT_PUBLIC_BASE_URL=https://iz.tiger21.com \
  -t ghcr.io/tiger21-llc/inbox-zero:latest \
  -t ghcr.io/tiger21-llc/inbox-zero:$(git rev-parse --short HEAD) \
  .
```

### Step 2: Push to Registry

```bash
# Authenticate to GitHub Container Registry (one time)
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Push the images
docker push ghcr.io/tiger21-llc/inbox-zero:latest
docker push ghcr.io/tiger21-llc/inbox-zero:abc1234
```

### Step 3: Deploy to Swarm

```bash
# Upload only the docker-compose file
scp docker-compose.tiger21.yml root@167.99.116.99:~/IT-Configs/docker_swarm/inbox-zero/

# Deploy the stack (server pulls image from registry)
ssh root@167.99.116.99 "cd ~/IT-Configs/docker_swarm/inbox-zero && \
  docker stack deploy --compose-file docker-compose.tiger21.yml \
  --with-registry-auth inbox-zero-tiger21"
```

### Step 4: Run Migrations

```bash
# Execute migrations in a running container
ssh root@167.99.116.99
docker exec $(docker ps -qf name=inbox-zero-tiger21_app | head -1) \
  sh -c 'cd /app/apps/web && npx prisma migrate deploy'
```

## Automated Deployment Script

Use the `deploy-tiger21.sh` script which follows this pattern:

```bash
./deploy-tiger21.sh
```

This script:
1. ✅ Verifies you're on the correct branch
2. ✅ Runs type checking locally
3. ✅ Builds Docker image locally
4. ✅ Pushes to container registry
5. ✅ Uploads only `docker-compose.tiger21.yml` to server
6. ✅ Deploys to swarm (server pulls pre-built image)
7. ✅ Runs migrations
8. ✅ Verifies deployment

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

### ✅ DO: Build locally, push to registry, deploy
```bash
# CORRECT - This is the way!
docker build -t ghcr.io/tiger21-llc/inbox-zero:latest .
docker push ghcr.io/tiger21-llc/inbox-zero:latest
ssh root@167.99.116.99 "cd ~/IT-Configs/docker_swarm/inbox-zero && \
  docker stack deploy --compose-file docker-compose.tiger21.yml inbox-zero-tiger21"
```

## Exceptions

There are NO exceptions to this rule for production deployments.

For development/staging environments, you might use different patterns, but production should ALWAYS follow the clean server principle.

## Emergency Rollback

If something goes wrong, rollback is trivial because images are tagged:

```bash
# List available tags
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://ghcr.io/v2/tiger21-llc/inbox-zero/tags/list

# Deploy a specific version
ssh root@167.99.116.99
cd ~/IT-Configs/docker_swarm/inbox-zero

# Edit docker-compose.tiger21.yml to use specific tag
# Change: image: ghcr.io/tiger21-llc/inbox-zero:latest
# To:     image: ghcr.io/tiger21-llc/inbox-zero:abc1234

docker stack deploy --compose-file docker-compose.tiger21.yml \
  --with-registry-auth inbox-zero-tiger21
```

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

# Only this should exist
ls -la ~/IT-Configs/docker_swarm/inbox-zero/
# Should show:
# - docker-compose.tiger21.yml
# - .env.tiger21
# - deploy-tiger21.sh (optional)
```

## Summary

**Remember**: Production servers are for **running** containers, not **building** them.

- Build locally or in CI/CD
- Push to registry
- Deploy from registry
- Keep servers clean

This is not just a best practice—it's a fundamental security and operational requirement.
