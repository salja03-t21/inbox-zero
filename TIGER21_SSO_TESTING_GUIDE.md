# TIGER 21 Okta SSO Testing Guide

**Production URL**: https://iz.tiger21.com  
**Last Updated**: December 16, 2025  
**SSO Status**: ✅ Configured and Working

## Overview

This guide provides comprehensive instructions for testing the Okta Single Sign-On (SSO) integration with the TIGER 21 Inbox Zero deployment. The SSO implementation uses SAML 2.0 protocol and is configured to work with TIGER 21's existing Okta infrastructure.

## Prerequisites

### For Testers

- Valid TIGER 21 email address (ending in `@tiger21.com` or `@tiger21chair.com`)
- Access to TIGER 21 Okta portal
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Network access to https://iz.tiger21.com

### For Administrators

- Okta Admin access to configure applications
- Access to server logs for troubleshooting
- Understanding of SAML 2.0 concepts

## SSO Configuration Details

### Application Settings

- **Application Name**: Inbox Zero
- **Application URL**: https://iz.tiger21.com
- **SSO URL**: https://iz.tiger21.com/api/sso/signin
- **Audience URI**: https://iz.tiger21.com
- **Protocol**: SAML 2.0
- **Name ID Format**: EmailAddress

### Attribute Mapping

| Okta Attribute   | SAML Attribute | Application Field |
| ---------------- | -------------- | ----------------- |
| user.email       | email          | Email Address     |
| user.firstName   | firstName      | First Name        |
| user.lastName    | lastName       | Last Name         |
| user.displayName | displayName    | Display Name      |

## Testing Procedures

### Test 1: Basic SSO Login Flow

**Objective**: Verify that users can successfully log in using Okta SSO

**Steps**:

1. **Navigate to Application**

   ```
   Open browser and go to: https://iz.tiger21.com
   ```

2. **Initiate SSO Login**
   - Click on "Sign In" button
   - Look for "Sign in with SSO" or "Single Sign-On" option
   - Click the SSO login button

3. **Okta Authentication**
   - Browser should redirect to Okta login page
   - URL should contain `tiger21.okta.com` or similar
   - Enter your TIGER 21 credentials if not already logged in
   - Complete any MFA challenges if prompted

4. **Return to Application**
   - Browser should redirect back to https://iz.tiger21.com
   - You should be logged in automatically
   - Check that your name/email appears in the top right corner

**Expected Results**:

- ✅ Successful redirect to Okta
- ✅ Successful authentication with Okta
- ✅ Successful redirect back to application
- ✅ User is logged in with correct profile information

**Troubleshooting**:

- If redirect fails, check browser console for JavaScript errors
- If authentication fails, verify user has access to Inbox Zero app in Okta
- If return redirect fails, check SAML response in browser developer tools

### Test 2: User Profile Information

**Objective**: Verify that user profile data is correctly populated from Okta

**Steps**:

1. **Complete Test 1** (successful SSO login)

2. **Check Profile Information**
   - Navigate to user profile/settings page
   - Verify the following fields are populated:
     - Email address (should match Okta email)
     - First name
     - Last name
     - Display name

3. **Verify Email Domain Restriction**
   - Profile email should end with `@tiger21.com` or `@tiger21chair.com`
   - Non-TIGER 21 emails should not be able to access the application

**Expected Results**:

- ✅ Email address matches Okta profile
- ✅ Name fields are correctly populated
- ✅ Only TIGER 21 domain emails can access

### Test 3: Session Management

**Objective**: Test session persistence and logout functionality

**Steps**:

1. **Complete Test 1** (successful SSO login)

2. **Test Session Persistence**
   - Close browser tab (not entire browser)
   - Reopen https://iz.tiger21.com in new tab
   - Should remain logged in without re-authentication

3. **Test Browser Restart**
   - Close entire browser
   - Reopen browser and navigate to https://iz.tiger21.com
   - May need to re-authenticate depending on session settings

4. **Test Logout**
   - Click logout button in application
   - Should be redirected to logout confirmation page
   - Attempting to access protected pages should require re-authentication

**Expected Results**:

- ✅ Session persists across tabs
- ✅ Session behavior consistent with security policies
- ✅ Logout properly terminates session

### Test 4: Multiple Browser/Device Testing

**Objective**: Verify SSO works across different browsers and devices

