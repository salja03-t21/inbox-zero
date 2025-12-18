# Spec: Linting Fixes and Premium Removal

## Overview

This spec covers two major cleanup initiatives:

1. **Fix all linting issues** - Resolve all 118 biome lint warnings to achieve zero lint errors
2. **Remove Premium system** - Make all Premium/LIFETIME capabilities available to ALL enabled users from creation

## Goals

### 1. Zero Lint Errors

- Fix all 118 biome lint warnings across 50+ files
- Ensure `pnpm biome check apps/web` returns 0 warnings
- Categories of issues to fix:
  - `noUnusedFunctionParameters` - Remove or use unused function parameters
  - `useUniqueElementIds` - Replace static IDs with `useId()` hooks
  - `noUnusedVariables` - Remove unused variables
  - `noLabelWithoutControl` - Associate labels with form controls using htmlFor
  - `noExplicitAny` - Replace `any` types with proper types
  - `useAriaSortOnlyOnTableHeaders` - Fix ARIA usage

### 2. Remove Premium System

- Remove all Premium tier checks throughout the codebase
- Make all features available to all enabled users
- Remove Premium-related:
  - Database queries filtering by premium status
  - UI components showing premium upsells/modals
  - API middleware checking premium status
  - Premium tier enums and types (keep table for migration compatibility)
- Keep the Premium database table for migration compatibility but stop using it

## Files Affected

### Linting Issues (50+ files)

See lint output for complete list. Major categories:

**Settings Components (7 files):**

- DigestScheduleForm.tsx - static IDs
- DigestSettingsForm.tsx - static IDs
- EmailUpdatesSection.tsx - static IDs
- MeetingSchedulerSection.tsx - static IDs
- MultiAccountSection.tsx - unused variables, static IDs
- SharedMailboxSection.tsx - label associations, static IDs
- ConfirmationStep.tsx - unused parameters

**Landing Pages (3 files):**

- FAQs.tsx - static IDs
- Privacy.tsx - static IDs
- SquaresPattern.tsx - static IDs

**Utils (20+ files):**

- Multiple files with `noExplicitAny` issues
- Various unused variables and parameters

### Premium System Removal (estimated 30+ files)

Key files to modify:

- `apps/web/utils/premium/index.ts` - Main premium utilities
- `apps/web/utils/actions/premium.ts` - Premium actions
- `apps/web/app/(app)/premium/*` - Premium pages/components
- `apps/web/utils/auth.ts` - Auto-premium creation
- `apps/web/utils/inngest/functions/watch-renew.ts` - Premium tier checks
- All files with `hasAiAccess`, `isPremium`, `PremiumTier` usage

## Non-Goals

- Do not delete the Premium database table (keep for migration compatibility)
- Do not remove Stripe/Lemon Squeezy integration code (may be used later)
- Do not change the database schema

## Success Criteria

1. `pnpm biome check apps/web` returns 0 warnings
2. All users have access to all features without premium checks
3. Application builds and runs without errors
4. All existing tests pass
5. New user creation works without premium record creation

## Implementation Phases

### Phase 1: Linting Fixes

Fix all 118 lint warnings across 50+ files

### Phase 2: Premium Removal

1. Identify all premium check locations
2. Modify `hasAiAccess` to always return true
3. Modify `isPremium` to always return true
4. Remove premium tier checks from queries
5. Remove premium upsell UI components
6. Remove auto-premium creation from auth flow
7. Update tests

### Phase 3: Verification

1. Run full lint check
2. Run test suite
3. Manual testing of key features
4. Deploy to staging/production
