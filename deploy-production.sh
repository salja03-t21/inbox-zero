#!/bin/bash
set -e

# Production deployment script for Inbox Zero
# Server: 192.168.3.2
# Domain: iz.salsven.com
# Branch: production

SERVER="192.168.3.2"
SERVER_USER="james"
DEPLOY_PATH="~/docker/inbox-zero"
VOLUMES_PATH="/mnt/nfs/inbox-zero"
BRANCH="production"

echo "🚀 Deploying Inbox Zero to production..."
echo "Server: $SERVER"
echo "Domain: https://iz.salsven.com"
echo "Branch: $BRANCH"
echo ""

# Step 1: Verify local state
echo "✓ Checking local repository..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    echo "⚠️  Warning: You're on branch '$CURRENT_BRANCH', switching to '$BRANCH'..."
    git checkout $BRANCH
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Error: You have uncommitted changes"
    git status --short
    exit 1
fi

echo "✓ Pushing latest changes to origin..."
git push origin $BRANCH

LATEST_COMMIT=$(git rev-parse --short HEAD)
echo "📌 Deploying commit: $LATEST_COMMIT"
echo ""

# Step 2: Create directories on server (if they don't exist)
echo "📁 Ensuring directories exist on server..."
ssh $SERVER_USER@$SERVER "mkdir -p $DEPLOY_PATH && sudo mkdir -p $VOLUMES_PATH/{postgres,redis,app-data}"

# Step 3: Initialize/update git repository on server
echo "📦 Updating code on server..."
ssh $SERVER_USER@$SERVER "
    mkdir -p $DEPLOY_PATH && cd $DEPLOY_PATH && 
    if [ ! -d .git ]; then 
        echo '  Initializing git repository...'; 
        git init && 
        git remote add origin https://github.com/salja03-t21/inbox-zero.git ; 
    fi && 
    echo '  Fetching updates...' && 
    git fetch origin && 
    echo '  Stashing local config files...' && 
    git add -A 2>/dev/null || true && 
    git stash push -u -m 'Local config files' 2>/dev/null || true && 
    echo '  Checking out $BRANCH...' && 
    git checkout -f $BRANCH 2>/dev/null || git checkout -b $BRANCH origin/$BRANCH && 
    echo '  Pulling latest code...' && 
    git reset --hard origin/$BRANCH && 
    echo '  Current commit:' && 
    git log --oneline -1"

# Step 4: Copy environment file and docker-compose
echo "⚙️  Copying configuration files..."
scp apps/web/.env.production $SERVER_USER@$SERVER:$DEPLOY_PATH/.env

# Backup existing docker-compose.yml and copy prod version
echo "📋 Updating docker-compose configuration..."
ssh $SERVER_USER@$SERVER "cd $DEPLOY_PATH && if [ -f docker-compose.yml ]; then cp docker-compose.yml docker-compose.yml.backup-\$(date +%Y%m%d-%H%M%S); fi"
scp docker-compose.prod.yml $SERVER_USER@$SERVER:$DEPLOY_PATH/docker-compose.yml

# Step 5: Copy tunnel credentials for Cloudflare (from laptop to server routing)
echo "🔐 Copying Cloudflare tunnel credentials..."
ssh $SERVER_USER@$SERVER "mkdir -p ~/.cloudflared"
scp ~/.cloudflared/d24aaaa0-5ef6-49ae-9099-44bbf6bca00a.json $SERVER_USER@$SERVER:~/.cloudflared/ 2>/dev/null || echo "  Tunnel credentials already on server"
scp ~/.cloudflared/inbox-zero-prod-config.yml $SERVER_USER@$SERVER:~/.cloudflared/ 2>/dev/null || echo "  Tunnel config already on server"

# Step 6: Build and start services
echo "🐳 Building and starting Docker containers..."
ssh $SERVER_USER@$SERVER "cd $DEPLOY_PATH && docker compose build --build-arg NEXT_PUBLIC_BASE_URL=https://iz.salsven.com && docker compose up -d"

# Step 7: Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Step 8: Run database migrations
# Pinned to prisma@6.6.0: the runtime image has no dev deps, so a bare `npx prisma`
# fetches the latest Prisma (7.x) from npm, which rejects this project's v6 schema.
echo "🗄️  Running database migrations..."
ssh $SERVER_USER@$SERVER "cd $DEPLOY_PATH && docker compose exec -T app sh -c 'cd /app/apps/web && npx --yes prisma@6.6.0 migrate deploy'"

# Step 9: Check service status
echo "✅ Checking service status..."
ssh $SERVER_USER@$SERVER "cd $DEPLOY_PATH && docker compose ps"

echo ""
echo "✨ Deployment complete!"
echo "🌐 Application: https://iz.salsven.com"
echo "📌 Deployed commit: $LATEST_COMMIT (branch: $BRANCH)"
echo ""
echo "📊 View logs: ssh $SERVER_USER@$SERVER 'cd $DEPLOY_PATH && docker compose logs -f web'"
echo "🔄 Restart: ssh $SERVER_USER@$SERVER 'cd $DEPLOY_PATH && docker compose restart web'"
echo "🔙 Rollback: git revert HEAD && ./deploy-production.sh"
echo "🛑 Stop: ssh $SERVER_USER@$SERVER 'cd $DEPLOY_PATH && docker compose down'"
