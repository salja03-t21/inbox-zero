#!/bin/bash
#
# =============================================================================
# RETIRED — deploy-tiger21.sh no longer deploys anything.
# =============================================================================
#
# TIGER 21 no longer deploys inbox-zero by building locally and SSHing to the
# server. The inbox-zero-tiger21 stack is now a Family-1 GitOps stack whose
# compose file lives in the tiger21-infrastructure repo (digest-pinned image),
# and this application repo only builds + publishes the image.
#
# THE NEW FLOW
# ------------
#   1. Merge to `main` in this repo.
#   2. .github/workflows/tiger21-build-release.yml builds an immutable,
#      sha-tagged amd64 image and pushes it to the DigitalOcean registry.
#   3. The same workflow opens a digest-bump PR against
#      TIGER21-LLC/tiger21-infrastructure, editing
#      stacks/inbox-zero-tiger21/compose.yml.
#   4. Merging that PR IS the deploy: tiger21-infrastructure's
#      stacks-deploy.yml runs `gitops-deploy inbox-zero-tiger21` on node 01.
#
# There is no local build, no floating tag, and no SSH deploy from this repo.
#
# DOCS
# ----
#   - tiger21-infrastructure  docs/00-overview/deployment-architecture.md
#   - tiger21-infrastructure  stacks/inbox-zero-tiger21/README.md
#
# EMERGENCY ROLLBACK
# ------------------
#   - Fast, no files:  docker --context tiger21-swarm service rollback inbox-zero-tiger21_app
#   - Durable, tracked: git-revert the digest-bump PR in tiger21-infrastructure
#                       (merging the revert redeploys the previous pinned digest).
#
# =============================================================================

echo "=============================================================================" >&2
echo "deploy-tiger21.sh is RETIRED — it no longer builds, pushes, or deploys." >&2
echo "" >&2
echo "New flow: merge to main -> tiger21-build-release.yml builds + pushes a" >&2
echo "sha-tagged image -> auto-opens a digest-bump PR on tiger21-infrastructure" >&2
echo "-> merging that PR is the deploy (stacks-deploy.yml runs gitops-deploy)." >&2
echo "" >&2
echo "Docs:" >&2
echo "  tiger21-infrastructure docs/00-overview/deployment-architecture.md" >&2
echo "  tiger21-infrastructure stacks/inbox-zero-tiger21/README.md" >&2
echo "" >&2
echo "Emergency rollback:" >&2
echo "  docker --context tiger21-swarm service rollback inbox-zero-tiger21_app" >&2
echo "  or git-revert the digest-bump PR in tiger21-infrastructure." >&2
echo "=============================================================================" >&2

exit 1
