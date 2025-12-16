# TIGER 21 Inbox Zero - Quick Reference Card

**Production URL**: https://iz.tiger21.com  
**Server**: 167.99.116.99  
**Last Updated**: December 16, 2025

## 🚀 Quick Commands

### Health Check

```bash
./scripts/tiger21-health-monitor.sh --verbose
```

### Deploy Latest Changes

```bash
git checkout production && git pull && ./deploy-tiger21.sh
```

### Emergency Restart

```bash
ssh root@167.99.116.99 'docker service scale inbox-zero-tiger21_app=0 && sleep 5 && docker service scale inbox-zero-tiger21_app=2'
```

### View Logs

```bash
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app -f --tail 50'
```

### Cleanup Docker Images

```bash
./scripts/tiger21-cleanup.sh --dry-run  # Preview
./scripts/tiger21-cleanup.sh            # Execute
```

## 🔍 Monitoring URLs

- **Application**: https://iz.tiger21.com
- **Health Check**: https://iz.tiger21.com/api/health/simple
- **SSO Metadata**: https://iz.tiger21.com/api/sso/metadata

## 📊 Service Status

```bash
# Quick service check
ssh root@167.99.116.99 'docker service ls | grep inbox-zero'

# Expected output:
# inbox-zero-tiger21_app                 2/2
# inbox-zero-tiger21_inngest             1/1
# inbox-zero-tiger21_redis               1/1
# inbox-zero-tiger21_serverless-redis-http 1/1
```

## 🛠️ Troubleshooting

### Common Issues

| Issue                         | Quick Fix                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Services showing 0/X replicas | `docker service scale inbox-zero-tiger21_app=0 && sleep 5 && docker service scale inbox-zero-tiger21_app=2`         |
| Inngest failing               | `docker service scale inbox-zero-tiger21_inngest=0 && sleep 5 && docker service scale inbox-zero-tiger21_inngest=1` |
| SSL certificate issues        | Check Cloudflare and Traefik configuration                                                                          |
| Database connection errors    | Verify DATABASE_URL and check DigitalOcean database status                                                          |
| SSO login failures            | Check Okta app assignment and SAML configuration                                                                    |

### Log Analysis

```bash
# Application errors
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i error | tail -20'

# SSO issues
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i sso | tail -20'

# Performance issues
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i timeout | tail -20'
```

## 📁 Important Files

### Local Development

- `docker-compose.tiger21.yml` - Service configuration
- `.env.tiger21.example` - Environment template
- `deploy-tiger21.sh` - Deployment script
- `scripts/tiger21-health-monitor.sh` - Health monitoring
- `scripts/tiger21-cleanup.sh` - Cleanup script

### Production Server

- `/root/IT-Configs/docker_swarm/inbox-zero/.env.tiger21` - Environment variables
- `/root/IT-Configs/docker_swarm/inbox-zero/docker-compose.tiger21.yml` - Stack config
- `/mnt/inbox-zero-tiger21/` - Persistent data volumes

## 🔐 Security Checklist

- [ ] Only TIGER 21 email domains can register
- [ ] Microsoft OAuth is enabled, Google is disabled
- [ ] SSO authentication is working
- [ ] SSL certificate is valid and auto-renewing
- [ ] Database connections use SSL
- [ ] All secrets are properly configured

## 📞 Emergency Contacts

- **Technical Issues**: James Salmon (james.salmon@tiger21.com)
- **Infrastructure**: DigitalOcean Support
- **DNS/SSL**: Cloudflare Support
- **SSO Issues**: TIGER 21 Okta Admin

## 🔄 Deployment Checklist

Before deploying:

- [ ] On `production` branch
- [ ] `pnpm tsc --noEmit` passes
- [ ] All tests pass
- [ ] Environment variables updated if needed

After deploying:

- [ ] Health check passes
- [ ] All services running (4/4)
- [ ] SSO login works
- [ ] Application responds correctly
- [ ] No errors in logs

## 📈 Performance Targets

| Metric          | Target      | Command to Check                                 |
| --------------- | ----------- | ------------------------------------------------ |
| Response Time   | < 2 seconds | `curl -w "%{time_total}" https://iz.tiger21.com` |
| Service Uptime  | 99.9%       | `./scripts/tiger21-health-monitor.sh`            |
| Disk Usage      | < 80%       | `ssh root@167.99.116.99 'df -h'`                 |
| Memory Usage    | < 80%       | `ssh root@167.99.116.99 'free -h'`               |
| SSL Cert Expiry | > 30 days   | `./scripts/tiger21-health-monitor.sh --verbose`  |

## 🔧 Maintenance Schedule

### Weekly

- Run health monitoring script
- Check disk space and clean up if needed
- Review application logs for errors

### Monthly

- Update dependencies and security patches
- Review resource usage trends
- Test backup procedures

### Quarterly

- Rotate secrets and API keys
- Performance optimization review
- Disaster recovery testing

---

**For detailed information, see:**

- `TIGER21_DEPLOYMENT_GUIDE.md` - Complete deployment documentation
- `TIGER21_SSO_TESTING_GUIDE.md` - SSO testing procedures
- `TIGER21_STATUS.md` - Current deployment status

## 🚀 Legacy Commands (Still Valid)

### Deploy

```bash
# From local machine
./deploy-tiger21.sh
```

### Check Status

```bash
# SSH to server first
ssh root@167.99.116.99

# View services
docker stack services inbox-zero-tiger21

# View running tasks
docker stack ps inbox-zero-tiger21

# Detailed service info
docker service ls
```

