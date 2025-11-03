# Draft-Only Verification

## Security Control: AI Cannot Send Emails Directly

This document verifies that AI-generated content **ONLY creates drafts** and **NEVER sends emails directly**. This is a critical security control that prevents prompt injection attacks from causing the AI to send unauthorized emails.

## Key Safety Layer

**The app creates DRAFTS, not SENT emails**. This means:
1. ✅ User always reviews AI-generated content before sending
2. ✅ Prompt injection cannot cause emails to be sent
3. ✅ User can catch and fix any inappropriate content
4. ✅ URLs and email addresses in drafts are safe (user will review them)

## Draft-Creating Functions

### AI Reply Generation
- **File**: `apps/web/utils/reply-tracker/generate-draft.ts`
- **Function**: `fetchMessagesAndGenerateDraft()`
- **Behavior**: Generates draft content string, **DOES NOT SEND**
- **Verified**: ✅

### Gmail Draft Creation
- **File**: `apps/web/utils/gmail/draft.ts`
- **Functions**:
  - `createDraft()` - Creates draft only
  - `updateDraft()` - Updates existing draft
- **Behavior**: Uses Gmail API `gmail.users.drafts.create()`
- **Verified**: ✅

### Outlook Draft Creation
- **File**: `apps/web/utils/outlook/draft.ts`
- **Functions**: `createDraft()` - Creates draft in Outlook
- **Behavior**: Uses Microsoft Graph API to create drafts
- **Verified**: ✅

## Email Sending Functions (NOT AI-Triggered)

These functions CAN send emails, but they are:
1. Not called by AI operations
2. Only called by explicit user actions
3. Protected by authentication middleware

### Gmail Send
- **File**: `apps/web/utils/gmail/mail.ts`
- **Function**: `sendEmail()`
- **Usage**: Only for forwarding emails (user-initiated action)
- **Protected**: ✅ withEmailAccount middleware

### Meeting Scheduler
- **File**: `apps/web/utils/meetings/create-meeting-link.ts`
- **Behavior**: Creates calendar events and meeting links
- **Note**: Creates events, not drafts - but requires explicit user trigger
- **Status**: ⚠️ Verify this is user-triggered only

## Verification Status

| Component | Creates Drafts Only | Verified |
|-----------|-------------------|----------|
| AI Reply Generation | ✅ Yes | ✅ |
| AI Rule Execution | ✅ Yes (via drafts) | ✅ |
| Gmail Integration | ✅ Yes | ✅ |
| Outlook Integration | ✅ Yes | ✅ |
| Meeting Scheduler | ⚠️ Creates events directly | ⚠️ Needs verification |

## Security Implications

Since the app only creates drafts:

1. **Prompt injection can't exfiltrate data via email** - Draft is reviewed first
2. **No need to validate email addresses in AI output** - User reviews before sending
3. **URLs in drafts are safe** - User can verify before sending
4. **The security boundary is the draft review** - User is the final gate

## Recommendation

**DO NOT implement strict email/URL validation in AI output** because:
- It would block legitimate use cases (including company emails, meeting links)
- The draft review is the security control
- False positives would harm functionality

Instead, the security measures implemented are:
1. ✅ Prompt injection detection (warns about suspicious patterns)
2. ✅ Input sanitization (prevents breaking out of XML tags)
3. ✅ Rate limiting (prevents abuse)
4. ✅ Security logging (monitors for attacks)
5. ✅ **Draft-only behavior** (primary security control)

---

**Last Updated**: 2025-11-03
**Verified By**: AI Security Implementation
