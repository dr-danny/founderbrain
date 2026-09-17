# FounderBrain on Railway + Cloudflare Workers

Status: implementation branch, not a live deployment. No Cloudflare rules, DNS, custom routes, Hexclave trusted domains, or paid services have been activated by this build.

## Boundary

Browser (React app + Hexclave browser SDK) -> Cloudflare Worker (static assets + fixed-origin /api gateway) -> Railway Fastify API -> private Railway PostgreSQL.
Sign-in happens between the browser and Hexclave directly: the SDK sends the founder to Hexclave's hosted page, Hexclave emails a one-time code, and the SDK comes back holding a session. The Worker and the API never talk to Hexclave except that the API fetches and caches the project's public JWKS to verify tokens.
A separately configured Railway worker process drains durable jobs using the restricted `fb_worker` database role. Cloudflare has no database credentials, private Brain cache, or model key. Railway API has no shell/agent endpoint. The production runtime manifest deliberately excludes Claude Agent SDK, tsx, PGlite and frontend build tools.

Three vendors: Cloudflare (Worker, static assets), Railway (API, worker, Postgres) and Hexclave (identity, one-time-code email). Hexclave is the platform formerly named Stack Auth; same product, new brand. There is no email sending service of ours.

### Auth decision (locked)

| Vendor | Status | Notes |
|---|---|---|
| **Hexclave** | **Yes — identity for FounderBrain** | One-time-code email, invite-only (`allowSignUp: false`), stable user id, API verifies JWTs locally. See #38 / #14. |
| Supabase Auth (or any Supabase product) | **Won't do** | Not in the stack. Do not restore `SUPABASE_*` env vars or `@supabase/supabase-js`. See #36. |
| Cloudflare Access | **Won't do** for product sign-in | Corporate Zero Trust gate, not a customer identity directory. Briefly considered in #36; superseded by Hexclave. |

Database remains private Railway PostgreSQL. Auth is Hexclave only; storage is not Supabase.

- UI: `src/founderbrain-web/`
- Edge: `src/founderbrain-edge/worker.ts`, `wrangler.jsonc`
- API, store, jobs: `src/founderbrain/`
- Railway API config: `/railway.json`
- Railway worker config: `/deploy/railway/worker.json` (set this custom config path on the worker service)
- Dockerfile: `/deploy/railway/Dockerfile`
- CI: `.github/workflows/founderbrain.yml`, build/tests only, no deployments

This mode does not register the inherited Launchhouse owner, setup, connection, publishing or agent routes. Keep `npm start` for upstream reference only; deploy the new compiled entrypoints.

## Build

Use Node 22 and `npm ci --include=dev`. Then:

```
npm run fb:build
npm run fb:test
npx wrangler deploy --dry-run --outdir dist/edge-dry-run
```

Native binaries are restricted in the Aside sandbox, so it uses the trusted esbuild WebAssembly CLI:

```
ESBUILD_BINARY_PATH="$PWD/node_modules/esbuild-wasm/bin/esbuild" npm run fb:build
```

Rollup is pinned to its official WASM build. Dependency lock URLs use the public npm registry instead of an inaccessible Replit-internal hostname. Docker and CI use the same portable build. TypeScript emits Node ESM and copies SQL migrations into `dist/founderbrain-server`; runtime does not depend on tsx.

## Provisioning gates

Before any paid resource creation, obtain cost approval. Before enabling any Cloudflare rule, DNS route, custom domain or existing-site configuration, show the exact target and get explicit approval. This repository has no automatic deploy workflow. `workers_dev:false`, `preview_urls:false`, and no `routes` make the checked-in Worker configuration non-routed by default.

Use a NEW isolated FounderBrain Railway project and a dedicated Hexclave project (never the one another product uses; the project id is the workspace key namespace). Never reuse client data, client databases, or client secrets. Choose a region and confirm actual resource pricing; resource limits are not hard billing caps.

### Railway PostgreSQL

1. Create private PostgreSQL with persistent storage in the new project; do not enable public database access for application traffic.
2. Retain the migration/admin URL only in a one-off migration environment.
3. Create two login roles, `fb_runtime` and `fb_worker`, each NOSUPERUSER NOBYPASSRLS with unique generated secrets. Do not put role passwords in GitHub, chat, logs, or these docs.
4. Run the compiled migration command with `MIGRATION_DATABASE_URL` and `RUNTIME_DB_ROLE=fb_runtime`; run it again with `RUNTIME_DB_ROLE=fb_worker` to grant worker access. These migrations are additive but must be tested on staging first.
5. Verify all expected RLS policies and roles using a runtime connection. API uses `fb_runtime`, never `fb_worker` or the admin URL. Only `fb_worker` can enumerate global dispatch metadata. Tenant job content remains scoped even for the worker.
6. Configure backups with approved cost/retention, escrow the encryption key independently, and rehearse restoring both DB and required keys into a separate isolated environment. Never use production as a restore drill.

