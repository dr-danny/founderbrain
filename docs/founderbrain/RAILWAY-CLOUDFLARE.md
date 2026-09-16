# FounderBrain on Railway + Cloudflare Workers

Status: implementation branch, not a live deployment. No Cloudflare rules, DNS, custom routes, provider auth settings, or paid services have been activated by this build.

## Boundary

Browser -> Cloudflare Worker (React static assets + fixed-origin /api gateway) -> Railway Fastify API -> private Railway PostgreSQL.
A separately configured Railway worker process drains durable jobs using the restricted `fb_worker` database role. Cloudflare has no database credentials, private Brain cache, or model key. Railway API has no shell/agent endpoint. The production runtime manifest deliberately excludes Claude Agent SDK, tsx, PGlite and frontend build tools.

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

Use a NEW isolated FounderBrain Railway project and dedicated auth project. Never reuse client data, client databases, or client secrets. Choose a region and confirm actual resource pricing; resource limits are not hard billing caps.

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

### Managed authentication

The implemented adapter uses a dedicated Supabase Auth project for magic-link login; the application's canonical database remains Railway Postgres, not Supabase storage.

- Configure asymmetric JWT signing supported by the project's JWKS (ES256 or RS256), not a legacy symmetric shared JWT secret.
- Add only the exact approved app URL to auth redirect allowlists.
- Invite pilot users in the provider. The UI uses `shouldCreateUser:false`; it will not silently create public accounts.
- Public/anon key can be exposed in `/api/config`; a service-role/secret key must never be provided to the frontend. Configuration rejects known service-key formats.
- Backend verifies signature, issuer, audience, expiry, stable subject and authenticated role. Email is not a database identity key.
- The browser persists only its auth session and opaque pending job ID in sessionStorage. Brain text remains server-side/in memory. Signout clears private in-memory state and pending operations.
- Provider password recovery/delivery and a real magic-link cycle require staging validation. No real email was sent by local tests.

### API environment

Set in Railway secret/variable settings, not source:

| Name | Purpose |
|---|---|
| `NODE_ENV=production`, `TZ=UTC` | Safe production mode |
| `DATABASE_URL` | Private PostgreSQL connection using `fb_runtime` |
| `GE_MASTER_KEY` | Independently escrowed, generated 32-byte base64 encryption key; never change/remove without migration |
| `APP_ORIGIN` | Exact approved HTTPS Worker/custom-domain origin |
| `ORIGIN_SECRET` | Generated secret, at least 32 characters, shared only with the Worker |
| `SUPABASE_URL` | Dedicated auth project HTTPS URL |
| `SUPABASE_ANON_KEY` | Auth publishable/anon key, never service-role |
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

### Cloudflare Worker

1. Build assets and dry-run bundle first.
2. Replace placeholder `API_ORIGIN` with the exact HTTPS Railway API origin, and `AUTH_ORIGIN` with the dedicated auth origin.
3. Set `ORIGIN_SECRET` using Worker secret settings. It must match Railway. Never use a plain-text checked-in variable.
4. Upload an inactive version if authorized. Activating a workers.dev URL or custom route is a separate approved traffic change. Do not change any existing zone rule, WAF, challenge setting, TLS setting or client route.
5. On approval, bind the chosen route/domain; update exact `APP_ORIGIN` and auth callbacks. Verify a real login and monitor-shaped requests. Challenge responses are failures, not successful probes.

Worker behavior: same-origin `/api` proxy to a fixed target only; allowlisted headers; injected origin secret; no client-controlled upstream; API redirects rejected; API responses private/no-store; security headers on app assets. The Worker executes for all requests so the asset security headers are applied. No KV, D1, R2, cache or edge data replication is required in v1.

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
- Fresh login, save/readback, signout/login, restart, restore and A/B isolation pass on staging.
- A real provider call (after spend approval) passes source-input and budget verification; no mock result represented as real generation.
- Backup/key recovery, accessible narrow-screen flow, privacy/data-use disclosure and deletion retention are reviewed.
- No Oneday logo, proprietary fonts, photographs, endorsement or event-required checklist is shipped without authorization.

Feature scope remains the Astra/Opus plan: four structured missions plus one private generated invitation, history/restore/export, truthful progress. No CRM, publishing, leaderboards, billing or broad agent tools.
