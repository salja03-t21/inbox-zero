# TIGER 21 Deployment Checklist

## Pre-Deployment Checklist

### 1. Repository Setup
- [ ] Create repository at https://github.com/TIGER21-LLC/inbox-zero
- [ ] Set repository to Private
- [ ] Add remote: `git remote add tiger21 https://github.com/TIGER21-LLC/inbox-zero.git`
- [ ] Push code: `git push tiger21 production`
- [ ] Verify files are committed (should NOT include .env.tiger21)

### 2. Server Prerequisites (167.99.116.99)
- [ ] Docker installed
- [ ] Docker Swarm initialized: `docker swarm init`
- [ ] Traefik network created: `docker network create --driver=overlay traefik-public`
- [ ] Traefik service running and accessible
- [ ] Volume directories created: `mkdir -p /mnt/inbox-zero-tiger21/{postgres,redis,app-data}`

### 3. Cloudflare Configuration
- [ ] DNS A record created: `iz.tiger21.com` → `167.99.116.99`
- [ ] Proxy status: Enabled (orange cloud)
- [ ] SSL/TLS mode: Full (strict)
- [ ] Always Use HTTPS: Enabled
- [ ] Minimum TLS Version: 1.2

### 4. Server Setup
- [ ] SSH access verified: `ssh root@167.99.116.99`
- [ ] Code cloned to: `~/IT-Configs/docker_swarm/inbox-zero`
- [ ] `.env.tiger21` file created from template
- [ ] All credentials filled in `.env.tiger21`
- [ ] File permissions secured: `chmod 600 .env.tiger21`

### 5. OAuth Configuration
- [ ] Google OAuth redirect URI: `https://iz.tiger21.com/api/auth/callback/google`
- [ ] Microsoft OAuth redirect URI: `https://iz.tiger21.com/api/auth/callback/microsoft`
- [ ] Credentials added to `.env.tiger21`

## Deployment Checklist

### Pre-Deployment
- [ ] Local repository is clean: `git status`
- [ ] On production branch: `git branch --show-current`
- [ ] All changes committed and pushed
- [ ] Type check passed: `pnpm tsc --noEmit`

### Deployment
- [ ] Run deployment script: `./deploy-tiger21.sh`
- [ ] Verify script completes without errors
- [ ] Check services are running: `docker stack services inbox-zero-tiger21`
- [ ] Verify 2+ replicas for app service

### Post-Deployment Verification
- [ ] Website accessible at https://iz.tiger21.com
- [ ] SSL certificate valid (Cloudflare)
- [ ] All services healthy: `docker stack ps inbox-zero-tiger21`
- [ ] App logs show no errors: `docker service logs inbox-zero-tiger21_app`
- [ ] Database connected (check logs)
- [ ] Redis connected (check logs)
- [ ] Inngest running (check logs)

### Functional Testing
- [ ] Home page loads correctly
- [ ] Can access sign-in page
- [ ] Google OAuth flow works
- [ ] Microsoft OAuth flow works
- [ ] Can load email list
- [ ] Can perform basic email actions
- [ ] Background jobs processing (check Inngest)

## Monitoring Setup (Optional but Recommended)

### Health Checks
- [ ] Configure uptime monitoring (e.g., UptimeRobot, Pingdom)
- [ ] Monitor: https://iz.tiger21.com/api/health
- [ ] Set up alerts for downtime

### Log Aggregation
- [ ] Consider setting up log shipping (e.g., to Papertrail, Logtail)
- [ ] Monitor error rates

### Metrics
- [ ] Configure Sentry for error tracking (optional)
- [ ] Set up PostHog for analytics (optional)

## Security Checklist

### Secrets Management
- [ ] `.env.tiger21` contains strong passwords (min 32 chars)
- [ ] `.env.tiger21` has correct file permissions (600)
- [ ] `.env.tiger21` is NOT in git repository
- [ ] All API keys are production keys (not dev/test)
- [ ] Secrets rotated from any previous installations

### Network Security
- [ ] Cloudflare proxy enabled (DDoS protection)
- [ ] SSL/TLS enforced (no HTTP access)
- [ ] Database not exposed to internet (Docker network only)
- [ ] Redis not exposed to internet (Docker network only)

### Container Security
- [ ] Containers running as non-root user
- [ ] Security updates applied in Dockerfile
- [ ] Resource limits configured
- [ ] Health checks enabled

## Maintenance Checklist

### Daily
- [ ] Check service status: `docker stack ps inbox-zero-tiger21`
- [ ] Review logs for errors

### Weekly
- [ ] Check disk space: `df -h`
- [ ] Review volume usage: `du -sh /mnt/inbox-zero-tiger21/*`
- [ ] Check resource usage: `docker stats`

### Monthly
- [ ] Update dependencies (test thoroughly first)
- [ ] Review and rotate API keys if needed
- [ ] Test backup restoration process
- [ ] Security audit

## Rollback Procedure

If deployment fails:

1. **Immediate Rollback**
   ```bash
   docker service rollback inbox-zero-tiger21_app
   ```

2. **Or Redeploy Previous Version**
   ```bash
   git checkout <previous-commit>
   ./deploy-tiger21.sh
   ```

3. **Verify Rollback**
   ```bash
   docker stack services inbox-zero-tiger21
   docker service logs inbox-zero-tiger21_app
   ```

## Emergency Contacts

- Server Provider: DigitalOcean Support
- DNS Provider: Cloudflare Support
- Domain Admin: [Add contact info]
- Dev Team: [Add contact info]

## Useful Commands Quick Reference

```bash
# Check stack status
docker stack services inbox-zero-tiger21

# View logs
docker service logs inbox-zero-tiger21_app -f

# Scale services
docker service scale inbox-zero-tiger21_app=3

# Update service
docker service update --force inbox-zero-tiger21_app

# Restart service
docker service update --force inbox-zero-tiger21_app

# Remove stack (⚠️ DANGER)
docker stack rm inbox-zero-tiger21
```
