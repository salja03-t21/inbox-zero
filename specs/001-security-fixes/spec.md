# Feature Specification: Security Vulnerability Fixes

**Feature Branch**: `001-security-fixes`  
**Created**: 2025-12-18  
**Status**: Draft  
**Input**: User description: "Fix Critical and High security vulnerabilities including open redirect, SSO account hijacking, SSRF in webhooks, admin privilege escalation, Vercel console errors, and remove upstream repository reference"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Prevent Open Redirect Attacks (Priority: P1)

As a user logging into the application, I should only be redirected to trusted internal pages after authentication, preventing attackers from redirecting me to malicious phishing sites.

**Why this priority**: Open redirect is a CRITICAL vulnerability that can be exploited immediately to steal credentials via phishing. An attacker can craft a URL like `https://app.com/login?next=https://evil.com` that appears legitimate but redirects to a malicious site after login.

**Independent Test**: Can be tested by attempting to login with various `?next=` parameter values including external URLs, protocol-relative URLs, and javascript: URLs. The system should only redirect to same-origin paths.

**Acceptance Scenarios**:

1. **Given** a user is not authenticated, **When** they access `/login?next=https://evil.com`, **Then** after successful login they are redirected to the default welcome page, NOT to evil.com
2. **Given** a user is not authenticated, **When** they access `/login?next=/settings`, **Then** after successful login they are redirected to `/settings` (valid internal path)
3. **Given** a user is not authenticated, **When** they access `/login?next=//evil.com`, **Then** after successful login they are redirected to the default welcome page (protocol-relative URLs blocked)
4. **Given** a user is not authenticated, **When** they access `/login?next=javascript:alert(1)`, **Then** after successful login they are redirected to the default welcome page (javascript: URLs blocked)

---

### User Story 2 - Prevent SSRF in Webhook Handler (Priority: P1)

As an administrator configuring webhooks, the system should prevent me from accidentally or maliciously configuring webhook URLs that target internal services, cloud metadata endpoints, or localhost.

**Why this priority**: SSRF (Server-Side Request Forgery) is a HIGH severity vulnerability that can expose cloud credentials, internal APIs, and enable lateral movement within infrastructure.

**Independent Test**: Can be tested by attempting to save webhook URLs pointing to internal IPs, localhost, cloud metadata endpoints (169.254.169.254), and file:// URLs. All should be rejected.

**Acceptance Scenarios**:

1. **Given** a user is configuring a webhook, **When** they enter `http://169.254.169.254/latest/meta-data/`, **Then** the system rejects the URL with an error message
2. **Given** a user is configuring a webhook, **When** they enter `http://localhost:5432/`, **Then** the system rejects the URL with an error message
3. **Given** a user is configuring a webhook, **When** they enter `http://10.0.0.1/internal-api`, **Then** the system rejects the URL with an error message
4. **Given** a user is configuring a webhook, **When** they enter `https://api.example.com/webhook`, **Then** the system accepts the URL (valid external HTTPS URL)
5. **Given** a user is configuring a webhook, **When** they enter `http://api.example.com/webhook` (HTTP not HTTPS), **Then** the system rejects the URL (HTTPS required)

---

### User Story 3 - Secure Admin Privilege Checks (Priority: P1)

As a system administrator, the admin check should use exact email matching, not substring matching, to prevent unauthorized users from gaining admin access.

**Why this priority**: Partial string matching in admin checks can lead to privilege escalation. If ADMINS="admin@company.com", a user with email "admin@company.co" or "badmin@company.com" could potentially gain admin access.

**Independent Test**: Can be tested by configuring ADMINS with specific emails and verifying that only exact matches grant admin access, not substrings or partial matches.

**Acceptance Scenarios**:

1. **Given** ADMINS is set to "admin@tiger21.com", **When** a user with email "admin@tiger21.com" attempts an admin action, **Then** they are granted access
2. **Given** ADMINS is set to "admin@tiger21.com", **When** a user with email "admin@tiger21.co" attempts an admin action, **Then** they are denied access
3. **Given** ADMINS is set to "admin@tiger21.com,other@tiger21.com", **When** a user with email "tiger21.com" attempts an admin action, **Then** they are denied access
4. **Given** ADMINS is set to "admin@tiger21.com", **When** a user with email "xadmin@tiger21.com" attempts an admin action, **Then** they are denied access

---

