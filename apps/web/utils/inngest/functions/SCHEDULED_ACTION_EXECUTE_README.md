# Scheduled Action Execute - Inngest Function

## Overview

This Inngest function replaces the QStash webhook endpoint at `/api/scheduled-actions/execute` for executing delayed email actions.

## Key Differences from QStash

| Feature | QStash (Old) | Inngest (New) |
|---------|--------------|---------------|
| Scheduling | External service (QStash) | Built-in `step.sleepUntil()` |
| Webhook verification | Required signature verification | Not needed (internal events) |
| Retries | QStash retry policy | Inngest retry policy (3 retries) |
| Cancellation | Delete QStash message | Check status before execution |
| Monitoring | QStash dashboard | Inngest dashboard |
| Cost | Per-message pricing | Included in Inngest plan |

## Architecture

### Event Flow

```
1. Rule execution creates scheduled action
   ↓
2. Send Inngest event with scheduledFor timestamp
   ↓
3. Inngest function receives event
   ↓
4. step.sleepUntil(scheduledFor) - waits until scheduled time
   ↓
5. Fetch action from database
   ↓
6. Validate status (skip if cancelled)
   ↓
7. Mark as EXECUTING (prevents duplicates)
   ↓
8. Execute action using existing executor logic
   ↓
9. Mark as COMPLETED or FAILED
```

### Files Created

1. **`scheduled-action-execute.ts`** - Main Inngest function
   - Handles delayed execution with `step.sleepUntil()`
   - Validates action status before execution
   - Uses existing executor logic from `utils/scheduled-actions/executor.ts`

2. **`events/scheduled-action.ts`** - Event sending helpers
   - `sendScheduledActionExecuteEvent()` - Send execution event
   - `cancelScheduledActionEvent()` - No-op (status check handles cancellation)

3. **`helpers/scheduled-action-migration.ts`** - Migration utilities
   - `migrateScheduledActionsToInngest()` - Migrate existing actions
   - `getScheduledActionsMigrationStatus()` - Check migration status

## Usage

### Scheduling a New Action

Replace QStash scheduling code:

```typescript
// OLD (QStash):
import { createScheduledAction } from "@/utils/scheduled-actions/scheduler";

const scheduledAction = await createScheduledAction({
  executedRuleId,
  actionItem,
  messageId,
  threadId,
  emailAccountId,
  scheduledFor,
});
// QStash message is automatically scheduled

// NEW (Inngest):
import { createScheduledAction } from "@/utils/scheduled-actions/scheduler";
import { sendScheduledActionExecuteEvent } from "@/utils/inngest/events/scheduled-action";

const scheduledAction = await createScheduledAction({
  executedRuleId,
  actionItem,
  messageId,
  threadId,
  emailAccountId,
  scheduledFor,
});

// Send Inngest event
await sendScheduledActionExecuteEvent({
  scheduledActionId: scheduledAction.id,
  scheduledFor,
});
```

### Cancelling an Action

Cancellation works the same way - just update the database status:

```typescript
// Both QStash and Inngest:
await prisma.scheduledAction.update({
  where: { id: scheduledActionId },
  data: { status: ScheduledActionStatus.CANCELLED },
});

// The Inngest function will check status and skip execution
```

## Migration Steps

### 1. Deploy Inngest Function

```bash
# Ensure Inngest is configured
export INNGEST_EVENT_KEY=your_event_key
export INNGEST_SIGNING_KEY=your_signing_key

# Deploy the function
pnpm dev  # or deploy to production
```

### 2. Migrate Existing Scheduled Actions

Run the migration helper to send Inngest events for all pending QStash actions:

```typescript
import { migrateScheduledActionsToInngest } from "@/utils/inngest/helpers/scheduled-action-migration";

// Dry run first to see what would be migrated
const dryRunResult = await migrateScheduledActionsToInngest({ dryRun: true });
console.log(dryRunResult);

// Then run the actual migration
const result = await migrateScheduledActionsToInngest();
console.log(result);
```

