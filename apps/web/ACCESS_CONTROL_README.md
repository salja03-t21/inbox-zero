# Access Control & Authentication Configuration

This application provides two types of access controls to manage authentication and user access.

## 1. Authentication Provider Control

Control which sign-in methods are available on the login page.

### Environment Variables

Add these to your `.env.local` file:

```bash
ENABLE_GOOGLE_AUTH=true
ENABLE_MICROSOFT_AUTH=true
ENABLE_SSO_AUTH=true
```

### Configuration Examples

**Allow only Google sign-in:**
```bash
ENABLE_GOOGLE_AUTH=true
ENABLE_MICROSOFT_AUTH=false
ENABLE_SSO_AUTH=false
```

**Allow only Microsoft and SSO:**
```bash
ENABLE_GOOGLE_AUTH=false
ENABLE_MICROSOFT_AUTH=true
ENABLE_SSO_AUTH=true
```

**Default (all methods enabled):**
```bash
ENABLE_GOOGLE_AUTH=true
ENABLE_MICROSOFT_AUTH=true
ENABLE_SSO_AUTH=true
```

### Behavior

- Each authentication method can be individually enabled or disabled
- If all methods are disabled, users will see an error message
- Changes require a server restart to take effect
- Default is `true` for all methods if not specified

---

## 2. Domain-Based Access Control

Restrict user sign-ups to specific email domains, regardless of which authentication method they use.

### Environment Variable

Add the following environment variable to your `.env.local` file:

```bash
ALLOWED_EMAIL_DOMAINS=example.com,company.org,partner.net
```

**Format**: Comma-separated list of allowed email domains (without @ symbol)

### Behavior

- **When configured**: Only users with email addresses from the specified domains can sign in
- **When empty/not set**: All domains are allowed (open access)
- **Domain matching**: Case-insensitive, exact domain match only
- **Works with all auth providers**: Applies to Google, Microsoft, and SSO authentication

## Example Configurations

### Allow single domain
```bash
ALLOWED_EMAIL_DOMAINS=mycompany.com
```
Only `user@mycompany.com` can sign in.

### Allow multiple domains
```bash
ALLOWED_EMAIL_DOMAINS=company.com,partner.org,team.net
```
Users from any of these three domains can sign in.

### Allow all domains (default)
```bash
# Leave empty or comment out
# ALLOWED_EMAIL_DOMAINS=
```
Any email domain is accepted.

## User Experience

When a user with an unauthorized email domain attempts to sign in, they will:

1. Complete the OAuth flow with Google/Microsoft/SSO
2. See an error message: **"Access Restricted"**
3. Receive the message: *"Your email domain is not authorized to access this application. Please contact your administrator if you believe this is an error."*

## Technical Details

### Implementation

- Domain check is performed in the `handleSignIn` event in `utils/auth.ts`
- Error code: `DomainNotAllowed`
- Logs unauthorized attempts with email and domain information
- Works with all auth providers (Google, Microsoft, SSO)

### Files Modified

**Authentication Provider Control:**
- `apps/web/env.ts` - Environment variable definitions
- `apps/web/.env.example` - Configuration examples
- `apps/web/app/(landing)/login/page.tsx` - Server-side prop passing
- `apps/web/app/(landing)/login/LoginForm.tsx` - Conditional button rendering
- `turbo.json` - Build configuration

**Domain-Based Access Control:**
- `apps/web/env.ts` - Environment variable definition
- `apps/web/.env.example` - Documentation and example
- `apps/web/utils/auth.ts` - Domain validation logic
- `apps/web/app/(landing)/login/page.tsx` - Error display
- `turbo.json` - Build configuration

## Combined Configuration Example

You can combine both types of access control. For example, to only allow Google sign-in for users from your company domain:

```bash
# Only enable Google authentication
ENABLE_GOOGLE_AUTH=true
ENABLE_MICROSOFT_AUTH=false
ENABLE_SSO_AUTH=false

# Only allow company email domain
ALLOWED_EMAIL_DOMAINS=mycompany.com
```

## Testing

### Test Authentication Provider Control

1. Set specific providers in `.env.local`:
   ```bash
   ENABLE_GOOGLE_AUTH=true
   ENABLE_MICROSOFT_AUTH=false
   ENABLE_SSO_AUTH=false
   ```
2. Restart your development server
3. Visit the login page - only the Google sign-in button should appear

### Test Domain Restriction

1. Set `ALLOWED_EMAIL_DOMAINS=yourdomain.com` in `.env.local`
2. Restart your development server
3. Attempt to sign in with an email from a different domain
4. You should see the "Access Restricted" error message
5. Attempt to sign in with an email from `yourdomain.com`
6. Sign-in should succeed

## Security Notes

- This is a **server-side** check performed during authentication
- The domain list is validated at build time through Zod schema
- Failed sign-in attempts are logged for security monitoring
- This does not restrict existing users - only new sign-ins
