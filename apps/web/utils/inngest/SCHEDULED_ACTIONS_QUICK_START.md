# Scheduled Actions with Inngest - Quick Start Guide

## Overview

Scheduled actions allow email actions to be delayed by a specified number of minutes. This is useful for:
- "Snooze" functionality (delay action until later)
- "Send later" for replies
- Delayed archiving or labeling
- Time-based rule execution

## How It Works

```
User creates rule with delayed action (e.g., "Archive in 30 minutes")
    ↓
System creates ScheduledAction in database
    ↓
System sends Inngest event with scheduledFor timestamp
    ↓
Inngest function sleeps until scheduledFor time
    ↓
Inngest function wakes up and executes the action
    ↓
Action is marked as COMPLETED in database
```

## Quick Example

### 1. Schedule an Action

```typescript
import { createScheduledAction } from "@/utils/scheduled-actions/scheduler";
import { sendScheduledActionExecuteEvent } from "@/utils/inngest/events/scheduled-action";
import { addMinutes } from "date-fns";

// Create the scheduled action in the database
const scheduledAction = await createScheduledAction({
  executedRuleId: "rule-123",
  actionItem: {
    type: "ARCHIVE",
    delayInMinutes: 30,
    // ... other action properties
  },
  messageId: "msg-456",
  threadId: "thread-789",
  emailAccountId: "account-abc",
  scheduledFor: addMinutes(new Date(), 30),
});

// Send Inngest event to execute it
await sendScheduledActionExecuteEvent({
  scheduledActionId: scheduledAction.id,
  scheduledFor: scheduledAction.scheduledFor,
});
```

### 2. Cancel a Scheduled Action

```typescript
import prisma from "@/utils/prisma";
import { ScheduledActionStatus } from "@prisma/client";

// Just update the status - the Inngest function will check and skip
await prisma.scheduledAction.update({
  where: { id: scheduledActionId },
  data: { status: ScheduledActionStatus.CANCELLED },
});
```

### 3. Check Action Status

```typescript
const action = await prisma.scheduledAction.findUnique({
  where: { id: scheduledActionId },
  include: {
    executedAction: true, // The actual executed action (if completed)
  },
});

console.log(action.status); // PENDING, EXECUTING, COMPLETED, FAILED, or CANCELLED
```

## Action Types That Can Be Delayed

From `utils/delayed-actions.ts`:

```typescript
const DELAYABLE_ACTIONS = [
  "ARCHIVE",
  "LABEL",
  "REPLY",
  "SEND_EMAIL",
  "FORWARD",
  "DRAFT_EMAIL",
  "MARK_SPAM",
];
```

## Database Schema

```prisma
model ScheduledAction {
  id                String                @id @default(cuid())
  status            ScheduledActionStatus @default(PENDING)
  scheduledFor      DateTime              // When to execute
  executedAt        DateTime?             // When it was executed
  
  // What to execute
  actionType        ActionType
  messageId         String
  threadId          String
  
  // Action details (stored for later execution)
  label             String?
  subject           String?
  content           String?
  to                String?
  cc                String?
  bcc               String?
  
  // Relationships
  executedRule      ExecutedRule          @relation(...)
  executedAction    ExecutedAction?       @relation(...)
  emailAccount      EmailAccount          @relation(...)
  
  // Legacy QStash fields (can be removed after migration)
  scheduledId       String?
  schedulingStatus  String?
}

enum ScheduledActionStatus {
  PENDING    // Waiting to execute
  EXECUTING  // Currently executing
  COMPLETED  // Successfully executed
  FAILED     // Execution failed
  CANCELLED  // Cancelled before execution
}
```

## Monitoring

### Inngest Dashboard

View scheduled actions in the Inngest dashboard:
- **Sleeping functions**: Actions waiting for their scheduled time
- **Running functions**: Actions currently executing
- **Failed functions**: Actions that encountered errors
- **Completed functions**: Successfully executed actions

### Database Queries

```typescript
// Count pending actions
const pendingCount = await prisma.scheduledAction.count({
  where: { status: ScheduledActionStatus.PENDING },
});

// Find actions scheduled for next hour
const upcomingActions = await prisma.scheduledAction.findMany({
  where: {
    status: ScheduledActionStatus.PENDING,
    scheduledFor: {
      gte: new Date(),
      lte: addHours(new Date(), 1),
    },
  },
});

// Find failed actions
const failedActions = await prisma.scheduledAction.findMany({
  where: { status: ScheduledActionStatus.FAILED },
  orderBy: { scheduledFor: "desc" },
});
```

## Error Handling

### Automatic Retries