Migration command inside the built container:

```
node src/founderbrain/migrate-main.js
```

Do not use the embedded-test schema script for a production migration. The inherited migration runner uses multiple native Postgres connections and a migration lock; the embedded fixture intentionally cannot certify that behavior.

### Sign-in: Hexclave with a one-time code

Sign-in is Hexclave. A founder opens the app and sees one button. It sends them to Hexclave's hosted sign-in page, they type the email they were invited under, Hexclave emails a one-time code, they enter it, and they land back in the app signed in. There is no password anywhere. There is no sign-in form in this app; the Hexclave browser SDK is what carries the session.

**Project configuration is code.** `hexclave.config.ts` at the repository root says: OTP sign-in on, password and passkey off, sign-up off, only the authentication app installed. After `npx @hexclave/cli login`, pull a snapshot into a fresh temporary directory and review the difference before pushing to the intended project:

```sh
FB_HEXCLAVE_REVIEW_DIR="$(mktemp -d)"
npx @hexclave/cli config pull --cloud-project-id "$HEXCLAVE_PROJECT_ID" --config-file "$FB_HEXCLAVE_REVIEW_DIR/current.ts"
diff -u "$FB_HEXCLAVE_REVIEW_DIR/current.ts" hexclave.config.ts
# After reviewing the difference (diff exits 1 when files differ):
npx @hexclave/cli config push --cloud-project-id "$HEXCLAVE_PROJECT_ID" --config-file hexclave.config.ts
```

Pulling to a separate path preserves the repository's intended settings. Config push updates branch configuration; environment-specific trusted domains remain in the dashboard.

What is per environment and lives in the Hexclave dashboard, not the file:

