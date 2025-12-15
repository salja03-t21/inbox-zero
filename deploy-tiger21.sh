#!/bin/bash
set -e

# TIGER 21 Production Deployment Script for Docker Swarm
# 
# CRITICAL DEPLOYMENT PRINCIPLE:
# ===============================
# SERVERS SHOULD NEVER HAVE SOURCE CODE!
# 
# This script follows the correct Docker Swarm deployment pattern:
# 1. Build Docker image LOCALLY (on development machine)
# 2. Push image to container registry (ghcr.io)
# 3. Deploy to swarm using ONLY the docker-compose file and .env
# 4. Server pulls pre-built image from registry
#
# The production server should ONLY contain:
# - ~/IT-Configs/docker_swarm/inbox-zero/docker-compose.tiger21.yml
# - ~/IT-Configs/docker_swarm/inbox-zero/.env.tiger21 (secrets, never in git)
# - ~/IT-Configs/docker_swarm/inbox-zero/deploy-tiger21.sh (optional helper)
# - NO SOURCE CODE, NO GIT REPOSITORY, NO BUILD TOOLS
#
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
REGISTRY="ghcr.io/tiger21-llc"
IMAGE_NAME="inbox-zero"
BRANCH="main"

echo "🚀 Deploying Inbox Zero to TIGER 21 production..."
echo "Server: $SERVER"
echo "Domain: https://iz.tiger21.com"
echo "Stack: $STACK_NAME"
echo "Branch: $BRANCH"
echo ""

# Step 1: Verify we're on the correct repository
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [[ ! "$CURRENT_REMOTE" =~ "TIGER21-LLC/inbox-zero" ]] && [[ ! "$CURRENT_REMOTE" =~ "salja03-t21/inbox-zero" ]]; then
    echo "❌ Error: Current repository is not TIGER21-LLC/inbox-zero or salja03-t21/inbox-zero"
    echo "   Current: $CURRENT_REMOTE"
    exit 1
fi

# Step 2: Verify local state
echo "✓ Checking local repository..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    echo "❌ Error: You're on branch '$CURRENT_BRANCH', must be on '$BRANCH'"
    echo "   Run: git checkout $BRANCH"
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Error: You have uncommitted changes"
    git status --short
    exit 1
fi

LATEST_COMMIT=$(git rev-parse --short HEAD)
echo "📌 Deploying commit: $LATEST_COMMIT"
echo ""

# Step 3: Type check (optional - Docker build will catch critical issues)
echo "🔍 Skipping TypeScript type check (Docker build will validate)..."
echo "   Note: Run 'pnpm tsc --noEmit' locally if you want to check types before building"
echo ""

# Step 4: Build Docker image locally
echo "🐳 Building Docker image locally..."
echo "   This may take 5-10 minutes..."
docker buildx build \
    --platform linux/amd64 \
    -f docker/Dockerfile.tiger21.prod \
    --build-arg NEXT_PUBLIC_BASE_URL=https://iz.tiger21.com \
    -t $REGISTRY/$IMAGE_NAME:latest \
    -t $REGISTRY/$IMAGE_NAME:$LATEST_COMMIT \
    .

if [ $? -ne 0 ]; then
    echo "❌ Error: Docker build failed"
    exit 1
fi
echo "✓ Docker image built successfully"
echo ""

# Step 5: Push to GitHub Container Registry
echo "📤 Pushing image to GitHub Container Registry..."
echo "   Image: $REGISTRY/$IMAGE_NAME:latest"
echo "   Tag: $REGISTRY/$IMAGE_NAME:$LATEST_COMMIT"

# Check if user is logged in to ghcr.io
if ! docker info 2>/dev/null | grep -q "ghcr.io"; then
    echo "⚠️  You may need to authenticate to GitHub Container Registry."
    echo "   Run: echo \$GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin"
    echo "   Or use: docker login ghcr.io"
fi

docker push $REGISTRY/$IMAGE_NAME:latest
docker push $REGISTRY/$IMAGE_NAME:$LATEST_COMMIT

if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to push image to registry"
    echo "   Make sure you're authenticated to ghcr.io"
    exit 1
fi
echo "✓ Images pushed to registry"
echo ""

# Step 6: Ensure deployment directory and volumes exist on server
echo "📁 Ensuring directories exist on server..."
ssh $SERVER_USER@$SERVER "mkdir -p $DEPLOY_PATH && mkdir -p $VOLUMES_PATH/{postgres,redis,app-data}"
echo ""

# Step 7: Upload docker-compose.tiger21.yml to server (config only, NO source code)
echo "📄 Uploading docker-compose.tiger21.yml to server..."
scp docker-compose.tiger21.yml $SERVER_USER@$SERVER:$DEPLOY_PATH/
echo ""

