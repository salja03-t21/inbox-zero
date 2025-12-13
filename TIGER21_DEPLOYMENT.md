# TIGER 21 Production Deployment Guide

## Overview

This guide covers deploying Inbox Zero to TIGER 21's production infrastructure.

**Key Details:**
- **Organization**: TIGER 21
- **Repository**: https://github.com/TIGER21-LLC/inbox-zero
- **Server**: 167.99.116.99 (DigitalOcean)
- **Domain**: iz.tiger21.com
- **Infrastructure**: Docker Swarm with Traefik reverse proxy
- **SSL/TLS**: Cloudflare certificates
- **Path**: ~/IT-Configs/docker_swarm/inbox-zero

## Architecture

```
Internet (Cloudflare DNS)
    ↓
Cloudflare SSL/TLS
    ↓
167.99.116.99 (DigitalOcean Droplet)
    ↓
Docker Swarm Cluster
    ↓
Traefik Reverse Proxy (traefik-public network)
    ↓
Inbox Zero Stack (2 replicas, load balanced)
    ├── app (Next.js - 2 replicas)
    ├── postgres (PostgreSQL 17)
    ├── redis (Redis 7)
    ├── serverless-redis-http
    └── inngest (background jobs)
```

## Prerequisites

### On Your Local Machine
1. Git access to https://github.com/TIGER21-LLC/inbox-zero
2. SSH access to root@167.99.116.99
3. Docker knowledge (for troubleshooting)

### On the Server (167.99.116.99)
1. **Docker Swarm initialized**
   ```bash
   docker swarm init
   ```

2. **Traefik running with `traefik-public` network**
   ```bash
   docker network create --driver=overlay traefik-public
   ```

3. **Volume mount points created**
   ```bash
   mkdir -p /mnt/inbox-zero-tiger21/{postgres,redis,app-data}
   ```

## Initial Setup (One-Time)

### Step 1: Set Up Cloudflare DNS

1. Log in to Cloudflare dashboard
2. Navigate to the TIGER 21 domain
3. Add an A record:
   - **Type**: A
   - **Name**: iz (or iz.tiger21.com)
   - **IPv4 address**: 167.99.116.99
   - **Proxy status**: Proxied (orange cloud) ✅
   - **TTL**: Auto

### Step 2: Configure SSL/TLS in Cloudflare

1. Go to SSL/TLS → Overview
2. Set encryption mode to **Full (strict)**
3. Go to SSL/TLS → Edge Certificates
4. Enable:
   - ✅ Always Use HTTPS
   - ✅ Automatic HTTPS Rewrites
   - ✅ Minimum TLS Version: 1.2

### Step 3: Create Environment File on Server

**CRITICAL**: The `.env.tiger21` file is NEVER committed to git. It exists ONLY on the server.

```bash
# SSH to the server
ssh root@167.99.116.99

# Navigate to deployment directory
cd ~/IT-Configs/docker_swarm/inbox-zero

# Clone the repository (first time only)
git clone https://github.com/TIGER21-LLC/inbox-zero.git .

# Copy the environment template
cp .env.tiger21.example .env.tiger21

# Edit with actual credentials
nano .env.tiger21
```

**Generate Secure Secrets:**
```bash
# AUTH_SECRET, INNGEST keys, etc. (32 chars base64)
openssl rand -base64 32

# EMAIL_ENCRYPT_SECRET (64 char hex)
openssl rand -hex 32

# EMAIL_ENCRYPT_SALT (32 char hex)
openssl rand -hex 16

# API keys
openssl rand -base64 32
```

**Required Credentials to Fill In:**
- `POSTGRES_PASSWORD` - Secure database password
- `UPSTASH_REDIS_TOKEN` - Secure Redis token
- `AUTH_SECRET` - Authentication secret
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
- `MICROSOFT_CLIENT_ID` & `MICROSOFT_CLIENT_SECRET` - From Azure Portal
- `EMAIL_ENCRYPT_SECRET` & `EMAIL_ENCRYPT_SALT` - Encryption keys
- `INNGEST_EVENT_KEY` & `INNGEST_SIGNING_KEY` - Background job keys
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` - AI provider keys
- All other keys as needed (see `.env.tiger21.example`)

### Step 4: Configure OAuth Redirect URIs

**Google OAuth Console** (https://console.cloud.google.com/):
- Authorized redirect URIs: `https://iz.tiger21.com/api/auth/callback/google`

