# Implementation Plan: Security Vulnerability Fixes

**Branch**: `001-security-fixes` | **Date**: 2025-12-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-security-fixes/spec.md`

## Summary

This plan addresses Critical and High severity security vulnerabilities identified in a comprehensive security audit. The fixes include: open redirect prevention in login flow, SSRF protection for webhooks, admin privilege escalation prevention, IDOR fix in admin endpoints, secret masking in API responses, removal of sensitive debug logging, and Vercel analytics console error fixes. Additionally, the upstream git remote reference will be removed.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+  
**Primary Dependencies**: Next.js 15, Better Auth, Prisma, Zod  
**Storage**: PostgreSQL via Prisma  
**Testing**: Vitest  
**Target Platform**: Linux server (Docker), self-hosted  
**Project Type**: Web application (Next.js App Router)  
**Performance Goals**: No degradation from security fixes  
**Constraints**: Must not break existing authentication flows, must be backward compatible  
**Scale/Scope**: Tiger21 production deployment (~100 users)

## Constitution Check

_GATE: All security fixes follow principle of least privilege and defense in depth._

- ✅ No new dependencies added (uses existing Zod, URL API)
- ✅ No breaking changes to existing APIs
- ✅ All changes are additive security hardening
- ✅ Follows existing middleware patterns
- ✅ Uses existing error handling (SafeError)

## Project Structure

### Documentation (this feature)

```text
specs/001-security-fixes/
├── spec.md              # Feature specification
├── plan.md              # This file
├── checklists/
│   └── requirements.md  # Quality validation checklist
└── tasks.md             # Implementation tasks (created by /speckit.tasks)
```

### Source Code Changes

```text
apps/web/
├── app/
│   ├── (landing)/
│   │   └── login/
│   │       ├── page.tsx              # FIX: Open redirect validation
│   │       └── sso/
│   │           └── page.tsx          # FIX: Remove console.log statements
│   ├── api/
│   │   ├── admin/
│   │   │   └── fix-sso-config/
│   │   │       └── route.ts          # FIX: Remove secret logging, redact response
│   │   └── user/
│   │       ├── me/
│   │       │   └── route.ts          # FIX: Mask secrets in response
│   │       └── admin/
│   │           └── rules/
│   │               └── [emailAccountId]/
│   │                   └── route.ts  # FIX: IDOR - verify org membership
│   └── layout.tsx                    # FIX: Conditional Vercel Analytics
├── utils/
│   ├── admin.ts                      # FIX: Exact email matching
│   ├── webhook.ts                    # FIX: SSRF URL validation
│   ├── security/
│   │   ├── redirect.ts               # NEW: Redirect URL validation
│   │   └── url.ts                    # NEW: Webhook URL validation
│   └── env.ts                        # ADD: NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED
└── __tests__/
    └── security/
        ├── redirect-validation.test.ts  # NEW: Redirect tests
        ├── url-validation.test.ts        # NEW: URL validation tests
        └── admin-check.test.ts           # NEW: Admin check tests
```

## Implementation Tasks

### Phase 1: Critical Security Fixes (P1)

#### Task 1.1: Fix Open Redirect in Login Page

**File**: `apps/web/app/(landing)/login/page.tsx`
**Priority**: CRITICAL

**Current Code (vulnerable)**:

```typescript
if (searchParams?.next) {
  redirect(searchParams?.next); // No validation!
}
```

**Implementation**:

1. Create `apps/web/utils/security/redirect.ts`:

```typescript
import { env } from "@/env";

/**
 * Validates that a redirect URL is safe (same-origin only).
 * Prevents open redirect attacks.
 */