The Inngest function has 3 automatic retries:
- Retry 1: Immediate
- Retry 2: After 1 minute
- Retry 3: After 5 minutes

### Common Errors

1. **Email not found**: Action is marked COMPLETED with reason "Email no longer exists"
2. **Email account not found**: Function throws error and retries
3. **Action already executing**: Skipped (optimistic locking prevents duplicates)
4. **Action cancelled**: Skipped with success status

### Manual Intervention

If an action is stuck in EXECUTING status:

```typescript
// Reset to PENDING to retry
await prisma.scheduledAction.update({
  where: { id: scheduledActionId },
  data: { status: ScheduledActionStatus.PENDING },
});

// Then send a new Inngest event
await sendScheduledActionExecuteEvent({
  scheduledActionId,
  scheduledFor: new Date(), // Execute immediately
});
```

## Testing

### Unit Test Example

```typescript
import { scheduledActionExecute } from "@/utils/inngest/functions/scheduled-action-execute";
import { inngest } from "@/utils/inngest/client";

test("executes scheduled action after delay", async () => {
  // Create test scheduled action
  const scheduledAction = await createTestScheduledAction({
    scheduledFor: new Date(Date.now() + 1000), // 1 second from now
  });

  // Send event
  await inngest.send({
    name: "inbox-zero/scheduled-action.execute",
    data: {
      scheduledActionId: scheduledAction.id,
      scheduledFor: scheduledAction.scheduledFor.toISOString(),
    },
  });

  // Wait for execution
  await sleep(2000);

  // Verify action was executed
  const updated = await prisma.scheduledAction.findUnique({
    where: { id: scheduledAction.id },
  });
  expect(updated.status).toBe(ScheduledActionStatus.COMPLETED);
});
```

### Integration Test Example

```typescript
test("full flow: schedule, wait, execute", async () => {
  // 1. Create rule with delayed action
  const rule = await createTestRule({
    actions: [
      {
        type: "ARCHIVE",
        delayInMinutes: 1,
      },
    ],
  });

  // 2. Execute rule (creates scheduled action)
  await executeRule(rule, testEmail);

  // 3. Verify scheduled action was created
  const scheduledAction = await prisma.scheduledAction.findFirst({
    where: { executedRuleId: rule.id },
  });
  expect(scheduledAction.status).toBe(ScheduledActionStatus.PENDING);

  // 4. Wait for execution
  await sleep(70000); // 70 seconds

  // 5. Verify action was executed
  const updated = await prisma.scheduledAction.findUnique({
    where: { id: scheduledAction.id },
  });
  expect(updated.status).toBe(ScheduledActionStatus.COMPLETED);
  expect(updated.executedActionId).toBeTruthy();
});
```

## Performance Tips

### Batch Scheduling

When scheduling multiple actions, send events in parallel:

```typescript
const eventPromises = scheduledActions.map((action) =>
  sendScheduledActionExecuteEvent({
    scheduledActionId: action.id,
    scheduledFor: action.scheduledFor,
  })
);

await Promise.all(eventPromises);
```

### Database Indexes

Ensure these indexes exist for performance:

```prisma
@@index([status, scheduledFor]) // For finding pending actions
@@index([emailAccountId, messageId]) // For cancellation queries
@@index([executedRuleId]) // For rule-based queries
```

## Migration from QStash

See `SCHEDULED_ACTION_EXECUTE_README.md` for detailed migration guide.

Quick steps:
1. Deploy Inngest function
2. Update scheduling code to send Inngest events
3. Run migration helper for existing actions
4. Monitor both systems during transition
5. Remove QStash code after verification

## Troubleshooting

### Action not executing

1. Check Inngest dashboard for function runs
2. Verify event was sent (check logs)
3. Check action status in database
4. Look for errors in function logs

### Action executing multiple times

- Should not happen due to optimistic locking
- Check for duplicate events being sent
- Verify database status updates are working

### Action stuck in EXECUTING

- Check Inngest dashboard for failed runs
- Manually reset status to PENDING if needed
- Send new event to retry

## Related Files

- `utils/inngest/functions/scheduled-action-execute.ts` - Main function
- `utils/inngest/events/scheduled-action.ts` - Event helpers
- `utils/scheduled-actions/executor.ts` - Execution logic
- `utils/scheduled-actions/scheduler.ts` - Scheduling logic (to be updated)
- `utils/delayed-actions.ts` - Action type validation

## Support

For issues or questions:
1. Check Inngest dashboard for function logs
2. Check database for action status
3. Review error logs in application monitoring
4. Consult `SCHEDULED_ACTION_EXECUTE_README.md` for detailed docs
