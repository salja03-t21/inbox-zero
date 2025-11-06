#!/bin/bash
set -e

# Production deployment script for Inbox Zero
# Server: 192.168.3.2
# Domain: iz.salsven.com

SERVER="192.168.3.2"
SERVER_USER="james"
DEPLOY_PATH="~/docker/inbox-zero"
VOLUMES_PATH="/mnt/nfs/inbox-zero"

echo "🚀 Deploying Inbox Zero to production..."
echo "Server: $SERVER"
echo "Domain: https://iz.salsven.com"
echo ""

# Step 1: Create directories on server
echo "📁 Creating directories on server..."
ssh $SERVER_USER@$SERVER "mkdir -p $DEPLOY_PATH && sudo mkdir -p $VOLUMES_PATH/{postgres,redis,app-data} && sudo chown -R $SERVER_USER:$SERVER_USER $VOLUMES_PATH"

# Step 2: Copy production files to server
echo "📦 Copying files to server..."
scp docker-compose.prod.yml $SERVER_USER@$SERVER:$DEPLOY_PATH/docker-compose.yml
scp apps/web/.env.production $SERVER_USER@$SERVER:$DEPLOY_PATH/.env

# Step 3: Copy tunnel credentials for Cloudflare (from laptop to server routing)
echo "🔐 Copying Cloudflare tunnel credentials..."
scp ~/.cloudflared/d24aaaa0-5ef6-49ae-9099-44bbf6bca00a.json $SERVER_USER@$SERVER:~/.cloudflared/
scp ~/.cloudflared/inbox-zero-prod-config.yml $SERVER_USER@$SERVER:~/.cloudflared/

# Step 4: Build and start services
echo "🐳 Building and starting Docker containers..."
ssh $SERVER_USER@$SERVER "cd $DEPLOY_PATH && docker compose pull && docker compose build --build-arg NEXT_PUBLIC_BASE_URL=https://iz.salsven.com && docker compose up -d"

# Step 5: Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Step 6: Run database migrations
echo "🗄️  Running database migrations..."
ssh $SERVER_USER@$SERVER "cd $DEPLOY_PATH && docker compose exec -T app pnpm --filter=web prisma migrate deploy"

# Step 7: Check service status
echo "✅ Checking service status..."
ssh $SERVER_USER@$SERVER "cd $DEPLOY_PATH && docker compose ps"

echo ""
echo "✨ Deployment complete!"
echo "🌐 Access your application at: https://iz.salsven.com"
echo ""
echo "📊 To view logs: ssh $SERVER_USER@$SERVER 'cd $DEPLOY_PATH && docker compose logs -f'"
echo "🔄 To restart: ssh $SERVER_USER@$SERVER 'cd $DEPLOY_PATH && docker compose restart'"
echo "🛑 To stop: ssh $SERVER_USER@$SERVER 'cd $DEPLOY_PATH && docker compose down'"
