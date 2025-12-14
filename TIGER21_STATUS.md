# TIGER 21 Inbox Zero Deployment - Current Status

**Last Updated**: December 14, 2025
**Production URL**: https://iz.tiger21.com
**Server**: 167.99.116.99 (DigitalOcean Swarm)
**Repository**: salja03-t21/inbox-zero (fork)
**Branch**: production

## Deployment Status: ✅ FULLY OPERATIONAL

### Services Running (4/4)
- ✅ inbox-zero-tiger21_app (2 replicas) - Next.js application
- ✅ inbox-zero-tiger21_inngest (1 replica) - Background job processor  
- ✅ inbox-zero-tiger21_redis (1 replica) - Cache
- ✅ inbox-zero-tiger21_serverless-redis-http (1 replica) - Redis HTTP API

### Infrastructure
- **Docker Swarm**: 3-node cluster (all managers)
  - Node 01: 167.99.116.99 (primary - SSH accessible)
  - Node 02: 104.236.232.69
  - Node 03: 159.65.188.58
- **Database**: DigitalOcean Managed PostgreSQL
  - Host: db-postgres-do-user-13034382-0.b.db.ondigitalocean.com:25060
  - Database: inbox-zero
  - User: inbox_zero_user
  - All 148 Prisma migrations applied ✅
- **Volumes**: /mnt/nfs/inbox-zero (NFS storage)
- **Proxy**: Traefik with SSL
- **Domain**: iz.tiger21.com (Cloudflare DNS)

### Recent Changes & Fixes

#### Security Updates (Dec 14, 2025)
- ✅ **Critical**: Next.js updated from 15.5.6 → 15.5.7 (fixes RCE vulnerability)
- ✅ Updated @modelcontextprotocol/sdk to 1.24.0+ (DNS rebinding protection)
- ✅ Updated glob and valibot packages (security patches)
- ✅ All vulnerabilities patched, production secure

#### Application Fixes
1. **Inngest Service** - Fixed health check configuration
   - Changed from `wget` to `curl`
   - Increased interval: 10s → 30s
   - Increased start_period: 30s → 40s
   - Increased memory: 1GB → 8GB
   - Reduced queue workers: 100 → 50

2. **Next.js 15.5 Server-Side Fetch Fix**
   - Added `NEXTAUTH_URL=http://localhost:3000` environment variable
   - Resolved "fetch failed" errors in Rules and internal APIs

3. **Calendar Integration**
   - Added Microsoft OAuth redirect URIs to Azure AD:
     - https://iz.tiger21.com/api/outlook/calendar/callback
     - https://iz.tiger21.com/api/outlook/linking/callback
     - https://iz.tiger21.com/api/auth/callback/microsoft
   - Calendar connection working ✅

4. **Knowledge Extraction**
   - Limited non-admin users to 90 days (3 months) maximum
   - Admin users retain full access (up to 2 years)
   - Added isAdmin field to email accounts API
   - Prevents timeouts for regular users

5. **UI Improvements**
   - Fixed digest items dropdown scrolling
   - Increased dropdown width: 200px → 250px
   - Increased max height: 300px → 400px

### Configuration Files

#### Server: /root/IT-Configs/docker_swarm/inbox-zero/
- `docker-compose.tiger21.yml` - Stack configuration
- `.env.tiger21` - Environment variables (secrets)
- `deploy-tiger21.sh` - Deployment helper script

#### Repository: /Users/jamessalmon/WebstormProjects/inbox-zero/
- `docker-compose.tiger21.yml` - Source of truth for stack config
- `docker/Dockerfile.tiger21.prod` - Production Dockerfile
- `.env.tiger21.example` - Environment template

### Key Environment Variables
```bash
NEXT_PUBLIC_BASE_URL=https://iz.tiger21.com
NEXTAUTH_URL=http://localhost:3000  # For internal API calls
DATABASE_URL=postgresql://inbox_zero_user:...
INNGEST_BASE_URL=http://inngest:8288
INNGEST_SIGNING_KEY=be773fac5fdb8b170f5c4579b4ea61713d8600f29f01283fab79ff7e21278f1f
MICROSOFT_CLIENT_ID=d5886e83-a14e-4213-8615-74d2146e318f
MICROSOFT_TENANT_ID=89f2f6c3-aa52-4af9-953e-02a633d0da4d
```

### Deployment Commands

#### Deploy to Production
```bash
cd /Users/jamessalmon/WebstormProjects/inbox-zero
./deploy-tiger21.sh
```

