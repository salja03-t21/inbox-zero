#!/bin/bash
# Add these to your .env.tiger21 file on the server to disable Vercel analytics
echo "
# Disable Vercel Analytics (not needed for self-hosted)
NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED=1
VERCEL_ANALYTICS_DISABLED=1
" >> ~/IT-Configs/docker_swarm/inbox-zero/.env.tiger21
