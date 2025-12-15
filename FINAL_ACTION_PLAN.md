# Final Action Plan - TIGER 21 Deployment

## Current Status: ✅ ALL PREPARATION COMPLETE

All code, configuration, and documentation has been created and committed. You now have everything ready to deploy to TIGER 21.

---

## 🎯 Immediate Next Steps

### Step 1: Create TIGER21-LLC GitHub Repository

**Via GitHub Web Interface:**

1. Go to: https://github.com/organizations/TIGER21-LLC/repositories/new
2. Fill in:
   - **Repository name**: `inbox-zero`
   - **Description**: `AI-powered email assistant for TIGER 21`
   - **Visibility**: **Private** ✅ (recommended for production)
   - **Initialize**: ❌ Do NOT check any initialization options
3. Click **Create repository**

**Or via GitHub CLI:**
```bash
gh repo create TIGER21-LLC/inbox-zero --private
```

### Step 2: Add TIGER21-LLC Remote

```bash
cd /Users/jamessalmon/WebstormProjects/inbox-zero
git remote add tiger21 https://github.com/TIGER21-LLC/inbox-zero.git
```

Verify:
```bash
git remote -v
# Should show:
# tiger21  https://github.com/TIGER21-LLC/inbox-zero.git (fetch)
# tiger21  https://github.com/TIGER21-LLC/inbox-zero.git (push)
```

### Step 3: Push Clean Repository to TIGER21-LLC

```bash
git push tiger21 tiger21-clean:main
```

This pushes the `tiger21-clean` branch as `main` on TIGER21-LLC/inbox-zero.

**Result:**
- ✅ Clean repository with 1 commit
- ✅ No upstream history
- ✅ All TIGER 21 files included
- ✅ No CodeRabbit or AI review tools
- ✅ Ready for deployment

### Step 4: Set Default Branch on GitHub

1. Go to: https://github.com/TIGER21-LLC/inbox-zero/settings
2. Navigate to: **Branches** → **Default branch**
3. Ensure **main** is selected
4. Click **Update** if needed

---

## 🚀 Server Setup & Deployment

### Step 5: Server Preparation

**SSH to TIGER 21 server:**
```bash
ssh root@167.99.116.99
```

**Create directories:**
```bash
mkdir -p ~/IT-Configs/docker_swarm/inbox-zero
mkdir -p /mnt/inbox-zero-tiger21/{postgres,redis,app-data}
```

**Verify Docker Swarm:**
```bash
docker swarm init  # If not already initialized
docker network create --driver=overlay traefik-public  # If not exists
docker network ls | grep traefik-public  # Verify
```

### Step 6: Clone Repository on Server

```bash
cd ~/IT-Configs/docker_swarm/inbox-zero
git clone https://github.com/TIGER21-LLC/inbox-zero.git .
```

### Step 7: Create Environment File

```bash
cp .env.tiger21.example .env.tiger21
nano .env.tiger21
```

**Fill in ALL required credentials:**
- Database password (strong, 32+ chars)
- Redis token
- Auth secrets
- Google OAuth (Client ID & Secret)
- Microsoft OAuth (Client ID & Secret)
- AI provider API keys (OpenAI or Anthropic)
- Encryption keys
- Inngest keys

**Generate secure secrets:**
```bash
# For 32-char base64 secrets
openssl rand -base64 32

# For hex secrets
openssl rand -hex 32  # 64 chars
openssl rand -hex 16  # 32 chars
```

**Secure the file:**
```bash
chmod 600 .env.tiger21
```

### Step 8: Configure Cloudflare DNS

1. **Log in to Cloudflare**
2. **Select TIGER 21 domain**
3. **Add DNS Record:**
   - Type: **A**
   - Name: **iz** (or full: iz.tiger21.com)
   - IPv4 address: **167.99.116.99**
   - Proxy status: **Proxied** ✅ (orange cloud)
   - TTL: **Auto**

4. **Configure SSL/TLS:**
   - Go to: **SSL/TLS** → **Overview**
   - Set mode: **Full (strict)** ✅
   - Enable: **Always Use HTTPS** ✅
   - Minimum TLS: **1.2** ✅

### Step 9: Configure OAuth Redirect URIs