### User Story 4 - Fix IDOR in Admin Rules Endpoint (Priority: P1)

As an organization administrator, I should only be able to view rules for email accounts within my own organization, not rules from other organizations.

**Why this priority**: IDOR (Insecure Direct Object Reference) allows an admin of one organization to access data from another organization, violating data isolation and privacy.

**Independent Test**: Can be tested by having an admin from Organization A attempt to access `/api/user/admin/rules/{emailAccountIdFromOrgB}`. The request should be denied.

**Acceptance Scenarios**:

1. **Given** User A is admin of Organization A, **When** they request rules for an email account in Organization A, **Then** the rules are returned
2. **Given** User A is admin of Organization A, **When** they request rules for an email account in Organization B, **Then** they receive a 403 Forbidden error
3. **Given** User A is admin of Organization A but also a member of Organization B (not admin), **When** they request rules for an email account in Organization B, **Then** they receive a 403 Forbidden error

---

### User Story 5 - Protect Sensitive Data in API Responses (Priority: P2)

As a user of the application, my sensitive credentials (API keys, webhook secrets) should not be returned in plain text via API responses, preventing exposure through XSS or session hijacking.

**Why this priority**: Exposing secrets in API responses means any XSS vulnerability or compromised session can steal user credentials.

**Independent Test**: Can be tested by calling `/api/user/me` and verifying that aiApiKey and webhookSecret are either not returned or are masked.

**Acceptance Scenarios**:

1. **Given** a user has set an AI API key, **When** they call `/api/user/me`, **Then** the response contains only a masked version (e.g., `***abcd`) or a boolean indicating presence
2. **Given** a user has set a webhook secret, **When** they call `/api/user/me`, **Then** the response contains only a masked version or a boolean indicating presence
3. **Given** a user has not set an AI API key, **When** they call `/api/user/me`, **Then** the response indicates no key is set (null or false)

---

### User Story 6 - Remove Debug Logging from Client Code (Priority: P2)

As a user of the application, sensitive SSO flow information should not be logged to the browser console where it could be captured by screenshots, shoulder-surfing, or browser extensions.

**Why this priority**: Client-side console.log statements can expose sensitive data including tokens, session information, and authentication flow details.

**Independent Test**: Can be tested by performing an SSO login and checking that no sensitive data appears in the browser console.

**Acceptance Scenarios**:

1. **Given** a user initiates SSO login in production, **When** they complete the flow, **Then** no response data is logged to the console
2. **Given** a user initiates SSO login in development mode, **When** they complete the flow, **Then** debug information may be logged (development only)

---

### User Story 7 - Remove Secret Information from Admin Logs (Priority: P2)

As an administrator, sensitive secret characteristics (length, first/last characters) should not be logged, as this information aids brute-force attacks.

**Why this priority**: Logging partial secret information significantly reduces the search space for brute-force attacks if logs are compromised.

**Independent Test**: Can be tested by triggering the admin SSO config fix endpoint and verifying logs only contain boolean presence indicators, not secret characteristics.

**Acceptance Scenarios**:

1. **Given** an admin calls the fix-sso-config endpoint, **When** the operation is logged, **Then** logs only indicate whether a secret exists, not its length or characters
2. **Given** an admin calls the fix-sso-config endpoint, **When** the response is returned, **Then** the clientSecret is redacted from the response

---

### User Story 8 - Fix Vercel Analytics Console Errors (Priority: P3)

As a user of the self-hosted application, I should not see Vercel Analytics errors in the browser console since the application is not hosted on Vercel.

**Why this priority**: While not a security vulnerability, console errors create noise and may mask real issues. This is a polish item.

**Independent Test**: Can be tested by loading the application and verifying no Vercel-related errors appear in the console.

**Acceptance Scenarios**:

1. **Given** the application is self-hosted (not on Vercel), **When** a user loads any page, **Then** no Vercel Analytics errors appear in the console
2. **Given** the application is self-hosted, **When** NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED is set, **Then** Vercel Analytics components do not render

---

### User Story 9 - Remove Upstream Repository Reference (Priority: P3)

As a developer working on this forked codebase, the git configuration should only reference our fork (origin) and not the original upstream repository, preventing accidental pushes to the wrong repository.

**Why this priority**: Having the upstream remote configured creates a risk of accidentally pushing proprietary changes to the public repository.

**Independent Test**: Can be tested by running `git remote -v` and verifying only `origin` and `tiger21` remotes exist, not `upstream`.