# Step 8: Verify .env.tiger21 exists on server
echo "⚙️  Verifying environment configuration..."
if ! ssh $SERVER_USER@$SERVER "test -f $DEPLOY_PATH/.env.tiger21"; then
    echo "❌ Error: .env.tiger21 not found on server at $DEPLOY_PATH/.env.tiger21"
    echo ""
    echo "Please create the environment file on the server first:"
    echo "  1. Upload .env.tiger21.example:"
    echo "     scp .env.tiger21.example $SERVER_USER@$SERVER:$DEPLOY_PATH/"
    echo "  2. SSH to server and create .env.tiger21:"
    echo "     ssh $SERVER_USER@$SERVER"
    echo "     cd $DEPLOY_PATH"
    echo "     cp .env.tiger21.example .env.tiger21"
    echo "     nano .env.tiger21  # Edit with actual credentials"
    echo ""
    exit 1
fi
echo "✓ Environment file found"
echo ""

# Step 9: Deploy stack to Docker Swarm
# CRITICAL: In Docker Swarm mode, env_file directive is IGNORED.
# Variable substitution in docker-compose.yml happens at deploy time.
# We must export env vars BEFORE running docker stack deploy so they're
# available for ${VAR} substitution in the compose file.
echo "📦 Deploying stack to Docker Swarm..."
echo "   Loading environment variables and deploying..."

# Create a deployment script on the server that properly exports env vars
ssh $SERVER_USER@$SERVER "cat > $DEPLOY_PATH/run-deploy.sh << 'DEPLOY_SCRIPT'
#!/bin/bash
set -e
cd ~/IT-Configs/docker_swarm/inbox-zero

# Export all variables from .env.tiger21 so they're available for docker stack deploy
# The 'set -a' makes all subsequent variable assignments exported automatically
set -a
source .env.tiger21
set +a

# Debug: Show that critical vars are loaded (masked for security)
echo \"  DATABASE_URL loaded: \${DATABASE_URL:0:30}...\"
echo \"  DIRECT_URL loaded: \${DIRECT_URL:0:30}...\"

# Deploy with exported environment variables
# Docker stack deploy will substitute \${VAR} references in compose file
docker stack deploy \
    --compose-file docker-compose.tiger21.yml \
    --with-registry-auth \
    inbox-zero-tiger21
DEPLOY_SCRIPT
chmod +x $DEPLOY_PATH/run-deploy.sh"

# Execute the deployment script
ssh $SERVER_USER@$SERVER "$DEPLOY_PATH/run-deploy.sh"

if [ $? -ne 0 ]; then
    echo "❌ Error: Stack deployment failed"
    exit 1
fi
echo ""

# Step 10: Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 15

# Step 11: Check stack status
echo "✅ Checking stack status..."
ssh $SERVER_USER@$SERVER "docker stack services $STACK_NAME"
echo ""

# Step 12: Run database migrations
echo "🗄️  Running database migrations..."
echo "⚠️  Waiting 30 seconds for app container to be ready..."
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
    ssh $SERVER_USER@$SERVER "docker exec $APP_CONTAINER sh -c 'cd /app/apps/web && npx prisma migrate deploy'" || {
        echo "⚠️  Warning: Migration command failed. Container may still be starting."
        echo "   Check logs: ssh $SERVER_USER@$SERVER 'docker service logs ${STACK_NAME}_app'"
    }
fi

echo ""
echo "✨ Deployment complete!"
echo "🌐 Application: https://iz.tiger21.com"
echo "📌 Deployed commit: $LATEST_COMMIT (branch: $BRANCH)"
echo "🏷️  Docker image: $REGISTRY/$IMAGE_NAME:$LATEST_COMMIT"
echo "🏷️  Stack: $STACK_NAME"
echo ""
echo "📊 Useful commands:"
echo "  View services: ssh $SERVER_USER@$SERVER 'docker stack services $STACK_NAME'"
echo "  View tasks: ssh $SERVER_USER@$SERVER 'docker stack ps $STACK_NAME'"
echo "  View logs: ssh $SERVER_USER@$SERVER 'docker service logs ${STACK_NAME}_app -f'"
echo "  Scale app: ssh $SERVER_USER@$SERVER 'docker service scale ${STACK_NAME}_app=3'"
echo "  Remove stack: ssh $SERVER_USER@$SERVER 'docker stack rm $STACK_NAME'"
echo "  Health check: curl https://iz.tiger21.com/api/health/simple"
echo ""
echo "🔒 Remember: The server contains ONLY configuration files, NO source code!"
echo ""