**Google Cloud Console** (https://console.cloud.google.com/):
1. Navigate to: APIs & Services → Credentials
2. Select your OAuth 2.0 Client ID
3. Add to **Authorized redirect URIs**:
   ```
   https://iz.tiger21.com/api/auth/callback/google
   ```
4. Save

**Microsoft Azure Portal** (https://portal.azure.com/):
1. Navigate to: Azure Active Directory → App registrations
2. Select your application
3. Go to: **Authentication** → **Platform configurations** → **Web**
4. Add **Redirect URI**:
   ```
   https://iz.tiger21.com/api/auth/callback/microsoft
   ```
5. Save

### Step 10: Deploy!

**From your local machine:**
```bash
./deploy-tiger21.sh
```

The script will:
1. ✅ Verify repository and branch
2. ✅ Push latest code to GitHub
3. ✅ Pull code on server
4. ✅ Verify `.env.tiger21` exists
5. ✅ Build Docker image on server
6. ✅ Deploy Docker Swarm stack
7. ✅ Run database migrations
8. ✅ Verify services are healthy

**Monitor deployment:**
```bash
# SSH to server
ssh root@167.99.116.99

# Watch services start
watch -n 2 'docker stack services inbox-zero-tiger21'

# View logs
docker service logs inbox-zero-tiger21_app -f
```

---

## ✅ Post-Deployment Verification

### Check 1: Services Running
```bash
ssh root@167.99.116.99 'docker stack services inbox-zero-tiger21'
```

**Expected output:**
- `inbox-zero-tiger21_app`: **2/2** replicas
- `inbox-zero-tiger21_postgres`: **1/1** replica
- `inbox-zero-tiger21_redis`: **1/1** replica
- `inbox-zero-tiger21_serverless-redis-http`: **1/1** replica
- `inbox-zero-tiger21_inngest`: **1/1** replica

### Check 2: Website Accessible
```bash
curl -I https://iz.tiger21.com
# Should return: HTTP/2 200
```

Or visit in browser: https://iz.tiger21.com

### Check 3: SSL Certificate Valid
- Browser should show 🔒 padlock (Cloudflare SSL)
- Certificate should be valid and trusted

### Check 4: Authentication Works
1. Visit https://iz.tiger21.com
2. Click **Sign in with Google** → Should redirect to Google
3. Click **Sign in with Microsoft** → Should redirect to Microsoft
4. Complete OAuth flow → Should redirect back and authenticate

### Check 5: Email Integration
1. Sign in with email account
2. Verify inbox loads
3. Check email list displays
4. Test basic actions (archive, label, etc.)

### Check 6: Background Jobs
```bash
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_inngest --tail 50'
```

Should show Inngest processing events without errors.

---

## 📊 Monitoring & Maintenance

### Daily Health Checks

**Quick status:**
```bash
ssh root@167.99.116.99 'docker stack ps inbox-zero-tiger21'
```

**View logs:**
```bash
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app -f'
```

### Weekly Maintenance

1. **Check disk space:**
   ```bash
   ssh root@167.99.116.99 'df -h'
   ```

2. **Check volume usage:**
   ```bash
   ssh root@167.99.116.99 'du -sh /mnt/inbox-zero-tiger21/*'
   ```

3. **Review error logs:**
   ```bash
   ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i error'
   ```

### Monthly Tasks

- Update dependencies (test in staging first)
- Review and rotate API keys if needed
- Test backup restoration
- Security audit

---

## 🔄 Future Deployments

After initial setup, deploying updates is simple:

```bash
# From your local machine
./deploy-tiger21.sh
```

That's it! The script handles everything automatically.

---

## 🆘 Troubleshooting

### Issue: Services won't start

```bash
# Check service status
ssh root@167.99.116.99 'docker service ps inbox-zero-tiger21_app --no-trunc'

# Check logs
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app'
```

### Issue: Database connection errors

```bash
# Verify postgres is running
ssh root@167.99.116.99 'docker service ps inbox-zero-tiger21_postgres'

# Check connection
ssh root@167.99.116.99 'docker exec $(docker ps -q -f name=inbox-zero-tiger21_postgres) pg_isready -U inboxzero'
```

### Issue: Website not accessible

1. Check DNS propagation: `dig iz.tiger21.com`
2. Check Cloudflare proxy is enabled (orange cloud)
3. Check Traefik is running: `docker service ls | grep traefik`
4. Check app is healthy: `docker stack ps inbox-zero-tiger21`

### Issue: OAuth not working

1. Verify redirect URIs are correct:
   - Google: `https://iz.tiger21.com/api/auth/callback/google`
   - Microsoft: `https://iz.tiger21.com/api/auth/callback/microsoft`
2. Check `.env.tiger21` has correct client IDs and secrets
3. Restart app: `docker service update --force inbox-zero-tiger21_app`

---

## 📚 Documentation Reference

- **Complete Guide**: `TIGER21_DEPLOYMENT.md`
- **Checklist**: `TIGER21_DEPLOYMENT_CHECKLIST.md`
- **Quick Reference**: `TIGER21_QUICK_REFERENCE.md`
- **Setup Summary**: `TIGER21_SETUP_SUMMARY.txt`
- **Workflow Docs**: `.github/workflows/README.md`

---

## 🎓 Optional: Enable Code Quality Checks

The automated code quality workflow is already in the repository. To enable it:

1. It will run automatically on all PRs to `main`, `production`, or `staging`
2. No configuration needed
3. See `.github/workflows/README.md` for details

---

## ✨ You're Ready!

Everything is prepared and ready to go. Follow the steps above in order, and you'll have TIGER 21's Inbox Zero instance running in production.

**Total estimated time**: 30-60 minutes (mostly waiting for builds/deployments)

Good luck with the deployment! 🚀