**Acceptance Scenarios**:

1. **Given** the repository is cloned, **When** a developer runs `git remote -v`, **Then** no `upstream` remote pointing to elie222/inbox-zero is present
2. **Given** the upstream remote is removed, **When** a developer attempts `git fetch upstream`, **Then** the command fails with "remote not found"

---

### Edge Cases

- What happens when the `?next` parameter contains encoded characters (URL encoding bypass attempts)?
- How does the webhook URL validation handle IPv6 addresses pointing to localhost (::1)?
- What happens when an organization admin's role is removed while they have an active session?
- How does the system handle webhook URLs with non-standard ports?
- What happens when ADMINS env variable contains extra whitespace around emails?

## Requirements _(mandatory)_

### Functional Requirements

#### Critical Priority (P1)

- **FR-001**: System MUST validate redirect URLs in the login flow to only allow same-origin paths
- **FR-002**: System MUST reject redirect URLs that start with `//`, `http://`, `https://`, or `javascript:`
- **FR-003**: System MUST validate webhook URLs to block private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
- **FR-004**: System MUST validate webhook URLs to block localhost, 127.0.0.1, and ::1
- **FR-005**: System MUST validate webhook URLs to block cloud metadata endpoints (169.254.169.254)
- **FR-006**: System MUST require HTTPS protocol for all webhook URLs
- **FR-007**: System MUST use exact string matching (not substring) for admin email checks
- **FR-008**: System MUST split ADMINS env variable by comma and trim whitespace before matching
- **FR-009**: System MUST verify that target email accounts belong to organizations where the requesting user is an admin
- **FR-010**: System MUST return 403 Forbidden when an admin attempts to access another organization's data

#### High Priority (P2)

- **FR-011**: System MUST NOT return plain-text aiApiKey in `/api/user/me` response
- **FR-012**: System MUST NOT return plain-text webhookSecret in `/api/user/me` response
- **FR-013**: System MUST return masked versions (last 4 chars) or boolean presence indicators for secrets
- **FR-014**: System MUST NOT log secret length, characters, or identifying information
- **FR-015**: System MUST remove or condition console.log statements in SSO client code to development-only
- **FR-016**: System MUST redact clientSecret from admin API responses

#### Medium Priority (P3)

- **FR-017**: System SHOULD conditionally render Vercel Analytics components based on environment
- **FR-018**: System SHOULD check for NEXT_PUBLIC_VERCEL_ANALYTICS_DISABLED before rendering analytics
- **FR-019**: System MUST remove the `upstream` git remote reference to elie222/inbox-zero

### Key Entities

- **User**: Application user with potential admin privileges, owns email accounts
- **EmailAccount**: Email account belonging to a user, may be part of an organization
- **Organization**: Group of email accounts with admin/member roles
- **Webhook**: User-configured URL for receiving event notifications
- **Session**: Authentication session with redirect capabilities

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of open redirect attempts with external URLs are blocked and redirected to default page
- **SC-002**: 100% of webhook URLs targeting private IP ranges, localhost, or metadata endpoints are rejected
- **SC-003**: 0 admin privilege escalations possible via email substring matching
- **SC-004**: 0 cross-organization data access possible via IDOR in admin endpoints
- **SC-005**: 0 plain-text secrets visible in `/api/user/me` API response
- **SC-006**: 0 sensitive data logged in production browser console during SSO flow
- **SC-007**: 0 secret characteristics (length, chars) logged in production server logs
- **SC-008**: 0 Vercel-related console errors on self-hosted deployments
- **SC-009**: 0 references to upstream (elie222/inbox-zero) repository in git remotes

## Assumptions

- The application uses Better Auth for authentication
- ADMINS environment variable uses comma-separated email addresses
- Webhook URLs are stored in the database and validated before use
- The application may be self-hosted (not on Vercel) or hosted on Vercel
- Organization admin status is determined by the `isOrganizationAdmin` utility function
- SSO flow uses the `/api/sso/signin` endpoint
- This is a forked repository that should not reference the original upstream

## Out of Scope

- Session duration changes (30-day sessions) - requires separate discussion on UX tradeoffs
- Rate limiting on authentication endpoints - separate feature
- SSO trusted provider auto-linking changes - requires understanding of business requirements
- Domain restriction race condition - requires Better Auth middleware changes
- Signing SSO state cookies - requires Better Auth plugin changes