**Test Matrix**:
| Browser | Device | Test Status |
|---------|--------|-------------|
| Chrome | Desktop | ⬜ |
| Firefox | Desktop | ⬜ |
| Safari | Desktop | ⬜ |
| Edge | Desktop | ⬜ |
| Chrome | Mobile | ⬜ |
| Safari | Mobile | ⬜ |

**Steps for Each Browser/Device**:

1. Navigate to https://iz.tiger21.com
2. Complete SSO login flow (Test 1)
3. Verify profile information (Test 2)
4. Test basic application functionality

**Expected Results**:

- ✅ SSO works consistently across all browsers
- ✅ No browser-specific issues
- ✅ Mobile experience is functional

### Test 5: Error Handling

**Objective**: Verify proper error handling for various failure scenarios

**Test Scenarios**:

#### 5.1 Invalid User Access

**Steps**:

1. Have a user without Inbox Zero app access attempt to log in
2. User should be denied access with clear error message

**Expected Results**:

- ✅ Clear error message about access denied
- ✅ User is not logged into application
- ✅ No sensitive information exposed in error

#### 5.2 Network Connectivity Issues

**Steps**:

1. Simulate network interruption during SSO flow
2. Test application behavior when Okta is unreachable

**Expected Results**:

- ✅ Graceful error handling
- ✅ User-friendly error messages
- ✅ Option to retry authentication

#### 5.3 SAML Response Tampering

**Steps**:

1. Use browser developer tools to modify SAML response
2. Attempt to complete authentication

**Expected Results**:

- ✅ Authentication fails
- ✅ Security error logged
- ✅ No unauthorized access granted

### Test 6: Performance Testing

**Objective**: Verify SSO performance meets acceptable standards

**Metrics to Measure**:

- Time from SSO initiation to Okta redirect: < 2 seconds
- Time for Okta authentication: < 5 seconds (excluding user input)
- Time from Okta callback to application login: < 3 seconds
- Total SSO flow time: < 10 seconds

**Steps**:

1. Use browser developer tools to measure timing
2. Record Network tab during SSO flow
3. Measure each phase of the authentication process

**Expected Results**:

- ✅ All timing metrics within acceptable ranges
- ✅ No unnecessary network requests
- ✅ Efficient SAML processing

## Automated Testing

### Health Check Script

Use the provided health monitoring script to verify SSO endpoints:

```bash
# Basic health check including SSO endpoints
./scripts/tiger21-health-monitor.sh --verbose

# Check SSO-specific endpoints
curl -I https://iz.tiger21.com/api/sso/signin
curl -I https://iz.tiger21.com/api/sso/callback
```

### Load Testing

For load testing SSO functionality:

```bash
# Install artillery if not already installed
npm install -g artillery

# Create load test configuration
cat > sso-load-test.yml << EOF
config:
  target: 'https://iz.tiger21.com'
  phases:
    - duration: 60
      arrivalRate: 5
scenarios:
  - name: "SSO Login Flow"
    requests:
      - get:
          url: "/"
      - get:
          url: "/api/sso/signin"
EOF

# Run load test
artillery run sso-load-test.yml
```

## Troubleshooting Guide

### Common Issues

#### Issue 1: "Access Denied" Error

**Symptoms**: User gets access denied after Okta authentication
**Causes**:

- User not assigned to Inbox Zero app in Okta
- Email domain not in allowed list
- Application configuration error

**Solutions**:

1. Check Okta app assignments
2. Verify email domain in application logs
3. Check environment variable `ALLOWED_EMAIL_DOMAINS`

#### Issue 2: Infinite Redirect Loop

**Symptoms**: Browser keeps redirecting between application and Okta
**Causes**:

- Session affinity not working
- Cookie configuration issues
- SAML configuration mismatch

**Solutions**:

1. Check Traefik sticky session configuration
2. Verify cookie settings in browser
3. Compare SAML metadata between Okta and application

#### Issue 3: SAML Signature Verification Failed

**Symptoms**: Authentication fails with signature error
**Causes**:

- Certificate mismatch
- Clock synchronization issues
- SAML configuration error

**Solutions**:

1. Verify SAML certificate in Okta matches application
2. Check server time synchronization
3. Review SAML configuration in application

### Diagnostic Commands

#### Check Application Logs

