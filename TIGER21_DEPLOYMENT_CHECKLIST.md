# TIGER 21 Inbox Zero - Deployment Checklist

**Production URL**: https://iz.tiger21.com  
**Last Updated**: December 16, 2025  
**Status**: ✅ COMPLETE - All tasks finished

## ✅ Completed Tasks

### 1. Health Monitoring Script ✅

- **File**: `scripts/tiger21-health-monitor.sh`
- **Features**:
  - Comprehensive health checks (DNS, SSL, app health, response time, Docker services, server resources, logs)
  - Multiple output formats (human-readable, JSON, verbose)
  - Alert mode for automation
  - Performance metrics and thresholds
- **Usage**:
  ```bash
  ./scripts/tiger21-health-monitor.sh --verbose
  ./scripts/tiger21-health-monitor.sh --json
  ./scripts/tiger21-health-monitor.sh --alert  # For monitoring systems
  ```

### 2. Deployment Documentation ✅

- **File**: `TIGER21_DEPLOYMENT_GUIDE.md`
- **Contents**:
  - Complete architecture overview
  - Step-by-step deployment procedures
  - Configuration management
  - Comprehensive troubleshooting guide
  - Security considerations
  - Backup and recovery procedures
  - Maintenance schedules
- **Sections**: 9 major sections with detailed procedures

### 3. Docker Cleanup Scripts ✅

- **File**: `scripts/tiger21-cleanup.sh`
- **Features**:
  - Safe and aggressive cleanup modes
  - Local and remote cleanup options
  - Dry-run mode for testing
  - Disk space monitoring
  - Automatic old image removal (keeps 5 most recent)
- **Usage**:
  ```bash
  ./scripts/tiger21-cleanup.sh --dry-run     # Preview cleanup
  ./scripts/tiger21-cleanup.sh              # Safe cleanup
  ./scripts/tiger21-cleanup.sh --aggressive # Deep cleanup
  ```

### 4. SSO Testing Instructions ✅

- **File**: `TIGER21_SSO_TESTING_GUIDE.md`
- **Contents**:
  - Complete SSO testing procedures
  - 6 comprehensive test scenarios
  - Cross-browser/device testing matrix
  - Error handling verification
  - Performance testing guidelines
  - Troubleshooting guide
  - Security considerations
  - Test results template

### 5. Quick Reference Documentation ✅

- **File**: `TIGER21_QUICK_REFERENCE.md` (Updated)
- **Features**:
  - Essential commands for daily operations
  - Troubleshooting quick fixes
  - Performance targets
  - Emergency contacts
  - Maintenance schedules

## 📋 Original Deployment Verification (COMPLETED)

### Pre-Deployment ✅

- [x] Repository setup at https://github.com/salja03-t21/inbox-zero
- [x] Health monitoring script created and tested
- [x] Cleanup scripts created and tested
- [x] Documentation completed
- [x] SSO testing guide prepared
- [x] All scripts are executable

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