### View Logs

```bash
# All app logs (streaming)
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
# Scale to 3 replicas
docker service scale inbox-zero-tiger21_app=3

# Scale back to 2
docker service scale inbox-zero-tiger21_app=2
```

### Update/Restart

```bash
# Update to latest image
docker service update --image ghcr.io/tiger21-llc/inbox-zero:latest inbox-zero-tiger21_app

# Force restart (recreate containers)
docker service update --force inbox-zero-tiger21_app
```

### Rollback

```bash
# Automatic rollback to previous version
docker service rollback inbox-zero-tiger21_app
```

### Database Operations

```bash
# Run migrations
docker exec $(docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_app --format '{{.ID}}' | head -n 1) \
  sh -c 'cd /app/apps/web && npx prisma migrate deploy'

# Backup database
docker exec $(docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_postgres --format '{{.ID}}' | head -n 1) \
  pg_dump -U inboxzero inboxzero > backup-$(date +%Y%m%d).sql

# Prisma Studio (local only, for debugging)
# Requires port forwarding: ssh -L 5555:localhost:5432 root@167.99.116.99
pnpm --filter=web prisma studio
```

### Resource Monitoring

```bash
# Real-time resource usage
docker stats

# Disk usage
df -h

# Volume usage
du -sh /mnt/inbox-zero-tiger21/*
```

## 🛑 Emergency Procedures

### Service Won't Start

```bash
# Check service status
docker service ps inbox-zero-tiger21_app --no-trunc

# View detailed logs
docker service logs inbox-zero-tiger21_app

# Check for errors
docker service inspect inbox-zero-tiger21_app
```

### Complete Stack Restart

```bash
# Remove stack
docker stack rm inbox-zero-tiger21

# Wait for cleanup (30-60 seconds)
docker stack ps inbox-zero-tiger21

# Redeploy
cd ~/IT-Configs/docker_swarm/inbox-zero
docker stack deploy --compose-file docker-compose.tiger21.yml inbox-zero-tiger21
```

### Rollback Deployment

```bash
# Option 1: Service rollback
docker service rollback inbox-zero-tiger21_app

# Option 2: Git rollback and redeploy
git log --oneline -10  # Find previous commit
git checkout <commit-hash>
./deploy-tiger21.sh
```

## 🔒 Security Checklist

- [ ] `.env.tiger21` exists on server with strong passwords
- [ ] `.env.tiger21` has correct permissions (600)
- [ ] `.env.tiger21` is NOT in git repository
- [ ] Cloudflare proxy enabled (orange cloud)
- [ ] SSL/TLS set to Full (strict)
- [ ] OAuth redirect URIs configured correctly
- [ ] All services healthy (no restart loops)

## 📊 Health Checks

### Application Health

```bash
# Via web
curl https://iz.tiger21.com/api/health

# Check all service health
docker service ps inbox-zero-tiger21
```

### Database Health

```bash
# Check postgres is responding
docker exec $(docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_postgres -q | head -n 1) \
  pg_isready -U inboxzero
```

### Redis Health

```bash
# Check redis is responding
docker exec $(docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_redis -q | head -n 1) \
  redis-cli ping
```

## 🔧 Troubleshooting

### Can't Access Website

1. Check DNS: `dig iz.tiger21.com`
2. Check Cloudflare proxy is enabled
3. Check Traefik is running: `docker service ls | grep traefik`
4. Check app service is healthy: `docker service ps inbox-zero-tiger21_app`
5. Check app logs: `docker service logs inbox-zero-tiger21_app`

### Database Connection Errors

1. Check postgres is running: `docker service ps inbox-zero-tiger21_postgres`
2. Check DATABASE_URL in `.env.tiger21`
3. Check network connectivity: `docker network inspect inbox-zero-tiger21_inbox-zero-network`
4. Check postgres logs: `docker service logs inbox-zero-tiger21_postgres`

### High Memory Usage

1. Check stats: `docker stats`
2. Review resource limits in `docker-compose.tiger21.yml`
3. Scale down if needed: `docker service scale inbox-zero-tiger21_app=1`
4. Check for memory leaks in logs

## 📞 Support Resources

- **Documentation**: See `TIGER21_DEPLOYMENT.md`
- **Checklist**: See `TIGER21_DEPLOYMENT_CHECKLIST.md`
- **Docker Swarm**: https://docs.docker.com/engine/swarm/
- **Traefik**: https://doc.traefik.io/traefik/
- **Next.js**: https://nextjs.org/docs

## 🔄 Maintenance Schedule

### Daily

- Check service status
- Review error logs

### Weekly

- Check disk space
- Review resource usage
- Monitor volume growth

### Monthly

- Update dependencies (test first!)
- Backup database
- Security audit
- Test restore procedure

## 📝 Quick Aliases

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
# TIGER 21 aliases
alias t21-ssh='ssh root@167.99.116.99'
alias t21-status='ssh root@167.99.116.99 "docker stack services inbox-zero-tiger21"'
alias t21-logs='ssh root@167.99.116.99 "docker service logs inbox-zero-tiger21_app -f"'
alias t21-ps='ssh root@167.99.116.99 "docker stack ps inbox-zero-tiger21"'
alias t21-deploy='./deploy-tiger21.sh'
```

---

**Remember**: This is TIGER 21 production. Always confirm before making changes!
