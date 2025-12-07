# Migration Plan: Upstash → Local Containers (Inngest + Redis)

**Status**: Planning  
**Created**: 2025-01-07  
**Target**: Replace Upstash QStash with self-hosted Inngest  

---

## Overview

Replace Upstash cloud services with self-hosted alternatives:
- **@upstash/qstash** → **Inngest** (self-hosted in Docker)
- **@upstash/redis** → Already using local Redis + serverless-redis-http ✅

### Design Principles
1. **Dual-system support**: Code supports both Inngest and QStash based on env vars
2. **Graceful fallback**: Inngest → QStash → Direct HTTP
3. **Zero downtime**: Existing QStash jobs drain naturally while new jobs go to Inngest

---

## Task List

### Phase 0: Pre-Migration Preparation

- [ ] **0.1** Generate Inngest keys
  - Event key: `openssl rand -hex 16`
  - Signing key: `openssl rand -hex 32`
  
- [ ] **0.2** Audit pending scheduled actions in production
  - Query: `SELECT COUNT(*) FROM "ScheduledAction" WHERE status = 'PENDING';`
  - Document count and oldest scheduled date

- [ ] **0.3** Document current QStash queue state (if accessible)
  - Check Upstash dashboard for pending messages
  - Note any active queues (categorize-senders-*, etc.)

---

### Phase 1: Infrastructure Setup

- [ ] **1.1** Update `docker-compose.prod.yml`
  - Add Inngest service (port 8288/8289 internal only)
  - Configure health checks
  - Connect to existing postgres and redis

- [ ] **1.2** Update `docker-compose.yml` (local dev)
  - Add Inngest service for local Docker dev
  - OR document `npx inngest-cli dev` approach

- [ ] **1.3** Update environment variable documentation
  - Add INNGEST_* vars to `.env.example`
  - Update `apps/web/env.ts` with Inngest schema

---

### Phase 2: Core Abstraction Layer

- [ ] **2.1** Create Inngest client
  - File: `apps/web/utils/inngest/client.ts`
  - Initialize Inngest with conditional config

- [ ] **2.2** Create queue abstraction layer
  - File: `apps/web/utils/queue/index.ts`
  - Implement provider detection (Inngest → QStash → Fallback)
  - Implement `enqueueJob()` unified interface

- [ ] **2.3** Create Inngest serve endpoint
  - File: `apps/web/app/api/inngest/route.ts`
  - Export GET, POST, PUT handlers

- [ ] **2.4** Install dependencies
  - Add `inngest` package to `apps/web/package.json`

---

### Phase 3: Convert Webhook Routes to Inngest Functions

Each existing QStash webhook endpoint needs an equivalent Inngest function:

- [ ] **3.1** `bulk-process/worker`
  - Current: `apps/web/app/api/bulk-process/worker/route.ts`
  - New: `apps/web/utils/inngest/functions/bulk-process-worker.ts`
  - Event: `inbox-zero/bulk-process.worker`

- [ ] **3.2** `categorize/senders/batch`
  - Current: `apps/web/app/api/user/categorize/senders/batch/route.ts`
  - New: `apps/web/utils/inngest/functions/categorize-senders-batch.ts`
  - Event: `inbox-zero/categorize.senders-batch`
  - Note: Needs concurrency config (parallelism: 3 per user)

- [ ] **3.3** `clean/process`
  - Current: `apps/web/app/api/clean/route.ts`
  - New: `apps/web/utils/inngest/functions/clean-process.ts`
  - Event: `inbox-zero/clean.process`

- [ ] **3.4** `clean/gmail`
  - Current: `apps/web/app/api/clean/gmail/route.ts`
  - New: `apps/web/utils/inngest/functions/clean-gmail.ts`
  - Event: `inbox-zero/clean.gmail`

- [ ] **3.5** `clean/outlook`
  - Current: `apps/web/app/api/clean/outlook/route.ts`
  - New: `apps/web/utils/inngest/functions/clean-outlook.ts`
  - Event: `inbox-zero/clean.outlook`

- [ ] **3.6** `ai/digest`
  - Current: `apps/web/app/api/ai/digest/route.ts`
  - New: `apps/web/utils/inngest/functions/ai-digest.ts`
  - Event: `inbox-zero/ai.digest`

- [ ] **3.7** `scheduled-actions/execute`
  - Current: `apps/web/app/api/scheduled-actions/execute/route.ts`
  - New: `apps/web/utils/inngest/functions/scheduled-action-execute.ts`
  - Event: `inbox-zero/scheduled-action.execute`
  - Note: Uses `step.sleepUntil()` for delayed execution

- [ ] **3.8** `resend/digest`
  - Current: `apps/web/app/api/resend/digest/route.ts`
  - New: `apps/web/utils/inngest/functions/resend-digest.ts`
  - Event: `inbox-zero/resend.digest`

- [ ] **3.9** Create functions index
  - File: `apps/web/utils/inngest/functions/index.ts`
  - Export `allFunctions` array

---

### Phase 4: Update Publishers to Use Abstraction

- [ ] **4.1** Update `utils/upstash/index.ts`
  - Add Inngest check before QStash in `publishToQstash()`
  - Add Inngest check before QStash in `bulkPublishToQstash()`
  - Add Inngest check before QStash in `publishToQstashQueue()`

- [ ] **4.2** Update `utils/upstash/categorize-senders.ts`
  - Use queue abstraction for `publishToAiCategorizeSendersQueue()`

