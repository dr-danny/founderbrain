# FounderBrain implementation contract

New product mode only; never register legacy owner/agent routes. Parent owns shared domain, API/auth/jobs, root package/build config/deployment integration. Storage agent owns src/founderbrain/store.ts, migrations.ts, db tests and SQL. UI agent owns src/founderbrain-web/** and src/founderbrain-edge/** only. No deployments or paid API calls.

## JSON domain (all strings max 2000 unless specified)
Brain = {schemaVersion:1, identity:{name,venture,role,stage,goal,approved:boolean}, customer:{segment,problem,outcome,workaround,evidenceStatus:'hypothesis'|'supported',evidence,approved:boolean}, offer:{description,delivery,outcome,cta,price,approved:boolean}, voice:{tone,boundaries,sample,approved:boolean}}. All text fields strings default empty. stage is exploring|building|launched|growing. Supported evidence requires evidence string; unknown workaround valid. Approved sections must meet required predicates; save of unapproved partial sections allowed. blank customer/problem cannot be approved. Export is deterministic Markdown from revision.

BrainState={workspaceId:string,version:number,sha:string,updatedAt:string|null,brain:Brain,readiness:{identity:boolean,customer:boolean,offer:boolean,voice:boolean,output:boolean},verified:boolean,artifact?:Artifact|null}. Artifact={id:string,text:string,sourceVersion:number,sourceHash:string,inputHash:string,acceptedAt:string|null,createdAt:string}. Content is immutable on acceptance (user edited text can be approved). Empty state version0 returned; server does not pretend persisted until commit.

## HTTP under /api
GET /config => {authMode:'supabase'|'local-demo',supabaseUrl?:string,supabaseAnonKey?:string,aiEnabled:boolean}; production never local-demo.
Authorization Bearer managed-auth JWT. Local-only development server accepts X-Dev-User: demo; never in production. Client demo auth only when config says local-demo.
GET /brain => BrainState (initializes owner's isolated workspace idempotently).
PUT /brain body {brain,expectedVersion,idempotencyKey} => BrainState fresh readback; response409 conflict,422 invalid,503 verification_pending with committed version if applicable.
GET /history => {versions:[{version,sha,at}]}; GET /brain?version=N => historical BrainState.
POST /restore {version,expectedVersion,idempotencyKey} => new BrainState.
GET /export?format=json|markdown => attachment private/no-store.
GET /artifact => {artifact:Artifact|null,stale:boolean}.
POST /jobs {expectedVersion,idempotencyKey} =>202 {id,status}; real AI opt-in behind budgets, disabled default.
GET /jobs/:id => {id,status:'queued'|'running'|'completed'|'failed'|'uncertain',error?:string,artifact?:Artifact}; never return full prompt/API secret.
POST /artifact/:id/accept {text,expectedVersion,idempotencyKey} => {artifact,verified:true}; stale sourceVersion rejected. Canonical Brain revision NOT bumped by accepting output.
DELETE /workspace {confirmation:'DELETE'} => {deleted:true}; delete content, revoke current ownership binding/tombstone so session cannot silently recreate. Separate explicit reset only in local test, not production.
Errors {error:string,message:string,...} sanitized, no database params or content echoed.

## Storage interface (implement in store.ts, export class PgBrainStore)
constructor(databaseUrl:string) opens postgres pool (production non-superuser/no BYPASSRLS, asserted via assertSafeRole()). Explicit production migration command uses admin DATABASE_URL separately then grant runtime role.
ensureWorkspace(subject:string):Promise<string>; mapping stable issuer+sub opaque string, not email. Use existing founder row/storage id as workspace physical ID. fb_user/fb_member mapping; owner only now. Preserve existing ge_file/ge_file_version/ge_blob/ge_event schemas and crypto primitives; new direct SQL short transaction writes not filesystem harvest. Use existing migration runner for original schema then additive fb migration; no destructive old data migration.
read(workspaceId:string,version?:number):Promise<BrainState>;
commit(workspaceId:string,brain:Brain,expectedVersion:number,idempotencyKey:string):Promise<BrainState>;
history(workspaceId:string):Promise<Array<{version:number,sha:string,at:string}>>;
restore(workspaceId:string,version:number,expectedVersion:number,idempotencyKey:string):Promise<BrainState>;
deleteWorkspace(subject:string,workspaceId:string):Promise<void>;
close():Promise<void>.
Expose scoped<T>(workspaceId:string, fn:(tx:any)=>Promise<T>):Promise<T> for job extension; establish SET LOCAL app.founder_id, keep txn short, caller validates authorization before context. Expose pool only to migration/job dispatcher internally, NOT routes. Parent can use separate postgres pool for jobs. Mutation same-key/different-payload =>409; replay returns exact original result/revision, not latest. Events+revision+receipt atomic. Readback outside committing txn verifies decrypted bytes SHA via existing crypto. History durable. Tests use real disposable Postgres; no pretending in-memory fake proves SQL/RLS.

## UI
Oneday-informed independent FounderBrain identity: black/white/#f4f6f9, #60dbb3, rounded 24px cards/32px panels, pill buttons, system font. Responsive mission rail, top save status/version, Home/Missions and Brain/history. One dominant next action. Minimum steps as schema. Draft save distinct from approval. Text remains on network fail; conflict compare reload without silent discard. Show summary after customer. First output generated only when enabled, no send. No fake saved state, no fake production auth. When AI disabled, show honest operator configuration notice and useful deterministic preview (not mark output verified). No localStorage founder content. Managed auth sessionStorage via supabase-js is allowed, clear logout. Error/success labels accessible, keyboard/320px. Readback timeout must not duplicate saves. Server module is sole authority of readiness.

## Edge gateway
Serve built static assets via ASSETS binding; run Worker first for /api and /api/*. API_ORIGIN https exact fixed Railway URL plus ORIGIN_SECRET secret. Do not accept client-controlled target host. Forward only allowlisted headers incl Authorization, Content-Type, request ID and Origin as appropriate; strip spoofed gateway headers. Inject X-FounderBrain-Origin secret, never expose it to client. Fail closed when config missing; API response Cache-Control private,no-store. No caching auth/content. No routes/custom domains/security rules activated. CSP/connect-src supports configured Supabase origin and same-origin API; no inline scripts unless needed meta CSP build evidence. Default no external redirects from API. Test proxy authorization/no-store/path handling, timeout and missing config.
