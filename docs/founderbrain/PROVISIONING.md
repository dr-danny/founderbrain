# FounderBrain staging provision runbook

Operator checklist for launch blockers **#13** (Railway), **#14** (Hexclave), **#15** (Cloudflare Worker), **#24** (AI spend). Cost and traffic are **approved to proceed** for staging; this document is how to execute without putting secrets in git or chat.

**Do not** paste role passwords, `GE_MASTER_KEY`, `ORIGIN_SECRET`, Hexclave `ssk_` keys, or Anthropic keys into GitHub issues, PR descriptions, or agent transcripts. Generate them locally and store them in a password manager / Railway / Wrangler secrets only.

Companion scripts (fail closed; print no secret values):

| Script | Issue |
|---|---|
| `scripts/founderbrain-gen-secrets.sh` | #13 / #15 — generate master key, origin secret, DB role passwords |
| `scripts/founderbrain-create-db-roles.sh` | #13 — create `fb_runtime` / `fb_worker` then migrate |
| `scripts/founderbrain-hexclave-push.sh` | #14 — pull / diff / push `hexclave.config.ts` |
| `scripts/founderbrain-edge-deploy.sh` | #15 — dry-run or deploy Worker (route binding is a separate flag) |
| `scripts/founderbrain-ai-enable-check.sh` | #24 — validate AI env before flipping `AI_ENABLED=true` |

Also: `docs/founderbrain/RAILWAY-CLOUDFLARE.md` (design), `.env.founderbrain.example` (variable names only).

---

## Order

