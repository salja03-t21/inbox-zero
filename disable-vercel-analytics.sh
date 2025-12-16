#!/bin/bash
# Script to disable Vercel Analytics warnings in production

echo "Disabling Vercel Analytics by setting environment variables..."

ssh root@167.99.116.99 << 'ENDSSH'
cd ~/IT-Configs/docker_swarm/inbox-zero

# Add environment variables to disable Vercel analytics
echo "" >> .env.tiger21
echo "# Disable Vercel Analytics (not using Vercel hosting)" >> .env.tiger21
echo "NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED=1" >> .env.tiger21
echo "VERCEL_ANALYTICS_DISABLED=1" >> .env.tiger21

# Restart the service to apply changes
docker stack deploy -c docker-compose.tiger21.yml inbox-zero-tiger21

echo "Service restarted with Vercel Analytics disabled"
ENDSSH
