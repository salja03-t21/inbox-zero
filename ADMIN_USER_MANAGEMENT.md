# Admin User Management Feature

## Overview

This feature adds an "Admin" tab to the Settings page that allows administrators to view and manage all users and their automation rules.

## Branch

- **Feature Branch**: `feature/admin-user-management`
- Created from: `production`

## Files Created

### API Routes

1. **`apps/web/app/api/user/admin/users/route.ts`**
   - GET endpoint to fetch all users with their email accounts and rule counts
   - Requires admin permissions (checks `isOrganizationAdmin`)
   - Returns user list with email accounts and rule counts

2. **`apps/web/app/api/user/admin/rules/[emailAccountId]/route.ts`**
   - GET endpoint to fetch all rules for a specific email account
   - Requires admin permissions
   - Returns detailed rule information including actions and groups

### Server Actions

3. **`apps/web/utils/actions/admin-rule.validation.ts`**
   - Zod validation schemas for admin rule management
   - `adminToggleRuleBody`: Schema for enabling/disabling rules
   - `adminDeleteRuleBody`: Schema for deleting rules

4. **`apps/web/utils/actions/admin-rule.ts`**
   - Server actions for admin rule management
   - `adminToggleRuleAction`: Enable/disable a user's rule
   - `adminDeleteRuleAction`: Delete a user's rule
   - Custom `adminActionClient` that verifies admin permissions

### Hooks

5. **`apps/web/hooks/useAdminUsers.ts`**
   - SWR hook for fetching all users
   - Fetches from `/api/user/admin/users`

6. **`apps/web/hooks/useAdminRules.ts`**
   - SWR hook for fetching rules for a specific email account
   - Fetches from `/api/user/admin/rules/[emailAccountId]`

### UI Components

7. **`apps/web/app/(app)/[emailAccountId]/settings/AdminUserManagementSection.tsx`**
   - Main admin user management section
   - Displays table of all users with their email accounts
   - Shows rule counts and "View Rules" buttons for accounts with rules
   - Opens modal to view/manage rules

8. **`apps/web/app/(app)/[emailAccountId]/settings/AdminUserRulesModal.tsx`**
   - Modal dialog for viewing and managing user rules
   - Displays table of rules with:
     - Rule name and group
     - Status (Enabled/Disabled)
     - Action types
     - Creation date
   - Actions:
     - Enable/Disable button (with loading state)
     - Delete button (with confirmation dialog)
   - Uses `AlertDialog` for delete confirmation

### Modified Files

9. **`apps/web/app/(app)/[emailAccountId]/settings/page.tsx`**
   - Added import for `AdminUserManagementSection`
   - Added "Admin" tab trigger
   - Added "Admin" tab content with `AdminUserManagementSection`

## Features

### User List
- View all users in the system
- Display user name, email, and join date
- List all email accounts per user
- Show rule counts per email account
- Quick access to view rules for accounts with active rules

### Rule Management
- View all rules for a specific user/email account
- See rule details:
  - Name
  - Status (Enabled/Disabled)
  - Actions configured
  - Group association
  - Creation date
- Enable/disable individual rules
- Delete rules with confirmation
- Real-time feedback with toast notifications

## Security

- All admin endpoints require admin permissions via `isOrganizationAdmin` check
- Users must be an admin in at least one organization to access admin features
- Rule operations verify that the rule belongs to the specified email account
- Delete operations require explicit confirmation

## Access Control

Only users who are:
1. Already have access to Settings (only admins can access settings per existing logic)
2. Are organization admins (verified by `isOrganizationAdmin`)

Can access the Admin tab.

## Testing Checklist

### Manual Testing

1. **Access Control**
   - [ ] Verify only admins can see the Admin tab
   - [ ] Verify API returns 403 for non-admin users
   - [ ] Verify non-admins cannot access `/api/user/admin/*` endpoints

2. **User List**
   - [ ] All users are displayed
   - [ ] User information is accurate (name, email, join date)
   - [ ] Email accounts are listed for each user
   - [ ] Rule counts are accurate
   - [ ] "View Rules" button only appears for accounts with rules
   - [ ] "No rules" text appears for accounts without rules

3. **Rules Modal**
   - [ ] Modal opens when clicking "View Rules"
   - [ ] All rules for the user are displayed
   - [ ] Rule information is accurate
   - [ ] Enable/Disable button works correctly
   - [ ] Enable/Disable button shows loading state
   - [ ] Delete button opens confirmation dialog
   - [ ] Deleting a rule requires confirmation
   - [ ] Modal closes after successful operations
   - [ ] User list refreshes after modal closes

4. **Error Handling**
   - [ ] Toast notifications appear for errors
   - [ ] Toast notifications appear for success
   - [ ] Loading states are displayed appropriately
   - [ ] Error states are displayed appropriately

5. **UI/UX**
   - [ ] Tables are responsive
   - [ ] Modal is scrollable for many rules
   - [ ] Badges display correctly
   - [ ] Buttons are appropriately disabled during operations
   - [ ] Date formatting is human-readable (e.g., "2 days ago")

## Development Commands

```bash
# Start development server
pnpm dev

# Type check (if not running out of memory)
pnpm tsc --noEmit

# Build
pnpm build

# Format and lint
pnpm format-and-lint:fix
```

## Deployment

Before deploying:
1. Test all features manually
2. Verify type checking passes
3. Run `pnpm build` to ensure production build works
4. Test on staging environment if available

Deploy using:
```bash
./deploy-production.sh
```

## Future Enhancements

Potential improvements:
1. Bulk operations (enable/disable multiple rules at once)
2. Search/filter users
3. Search/filter rules within modal
4. Export user/rule data
5. Audit log for admin actions
6. User activity statistics
7. Rule execution statistics per user
8. Impersonation feature for troubleshooting