```bash
# View SSO-related logs
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i sso'

# View authentication logs
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app | grep -i auth'

# View recent errors
ssh root@167.99.116.99 'docker service logs inbox-zero-tiger21_app --since 10m | grep -i error'
```

#### Check SAML Configuration

```bash
# Verify SAML metadata endpoint
curl https://iz.tiger21.com/api/sso/metadata

# Check SSO signin endpoint
curl -I https://iz.tiger21.com/api/sso/signin
```

#### Check Environment Variables

```bash
# Verify SSO configuration (on server)
ssh root@167.99.116.99 'cd ~/IT-Configs/docker_swarm/inbox-zero && grep -E "(SSO|SAML)" .env.tiger21'
```

### Log Analysis

#### Successful SSO Login Log Pattern

```
[timestamp] INFO: SSO signin initiated for user
[timestamp] INFO: SAML request generated
[timestamp] INFO: Redirecting to Okta for authentication
[timestamp] INFO: SAML response received from Okta
[timestamp] INFO: SAML signature verified successfully
[timestamp] INFO: User authenticated: user@tiger21.com
[timestamp] INFO: Session created for user
```

#### Failed SSO Login Log Pattern

```
[timestamp] ERROR: SAML signature verification failed
[timestamp] ERROR: User not authorized: user@external.com
[timestamp] ERROR: Invalid SAML response format
[timestamp] ERROR: Session creation failed
```

## Security Considerations

### SAML Security Best Practices

1. **Certificate Management**
   - SAML certificates should be rotated annually
   - Private keys must be securely stored
   - Certificate expiration monitoring required

2. **Response Validation**
   - All SAML responses must be signed
   - Signature verification is mandatory
   - Response timing validation prevents replay attacks

3. **Session Security**
   - Sessions use secure, HTTP-only cookies
   - Session timeout configured appropriately
   - Session affinity prevents session hijacking

### Monitoring and Alerting

Set up monitoring for:

- Failed SSO authentication attempts
- SAML certificate expiration
- Unusual login patterns
- Performance degradation

## Test Results Template

Use this template to document test results:

```markdown
## SSO Test Results - [Date]

**Tester**: [Name]
**Environment**: Production (https://iz.tiger21.com)
**Browser**: [Browser and Version]
**Device**: [Desktop/Mobile]

### Test Results

| Test               | Status | Notes |
| ------------------ | ------ | ----- |
| Basic SSO Login    | ✅/❌  |       |
| User Profile Data  | ✅/❌  |       |
| Session Management | ✅/❌  |       |
| Cross-Browser      | ✅/❌  |       |
| Error Handling     | ✅/❌  |       |
| Performance        | ✅/❌  |       |

### Issues Found

- [List any issues discovered]

### Recommendations

- [List any recommendations for improvement]

### Overall Assessment

- [ ] SSO is ready for production use
- [ ] SSO needs minor fixes before production
- [ ] SSO needs major fixes before production
```

## Contact Information

### Technical Support

- **Primary**: James Salmon (james.salmon@tiger21.com)
- **Backup**: TIGER 21 IT Team

### Okta Administration

- **Okta Admin Portal**: [Your Okta URL]
- **Okta Support**: Contact through Okta admin portal

### Application Support

- **Application Logs**: Available via health monitoring script
- **Infrastructure**: DigitalOcean support for server issues
- **Code Issues**: GitHub repository for bug reports

---

## Appendix

### SAML Metadata Example

The application exposes SAML metadata at:

```
https://iz.tiger21.com/api/sso/metadata
```

This metadata should be imported into Okta when configuring the application.

### Environment Variables Reference

Key SSO-related environment variables:

```bash
ENABLE_SSO_AUTH=true
SAML_ISSUER=https://iz.tiger21.com
SAML_CALLBACK_URL=https://iz.tiger21.com/api/sso/callback
SAML_CERT_PATH=/app/certs/saml.crt
SAML_PRIVATE_KEY_PATH=/app/certs/saml.key
OKTA_SSO_URL=[Okta SSO URL]
OKTA_ISSUER=[Okta Issuer URL]
OKTA_CERT=[Okta Certificate]
```

### Additional Resources

- [SAML 2.0 Specification](https://docs.oasis-open.org/security/saml/v2.0/)
- [Okta SAML Documentation](https://developer.okta.com/docs/concepts/saml/)
- [TIGER 21 IT Policies](internal-link-to-policies)
