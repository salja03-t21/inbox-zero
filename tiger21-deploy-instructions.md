# Tiger21 Docker Swarm Deployment Instructions

## Images Built and Pushed
- Image: `ghcr.io/tiger21-llc/inbox-zero:9c92b2c21`
- Latest: `ghcr.io/tiger21-llc/inbox-zero:latest`
- Build Date: $(date)

## Deployment Steps

1. SSH to the server:
```bash
ssh root@167.99.116.99
```

2. Navigate to the deployment directory:
```bash
cd ~/IT-Configs/docker_swarm/inbox-zero
```

3. Ensure the docker-compose.tiger21.yml file is up to date:
```bash
# The file should already be there from previous deployments
ls -la docker-compose.tiger21.yml
```

4. Deploy the stack with environment variables:
```bash
# Export all variables from .env.tiger21
set -a
source .env.tiger21
set +a

# Deploy the stack
docker stack deploy \
    --compose-file docker-compose.tiger21.yml \
    --with-registry-auth \
    inbox-zero-tiger21
```

5. Check the deployment status:
```bash
# View services
docker stack services inbox-zero-tiger21

# View running tasks
docker stack ps inbox-zero-tiger21

# Check logs
docker service logs inbox-zero-tiger21_app -f
```

6. Run database migrations (wait 30 seconds after deployment):
```bash
# Find the app container
APP_CONTAINER=$(docker ps --filter label=com.docker.swarm.service.name=inbox-zero-tiger21_app --format '{{.ID}}' | head -n 1)

# Run migrations
docker exec $APP_CONTAINER sh -c 'cd /app/apps/web && npx prisma migrate deploy'
```

7. Verify the deployment:
```bash
# Check health endpoint
curl https://iz.tiger21.com/api/health/simple

# Or from the server
curl http://localhost:3000/api/health/simple
```

## Useful Commands

- Scale the app: `docker service scale inbox-zero-tiger21_app=3`
- Remove stack: `docker stack rm inbox-zero-tiger21`
- View all stacks: `docker stack ls`
- Force update service: `docker service update --force inbox-zero-tiger21_app`

## Troubleshooting

If the deployment fails:
1. Check logs: `docker service logs inbox-zero-tiger21_app`
2. Check events: `docker service ps inbox-zero-tiger21_app --no-trunc`
3. Verify environment file: `cat .env.tiger21 | grep -E "DATABASE_URL|DIRECT_URL"`
4. Check Traefik: `docker service logs traefik`

