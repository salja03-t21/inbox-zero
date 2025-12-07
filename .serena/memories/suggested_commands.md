# Suggested Commands for Inbox Zero Development

## Development Commands
```bash
# Start development server
pnpm dev

# Build the application
pnpm build

# Start production server
pnpm start

# Type checking (CRITICAL before deploy)
pnpm tsc --noEmit
```

## Testing Commands
```bash
# Run tests (excluding AI tests)
pnpm test

# Run AI tests
pnpm test-ai

# Run E2E tests
pnpm test-e2e
```

## Database Commands
```bash
# Run database migrations
pnpm --filter=web prisma migrate dev

# Open Prisma Studio
pnpm --filter=web prisma studio

# Generate Prisma client
pnpm --filter=web prisma generate

# Reset database (DANGEROUS - ask before running)
pnpm --filter=web prisma migrate reset
```

## Code Quality Commands
```bash
# Lint code
pnpm lint

# Format and lint code
pnpm format-and-lint:fix

# Biome check
biome check .
```

## Docker Commands
```bash
# Start local services (PostgreSQL + Redis)
docker-compose up -d

# Stop local services
docker-compose down

# View logs
docker-compose logs -f
```

## Deployment Commands
```bash
# Deploy to production (from production branch only)
./deploy-production.sh
```

## Git Commands
```bash
# Check current branch
git branch --show-current

# Check remote (should be origin, not upstream)
git remote -v

# Create feature branch
git checkout -b feature/your-feature-name
```

## System Commands (macOS)
```bash
# List files
ls -la

# Find files
find . -name "*.ts" -type f

# Search in files
grep -r "pattern" .

# Change directory
cd path/to/directory
```