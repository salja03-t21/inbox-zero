# CREATE_MEETING Action Type

## Overview

The `CREATE_MEETING` action type enables automatic calendar event creation when meeting acceptances are detected in emails. This integrates with the existing rule/action system, giving users full control over when meetings are created.

## Architecture

### How It Works

1. **Rule Matching**: User creates a rule that triggers on meeting-related emails
2. **Action Execution**: When the rule matches, the `CREATE_MEETING` action executes
3. **AI Detection**: AI analyzes the email thread to detect meeting acceptance patterns
4. **Meeting Parsing**: AI extracts meeting details (title, attendees, agenda, etc.)
5. **DateTime Parsing**: Natural language date/time is converted to ISO format
6. **Meeting Link**: Creates Teams/Google Meet/Zoom link based on user preference
7. **Calendar Event**: Creates calendar event with meeting link
8. **Invitations**: Attendees receive calendar invitations via email automatically

### Key Components

#### 1. AI Meeting Acceptance Detector
**File**: `utils/meetings/ai-detect-meeting-acceptance.ts`

Detects patterns like:
- "Yes, let's meet on the 8th at 2pm"
- "2pm works for me"
- "Let's do Tuesday at 3"
- "That time works"
- "I'm free tomorrow at 10"

#### 2. Meeting Request Parser
**File**: `utils/meetings/parse-meeting-request-with-time.ts`

Combines:
- AI-extracted meeting details (title, agenda, attendees)
- Confirmed date/time from acceptance
- User's timezone and preferences

#### 3. Natural Language DateTime Parser
**File**: `utils/meetings/parse-datetime.ts`

Converts expressions like:
- "tomorrow at 2pm" → ISO 8601
- "Nov 8 at 10am" → ISO 8601
- "next Tuesday at 3" → ISO 8601

#### 4. CREATE_MEETING Action Handler
**File**: `utils/ai/actions/create-meeting.ts`

Orchestrates the entire flow from detection to calendar event creation.

## Database Schema

### New Action Type

```prisma
enum ActionType {
  // ... existing types
  CREATE_MEETING
}
```

### Action Arguments

The `CREATE_MEETING` action accepts optional arguments:

```typescript
{
  duration?: number | null;  // Override meeting duration in minutes
  title?: string | null;     // Override meeting title
}
```

## Usage

### Creating a Rule

Users can create rules in the UI with the `CREATE_MEETING` action. Example rule:

**Condition**: Email contains phrases like "let's meet", "works for me", "that time is good"
**Action**: CREATE_MEETING

### Example Rule Configuration

```json
{
  "name": "Auto-create meetings on acceptance",
  "conditions": [
    {
      "type": "AI_CATEGORIZE",
      "category": "meeting_acceptance"
    }
  ],
  "actions": [
    {
      "type": "CREATE_MEETING",
      "duration": 60,
      "title": null  // Let AI generate title
    }
  ]
}
```

## Migration Required

After adding the `CREATE_MEETING` action type to the schema, run:

```bash
pnpm --filter=web prisma migrate dev --name add-create-meeting-action
pnpm --filter=web prisma generate
```

## Testing

### Manual Testing

1. **Setup**: Ensure you have calendar and meeting provider connected
2. **Send test email**: "Hey, can we meet to discuss the report?"
3. **Reply with acceptance**: "Yes, let's meet on Nov 8th at 2pm"
4. **Verify**: Check that:
   - AI detects meeting acceptance
   - Calendar event is created
   - Meeting link is generated
   - Attendees receive invitations

### Log Monitoring

Watch logs for the CREATE_MEETING flow:

```bash
docker logs -f inbox-zero-app 2>&1 | grep -E "(CREATE_MEETING|ai-detect-acceptance|parse-datetime|create-calendar-event)"
```

### Test Script

Create a test rule:

```bash
docker compose exec app pnpm tsx scripts/test-create-meeting.ts
```

## Benefits Over Previous Approach

### Before: Special Trigger Detection
- Meeting creation only worked for self-emails
- Hard-coded patterns in `detect-meeting-trigger.ts`
- No user control
- Couldn't customize when meetings are created

### After: Rule-Based Actions
- ✅ Works for any email (not just self-emails)
- ✅ Users control when meetings are created via rules
- ✅ Follows existing inbox-zero architecture
- ✅ Can combine with other actions (e.g., LABEL + CREATE_MEETING)
- ✅ Customizable via action arguments (duration, title)
- ✅ Better logging and observability
- ✅ Testable via rule execution framework

## Configuration

### User Settings

Meeting creation respects these user settings:
- `meetingSchedulerWorkingHoursStart` (default: 9)
- `meetingSchedulerWorkingHoursEnd` (default: 17)
- `meetingSchedulerEnabled` (default: true)
- `meetingSchedulerDefaultDuration` (default: 60)
- `meetingSchedulerPreferredProvider` (teams/google-meet/zoom)
- `meetingSchedulerAutoCreate` (default: true)

### Environment Variables

None required beyond existing calendar/meeting provider credentials.

## Error Handling

The action handles errors gracefully:
- **No meeting acceptance detected**: Silently skips (logs at info level)
- **No date/time specified**: Logs warning, skips meeting creation
- **Calendar not connected**: Throws error (rule marked as ERROR status)
- **AI parsing failure**: Returns safe defaults, logs error

## Future Enhancements

Potential improvements:
1. **Conflict detection**: Check calendar for conflicts before creating event
2. **Tentative events**: Create as tentative if confidence is low
3. **Time zone suggestions**: Offer multiple time zones for distributed teams
4. **Recurring meetings**: Support "every Tuesday at 2pm"
5. **Meeting templates**: Predefined meeting structures
6. **Smart rescheduling**: Detect reschedule requests and update existing events

## Related Files

### New Files
- `utils/meetings/ai-detect-meeting-acceptance.ts`
- `utils/meetings/parse-meeting-request-with-time.ts`
- `utils/meetings/parse-datetime.ts`
- `utils/ai/actions/create-meeting.ts`
- `docs/features/CREATE_MEETING_ACTION.md`

### Modified Files
- `prisma/schema.prisma` - Added `CREATE_MEETING` to `ActionType` enum
- `utils/ai/actions.ts` - Added `CREATE_MEETING` case to switch statement

### Existing Files (Used)
- `utils/meetings/create-calendar-event.ts` - Creates calendar events
- `utils/meetings/providers/index.ts` - Creates meeting links
- `utils/meetings/parse-meeting-request.ts` - AI meeting detail parser
