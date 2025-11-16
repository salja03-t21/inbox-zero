# Microsoft Shared Mailbox Implementation Plan

## Current State

### What Works ✅
- OAuth authentication for primary Microsoft account
- Database schema supports multiple EmailAccounts per Account
- UI for connecting/disconnecting shared mailboxes
- Manual shared mailbox entry (since MS Graph API doesn't list delegated mailboxes)

### What Doesn't Work ❌
- **Critical**: All API calls use `/me/` which only accesses the primary mailbox
- Shared mailbox EmailAccounts show primary mailbox emails instead of shared mailbox emails
- Error on settings page when viewing shared mailbox context

## Root Cause

Microsoft Graph API requires different endpoints for shared mailboxes:
- **Primary mailbox**: `/me/messages`, `/me/mailFolders`, etc.
- **Shared mailbox**: `/users/{sharedMailboxEmail}/messages`, `/users/{sharedMailboxEmail}/mailFolders`, etc.

The current implementation hardcodes `/me/` in all Outlook provider methods.

## Implementation Requirements

### 1. Pass Shared Mailbox Context Through Stack

**Files to modify:**
- `utils/email/provider.ts` - Pass emailAccount to provider creation
- `utils/outlook/client.ts` - Store and use shared mailbox email
- All Outlook provider files (mail.ts, message.ts, label.ts, etc.)

**Changes needed:**
```typescript
// In OutlookClient constructor
constructor(accessToken: string, sharedMailboxEmail?: string) {
  this.sharedMailboxEmail = sharedMailboxEmail;
  // ...
}

// In API calls
getBaseUrl() {
  return this.sharedMailboxEmail 
    ? `/users/${this.sharedMailboxEmail}` 
    : '/me';
}
```

### 2. Update All API Endpoint Calls

**Files with `/me/` references:**
- `utils/outlook/attachment.ts` (1 reference)
- `utils/outlook/client.ts` (1 reference)
- `utils/outlook/label.ts` (19 references)
- `utils/outlook/mail.ts` (6 references)
- `utils/outlook/calendar-client.ts` (1 reference)
- `utils/outlook/message.ts` (5 references)
- `utils/outlook/spam.ts` (5 references)
- `utils/outlook/draft.ts` (2 references)
- `utils/outlook/filter.ts` (7 references)
- `utils/outlook/folders.ts` (9 references)
- `utils/outlook/thread.ts` (5 references)
- `utils/outlook/trash.ts` (5 references)
- `utils/outlook/watch.ts` (1 reference)

**Total**: ~66 references to update

### 3. Database Query Updates

Ensure all queries fetch the shared mailbox email:
```typescript
const emailAccount = await prisma.emailAccount.findUnique({
  where: { id: emailAccountId },
  select: {
    isSharedMailbox: true,
    sharedMailboxOwner: true,
    // ... other fields
  }
});
```

### 4. Email Provider Factory

Update `createEmailProvider` to pass shared mailbox context:
```typescript
if (isMicrosoftProvider(emailAccount.account.provider)) {
  return new OutlookProvider(
    outlookClient,
    emailAccount.isSharedMailbox ? emailAccount.sharedMailboxOwner : undefined
  );
}
```

### 5. Testing Strategy

**Test cases needed:**
1. Primary mailbox still works (regression test)
2. Shared mailbox shows correct emails
3. Switching between primary and shared mailbox contexts
4. Shared mailbox permissions are respected
5. OAuth token refresh works for both
6. Disconnect doesn't break primary mailbox

### 6. Known Issues to Address

1. **Settings page error**: "Cannot create proxy" when loading shared mailboxes
   - Likely caused by SWR receiving unexpected data structure
   - Need to debug `/api/user/shared-mailboxes` response

2. **Permission scopes**: Verify that `Mail.Read.Shared` and `Mail.ReadWrite.Shared` scopes are sufficient
   - Currently in `utils/outlook/scopes.ts`
   - Already included in OAuth flow

3. **Calendar support**: Should shared mailbox access calendars?
   - May need separate permissions
   - Consider if this is in scope

## Implementation Order

1. ✅ **Phase 1: Database & Auth** (COMPLETED)
   - Schema changes to support multiple EmailAccounts per Account
   - OAuth callback fixes
   - Manual mailbox entry UI

2. **Phase 2: Outlook Client Updates** (IN PROGRESS)
   - Add shared mailbox email parameter to OutlookClient
   - Create helper method for base URL determination
   - Update client factory methods

3. **Phase 3: API Endpoint Updates**
   - Update all `/me/` references to use dynamic base URL
   - Test each module individually

4. **Phase 4: Provider Integration**
   - Update email provider factory
   - Pass shared mailbox context through stack
   - Update all query methods to fetch shared mailbox email

5. **Phase 5: Testing & Bug Fixes**
   - Fix settings page error
   - Test primary mailbox (regression)
   - Test shared mailbox access
   - Test context switching

6. **Phase 6: Documentation & Polish**
   - Update user documentation
   - Add inline code comments
   - Document limitations

## Risk Assessment

**High Risk:**
- Breaking primary mailbox functionality
- OAuth token issues with shared mailbox access

**Medium Risk:**
- Permission errors if user doesn't have proper delegated access
- Rate limiting issues with multiple mailboxes

**Low Risk:**
- UI/UX issues
- Performance degradation

## Rollback Plan

- Feature is isolated to Microsoft provider
- Can be disabled by not showing shared mailbox UI for Microsoft accounts
- Database changes are non-breaking (added fields, not removed)
- Can always revert to primary mailbox only

## Success Criteria

- [ ] Primary mailbox continues to work without regression
- [ ] Shared mailbox shows its own emails, not primary mailbox emails
- [ ] Can switch between primary and shared mailbox contexts
- [ ] No errors on settings page
- [ ] Disconnect doesn't break primary mailbox
- [ ] All tests pass

## Notes

- Google Workspace doesn't use the same shared mailbox concept - they use delegation which works differently
- This implementation is Microsoft-specific
- Consider future: should we support multiple shared mailboxes? (Yes - already done in schema)