1. **#13 Railway** — project, private Postgres, roles, migrations, API service (`AI_ENABLED=false`, worker **not** started).
2. **#15 Cloudflare** — build, set `API_ORIGIN` + `ORIGIN_SECRET`, upload Worker; bind route only when hostname is chosen.
3. **#14 Hexclave** — dedicated project, config push, trusted domain = bound `APP_ORIGIN`, pilot users; set `HEXCLAVE_PROJECT_ID` on Railway.
4. Staging acceptance (#16) — one real OTP cycle.
5. **#24 AI** — only after spend numbers are chosen; then start the Railway worker service.

#15 and #14 depend on each other for the trusted domain: you can create the Hexclave project and push config before the hostname exists, but OTP cannot complete until the bound origin is trusted.

---

## #13 Railway + Postgres

### Create (dashboard or Railway CLI)

1. New isolated project named for FounderBrain staging. Do not reuse another product's project or database.
2. Add private PostgreSQL with persistent storage. Do **not** enable public DB access for app traffic.
3. Add an **API** service using `railway.json` / `deploy/railway/Dockerfile` (`startCommand`: `node src/founderbrain/main.js`).
4. Add a **worker** service using custom config path `deploy/railway/worker.json`, but **do not start it** until #24.

### Secrets and roles (laptop, not git)

```sh
# Writes only under a directory you choose (default: /tmp/founderbrain-secrets-$$). Prints paths, not values.
./scripts/founderbrain-gen-secrets.sh /tmp/fb-staging-secrets

# Requires: MIGRATION_DATABASE_URL (admin), FB_RUNTIME_PASSWORD, FB_WORKER_PASSWORD
# Optional: already generated files from gen-secrets (source them yourself; do not `cat` into chat).
export MIGRATION_DATABASE_URL='postgresql://…'   # admin URL from Railway, private network or one-off
export FB_RUNTIME_PASSWORD='…'                 # from gen-secrets
export FB_WORKER_PASSWORD='…'
./scripts/founderbrain-create-db-roles.sh
```

That script creates `fb_runtime` and `fb_worker` (`NOSUPERUSER NOBYPASSRLS`), then runs:

```sh
RUNTIME_DB_ROLE=fb_runtime npm run fb:migrate
RUNTIME_DB_ROLE=fb_worker npm run fb:migrate
```

### API service variables

Set on the API service only (names match `.env.founderbrain.example`):

| Variable | Notes |
|---|---|
| `NODE_ENV=production` | |
| `TZ=UTC` | |
| `DATABASE_URL` | `fb_runtime` connection string |
| `GE_MASTER_KEY` | from gen-secrets; escrow offline |
| `APP_ORIGIN` | exact HTTPS Worker origin once #15 binds it; placeholder until then blocks real browser use |
| `ORIGIN_SECRET` | same value as Worker secret |
| `HEXCLAVE_PROJECT_ID` | from #14 |
| `HEXCLAVE_API_URL` | default `https://api.hexclave.com` unless self-hosting |
| `AI_ENABLED=false` | keep false until #24 |
| `PORT` | Railway-injected |

Never set an Hexclave `ssk_` server key.

### Acceptance (#13)

- `GET /health/ready` → 200 on the deployed API.
- `GET /api/brain` without `X-FounderBrain-Origin` → 403.

---

## #14 Hexclave project

1. Create a **new** Hexclave project for FounderBrain staging (never share with another product). Note the project id from the dashboard URL after `/projects/`.
2. Log in locally: `npx @hexclave/cli login`.
3. Push config:

```sh
export HEXCLAVE_PROJECT_ID='…'   # UUID
./scripts/founderbrain-hexclave-push.sh
```

Expect OTP on, password/passkey off, `allowSignUp: false`.

4. After #15 binds a hostname, add that exact origin as a **trusted domain** in the Hexclave dashboard for this environment.
5. Create each pilot user (sign-up is off):

```sh
npx @hexclave/cli exec --cloud-project-id "$HEXCLAVE_PROJECT_ID" \
  'await hexclaveServerApp.createUser({ primaryEmail: "founder@example.com", primaryEmailVerified: true, primaryEmailAuthEnabled: true, otpAuthEnabled: true })'
```

6. Set `HEXCLAVE_PROJECT_ID` on Railway. Leave `HEXCLAVE_API_URL` at default. Worker var `HEXCLAVE_API_URL` must match (already in `wrangler.jsonc`).

### Acceptance (#14)

Real OTP on staging: Sign in → hosted page → invited email → code → back signed in; `GET /api/me` returns that email; unknown email refused; sign out lands on `/` signed out.

---

## #15 Cloudflare Worker

Two separate traffic decisions: **(A) upload a version**, **(B) bind a route / domain**.

```sh
npm run fb:build

# A — dry-run (safe, CI already does this)
./scripts/founderbrain-edge-deploy.sh dry-run

# A — upload with approved API_ORIGIN (no route binding yet)
export API_ORIGIN='https://your-railway-api.up.railway.app'   # exact HTTPS origin
export ORIGIN_SECRET='…'   # must match Railway; script uses `wrangler secret put`
./scripts/founderbrain-edge-deploy.sh upload

# B — only after hostname approval (edits local wrangler; review before apply)
export WORKER_ROUTE='staging.example.com/*'   # or your approved pattern
./scripts/founderbrain-edge-deploy.sh bind-route
```

Then: set Railway `APP_ORIGIN` to the bound HTTPS origin; add the same origin as Hexclave trusted domain (#14). Do not change unrelated zone/WAF/TLS rules.

### Acceptance (#15)

Browser → Worker → API for `GET /api/config` works; assets carry CSP/security headers; challenge pages count as failure.

---

## #24 AI generation (spend)

Keep `AI_ENABLED=false` and the worker service stopped until rates and caps are chosen for a **real** model id from the Anthropic account.

1. Pick `AI_MODEL` from the live account (do not invent ids in source).
2. Verify that day's `AI_INPUT_USD_PER_MILLION` and `AI_OUTPUT_USD_PER_MILLION` for that exact model.
3. Approve `AI_WORKSPACE_DAILY_MICROUSD` and `AI_GLOBAL_DAILY_MICROUSD` with headroom for reservation math in `jobs.ts`.
4. Set the same model/rate/cap vars on **API** (admission) and **worker** (execution). Only the worker gets `ANTHROPIC_API_KEY`. Worker `DATABASE_URL` uses `fb_worker`.
5. Validate:

```sh
./scripts/founderbrain-ai-enable-check.sh
```

6. Set `AI_ENABLED=true` on both services; start the worker (`deploy/railway/worker.json`). Confirm worker log line and `/api/config` reports `aiEnabled: true`.

### Acceptance (#24)

`POST /api/jobs` on a fully approved Brain → 202 → job completes → artifact present → `fb_budget.spent` reflects settled cost.

---

## What this agent environment cannot do alone

No Railway, Cloudflare, Hexclave, or Anthropic credentials are present in the cloud agent VM. Live create/deploy steps must be run by an operator (or a follow-up agent turn after secrets are injected into the environment). Closing #13/#14/#15/#24 requires those live acceptance checks above.
