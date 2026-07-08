# TIGER 21 CI Provisioning Guide — One-Time Setup for PR #14

This guide provisions the credentials required by the new GitOps build workflow
(`.github/workflows/tiger21-build-release.yml`, added in PR #14). Do this
**before** merging PR #14 (or before its first run — the workflow fails cleanly
without these, but provisioning first avoids a red run).

**Time required:** ~20 minutes.
**You need:** DigitalOcean team admin, TIGER21-LLC GitHub org access (or an org
admin to approve a PAT), Doppler workspace admin, and the `doppler` + `gh` CLIs
logged in locally.

---

## What you are creating (overview)

| # | Credential | Lives in | Name | Purpose |
|---|-----------|----------|------|---------|
| 1 | DigitalOcean API token | Doppler `ci` / `prd_inboxzero` | `DO_REGISTRY_TOKEN` | Push built images to `registry.digitalocean.com/t21-docker-registry` |
| 2 | GitHub fine-grained PAT | Doppler `ci` / `prd_inboxzero` | `TIGER21_INFRA_GITHUB_TOKEN` | Push the bump branch + open the digest-bump PR on `TIGER21-LLC/tiger21-infrastructure` |
| 3 | Doppler service token | GitHub Actions secret on `salja03-t21/inbox-zero` | `DOPPLER_TOKEN` | Lets the workflow fetch #1 and #2 from Doppler at run time |

**Design rules this follows:**

- **One GitHub secret only.** Per org convention, `DOPPLER_TOKEN` is the only
  secret in GitHub repo settings; everything else is fetched from Doppler at
  run time by `dopplerhq/secrets-fetch-action`.
- **Dedicated Doppler config, never `swarm-apps/inboxzero`.** The runtime
  config is staged wholesale into the production container's environment at
  deploy time (P-ENVFILE-STAGING). Any CI credential placed there would leak
  into the running app.
- **Unique values per consumer.** The secret *name* `DOPPLER_TOKEN` is reused
  across repos, but each repo gets its own service token bound to its own
  config. Revoking one repo's CI access then never affects another, and
  Doppler's access logs show which consumer read what.

---

## Step 1 — DigitalOcean registry token (`DO_REGISTRY_TOKEN`)

Mint a **fresh, registry-scoped** token. Do not reuse
`infrastructure/prd` → `DIGITALOCEAN_ACCESS_TOKEN_` — that token is
full-access, shared with the Swarm host's pull credential, and already has an
unresolved rotation problem (it expired 2026-07-02 and broke every stack's
image pulls).

1. Go to <https://cloud.digitalocean.com> and make sure the **TIGER 21 team**
   is selected in the team switcher (top-left dropdown).
2. In the left sidebar, scroll to the bottom and click **API**.
3. On the **Tokens** tab, click **Generate New Token**.
4. Fill in:
   - **Token name:** `ci-inbox-zero-registry`
   - **Expiration:** `1 year` — a shorter window is safer but there is
     currently no rotation process, so pick 1 year and set a calendar
     reminder for ~2 weeks before expiry. (This is the same class of gap
     that broke the Swarm host's pulls; don't pick "No expiry" and let it
     become permanent standing credential.)
   - **Scopes:** select **Custom Scopes** — do NOT use Full Access.
     - Expand **registry** and tick **read** and **update** (update is DO's
       label for the write/push scope; it is what `docker login` needs to
       mint push credentials).
     - Leave every other scope unticked.
5. Click **Generate Token**. The value (`dop_v1_…`) is shown **once** — leave
   the page open until Step 3 stores it in Doppler. Do not paste it anywhere
   else (no Slack, no notes, no terminal echo).

> The workflow uses this token as **both** the docker-login username and
> password against `registry.digitalocean.com` — that is DO's documented
> pattern, not a mistake.

---

## Step 2 — GitHub fine-grained PAT (`TIGER21_INFRA_GITHUB_TOKEN`)

This token lets the workflow (running in `salja03-t21/inbox-zero`) push a
`bump/inbox-zero-sha-…` branch and open a PR on
`TIGER21-LLC/tiger21-infrastructure`. It must be created by an account that
has **write access to tiger21-infrastructure**.