#### Manual Stack Update (without rebuild)
```bash
ssh root@167.99.116.99
cd ~/IT-Configs/docker_swarm/inbox-zero
docker compose --env-file .env.tiger21 -f docker-compose.tiger21.yml config | \
  sed '/^name:/d' | sed -E 's/(cpus:) ([0-9.]+)/\1 "\2"/' | \
  docker stack deploy --with-registry-auth --resolve-image always -c - inbox-zero-tiger21
```

#### Database Migrations
```bash
# From local machine
cd /Users/jamessalmon/WebstormProjects/inbox-zero/apps/web
DATABASE_URL="..." DIRECT_URL="..." npx prisma migrate deploy
```

#### Useful Monitoring Commands
```bash
# Check services
ssh root@167.99.116.99 'docker service ls | grep inbox-zero'

# View logs
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app -f'
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_inngest -f'

# Check task status
ssh root@167.99.116.99 'docker stack ps inbox-zero-tiger21'

# Health check
curl https://iz.tiger21.com/api/health/simple
```

### Git Workflow

#### Branch Structure
- `main` - Mirrors upstream (elie222/inbox-zero) - NEVER deploy from here
- `feature/*` - Custom TIGER 21 features
- `production` - Integration branch (main + all features) - **DEPLOY FROM HERE**

#### Safety Rules
- ✅ Always deploy from `production` branch
- ✅ Always verify remote before commit: `git remote -v`
- ✅ Repository: origin = salja03-t21/inbox-zero (NOT upstream)
- ✅ Run `pnpm tsc --noEmit` before deploying
- ⚠️ NEVER commit to upstream (elie222/inbox-zero)
- ⚠️ NEVER destroy volumes without permission

### Known Issues & Workarounds

1. **Inngest Sometimes Shows 0/1 Replicas**
   - Auto-recovers within 1-2 minutes
   - If persistent, restart: `docker service scale inbox-zero-tiger21_inngest=0 && sleep 3 && docker service scale inbox-zero-tiger21_inngest=1`

2. **Knowledge Extraction Can Timeout**
   - First run may take 10-15 minutes for large email volumes
   - Job continues in background even if UI times out
   - Check KnowledgeExtractionJob table for status
   - Non-admins now limited to 90 days to prevent this

3. **Microsoft OAuth Re-consent Required**
   - Known issue: Microsoft users must re-consent on each login
   - Being tracked upstream

4. **Ultracite Linting Often Fails in Pre-commit**
   - Use `git commit --no-verify` if needed
   - Only for trusted changes

### Azure AD Configuration

**App Registration ID**: d5886e83-a14e-4213-8615-74d2146e318f

**Required Redirect URIs**:
- https://iz.tiger21.com/api/auth/callback/microsoft
- https://iz.tiger21.com/api/outlook/linking/callback  
- https://iz.tiger21.com/api/outlook/calendar/callback

**Required API Permissions** (Microsoft Graph Delegated):
- offline_access
- User.Read
- Mail.ReadWrite
- Mail.Send
- Calendars.ReadWrite

### Version Information
- Next.js: 15.5.7 (security patched)
- React: 19.1.1
- Node: 22-alpine
- PostgreSQL: Managed (v16+)
- Redis: 7-alpine
- Inngest: latest

### Testing User
- Email: james.salmon@tiger21.com
- Calendar: Connected ✅
- Knowledge: Enabled ✅
- Admin: Yes ✅

### Next Steps / Future Improvements
1. Consider moving to Next.js 16 (once MDX/Turbopack issues resolved)
2. Optimize Inngest memory usage
3. Add monitoring/alerting for service health
4. Document backup/restore procedures
5. Set up automated security scanning

### Important Files Modified
```
apps/web/next.config.ts - Added standalone output mode
docker/Dockerfile.tiger21.prod - Production build configuration  
docker-compose.tiger21.yml - Service definitions, health checks
apps/web/app/api/user/email-accounts/route.ts - Added isAdmin field
apps/web/app/(app)/[emailAccountId]/assistant/knowledge/AutoGenerateKnowledge.tsx - 3-month limit
apps/web/components/MultiSelectFilter.tsx - Scrollable dropdown
```

### Troubleshooting Resources
- CLAUDE.md - Development guidelines
- Warp.md - Comprehensive project documentation
- .cursor/rules/ - Feature-specific context
- Serena MCP - Code navigation and memory

---

**Status**: PRODUCTION READY ✅
**Last Successful Deployment**: December 14, 2025
**Deployed By**: Claude/James Salmon
**Commit**: d57fdd482 (production branch)
