/**
 * src/founderbrain/reconcile-main.ts
 *
 * WHAT THIS IS. Operator-only accounting reconciliation for quarantined AI spend.
 * This never triggers a provider call. Environment is read only through config.ts.
 */
import postgres from "postgres";
import { loadReconciliationEnv } from "./config.ts";

const { adminUrl: url, jobId: id, confirmedCostMicroUsd: cost } = loadReconciliationEnv();
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    const jobs = await tx`
      select id, founder_id, status, reserved, budget_day,
             coalesce(openrouter_spend_recorded_microusd, 0) as openrouter_spend_recorded_microusd
      from fb_ai_job
      where id = ${id}
      for update
    `;
    const deleted = await tx`
      select * from fb_usage_reconciliation
      where job_id = ${id}
      for update
    `;
    const j = jobs[0];
    const d = deleted[0];
    if (j && j.status !== "uncertain") {
      throw new Error("Only quarantined uncertain jobs can be reconciled.");
    }
    if (d?.reconciled_at) {
      throw new Error("This deleted-workspace call was already reconciled.");
    }
    if (!j && !d) throw new Error("No unresolved call found.");
    const scope = j ? "workspace:" + j.founder_id : d!.scope;
    const day = j?.budget_day ?? d!.budget_day;
    const reserved = j?.reserved ?? d!.reserved;
    for (const s of ["global", scope]) {
      const changed = await tx`
        update fb_budget
        set reserved = reserved - ${reserved},
            spent = spent + ${cost}
        where scope = ${s}
          and day = ${day}
          and reserved >= ${reserved}
        returning scope
      `;
      if (!changed.length) {
        throw new Error("Reservation accounting is inconsistent; no changes were committed.");
      }
    }
    // Lifetime key spend must track provider-confirmed cost even when the job
    // never completed successfully. Only add the delta above any spend already
    // recorded on the uncertain/partial path so reconcile cannot double-count.
    if (cost > 0 && j) {
      const already = Number(j.openrouter_spend_recorded_microusd ?? 0);
      const delta = Math.max(0, cost - (Number.isSafeInteger(already) ? already : 0));
      if (delta > 0) {
        await tx`
          update fb_openrouter_key
          set spent_microusd = spent_microusd + ${delta}
          where founder_id = ${j.founder_id}
            and revoked_at is null
        `;
      }
      await tx`
        update fb_ai_job
        set openrouter_spend_recorded_microusd = greatest(
          coalesce(openrouter_spend_recorded_microusd, 0),
          ${cost}
        )
        where id = ${id}
      `;
    }
    if (j) {
      await tx`
        update fb_ai_job
        set status = 'failed',
            error = 'Operator reconciled provider usage. A new generation may be requested.'
        where id = ${id}
      `;
      await tx`update fb_job_dispatch set status = 'failed' where job_id = ${id}`;
    }
    if (d) {
      await tx`
        update fb_usage_reconciliation
        set reconciled_at = now()
        where job_id = ${id}
      `;
    }
  });
  // eslint-disable-next-line no-console -- this is a CLI entry point, not server code
  console.log(
    "Provider-confirmed accounting reconciled. No generation or outbound action performed.",
  );
} finally {
  await sql.end();
}