export function isValidRedirectUrl(url: string | undefined): boolean {
  if (!url) return false;

  // Allow relative paths (but not protocol-relative)
  if (url.startsWith("/") && !url.startsWith("//")) {
    // Block javascript: URLs disguised as paths
    if (url.toLowerCase().includes("javascript:")) return false;
    return true;
  }

  // Check for same-origin absolute URLs
  try {
    const parsed = new URL(url);
    const baseUrl = new URL(env.NEXT_PUBLIC_BASE_URL);
    return parsed.origin === baseUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Returns the redirect URL if valid, otherwise returns the fallback.
 */
export function getSafeRedirectUrl(
  url: string | undefined,
  fallback: string,
): string {
  return isValidRedirectUrl(url) ? url! : fallback;
}
```

2. Update login page:

```typescript
import { getSafeRedirectUrl } from "@/utils/security/redirect";

// Replace direct redirect with validated redirect
if (session?.user && !searchParams?.error) {
  redirect(getSafeRedirectUrl(searchParams?.next, WELCOME_PATH));
}
```

---

#### Task 1.2: Fix SSRF in Webhook Handler

**File**: `apps/web/utils/webhook.ts`
**Priority**: HIGH

**Implementation**:

1. Create `apps/web/utils/security/url.ts`:

```typescript
/**
 * Validates webhook URLs to prevent SSRF attacks.
 * Blocks: private IPs, localhost, metadata endpoints, non-HTTPS
 */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Require HTTPS
    if (parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    ) {
      return false;
    }

    // Block private IP ranges (RFC 1918)
    if (
      hostname.match(/^10\./) ||
      hostname.match(/^192\.168\./) ||
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
      hostname.match(/^169\.254\./)
    ) {
      // Link-local / cloud metadata
      return false;
    }

    // Block internal/local TLDs
    if (
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".localhost")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
```

2. Update `webhook.ts`:

```typescript
import { isValidWebhookUrl } from "@/utils/security/url";

export const callWebhook = async (
  userId: string,
  url: string,
  payload: WebhookPayload,
) => {
  if (!url) throw new Error("Webhook URL is required");
  if (!isValidWebhookUrl(url)) throw new Error("Invalid webhook URL: must be HTTPS and not target internal services");
  // ... rest unchanged
```

---

#### Task 1.3: Fix Admin Check Partial Match

**File**: `apps/web/utils/admin.ts`
**Priority**: HIGH

**Current Code (vulnerable)**:

```typescript
if (email && env.ADMINS?.includes(email)) {
  return true;
}
```

**Implementation**:

```typescript
// Replace includes() with exact match
if (email) {
  const adminList =
    env.ADMINS?.split(",").map((e) => e.trim().toLowerCase()) ?? [];
  if (adminList.includes(email.toLowerCase())) {
    logger.info("User is admin via ADMINS env variable", { email });
    return true;
  }
}
```

---

#### Task 1.4: Fix IDOR in Admin Rules Endpoint

**File**: `apps/web/app/api/user/admin/rules/[emailAccountId]/route.ts`
**Priority**: HIGH

**Current Code (vulnerable)**:

```typescript
// Only checks if user is admin in ANY organization
const isAdmin = requestingUser.emailAccounts.some((account) =>
  isOrganizationAdmin(account.members),
);
// Then fetches rules for ANY emailAccountId
```

**Implementation**:

```typescript
async function getAdminRules({
  userId,
  emailAccountId,
}: {
  userId: string;
  emailAccountId: string;
}) {
  // Get the target email account with its organization
  const targetEmailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    include: {
      members: true,
    },
  });

  if (!targetEmailAccount) {
    throw new Error("Email account not found");
  }

  // Check if the requesting user is an admin of the organization that owns this email account
  const userMembership = targetEmailAccount.members.find(
    (member) => member.userId === userId,
  );

  if (!userMembership || !isOrganizationAdmin([userMembership])) {
    throw new Error("Unauthorized: You must be an admin of this organization");
  }

  // Fetch rules for the verified email account
  const rules = await prisma.rule.findMany({
    where: { emailAccountId },
    include: {
      actions: true,
      group: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rules;
}
```

---

### Phase 2: High Priority Fixes (P2)

#### Task 2.1: Mask Secrets in /api/user/me

**File**: `apps/web/app/api/user/me/route.ts`
**Priority**: HIGH

**Implementation**:

```typescript
// Add helper function
function maskSecret(secret: string | null): string | null {
  if (!secret) return null;
  if (secret.length <= 4) return "****";
  return "***" + secret.slice(-4);
}

// Update getUser function to mask secrets before returning
return {
  ...user,
  aiApiKey: maskSecret(user.aiApiKey),
  webhookSecret: user.webhookSecret ? "********" : null,
  // Add boolean flags for UI
  hasAiApiKey: !!user.aiApiKey,
  hasWebhookSecret: !!user.webhookSecret,
};
```

---

#### Task 2.2: Remove Client Console Logs in SSO

**File**: `apps/web/app/(landing)/login/sso/page.tsx`
**Priority**: HIGH

**Implementation**: Remove or condition all console.log statements:

```typescript
// Remove these lines (44, 58, 61, 64, 75, 78, 82, 98):
// console.log("[SSO Login] Starting SSO signin flow...", { providerId });
// console.log("[SSO Login] Response status:", response.status);
// etc.

// Or condition for development only:
if (process.env.NODE_ENV === "development") {
  console.log("[SSO Login] Starting SSO signin flow...", { providerId });
}
```

---

#### Task 2.3: Fix SSO Client Secret Logging

**File**: `apps/web/app/api/admin/fix-sso-config/route.ts`
**Priority**: HIGH

**Current Code (vulnerable)**:

```typescript
logger.info("Client secret from env", {
  length: clientSecret.length,
  firstChar: clientSecret[0],
  lastChar: clientSecret[clientSecret.length - 1],
  // ...
});
```

**Implementation**:

```typescript
// Replace with safe logging
logger.info("Client secret from env", {
  hasValue: !!clientSecret,
});

// Also redact clientSecret from response
return NextResponse.json({
  success: true,
  old: {
    raw: "[REDACTED]", // Don't return raw config
    type: typeof provider.oidcConfig,
  },
  new: {
    raw: "[REDACTED]", // Don't return raw config
    parsed: parsedConfig
      ? { ...parsedConfig, clientSecret: "[REDACTED]" }
      : null,
    parseError,
  },
  message: "Updated OIDC config successfully",
});
```

---

### Phase 3: Medium Priority Fixes (P3)

#### Task 3.1: Fix Vercel Analytics Console Errors

**Files**: `apps/web/env.ts`, `apps/web/app/layout.tsx`
**Priority**: MEDIUM

**Implementation**:

1. Add to `env.ts` client section:

```typescript
NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED: z.coerce.boolean().optional().default(false),
```

2. Add to `env.ts` experimental\_\_runtimeEnv section:

```typescript
NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED: process.env.NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED,
```

3. Update `layout.tsx`:

```typescript
{!env.NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED && (
  <>
    <Analytics />
    <SpeedInsights />
  </>
)}
```

4. Add to `.env.example`:

```bash
# Self-hosted: Set to "true" to disable Vercel Analytics (prevents console errors)
NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED=false
```

---

#### Task 3.2: Remove Upstream Git Remote

**Priority**: MEDIUM

**Implementation**:

```bash
git remote remove upstream
```

Verify:

```bash
git remote -v
# Should only show origin and tiger21
```

---

## Testing Strategy

### Unit Tests to Create

1. **`__tests__/security/redirect-validation.test.ts`**:
   - Test relative paths are allowed
   - Test same-origin absolute URLs are allowed
   - Test external URLs are blocked
   - Test protocol-relative URLs are blocked
   - Test javascript: URLs are blocked
   - Test URL-encoded bypass attempts are blocked

2. **`__tests__/security/url-validation.test.ts`**:
   - Test valid HTTPS URLs pass
   - Test HTTP URLs are blocked
   - Test localhost variants are blocked
   - Test private IP ranges are blocked
   - Test cloud metadata IPs are blocked
   - Test internal TLDs are blocked

3. **`__tests__/security/admin-check.test.ts`**:
   - Test exact email match works
   - Test partial email match is blocked
   - Test case insensitivity works
   - Test whitespace trimming works

### Manual Testing Checklist

- [ ] Login with `?next=/settings` redirects to settings
- [ ] Login with `?next=https://evil.com` redirects to welcome
- [ ] Login with `?next=//evil.com` redirects to welcome
- [ ] Webhook save with private IP fails
- [ ] Webhook save with valid HTTPS URL succeeds
- [ ] `/api/user/me` returns masked secrets
- [ ] No console.log in production SSO flow
- [ ] No Vercel errors in console when disabled
- [ ] `git remote -v` shows no upstream

## Rollback Plan

If any issues are discovered after deployment:

1. **Immediate**: Revert the specific commit causing issues
2. **If auth is broken**: Emergency hotfix to restore previous login logic
3. **If webhooks fail**: Temporarily disable URL validation

Each fix is independent and can be reverted individually without affecting other fixes.

## Complexity Tracking

No constitutional violations. All changes follow existing patterns:

- Middleware pattern (withAuth, withError)
- Zod validation pattern
- SafeError for user-facing errors
- Prisma for database access