### 3. Update Scheduling Code

Replace all calls to QStash scheduling with Inngest event sending:

- Find: `createScheduledAction()` calls
- Add: `sendScheduledActionExecuteEvent()` after each one

### 4. Monitor Both Systems

During transition period:
- Keep QStash webhook endpoint active
- Monitor both QStash and Inngest dashboards
- Verify actions execute correctly

### 5. Remove QStash Code

Once all actions are migrated and verified:
- Remove QStash webhook endpoint (`/api/scheduled-actions/execute/route.ts`)
- Remove QStash scheduling logic from `scheduler.ts`
- Remove QStash environment variables
- Remove `@upstash/qstash` dependency

## Error Handling

### Retries

The function has 3 automatic retries configured:

```typescript
{
  id: "scheduled-action-execute",
  retries: 3,
}
```

### Failure Scenarios

1. **Action not found** - Logs warning, throws error (will retry)
2. **Action cancelled** - Skips execution, returns success
3. **Action already executing** - Skips execution, returns success
4. **Execution fails** - Executor marks as FAILED, function returns error

### Monitoring

Check Inngest dashboard for:
- Failed function runs
- Retry attempts
- Execution duration
- Sleeping functions (waiting for scheduled time)

## Testing

### Unit Tests

Test the event payload and function logic:

```typescript
import { scheduledActionExecute } from "./scheduled-action-execute";

test("executes scheduled action at correct time", async () => {
  // Create test scheduled action
  const scheduledAction = await createTestScheduledAction();
  
  // Send event
  await inngest.send({
    name: "inbox-zero/scheduled-action.execute",
    data: {
      scheduledActionId: scheduledAction.id,
      scheduledFor: new Date(Date.now() + 1000).toISOString(),
    },
  });
  
  // Verify execution after delay
  // ...
});
```

### Integration Tests

Test the full flow with a real Inngest instance:

```typescript
test("schedules and executes delayed action", async () => {
  // Create rule with delayed action
  // Verify Inngest event is sent
  // Wait for execution
  // Verify action was executed
});
```

## Performance Considerations

### Sleep Duration

- Inngest `step.sleepUntil()` is efficient for any duration
- No polling or active waiting
- Function is paused and resumed at scheduled time

### Database Queries

Each execution makes these queries:
1. Fetch scheduled action (with includes)
2. Mark as executing (optimistic locking)
3. Execute action (varies by action type)
4. Mark as completed/failed

### Concurrency

- Multiple actions can execute concurrently
- Optimistic locking prevents duplicate execution
- No global rate limits (unlike QStash)

## Troubleshooting

### Action not executing

1. Check Inngest dashboard for function runs
2. Verify event was sent: `inngest.send()` logs
3. Check scheduled action status in database
4. Look for errors in function logs

### Action executing multiple times

- Should not happen due to optimistic locking
- Check for duplicate events being sent
- Verify `markAsExecuting` step is working

### Action stuck in EXECUTING

- Function may have crashed during execution
- Check Inngest dashboard for failed runs
- Manually update status if needed

## Future Improvements

1. **Add inngestEventId field** to ScheduledAction schema
   - Track which Inngest event corresponds to each action
   - Enable better debugging and monitoring

2. **Batch event sending** for multiple actions
   - Use `inngest.send()` with array of events
   - More efficient for bulk scheduling

3. **Add metrics** to track execution times
   - How long actions wait before executing
   - Execution duration by action type
   - Success/failure rates

4. **Implement event cancellation** if Inngest adds support
   - Currently relies on status check
   - Could save resources if events can be cancelled

## Related Files

- `apps/web/app/api/scheduled-actions/execute/route.ts` - Old QStash webhook (to be removed)
- `apps/web/utils/scheduled-actions/executor.ts` - Core execution logic (reused)
- `apps/web/utils/scheduled-actions/scheduler.ts` - QStash scheduling (to be updated)
- `apps/web/utils/inngest/client.ts` - Inngest client setup