1. **Project.** One dedicated Hexclave project for FounderBrain per environment (staging, production). The project id is in the dashboard URL after `/projects/`. That is `HEXCLAVE_PROJECT_ID`. Never share a project with another product: the project id is the namespace of every workspace key.
2. **Trusted domains.** The approved app origin (after #15 binds it), so the hosted page is allowed to redirect back. Without it sign-in ends on a Hexclave error page.
3. **Users.** Sign-up is off, so invite-only means the operator creates each pilot founder: dashboard, or `npx @hexclave/cli exec --cloud-project-id "$HEXCLAVE_PROJECT_ID" 'await hexclaveServerApp.createUser({ primaryEmail: "...", primaryEmailVerified: true, primaryEmailAuthEnabled: true, otpAuthEnabled: true })'`. The email must be enabled for authentication; creating a verified display email alone does not enable OTP sign-in. An email with no user is refused on the hosted page and receives nothing.
4. **Publishable client key.** Only if the project has `requirePublishableClientKey` on, which is unusual. Then `HEXCLAVE_PUBLISHABLE_CLIENT_KEY` (`pck_...`, safe in the browser). The secret server key (`ssk_...`) is **not** needed by anything in v1 and must not be set on Railway.
5. **Email sender.** Hexclave sends the code from its shared sender by default. A custom sender domain is a branding decision (#29), not a requirement.

What the code does with it:

- The browser gets `{projectId, apiUrl, publishableClientKey}` from `GET /api/config` and builds the Hexclave client at runtime, so one static bundle serves every environment. All SDK analytics (including click tracking and DOM session replays) and the dev tool overlay are switched off in `src/founderbrain-web/hexclave.ts`. That file is the only place the SDK is touched.
- Every API call carries the SDK's current access token as `x-stack-access-token`. The Worker forwards that header, and only allowlisted headers, to the API. It refuses `/api/*` without the header before touching the origin, except `/api/config`, which the browser must read before it has a token.
- The API verifies the token itself with `jose` against `<HEXCLAVE_API_URL>/api/v1/projects/<id>/.well-known/jwks.json`: ES256 only, issuer `<HEXCLAVE_API_URL>/api/v1/projects/<id>`, audience `<id>`, `exp`, non-empty `sub`, `is_anonymous` and `is_restricted` false, `email_verified` true, well-formed `email`. Pinning issuer and audience to the regular form refuses Hexclave's anonymous (`.../projects-anonymous-users/`, `<id>:anon`) and restricted (`.../projects-restricted-users/`, `<id>:restricted`) tokens by construction. The JWKS is cached by `jose`; cold starts, cache expiry (ten minutes by default), and key rotation require Hexclave to be reachable even for an unexpired token.
- The workspace is keyed on `hexclave|<projectId>|<sub>`. `sub` is Hexclave's user id and is stable for the life of the user. The API hostname is deliberately not in the key: the platform already renamed from Stack Auth to Hexclave and moved hosts once. The email is returned by `GET /api/me` for display only and is never a database key.
- The browser stores no token of ours. The SDK keeps its refresh token in its own cookie and mints access tokens on demand. Only the opaque pending job id is kept in `sessionStorage`. Brain text remains server-side or in memory. Sign out clears private in-memory state first, then asks the SDK to end the session, which navigates to `/`.
- When the session lapses mid-edit, the API answers 401 and the client turns that into one clear error that keeps the draft on screen and points to signing in again in a new tab, then retrying. The SDK session is read again before every API call, so signing back in as the same founder works without reloading the draft. A different founder's session is refused for that draft. Nothing is lost silently.

Known caveat, on purpose in writing: if an operator **deletes a founder's Hexclave user and creates a new one** for the same email, the new user has a new `sub`, so they sign in to an empty workspace while the real one sits intact under the old subject. That is an operator action, and the recovery is an operator re-binding `fb_user.subject`. Do not "fix" this by keying on email; email is a display value here. The issue tracker holds the recovery-path task (#37). Do not delete and recreate pilot users casually.

A real one-time-code cycle requires the staging hostname to be a trusted domain. No email is sent by local tests, and the local demo is not a sign-in demonstration.

### API environment

Set in Railway secret/variable settings, not source:

| Name | Purpose |
|---|---|
| `NODE_ENV=production`, `TZ=UTC` | Safe production mode |
| `DATABASE_URL` | Private PostgreSQL connection using `fb_runtime` |
| `GE_MASTER_KEY` | Independently escrowed, generated 32-byte base64 encryption key; never change/remove without migration |
| `APP_ORIGIN` | Exact approved HTTPS Worker/custom-domain origin |
| `ORIGIN_SECRET` | Generated secret, at least 32 characters, shared only with the Worker |
| `HEXCLAVE_PROJECT_ID` | The FounderBrain Hexclave project UUID. Token audience and workspace key namespace. Not a secret, but wrong means nobody signs in |
| `HEXCLAVE_API_URL` | Bare HTTPS origin of the Hexclave API. Default `https://api.hexclave.com`; only set it for a self-hosted instance. Must match the Worker var of the same name |
| `HEXCLAVE_PUBLISHABLE_CLIENT_KEY` | Optional, `pck_...`, only if the project requires one. Sent to the browser on purpose. Never the `ssk_` server key |
| `AI_ENABLED=false` | Default until real API spending is approved |
| `PORT` | Railway-injected listening port; default 8080 |

The API requires the gateway secret for `/api/*` and denies foreign browser origins. `/health/live` and `/health/ready` contain no sensitive detail. Readiness queries the database; it is not a backup-recovery proof.

### AI worker, only when approved

Use the same compiled image with `node src/founderbrain/worker.js`. Its `DATABASE_URL` uses `fb_worker`. Also configure:

- `AI_ENABLED=true`
- `ANTHROPIC_API_KEY`
- `AI_MODEL` chosen from the actual provider account
- `AI_INPUT_USD_PER_MILLION`, `AI_OUTPUT_USD_PER_MILLION`: verified current rates for that exact model
- `AI_WORKSPACE_DAILY_MICROUSD`, `AI_GLOBAL_DAILY_MICROUSD`: approved limits, in millionths of a dollar

The API needs the same approved model/rate/cap settings for job admission. The worker needs the provider key. Neither key nor full prompts appear in logs/browser responses. No calls occur merely by opening a mission; job creation is explicit. Do not start the worker service while AI is disabled.

The app reserves a conservative maximum before dispatch and settles actual reported token usage. Provider pricing must be kept current; application caps cannot override provider billing. Generation uses one attempt per job. An ambiguous response or expired in-flight lease becomes `uncertain`, retains its budget reservation and blocks new workspace jobs until operator reconciliation. There is deliberately no automatic retry of potentially billed calls.

To release quarantine, an operator must inspect provider usage, then run `node src/founderbrain/reconcile-main.js` with the admin URL in `MIGRATION_DATABASE_URL`, the exact `JOB_ID`, verified `CONFIRMED_COST_MICROUSD`, and `RECONCILIATION_CONFIRMED=yes`. The command settles accounting atomically and never calls the model. It refuses active/completed/already-reconciled jobs. Do not infer zero cost from an elapsed lease.

### Cloudflare Worker

1. Build assets and dry-run bundle first.
2. Replace placeholder `API_ORIGIN` with the exact HTTPS Railway API origin. Leave `HEXCLAVE_API_URL` at `https://api.hexclave.com` unless the API's value differs; the two must match or the browser SDK is blocked by the Content-Security-Policy.
3. Set `ORIGIN_SECRET` using Worker secret settings. It must match Railway. Never use a plain-text checked-in variable.
4. Upload an inactive version if authorized. Activating a workers.dev URL or custom route is a separate approved traffic change. Do not change any existing zone rule, WAF, challenge setting, TLS setting or client route.
5. On approval, bind the chosen route/domain, update the exact `APP_ORIGIN` on Railway, and add that origin as a trusted domain in the Hexclave project (section above). Until it is trusted, the hosted sign-in page will not return to the app. Until a founder has signed in, the Worker answers every `/api/*` request except `/api/config` with 401 because no token header arrives. That is the intended fail-closed state, not a bug to work around.
6. Verify a real one-time-code login and monitor-shaped requests. Challenge responses are failures, not successful probes.

Worker behavior: same-origin `/api` proxy to a fixed target only; forwards `x-stack-access-token`, `Content-Type`, `Accept`, `Origin` and `X-Request-Id` and nothing else (cookies and `Authorization` do not cross); injected origin secret; refuses `/api/*` other than `/api/config` without the token header; no client-controlled upstream; API redirects rejected; API responses private/no-store; security headers on app assets with `connect-src 'self' <HEXCLAVE_API_URL>` (falls back to `'self'` alone if the var is missing or not a bare HTTPS origin, which fails sign-in closed rather than widening the policy). The Worker executes for all requests so the asset security headers are applied. No KV, D1, R2, cache or edge data replication is required in v1.

## Local demonstration

Run a disposable native Postgres database, apply migrations, and use a dedicated local encryption key. Set `NODE_ENV=development`, `FOUNDERBRAIN_LOCAL_DEMO=true`, `APP_ORIGIN=http://127.0.0.1:8080`, `PORT=8080`, and `AI_ENABLED=false`. Run `npm run fb:dev` after building.

Local demo binds only loopback and accepts only the explicit demo identity. Production configuration rejects local demo. It is not a working hosted-auth demonstration. Do not proxy the local demo onto the public internet.

Where native PostgreSQL is sandbox-blocked, `scripts/founderbrain-pglite.mjs` is an embedded WASM fallback and `scripts/founderbrain-test-schema.mjs` loads an isolated schema. Startup usernames are not independent native connections in that harness; set the restricted test role explicitly and do not claim its results as native concurrency/migration proof.

## Data deletion and accounting

Deletion locks the workspace against writers, removes AI jobs/artifacts before their referenced blobs, deletes saved Brain revisions/receipts/events, revokes membership and tombstones the subject binding. A deleted session cannot silently recreate the account. Queued work with no call releases reservation. Running/uncertain work retains only pseudonymous accounting identifiers and reserved amounts for reconciliation, not prompts or outputs. Infrastructure backups have separate operator-defined retention and expiry.

## Launch checklist

- Native PostgreSQL CI and actual migration runner pass.
- Production Docker image builds and starts with the restricted runtime role.
- Worker dry-run succeeds; deployed origin proxy/callbacks verified after approval.
- A dedicated Hexclave project exists with `hexclave.config.ts` pushed, the staging origin trusted, and the pilot users created; `HEXCLAVE_PROJECT_ID` on Railway matches it and no `ssk_` key is set anywhere.
- Fresh one-time-code login on the hosted page, save/readback, sign out then login, restart, restore and A/B isolation pass on staging. An email with no user receives nothing. `GET /api/me` returns the signed-in email and never a subject.
- Browser check on staging: no request leaves the page except to the app origin and `HEXCLAVE_API_URL`; no analytics or session-replay traffic; no `ssk_` string anywhere in the bundle or responses.
- A real provider call (after spend approval) passes source-input and budget verification; no mock result represented as real generation.
- Backup/key recovery, accessible narrow-screen flow, privacy/data-use disclosure and deletion retention are reviewed.
- No Oneday logo, proprietary fonts, photographs, endorsement or event-required checklist is shipped without authorization.

Feature scope remains the Astra/Opus plan: four structured missions plus one private generated invitation, history/restore/export, truthful progress. No CRM, publishing, leaderboards, billing or broad agent tools.

## Browser regression checks

CI runs the actual browser SDK against local HTTP fixtures. The checks cover hosted sign-in navigation, private DOM text staying out of telemetry, and resuming an existing draft only under the same founder after another-tab sign-in. They do not send email or replace the real staging sign-in acceptance check.

With Node 22 and `npm ci --include=dev --ignore-scripts` already completed:

```sh
python3 -m venv /tmp/founderbrain-browser-check
/tmp/founderbrain-browser-check/bin/pip install playwright==1.63.0
/tmp/founderbrain-browser-check/bin/python -m playwright install chromium
/tmp/founderbrain-browser-check/bin/python scripts/founderbrain-browser-test.py
```

The script starts and stops its own Vite server on a disposable loopback port.
