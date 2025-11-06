# Production Deployment Guide

## Overview

This guide covers deploying Inbox Zero to production at **192.168.3.2** with domain **iz.salsven.com**.

## Architecture

- **Server**: 192.168.3.2
- **Domain**: iz.salsven.com
- **Reverse Proxy**: Traefik (handles SSL/TLS with Let's Encrypt)
- **Tunnel**: Cloudflare Tunnel (routes external traffic to Traefik)
- **Containers**: Docker Compose
  - `inbox-zero-app`: Next.js application
  - `inbox-zero-postgres`: PostgreSQL database
  - `inbox-zero-redis`: Redis cache
- **Volumes**: `/mnt/nfs/inbox-zero/{postgres,redis,app-data}`

## Prerequisites

1. SSH access to 192.168.3.2
2. Docker and Docker Compose installed on server
3. Traefik already running with `traefik-network` created
4. Cloudflare tunnel configured (already done)

## Deployment Steps

### Option 1: Automated Deployment (Recommended)

1. **Update the deployment script with your SSH username:**
   ```bash
   vim deploy-production.sh
   # Change SERVER_USER="your_username" to your actual username
   ```

2. **Run the deployment script:**
   ```bash
   ./deploy-production.sh
   ```

   This script will:
   - Create necessary directories
   - Copy files to server
   - Build and start Docker containers
   - Run database migrations
   - Verify deployment

### Option 2: Manual Deployment

1. **Create directories on server:**
   ```bash
   ssh user@192.168.3.2
   mkdir -p ~/docker/inbox-zero
   sudo mkdir -p /mnt/nfs/inbox-zero/{postgres,redis,app-data}
   sudo chown -R $USER:$USER /mnt/nfs/inbox-zero
   ```

2. **Copy files to server:**
   ```bash
   # From your laptop
   scp docker-compose.prod.yml user@192.168.3.2:~/docker/inbox-zero/docker-compose.yml
   scp apps/web/.env.production user@192.168.3.2:~/docker/inbox-zero/.env
   ```

3. **SSH to server and start services:**
   ```bash
   ssh user@192.168.3.2
   cd ~/docker/inbox-zero
   
   # Build and start
   docker compose build --build-arg NEXT_PUBLIC_BASE_URL=https://iz.salsven.com
   docker compose up -d
   
   # Run migrations
   docker compose exec app pnpm --filter=web prisma migrate deploy
   ```

4. **Verify deployment:**
   ```bash
   docker compose ps
   docker compose logs -f app
   ```

## Configuration

### Environment Variables

Production environment variables are in `apps/web/.env.production`. Key differences from dev:

- `NEXT_PUBLIC_BASE_URL=https://iz.salsven.com`
- `DATABASE_URL=postgresql://inboxzero:changeme@postgres:5432/inboxzero`
- `REDIS_URL=redis://redis:6379`
- All Microsoft/Google OAuth credentials (same as dev)
- Encryption keys (same as dev for now, should be different in final prod)

### Traefik Labels

The `docker-compose.prod.yml` includes Traefik labels for automatic SSL/TLS:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.inbox-zero.rule=Host(`iz.salsven.com`)"
  - "traefik.http.routers.inbox-zero.entrypoints=websecure"
  - "traefik.http.routers.inbox-zero.tls=true"
  - "traefik.http.routers.inbox-zero.tls.certresolver=letsencrypt"
```

## Cloudflare Tunnel

The Cloudflare tunnel routes traffic from the internet to your server:

**Tunnel Configuration:**
- Tunnel ID: `d24aaaa0-5ef6-49ae-9099-44bbf6bca00a`
- Domain: `iz.salsven.com`
- Target: `http://192.168.3.2:3000` (Traefik will handle this internally)

## Post-Deployment

### Verify Application

1. Visit https://iz.salsven.com
2. Sign in with Microsoft
3. Test key features:
   - Email loading
   - Calendar connection
   - Unsubscribe
   - Cold email blocker

### Monitor Logs

```bash
# All services
ssh user@192.168.3.2 'cd ~/docker/inbox-zero && docker compose logs -f'

# Just the app
ssh user@192.168.3.2 'cd ~/docker/inbox-zero && docker compose logs -f app'

# Postgres
ssh user@192.168.3.2 'cd ~/docker/inbox-zero && docker compose logs -f postgres'
```

### Restart Services

```bash
# Restart all
ssh user@192.168.3.2 'cd ~/docker/inbox-zero && docker compose restart'

# Restart just app
ssh user@192.168.3.2 'cd ~/docker/inbox-zero && docker compose restart app'
```

## Backup & Maintenance

### Database Backup

```bash
ssh user@192.168.3.2
cd ~/docker/inbox-zero
docker compose exec postgres pg_dump -U inboxzero inboxzero > backup-$(date +%Y%m%d).sql
```

### Update Application

```bash
# Rebuild and restart
ssh user@192.168.3.2
cd ~/docker/inbox-zero
docker compose down
docker compose build --build-arg NEXT_PUBLIC_BASE_URL=https://iz.salsven.com
docker compose up -d
docker compose exec app pnpm --filter=web prisma migrate deploy
```

## Troubleshooting

### Application won't start

```bash
# Check logs
docker compose logs app

# Check if postgres is ready
docker compose ps postgres

# Restart services
docker compose restart
```

### Database connection errors

```bash
# Verify postgres is running
docker compose exec postgres psql -U inboxzero -c "SELECT 1"

# Check DATABASE_URL in .env
cat .env | grep DATABASE_URL
```

### SSL/TLS certificate issues

- Check Traefik logs on the host
- Verify DNS points to correct Cloudflare tunnel
- Ensure `traefik-network` exists and app is connected

## Security Notes

- Change default Postgres password in `.env`
- Generate new encryption keys for production (don't reuse dev keys)
- Regularly update Docker images
- Monitor logs for suspicious activity
- Set up automated backups

## Support

- Logs: `docker compose logs -f`
- Status: `docker compose ps`
- Interactive shell: `docker compose exec app sh`
