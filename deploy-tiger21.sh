#!/bin/bash
set -e

# TIGER 21 Production Deployment Script for Docker Swarm
# Server: 167.99.116.99 (DigitalOcean)
# Domain: iz.tiger21.com
# Infrastructure: Docker Swarm with Traefik reverse proxy
# Repository: https://github.com/TIGER21-LLC/inbox-zero

# Configuration
SERVER="167.99.116.99"
SERVER_USER="root"
DEPLOY_PATH="~/IT-Configs/docker_swarm/inbox-zero"
VOLUMES_PATH="/mnt/inbox-zero-tiger21"
STACK_NAME="inbox-zero-tiger21"
REPO_URL="https://github.com/TIGER21-LLC/inbox-zero.git"
BRANCH="production"

echo "🚀 Deploying Inbox Zero to TIGER 21 production..."
echo "Server: $SERVER"
echo "Domain: https://iz.tiger21.com"
echo "Stack: $STACK_NAME"
echo "Branch: $BRANCH"
echo ""

# Verify we're on the correct repository
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [[ ! "$CURRENT_REMOTE" =~ "TIGER21-LLC/inbox-zero" ]]; then
    echo "⚠️  WARNING: Current repository is not TIGER21-LLC/inbox-zero"
    echo "   Current: $CURRENT_REMOTE"
    echo "   Expected: github.com/TIGER21-LLC/inbox-zero"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

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

# Step 2: Create directories on server
echo "📁 Ensuring directories exist on server..."
ssh $SERVER_USER@$SERVER "mkdir -p $DEPLOY_PATH && mkdir -p $VOLUMES_PATH/{postgres,redis,app-data}"

# Step 3: Initialize/update git repository on server
echo "📦 Updating code on server..."
ssh $SERVER_USER@$SERVER "
    mkdir -p $DEPLOY_PATH && cd $DEPLOY_PATH && 
    if [ ! -d .git ]; then 
        echo '  Initializing git repository...'; 
        git init && 
        git remote add origin $REPO_URL ; 
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

# Step 4: Verify .env.tiger21 exists on server
echo "⚙️  Verifying environment configuration..."
if ! ssh $SERVER_USER@$SERVER "test -f $DEPLOY_PATH/.env.tiger21"; then
    echo "❌ Error: .env.tiger21 not found on server at $DEPLOY_PATH/.env.tiger21"
    echo ""
    echo "Please create the environment file on the server first:"
    echo "  ssh $SERVER_USER@$SERVER"
    echo "  cd $DEPLOY_PATH"
    echo "  cp .env.tiger21.example .env.tiger21"
    echo "  nano .env.tiger21  # Edit with actual credentials"
    echo ""
    exit 1
fi
echo "✓ Environment file found"

# Step 5: Build Docker image on server
echo "🐳 Building Docker image on server..."
ssh $SERVER_USER@$SERVER "cd $DEPLOY_PATH && docker build \
    -f docker/Dockerfile.tiger21.prod \
    --build-arg NEXT_PUBLIC_BASE_URL=https://iz.tiger21.com \
    -t ghcr.io/tiger21-llc/inbox-zero:latest \
    -t ghcr.io/tiger21-llc/inbox-zero:$LATEST_COMMIT \
    ."

# Step 6: Deploy stack to Docker Swarm
echo "📦 Deploying stack to Docker Swarm..."
ssh $SERVER_USER@$SERVER "cd $DEPLOY_PATH && docker stack deploy \
    --compose-file docker-compose.tiger21.yml \
    --with-registry-auth \
    $STACK_NAME"

# Step 7: Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 15

# Step 8: Check stack status
echo "✅ Checking stack status..."
ssh $SERVER_USER@$SERVER "docker stack services $STACK_NAME"

# Step 9: Run database migrations
echo "🗄️  Running database migrations..."
echo "⚠️  Waiting 30 seconds for database to be fully ready..."
sleep 30

# Find a running app container
APP_CONTAINER=$(ssh $SERVER_USER@$SERVER "docker ps --filter label=com.docker.swarm.service.name=${STACK_NAME}_app --format '{{.ID}}' | head -n 1")

if [ -z "$APP_CONTAINER" ]; then
    echo "⚠️  Warning: Could not find running app container. Skipping migrations."
    echo "   You may need to run migrations manually:"
    echo "   ssh $SERVER_USER@$SERVER"
    echo "   docker exec -it \$(docker ps --filter label=com.docker.swarm.service.name=${STACK_NAME}_app --format '{{.ID}}' | head -n 1) sh -c 'cd /app/apps/web && npx prisma migrate deploy'"
else
    echo "Running migrations in container: $APP_CONTAINER"
    ssh $SERVER_USER@$SERVER "docker exec $APP_CONTAINER sh -c 'cd /app/apps/web && npx prisma migrate deploy'"
fi

echo ""
echo "✨ Deployment complete!"
echo "🌐 Application: https://iz.tiger21.com"
echo "📌 Deployed commit: $LATEST_COMMIT (branch: $BRANCH)"
echo "🏷️  Stack: $STACK_NAME"
echo ""
echo "📊 Useful commands:"
echo "  View services: ssh $SERVER_USER@$SERVER 'docker stack services $STACK_NAME'"
echo "  View tasks: ssh $SERVER_USER@$SERVER 'docker stack ps $STACK_NAME'"
echo "  View logs: ssh $SERVER_USER@$SERVER 'docker service logs ${STACK_NAME}_app -f'"
echo "  Scale app: ssh $SERVER_USER@$SERVER 'docker service scale ${STACK_NAME}_app=3'"
echo "  Remove stack: ssh $SERVER_USER@$SERVER 'docker stack rm $STACK_NAME'"
echo ""
