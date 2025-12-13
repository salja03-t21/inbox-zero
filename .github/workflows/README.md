# GitHub Actions Workflows

This directory contains automated CI/CD workflows for the Inbox Zero project.

## Workflows

### ✅ code-quality-check.yml (NEW - Replaces CodeRabbit)
**Purpose**: Automated code quality checks for pull requests

**Triggers**:
- Pull requests to `main`, `production`, or `staging` branches
- Runs on: opened, synchronized, reopened

**What it does**:
1. **TypeScript Check** - Validates type safety (`pnpm tsc --noEmit`)
2. **Linting** - Checks code quality (`pnpm run check`)
3. **Tests** - Runs test suite (`pnpm test`)
4. **File Analysis** - Detects changes in critical files:
   - Database schema (Prisma)
   - Environment variables
   - Authentication/security files
   - AI/LLM prompts
   - Docker configuration
   - CI/CD workflows

**Output**:
- ✅ Status table (TypeScript, Linting, Tests)
- 📊 Changes summary (files, additions, deletions)
- ⚠️ Project-specific warnings for critical changes
- 📝 Actionable recommendations

**Benefits over CodeRabbit**:
- No external service dependency
- Runs on every PR automatically
- Project-specific checks for Inbox Zero
- Clear, actionable feedback
- Free (uses GitHub Actions minutes)

### 🔨 build_and_publish_docker.yml
Builds and publishes Docker images to GitHub Container Registry.

### 🧪 test.yml
Runs the test suite on push and pull requests.

### 🤖 claude-code-review.yml (Optional)
Manual Claude AI code review via `@claude` mentions in PR comments.
Requires `ANTHROPIC_API_KEY` secret.

### 🤖 claude.yml
Claude AI integration for specific workflows.

## Usage

### For Pull Requests

1. **Open a PR** - Code quality check runs automatically
2. **Review the comment** - Check automated feedback
3. **Fix issues** - Address failures (TypeScript, tests, linting)
4. **Push changes** - Workflow re-runs automatically

### Security & Critical Changes

When you modify sensitive files, the workflow will flag them:

- 🔒 **Auth changes** - Manual security review required
- 🗄️ **Database schema** - Migration checklist provided
- ⚙️ **Environment vars** - Documentation reminder
- 🤖 **AI prompts** - Injection vulnerability check
- 🐳 **Docker config** - Build testing reminder
- ⚙️ **CI/CD workflows** - Fork testing suggested

### Example Output

```markdown
## 🤖 Automated Code Quality Report

### Automated Checks

| Check | Status |
|-------|--------|
| TypeScript | ✅ Passed |
| Linting | ✅ Passed |
| Tests | ❌ Failed |

### Changes Summary

- **Files changed:** 15
- **Lines added:** +432
- **Lines deleted:** -89

### Project-Specific Checks

⚠️ **Database Schema Changes Detected**
- Ensure migration files are included
- Verify backward compatibility
- Test migration in development environment
- Update seed data if necessary

🔒 **Security-Critical Changes Detected**
- Authentication/authorization logic modified
- Manual security review **required**
- Test OAuth flows thoroughly
- Verify session handling

### Recommendations

⚠️ **Action Required**

Please address the following issues before merging:

2. 🔴 **Fix failing tests** (Critical)
   - Run `pnpm test` locally
   - Ensure all tests pass before merging
```

## Configuration

### Required Secrets
None required for basic functionality.

Optional:
- `ANTHROPIC_API_KEY` - For Claude code review

### Branch Protection

Recommended branch protection rules:

```yaml
main:
  required_status_checks:
    - Code Quality Check
  required_reviews: 1
  dismiss_stale_reviews: true
  
production:
  required_status_checks:
    - Code Quality Check
    - test
  required_reviews: 2
  dismiss_stale_reviews: true
```

## Customization

### Adding New Checks

Edit `.github/workflows/code-quality-check.yml`:

```yaml
- name: Run custom check
  id: custom
  continue-on-error: true
  run: |
    echo "## Custom Check" >> $GITHUB_STEP_SUMMARY
    if pnpm run custom-check; then
      echo "✅ Custom check passed" >> $GITHUB_STEP_SUMMARY
      echo "status=success" >> $GITHUB_OUTPUT
    else
      echo "❌ Custom check failed" >> $GITHUB_STEP_SUMMARY
      echo "status=failure" >> $GITHUB_OUTPUT
    fi
```

### Project-Specific Checks

To add new file pattern detection, edit the `Analyze changed files` step:

```javascript
hasCustomChanges: files.some(f => f.filename.includes('your-pattern')),
```

Then add handling in the `Post review comment` step:

```javascript
if (analysis.hasCustomChanges) {
  body += '⚠️ **Custom Changes Detected**\n';
  body += '- Your custom checklist item\n\n';
}
```

## Maintenance

### Updating Dependencies

```bash
# Update GitHub Actions
# Edit .yml files and bump @vX to latest version
```

### Debugging Workflows

1. Check workflow runs: `Actions` tab on GitHub
2. View detailed logs for each step
3. Test locally:
   ```bash
   pnpm tsc --noEmit  # TypeScript
   pnpm run check     # Linting
   pnpm test          # Tests
   ```

## Migration from CodeRabbit

CodeRabbit has been **removed** and replaced with `code-quality-check.yml`.

**What changed**:
- ❌ Removed `.coderabbit.yaml`
- ❌ Removed CodeRabbit bot integration
- ✅ Added `code-quality-check.yml` (GitHub Actions native)

**Benefits**:
- No external service
- Free (GitHub Actions minutes)
- Project-specific rules
- Full control over checks
- Faster feedback

**What you lose**:
- AI-powered code suggestions
- Natural language review

**What you gain**:
- Deterministic, project-specific checks
- No rate limits or quotas
- Full customization
- Security-focused analysis

## Support

- GitHub Actions Docs: https://docs.github.com/actions
- Project Issues: https://github.com/TIGER21-LLC/inbox-zero/issues
