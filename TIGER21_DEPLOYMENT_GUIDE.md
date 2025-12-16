# TIGER 21 Inbox Zero - Deployment Guide & Troubleshooting

**Production URL**: https://iz.tiger21.com  
**Server**: 167.99.116.99 (DigitalOcean Swarm)  
**Repository**: salja03-t21/inbox-zero (fork)  
**Last Updated**: December 16, 2025

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Architecture Overview](#architecture-overview)
3. [Deployment Process](#deployment-process)
4. [Configuration Management](#configuration-management)
5. [Monitoring & Health Checks](#monitoring--health-checks)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Maintenance Procedures](#maintenance-procedures)
8. [Security Considerations](#security-considerations)
9. [Backup & Recovery](#backup--recovery)

## Quick Reference

### Essential Commands

```bash
# Health check
./scripts/tiger21-health-monitor.sh --verbose

# Deploy latest changes
./deploy-tiger21.sh

# Check service status
ssh root@167.99.116.99 'docker service ls | grep inbox-zero'

# View logs
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app -f'

# Emergency restart
ssh root@167.99.116.99 'docker service scale inbox-zero-tiger21_app=0 && sleep 5 && docker service scale inbox-zero-tiger21_app=2'
```

### Key URLs

- **Application**: https://iz.tiger21.com
- **Health Check**: https://iz.tiger21.com/api/health/simple
- **Traefik Dashboard**: https://traefik.tiger21.com (if enabled)

### Important Files

- **Local Config**: `docker-compose.tiger21.yml`
- **Server Config**: `/root/IT-Configs/docker_swarm/inbox-zero/`
- **Environment**: `/root/IT-Configs/docker_swarm/inbox-zero/.env.tiger21`

## Architecture Overview

### Infrastructure Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare (DNS + CDN)                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  DigitalOcean Load Balancer                │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│              Docker Swarm (3 Manager Nodes)                │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│  │ Node 01 (SSH)   │ │ Node 02         │ │ Node 03         │ │
│  │ 167.99.116.99   │ │ 104.236.232.69  │ │ 159.65.188.58   │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    Traefik Proxy                       │ │
│  │              (SSL Termination)                         │ │
│  └─────────────────────┬───────────────────────────────────┘ │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────────┐ │
│  │              Inbox Zero Services                       │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │ │
│  │  │ App (x2)    │ │ Inngest     │ │ Redis       │       │ │
│  │  │ Next.js     │ │ Jobs        │ │ Cache       │       │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘       │ │
│  │  ┌─────────────┐                                       │ │
│  │  │ Redis HTTP  │                                       │ │
│  │  │ Proxy       │                                       │ │
│  │  └─────────────┘                                       │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│            DigitalOcean Managed PostgreSQL                 │
│         db-postgres-do-user-13034382-0.b.db...             │
└─────────────────────────────────────────────────────────────┘
```

### Service Components

| Service                 | Replicas | Purpose                   | Resources          |
| ----------------------- | -------- | ------------------------- | ------------------ |
| `app`                   | 2        | Next.js application       | 4GB RAM, 2 CPU     |
| `inngest`               | 1        | Background job processor  | 8GB RAM, 2 CPU     |
| `redis`                 | 1        | Cache and session storage | 512MB RAM, 0.5 CPU |
| `serverless-redis-http` | 1        | Redis HTTP API proxy      | 2GB RAM, 1 CPU     |

### Network Configuration

- **External Network**: `traefik-network` (connects to Traefik proxy)
- **Internal Network**: `inbox-zero-network` (service communication)
- **Session Affinity**: Enabled for OAuth state consistency
- **Health Checks**: All services have health monitoring

## Deployment Process

### Prerequisites

1. **Local Environment**:

   ```bash
   cd /Users/jamessalmon/WebstormProjects/inbox-zero
   git checkout production
   git pull origin production
   ```

2. **Server Access**:

   ```bash
   ssh root@167.99.116.99
   ```

3. **Docker Registry Access**:
   - GitHub Container Registry: `ghcr.io/tiger21-llc/inbox-zero`
   - Authentication handled by deploy script

### Standard Deployment

```bash
# 1. Ensure you're on the production branch
git branch --show-current  # Should show 'production'

# 2. Run type check (critical - Docker doesn't validate TypeScript)
pnpm tsc --noEmit

# 3. Deploy
./deploy-tiger21.sh
```

### Manual Deployment Steps

If the automated script fails, you can deploy manually:

```bash
# 1. Build and push image
docker buildx build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_BASE_URL=https://iz.tiger21.com \
  -f docker/Dockerfile.tiger21.prod \
  -t ghcr.io/tiger21-llc/inbox-zero:latest \
  --push .

# 2. Update stack on server
ssh root@167.99.116.99 'cd ~/IT-Configs/docker_swarm/inbox-zero && \
  docker compose --env-file .env.tiger21 -f docker-compose.tiger21.yml config | \
  sed "/^name:/d" | sed -E "s/(cpus:) ([0-9.]+)/\1 \"\2\"/" | \
  docker stack deploy --with-registry-auth --resolve-image always -c - inbox-zero-tiger21'
```

### Rollback Procedure

```bash
# 1. Find previous working image
ssh root@167.99.116.99 'docker service inspect inbox-zero-tiger21_app --format "{{.Spec.TaskTemplate.ContainerSpec.Image}}"'

# 2. Update to specific image
ssh root@167.99.116.99 'docker service update --image ghcr.io/tiger21-llc/inbox-zero:PREVIOUS_TAG inbox-zero-tiger21_app'
```

## Configuration Management

### Environment Variables

The application uses a comprehensive set of environment variables. Key categories:

#### Authentication & Security

```bash
# Core authentication
BETTER_AUTH_SECRET=<32+ character secret>
BETTER_AUTH_URL=https://iz.tiger21.com
AUTH_SECRET=<32+ character secret>

# Access control
ALLOWED_EMAIL_DOMAINS=tiger21.com,tiger21chair.com
ENABLE_GOOGLE_AUTH=false
ENABLE_MICROSOFT_AUTH=true
ENABLE_SSO_AUTH=true

# Encryption
EMAIL_ENCRYPT_SECRET=<64 character hex>
EMAIL_ENCRYPT_SALT=<32 character hex>
```

#### Microsoft OAuth (Required)

```bash
MICROSOFT_CLIENT_ID=d5886e83-a14e-4213-8615-74d2146e318f
MICROSOFT_CLIENT_SECRET=<from Azure AD>
MICROSOFT_TENANT_ID=89f2f6c3-aa52-4af9-953e-02a633d0da4d
```

#### Database & Infrastructure

```bash
DATABASE_URL=postgresql://inbox_zero_user:...@db-postgres-do-user-13034382-0.b.db.ondigitalocean.com:25060/inbox-zero?sslmode=require
DIRECT_URL=<same as DATABASE_URL>
REDIS_URL=redis://redis:6379
UPSTASH_REDIS_URL=http://serverless-redis-http:80
```

#### Background Jobs

```bash
INNGEST_EVENT_KEY=<secure key>
INNGEST_SIGNING_KEY=<secure key>
INNGEST_BASE_URL=http://inngest:8288
INNGEST_DEV=1
```

### Configuration Files

#### `docker-compose.tiger21.yml`

- Service definitions and resource limits
- Network configuration
- Volume mounts
- Health check definitions
- Traefik labels for routing

#### `.env.tiger21` (Server Only)

- Contains all sensitive environment variables
- Located at `/root/IT-Configs/docker_swarm/inbox-zero/.env.tiger21`
- **Never commit to git** - use `.env.tiger21.example` as template

## Monitoring & Health Checks

### Automated Health Monitoring

Use the provided health monitoring script:

```bash
# Basic health check
./scripts/tiger21-health-monitor.sh

# Verbose output with details
./scripts/tiger21-health-monitor.sh --verbose

# JSON output for automation
./scripts/tiger21-health-monitor.sh --json

# Alert mode (exits with error code if issues found)
./scripts/tiger21-health-monitor.sh --alert
```

### Manual Health Checks

#### Application Health

```bash
# Quick health check
curl https://iz.tiger21.com/api/health/simple

# Detailed health check
curl https://iz.tiger21.com/api/health
```

#### Service Status

```bash
# List all services
ssh root@167.99.116.99 'docker service ls | grep inbox-zero'

# Check specific service
ssh root@167.99.116.99 'docker service ps inbox-zero-tiger21_app'

# Service logs
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app --tail 50'
```

#### Resource Monitoring

```bash
# Server resources
ssh root@167.99.116.99 'df -h && free -h && uptime'

# Docker stats
ssh root@167.99.116.99 'docker stats --no-stream'
```

### Key Metrics to Monitor

1. **Application Response Time**: < 2 seconds
2. **Service Replicas**: All services should show X/X (not 0/X)
3. **Memory Usage**: < 80% on server
4. **Disk Usage**: < 80% on server
5. **SSL Certificate**: > 30 days until expiry
6. **Error Logs**: < 5 errors per 10 minutes

## Troubleshooting Guide

### Common Issues

#### 1. Services Showing 0/X Replicas

**Symptoms**: `docker service ls` shows services with 0 running replicas

**Diagnosis**:

```bash
# Check service status
ssh root@167.99.116.99 'docker service ps inbox-zero-tiger21_app --no-trunc'

# Check node availability
ssh root@167.99.116.99 'docker node ls'
```

**Solutions**:

```bash
# Force service restart
ssh root@167.99.116.99 'docker service scale inbox-zero-tiger21_app=0'
sleep 10
ssh root@167.99.116.99 'docker service scale inbox-zero-tiger21_app=2'

# If persistent, check logs
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app --tail 100'
```

#### 2. Inngest Service Failing

**Symptoms**: Background jobs not processing, Inngest service restarting

**Diagnosis**:

```bash
# Check Inngest logs
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_inngest --tail 50'

# Common error: "signing-key is required"
```

**Solutions**:

```bash
# Verify environment variables
ssh root@167.99.116.99 'cd ~/IT-Configs/docker_swarm/inbox-zero && grep INNGEST .env.tiger21'

# Restart Inngest service
ssh root@167.99.116.99 'docker service scale inbox-zero-tiger21_inngest=0 && sleep 5 && docker service scale inbox-zero-tiger21_inngest=1'
```

#### 3. SSL Certificate Issues

**Symptoms**: Browser shows SSL warnings, certificate expired

**Diagnosis**:

```bash
# Check certificate expiry
echo | openssl s_client -servername iz.tiger21.com -connect iz.tiger21.com:443 2>/dev/null | openssl x509 -noout -dates
```

**Solutions**:

```bash
# Traefik should auto-renew via Cloudflare
# If not working, restart Traefik
ssh root@167.99.116.99 'docker service scale traefik_traefik=0 && sleep 5 && docker service scale traefik_traefik=1'
```

#### 4. Database Connection Issues

**Symptoms**: Application errors about database connections

**Diagnosis**:

```bash
# Test database connection from server
ssh root@167.99.116.99 'docker run --rm postgres:15 psql "postgresql://inbox_zero_user:PASSWORD@db-postgres-do-user-13034382-0.b.db.ondigitalocean.com:25060/inbox-zero?sslmode=require" -c "SELECT 1;"'
```

**Solutions**:

- Check DigitalOcean database status in control panel
- Verify DATABASE_URL in environment file
- Check firewall rules (should allow swarm nodes)

#### 5. OAuth/SSO Login Issues

**Symptoms**: Users can't log in, OAuth errors

**Diagnosis**:

```bash
# Check application logs for OAuth errors
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i oauth'

# Verify redirect URIs in Azure AD match:
# - https://iz.tiger21.com/api/auth/callback/microsoft
# - https://iz.tiger21.com/api/outlook/linking/callback
# - https://iz.tiger21.com/api/outlook/calendar/callback
```

**Solutions**:

- Verify MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID
- Check Azure AD app registration configuration
- Ensure session affinity is working (sticky sessions)

#### 6. High Memory Usage

**Symptoms**: Server running out of memory, services being killed

**Diagnosis**:

```bash
# Check memory usage
ssh root@167.99.116.99 'free -h && docker stats --no-stream'

# Check for memory leaks in logs
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i "out of memory\|oom"'
```

**Solutions**:

```bash
# Restart high-memory services
ssh root@167.99.116.99 'docker service scale inbox-zero-tiger21_inngest=0 && sleep 5 && docker service scale inbox-zero-tiger21_inngest=1'

# Reduce Inngest workers if needed (edit docker-compose.tiger21.yml)
# Change: --queue-workers 50 to --queue-workers 25
```

### Emergency Procedures

#### Complete Service Restart

```bash
# Stop all services
ssh root@167.99.116.99 'docker stack rm inbox-zero-tiger21'

# Wait for cleanup
sleep 30

# Redeploy
ssh root@167.99.116.99 'cd ~/IT-Configs/docker_swarm/inbox-zero && \
  docker compose --env-file .env.tiger21 -f docker-compose.tiger21.yml config | \
  sed "/^name:/d" | sed -E "s/(cpus:) ([0-9.]+)/\1 \"\2\"/" | \
  docker stack deploy --with-registry-auth --resolve-image always -c - inbox-zero-tiger21'
```

#### Database Emergency Access

```bash
# Connect to database directly
ssh root@167.99.116.99
docker run -it --rm postgres:15 psql "postgresql://inbox_zero_user:PASSWORD@db-postgres-do-user-13034382-0.b.db.ondigitalocean.com:25060/inbox-zero?sslmode=require"
```

## Maintenance Procedures

### Regular Maintenance Tasks

#### Weekly

- [ ] Run health monitoring script
- [ ] Check disk space and clean up old Docker images
- [ ] Review application logs for errors
- [ ] Verify SSL certificate status

#### Monthly

- [ ] Update dependencies and security patches
- [ ] Review resource usage trends
- [ ] Test backup and restore procedures
- [ ] Update documentation

#### Quarterly

- [ ] Review and rotate secrets
- [ ] Performance optimization review
- [ ] Disaster recovery testing
- [ ] Security audit

### Docker Image Cleanup

```bash
# Remove unused images (run on server)
ssh root@167.99.116.99 'docker image prune -f'

# Remove old inbox-zero images (keep last 5)
ssh root@167.99.116.99 'docker images ghcr.io/tiger21-llc/inbox-zero --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}" | tail -n +2 | sort -k2 -r | tail -n +6 | awk "{print \$3}" | xargs -r docker rmi'
```

### Database Maintenance

```bash
# Run from local machine with database access
cd /Users/jamessalmon/WebstormProjects/inbox-zero/apps/web

# Check migration status
DATABASE_URL="..." npx prisma migrate status

# Apply pending migrations
DATABASE_URL="..." npx prisma migrate deploy

# Generate fresh Prisma client (if schema changed)
npx prisma generate
```

## Security Considerations

### Access Control

1. **Email Domain Restriction**: Only `tiger21.com` and `tiger21chair.com` emails can register
2. **OAuth Only**: Google authentication disabled, Microsoft OAuth required
3. **Admin Controls**: Knowledge extraction limits for non-admin users

### Network Security

1. **SSL/TLS**: All traffic encrypted via Cloudflare and Traefik
2. **Internal Networks**: Services communicate on isolated Docker networks
3. **Firewall**: DigitalOcean firewall restricts access to necessary ports only

### Data Protection

1. **Email Encryption**: All stored emails encrypted with AES-256
2. **Database**: Managed PostgreSQL with SSL connections required
3. **Secrets Management**: Environment variables stored securely on server

### Security Monitoring

```bash
# Check for failed login attempts
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i "failed\|unauthorized\|forbidden"'

# Monitor for suspicious activity
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i "attack\|exploit\|injection"'
```

## Backup & Recovery

### Database Backups

DigitalOcean provides automated backups for the managed PostgreSQL instance:

- **Daily backups**: Retained for 7 days
- **Weekly backups**: Retained for 4 weeks
- **Point-in-time recovery**: Available for last 7 days

### Manual Database Backup

```bash
# Create manual backup
ssh root@167.99.116.99 'docker run --rm postgres:15 pg_dump "postgresql://inbox_zero_user:PASSWORD@db-postgres-do-user-13034382-0.b.db.ondigitalocean.com:25060/inbox-zero?sslmode=require" > /mnt/inbox-zero-tiger21/backup-$(date +%Y%m%d-%H%M%S).sql'
```

### Configuration Backups

```bash
# Backup configuration files
ssh root@167.99.116.99 'cd ~/IT-Configs/docker_swarm/inbox-zero && tar -czf /mnt/inbox-zero-tiger21/config-backup-$(date +%Y%m%d).tar.gz .'
```

### Recovery Procedures

#### Application Recovery

1. Redeploy from last known good image
2. Restore configuration from backup
3. Verify all services are healthy

#### Database Recovery

1. Contact DigitalOcean support for point-in-time recovery
2. Or restore from manual backup:
   ```bash
   ssh root@167.99.116.99 'docker run --rm -i postgres:15 psql "postgresql://inbox_zero_user:PASSWORD@db-postgres-do-user-13034382-0.b.db.ondigitalocean.com:25060/inbox-zero?sslmode=require" < /mnt/inbox-zero-tiger21/backup-TIMESTAMP.sql'
   ```

---

## Support Contacts

- **Technical Issues**: James Salmon (james.salmon@tiger21.com)
- **Infrastructure**: DigitalOcean Support
- **DNS/CDN**: Cloudflare Support
- **Application**: Inbox Zero Community (GitHub Issues)

## Additional Resources

- **Project Documentation**: `Warp.md`
- **Development Guidelines**: `CLAUDE.md`
- **Feature Documentation**: `.cursor/rules/features/`
- **Health Monitoring**: `./scripts/tiger21-health-monitor.sh`
- **Cleanup Scripts**: `./scripts/tiger21-cleanup.sh`