**Microsoft Azure Portal** (https://portal.azure.com/):
- Redirect URIs: `https://iz.tiger21.com/api/auth/callback/microsoft`

## Deployment Process

### Automated Deployment (Recommended)

From your local machine:

```bash
# Ensure you're on the production branch
git checkout production

# Commit your changes
git add .
git commit -m "Your commit message"

# Run the deployment script
./deploy-tiger21.sh
```

The script will:
1. ✅ Verify you're on the correct repository and branch
2. ✅ Push code to GitHub
3. ✅ Pull code on the server
4. ✅ Verify `.env.tiger21` exists
5. ✅ Build the Docker image on the server
6. ✅ Deploy to Docker Swarm
7. ✅ Run database migrations
8. ✅ Verify services are running

### Manual Deployment

If you need to deploy manually:

```bash
# SSH to server
ssh root@167.99.116.99

# Navigate to deployment directory
cd ~/IT-Configs/docker_swarm/inbox-zero

# Pull latest code
git pull origin production

# Build the image
docker build \
  -f docker/Dockerfile.tiger21.prod \
  --build-arg NEXT_PUBLIC_BASE_URL=https://iz.tiger21.com \
  -t ghcr.io/tiger21-llc/inbox-zero:latest \
  .

# Deploy the stack
docker stack deploy \
  --compose-file docker-compose.tiger21.yml \
  inbox-zero-tiger21

# Wait for services to start (30-60 seconds)
docker stack services inbox-zero-tiger21

# Run migrations
docker exec $(docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_app --format '{{.ID}}' | head -n 1) \
  sh -c 'cd /app/apps/web && npx prisma migrate deploy'
```

## Docker Swarm Management

### View Stack Status

```bash
# List all stacks
docker stack ls

# List services in the stack
docker stack services inbox-zero-tiger21

# List tasks (container instances)
docker stack ps inbox-zero-tiger21

# View detailed service info
docker service inspect inbox-zero-tiger21_app
```

### View Logs

```bash
# App logs (all replicas)
docker service logs inbox-zero-tiger21_app -f

# Last 100 lines
docker service logs inbox-zero-tiger21_app --tail 100

# Postgres logs
docker service logs inbox-zero-tiger21_postgres -f

# Inngest logs
docker service logs inbox-zero-tiger21_inngest -f
```

### Scale Services

```bash
# Scale app to 3 replicas
docker service scale inbox-zero-tiger21_app=3

# Scale back to 2
docker service scale inbox-zero-tiger21_app=2
```

### Update Service

```bash
# Update with new image
docker service update \
  --image ghcr.io/tiger21-llc/inbox-zero:latest \
  inbox-zero-tiger21_app

# Force update (recreate containers)
docker service update --force inbox-zero-tiger21_app
```

### Rolling Updates

The stack is configured for zero-downtime deployments:
- `update_config.parallelism: 1` - Update one replica at a time
- `update_config.order: start-first` - Start new container before stopping old one
- `update_config.failure_action: rollback` - Auto-rollback on failure

```bash
# Trigger a rolling update
docker stack deploy \
  --compose-file docker-compose.tiger21.yml \
  inbox-zero-tiger21
```

### Rollback

```bash
# Rollback to previous version
docker service rollback inbox-zero-tiger21_app
```

## Monitoring & Troubleshooting

### Health Checks

All services have health checks configured:

```bash
# Check service health
docker service ps inbox-zero-tiger21_app

# Check container health directly
docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_app
```

### Common Issues

#### Service won't start
```bash
# Check service logs
docker service logs inbox-zero-tiger21_app

# Check events
docker service ps inbox-zero-tiger21_app --no-trunc

# Inspect service
docker service inspect inbox-zero-tiger21_app
```

#### Database connection errors
```bash
# Verify postgres is running
docker service ps inbox-zero-tiger21_postgres

# Check postgres logs
docker service logs inbox-zero-tiger21_postgres

# Test connection from app container
docker exec $(docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_app -q | head -n 1) \
  sh -c 'wget -O- http://postgres:5432 || echo "Cannot connect"'
```

#### Traefik not routing traffic
```bash
# Verify traefik-public network exists
docker network ls | grep traefik-public

# Check service is connected to traefik-public
docker service inspect inbox-zero-tiger21_app | grep traefik-public

# View Traefik logs (if accessible)
docker service logs traefik
```

#### Memory/CPU issues
```bash
# View resource usage
docker stats

# Check service constraints
docker service inspect inbox-zero-tiger21_app | grep -A 10 Resources
```

## Backup & Restore

### Database Backup

```bash
# Backup database
docker exec $(docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_postgres -q | head -n 1) \
  pg_dump -U inboxzero inboxzero > backup-$(date +%Y%m%d).sql

# Compress backup
gzip backup-$(date +%Y%m%d).sql
```

### Database Restore

```bash
# Restore from backup
cat backup-20240101.sql | docker exec -i $(docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_postgres -q | head -n 1) \
  psql -U inboxzero inboxzero
```

### Volume Backup

```bash
# Backup volumes (run on server)
tar -czf /backup/postgres-$(date +%Y%m%d).tar.gz /mnt/inbox-zero-tiger21/postgres
tar -czf /backup/redis-$(date +%Y%m%d).tar.gz /mnt/inbox-zero-tiger21/redis
tar -czf /backup/app-data-$(date +%Y%m%d).tar.gz /mnt/inbox-zero-tiger21/app-data
```

## Security Considerations

### Secrets Management
- ✅ `.env.tiger21` is **NEVER** committed to git
- ✅ All secrets generated using cryptographically secure methods
- ✅ Different secrets for production vs. development
- ✅ Secrets rotated periodically

### Container Security
- ✅ Running as non-root user (`nextjs:nodejs`)
- ✅ Using Alpine Linux (minimal attack surface)
- ✅ Regular security updates (`apk upgrade`)
- ✅ Health checks enabled
- ✅ Resource limits configured

### Network Security
- ✅ Services on isolated overlay network
- ✅ Only app service exposed to Traefik
- ✅ Cloudflare proxy enabled (DDoS protection)
- ✅ SSL/TLS enforced

### Database Security
- ✅ Strong password required
- ✅ `scram-sha-256` authentication
- ✅ Not exposed to public internet
- ✅ Regular backups

## Maintenance

### Regular Tasks

**Weekly:**
- Review logs for errors
- Check disk space on volumes
- Monitor resource usage

**Monthly:**
- Update Docker images for security patches
- Review and rotate API keys if needed
- Test backup restoration process

**Quarterly:**
- Rotate database password
- Rotate authentication secrets
- Security audit

### Updating Dependencies

```bash
# On your local machine
pnpm update

# Test thoroughly
pnpm build
pnpm test

# Commit and deploy
git add .
git commit -m "chore: update dependencies"
./deploy-tiger21.sh
```

## Removing the Stack

```bash
# Remove the entire stack
docker stack rm inbox-zero-tiger21

# Wait for services to stop (check with)
docker stack ps inbox-zero-tiger21

# Optionally remove volumes (⚠️ THIS DELETES DATA!)
# rm -rf /mnt/inbox-zero-tiger21/*
```

## Support & Documentation

- **Main Documentation**: See `DEPLOYMENT.md` for general deployment info
- **Docker Swarm Docs**: https://docs.docker.com/engine/swarm/
- **Traefik Docs**: https://doc.traefik.io/traefik/
- **Next.js Deployment**: https://nextjs.org/docs/deployment

## Quick Reference

```bash
# Common commands
alias tiger21-status='docker stack services inbox-zero-tiger21'
alias tiger21-logs='docker service logs inbox-zero-tiger21_app -f'
alias tiger21-ps='docker stack ps inbox-zero-tiger21'
alias tiger21-deploy='cd ~/IT-Configs/docker_swarm/inbox-zero && docker stack deploy --compose-file docker-compose.tiger21.yml inbox-zero-tiger21'
```