- [ ] **4.3** Update `utils/scheduled-actions/scheduler.ts`
  - Replace QStash `publishJSON` with queue abstraction
  - Handle `scheduledFor` via event data (Inngest uses `step.sleepUntil`)

- [ ] **4.4** Update `utils/actions/clean.ts`
  - Replace `bulkPublishToQstash` with queue abstraction

- [ ] **4.5** Update digest utilities
  - `utils/digest/index.ts` - use queue abstraction
  - `app/api/resend/digest/all/route.ts` - use queue abstraction
  - `app/api/resend/summary/all/route.ts` - use queue abstraction

- [ ] **4.6** Update `app/api/bulk-process/start/route.ts`
  - Use queue abstraction for worker dispatch

---

### Phase 5: Migration Script

- [ ] **5.1** Create migration script
  - File: `apps/web/scripts/migrateQstashToInngest.ts`
  - Query PENDING scheduled actions from database
  - Re-queue to Inngest with original `scheduledFor` times
  - Add logging for audit trail

- [ ] **5.2** Add migration npm script
  - Add to `apps/web/package.json`: `"migrate:qstash-to-inngest": "tsx scripts/migrateQstashToInngest.ts"`

---

### Phase 6: Testing

- [ ] **6.1** Local testing with Inngest dev server
  - Start: `npx inngest-cli dev -u http://localhost:3000/api/inngest`
  - Test each function manually

- [ ] **6.2** Update/create tests
  - Update `utils/scheduled-actions/scheduler.test.ts` for dual-provider
  - Add tests for queue abstraction layer

- [ ] **6.3** Test fallback behavior
  - Verify code works with neither Inngest nor QStash configured
  - Verify fallback to direct HTTP with INTERNAL_API_KEY

---

### Phase 7: Deployment

- [ ] **7.1** Deploy infrastructure (Inngest container)
  - Push updated docker-compose.prod.yml
  - Verify Inngest container starts and is healthy

- [ ] **7.2** Deploy application code
  - With BOTH Inngest and QStash env vars set initially
  - Verify app connects to Inngest

- [ ] **7.3** Run migration script
  - Execute `pnpm migrate:qstash-to-inngest` in production
  - Verify pending actions are re-queued to Inngest

- [ ] **7.4** Monitor dual operation
  - Watch Inngest dashboard for new jobs processing
  - Watch QStash dashboard for existing jobs draining

- [ ] **7.5** Remove QStash configuration
  - Once QStash queues are empty, remove QSTASH_* env vars
  - Verify all jobs now flow through Inngest

---

### Phase 8: Cleanup (Future PR)

- [ ] **8.1** Remove QStash dependencies
  - Remove `@upstash/qstash` from package.json
  - Remove `verifySignatureAppRouter` wrappers from routes

- [ ] **8.2** Remove deprecated code
  - Clean up `utils/upstash/index.ts` (remove QStash paths)
  - Rename to `utils/queue/` or similar

- [ ] **8.3** Update documentation
  - Update README.md references to Upstash
  - Update any setup guides

---

## File Changes Summary

| File | Action | Phase |
|------|--------|-------|
| `docker-compose.prod.yml` | Modify | 1.1 |
| `docker-compose.yml` | Modify | 1.2 |
| `.env.example` | Modify | 1.3 |
| `apps/web/env.ts` | Modify | 1.3 |
| `apps/web/package.json` | Modify | 2.4 |
| `apps/web/utils/inngest/client.ts` | **New** | 2.1 |
| `apps/web/utils/queue/index.ts` | **New** | 2.2 |
| `apps/web/app/api/inngest/route.ts` | **New** | 2.3 |
| `apps/web/utils/inngest/functions/*.ts` | **New** (9 files) | 3.x |
| `apps/web/utils/upstash/index.ts` | Modify | 4.1 |
| `apps/web/utils/upstash/categorize-senders.ts` | Modify | 4.2 |
| `apps/web/utils/scheduled-actions/scheduler.ts` | Modify | 4.3 |
| `apps/web/utils/actions/clean.ts` | Modify | 4.4 |
| `apps/web/utils/digest/index.ts` | Modify | 4.5 |
| `apps/web/app/api/resend/digest/all/route.ts` | Modify | 4.5 |
| `apps/web/app/api/resend/summary/all/route.ts` | Modify | 4.5 |
| `apps/web/app/api/bulk-process/start/route.ts` | Modify | 4.6 |
| `apps/web/scripts/migrateQstashToInngest.ts` | **New** | 5.1 |

---

## Environment Variables

### New (Required for Inngest)
```bash
INNGEST_EVENT_KEY=<generated-hex-16>
INNGEST_SIGNING_KEY=<generated-hex-32>
INNGEST_BASE_URL=http://inngest:8288
```

### Deprecated (Keep during migration, remove after)
```bash
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
```

---

## Rollback Plan

If issues occur with Inngest:
1. Remove `INNGEST_*` environment variables
2. Restore `QSTASH_*` environment variables
3. Code automatically falls back to QStash
4. No code changes required for rollback

---

## References

- [Inngest Self-Hosting Docs](https://www.inngest.com/docs/self-hosting)
- [Inngest Next.js Integration](https://www.inngest.com/docs/getting-started/nextjs-quick-start)
- Current QStash Usage: `apps/web/utils/upstash/index.ts`
