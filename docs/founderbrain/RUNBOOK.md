# FounderBrain operator runbook

Short procedures for live incidents. Read source only if this disagrees with the code.

Related: [RAILWAY-CLOUDFLARE.md](./RAILWAY-CLOUDFLARE.md), [PROVISIONING.md](./PROVISIONING.md).

---

## Reconcile an uncertain AI job (#26)

Generation never auto-retries a call that might have been billed. An ambiguous provider response or an expired in-flight lease marks the job `uncertain`, keeps its budget reservation, and blocks new jobs for that workspace until an operator reconciles.

### What the founder sees

- Before: generation fails closed with copy that the outcome is uncertain; new Generate stays blocked (`job_active`).
- After a successful reconcile: the job is `failed` with an operator message; the founder can start a new generation. No artifact is invented by reconciliation.

Copy you can send them: "We confirmed the provider side of that generation. You can run Generate again when ready. Nothing was published on your behalf."

### Find quarantined jobs

Use an admin / migration role connection (not `fb_runtime`):

```sql
select id, founder_id, provider_request_id, reserved, budget_day, error, updated_at
from fb_ai_job
where status = 'uncertain'
order by updated_at nulls last, created_at;
```

### Confirm actual provider usage

1. Take `provider_request_id` from the row (it may be null if the lease expired before a request id was stored).
2. Look up that id in the OpenRouter activity / generation log for the model in use.
3. Decide the confirmed cost in **micro-USD** (millionths of a dollar), matching how `fb_budget` stores amounts.
4. If no request landed and the provider shows nothing billable, confirmed cost is `0`. Do **not** infer zero from an elapsed lease alone when a request id exists or usage is unclear. Stop and investigate.

### Run reconciliation

Export these env vars, then run the script (admin URL only; never paste secrets into tickets):

- `MIGRATION_DATABASE_URL` — admin / migration database URL
- `JOB_ID` — UUID of the uncertain job (or `fb_usage_reconciliation.job_id`)
- `CONFIRMED_COST_MICROUSD` — nonnegative integer from the provider
- `RECONCILIATION_CONFIRMED=yes` — required confirm flag

```sh
npm run fb:reconcile
```

After `fb:build`, the compiled entry is `node src/founderbrain/reconcile-main.js` with the same env vars.

Effects:

- Subtracts the reserved amount and adds the confirmed cost on `global` and `workspace:<founder_id>` for that `budget_day`.
- Sets the job (and dispatch row) to `failed` with an operator message.
- Never calls the model. Never invents an artifact.
- Refuses jobs that are not `uncertain`, and refuses already-reconciled deleted-workspace rows.

### Deleted workspace mid-call

If the founder deleted the workspace while a job was `running` or `uncertain`, `deleteWorkspace` removes the job row and inserts a row into `fb_usage_reconciliation` (pseudonymous: job id, scope, day, reserved, optional `provider_request_id`, reason `workspace_deleted_during_uncertain_call`). Brain content is gone; only accounting survives.

Find open rows:

```sql
select job_id, scope, budget_day, reserved, provider_request_id, reason, created_at
from fb_usage_reconciliation
where reconciled_at is null
order by created_at;
```

Reconcile with the same command using that `job_id`. Confirmed cost still comes from the provider. The script marks `reconciled_at` and settles budget the same way.

Queued jobs with no call release their reservation at delete time and do not need this path.

---

## Hexclave user deleted and recreated (#37)

Workspaces are keyed on `hexclave|<projectId>|<sub>`. `sub` is Hexclave's user id. It changes only when an operator deletes the Hexclave user and creates a new one for the same email (or moves the founder to another Hexclave project). The founder then signs in to a **new empty** workspace; the real encrypted workspace remains under the old subject.

**Prevention:** do not delete and recreate pilot users casually. Prefer disable / revoke over delete. Same warning lives in [RAILWAY-CLOUDFLARE.md](./RAILWAY-CLOUDFLARE.md).

**Recovery (manual, after founder confirmation):**

1. Confirm the founder's email and that they cannot see expected Brain content after a successful sign-in.
2. From Hexclave, note the **new** user id (`sub`) and, if still available, the **old** user id / approximate creation time of the prior user.
3. Find the old binding. Email is not stored on `fb_user` today, so lookup is operational guesswork: Hexclave audit of the deleted user id, or `fb_user.created_at` vs known invite time. A salted `email_hash` column is a privacy decision still open on #37; do not invent it in production without that decision.
4. In one transaction, update `fb_user.subject` and `fb_member.subject` from the old opaque subject string to the new one (`hexclave|<projectId>|<newSub>`). Insert a `ge_event` recording the re-bind (who, when, old subject, new subject). Do not merge two live workspaces automatically.
5. Have the founder sign out, sign in again, and confirm the expected Brain version.

There is no automatic merge of two workspaces. That remains a human data decision.

---

## Related open ops

| Topic | Issue | Status |
| --- | --- | --- |
| Railway / Postgres provision | #13 | Live credentials on operator machine |
| Hexclave project / OTP | #14 | Live Hexclave login |
| Cloudflare Worker route | #15 | Live Cloudflare account |
| Staging acceptance | #16 | After #13–#15 |
| Backups + key escrow | #17 | Cost + offline escrow |
| Enable AI worker | #24 | OpenRouter management key, models, rates, caps |

## Founder deleted and recreated in Hexclave (#37)

Workspaces are keyed on the Hexclave subject (`fb_user.subject`), not email. If an operator deletes a Hexclave user and creates a new one for the same email:

1. The founder signs in and gets a **new, empty workspace**. Their previous workspace remains encrypted under the old subject, intact but unreachable.
2. There is no merge tooling in v1. If the founder wants their history, the operator either re-links by hand in the database (out of scope for pilot support) or the founder starts fresh.
3. To start fresh deliberately: operator deletes the old workspace from the old subject's session (Brain panel -> Delete workspace), or leaves it dormant.

Email is never the key (it is display-only and can be reassigned). Documented decision: accept the orphaned workspace rather than widen identity coupling.