1. On <https://github.com>, click your avatar (top-right) → **Settings**.
2. In the left sidebar, scroll to the bottom → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. Fill in:
   - **Token name:** `ci-inbox-zero-infra-bump`
   - **Resource owner:** select **TIGER21-LLC** (not your personal account —
     if TIGER21-LLC is missing from the dropdown, the org restricts
     fine-grained PATs; an org owner must enable them under
     *Org Settings → Third-party Access → Personal access tokens*).
   - **Expiration:** `1 year` (same calendar-reminder caveat as Step 1;
     GitHub emails you before expiry, DO does not).
   - **Repository access:** **Only select repositories** →
     `TIGER21-LLC/tiger21-infrastructure` (exactly one repo).
   - **Permissions → Repository permissions:** set exactly two, leave the
     rest on *No access*:
     - **Contents:** Read and write (push the bump branch)
     - **Pull requests:** Read and write (open the digest-bump PR)
     - *(Metadata: Read-only is added automatically — that's expected.)*
5. Click **Generate token**. Value (`github_pat_…`) is shown **once** — keep
   the tab open until Step 3.
6. If the org requires PAT approval, the token sits in **pending** until an
   org admin approves it under *Org Settings → Personal access tokens →
   Pending requests*. It won't work until approved.

---

## Step 3 — Doppler home for the two secrets

Create a dedicated CI project so CI credentials are structurally separated
from runtime (`swarm-apps`) and infra (`infrastructure`) secrets. Layout:
project **`ci`**, environment **`prd`**, branch config **`prd_inboxzero`** —
a future second repo gets its own branch config (`prd_<app>`), and its
service token cannot read this one's secrets.

### CLI (recommended)

```bash
# Create the project (skip if `ci` already exists: doppler projects)
doppler projects create ci

# Create the per-app branch config under the prd environment
doppler configs create inboxzero --project ci --config prd

# Store the two secrets — each command prompts interactively,
# so the values never land in shell history
doppler secrets set DO_REGISTRY_TOKEN --project ci --config prd_inboxzero
doppler secrets set TIGER21_INFRA_GITHUB_TOKEN --project ci --config prd_inboxzero

# Verify names (never print values)
doppler secrets --project ci --config prd_inboxzero --only-names
```

### Dashboard equivalent

1. <https://dashboard.doppler.com> → workspace → **+ Create Project** →
   name `ci`.
2. Open the project → under the **prd** environment column, click **+** →
   **Create Branch Config** → name `inboxzero` (Doppler renders it as
   `prd_inboxzero`).
3. Open `prd_inboxzero` → **Add Secret** twice:
   - `DO_REGISTRY_TOKEN` = the `dop_v1_…` value from Step 1
   - `TIGER21_INFRA_GITHUB_TOKEN` = the `github_pat_…` value from Step 2
4. **Save**. You can now close the DO and GitHub tabs from Steps 1–2.

---

## Step 4 — Doppler service token → GitHub Actions secret

Generate a **read-only service token** scoped to `ci/prd_inboxzero` and store
it as the single GitHub Actions secret.

### CLI (recommended — token value never touches your screen or history)

```bash
doppler configs tokens create gha-inbox-zero \
  --project ci --config prd_inboxzero --plain \
| gh secret set DOPPLER_TOKEN --repo salja03-t21/inbox-zero
```

Expected output: `✓ Set Actions secret DOPPLER_TOKEN for salja03-t21/inbox-zero`.

### Dashboard equivalent

1. Doppler → project `ci` → config `prd_inboxzero` → **Access** tab →
   **Service Tokens** → **+ Generate**.
   - **Name:** `gha-inbox-zero`
   - **Access:** Read (the default; the workflow only reads)
2. Copy the `dp.st.…` value, then on GitHub:
   `salja03-t21/inbox-zero` → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret** → Name `DOPPLER_TOKEN`, paste
   value → **Add secret**.

---

## Step 5 — Verify end-to-end

1. Merge PR #14 (or check out its branch on a test basis).
2. GitHub → `salja03-t21/inbox-zero` → **Actions** →
   **TIGER 21 — Build & Release** → **Run workflow** (the
   `workflow_dispatch` trigger exists exactly for this smoke test) → run
   against `main`.
3. A green run should show, in order:
   - Doppler secrets fetched (values masked as `***` in logs),
   - `docker login registry.digitalocean.com` succeeded,
   - image built and pushed as `sha-<9-char-sha>` (plus `latest`),
   - a PR titled `bump(inbox-zero): sha-… — <commit subject>` opened on
     `TIGER21-LLC/tiger21-infrastructure`.
4. **Do not merge that infra PR unless you intend to deploy** — merging a
   tiger21-infrastructure PR that touches `stacks/**` deploys iz.tiger21.com
   immediately. For a pure smoke test, close the bump PR and delete its
   branch.

### Troubleshooting quick table

| Failure point | Likely cause |
|---|---|
| `Doppler Error: Invalid Auth token` | `DOPPLER_TOKEN` secret missing/typoed, or service token revoked |
| `docker login` → `unauthorized` | DO token lacks the registry **update** scope, or expired |
| Push to infra repo → `403` / `Resource not accessible` | PAT still pending org approval, or missing Contents write |
| `gh pr create` → `GraphQL: … not accessible` | PAT missing Pull requests write |

---

## Rotation & revocation reference

- **Rotate `DO_REGISTRY_TOKEN`:** mint a new token (Step 1) → `doppler
  secrets set DO_REGISTRY_TOKEN …` (Step 3) → delete the old token in the DO
  API page. No GitHub change needed — the workflow reads Doppler fresh each run.
- **Rotate `TIGER21_INFRA_GITHUB_TOKEN`:** same pattern via GitHub fine-grained
  tokens page → update Doppler → revoke old.
- **Rotate `DOPPLER_TOKEN`:** re-run Step 4 with a new token name, then roll
  (delete) the old service token in Doppler's Access tab.
- **Kill CI access entirely:** delete the `gha-inbox-zero` service token in
  Doppler — the workflow loses everything at once, production is untouched.

Calendar reminders to set now (both expire ~1 year from creation):
- [ ] DO token `ci-inbox-zero-registry` renewal
- [ ] GitHub PAT `ci-inbox-zero-infra-bump` renewal
