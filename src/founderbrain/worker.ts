/**
 * src/founderbrain/worker.ts
 *
 * WHAT THIS IS. Long-running dispatcher that leases queued generation jobs and
 * runs BrainJobs.tick(). Production requires the restricted fb_worker DB role.
 *
 * WHY IT EXISTS. The API must not hold the cross-workspace dispatch role. One
 * attempt per job; ambiguous paid calls are never automatically retried.
 */
import { loadConfig } from "./config.ts";
import { PgBrainStore } from "./store.ts";
import { BrainJobs } from "./jobs.ts";
import { sweepOnce } from "./routines.ts";
import { createFounderBrainLogger, logJobEvent } from "./logging.ts";

const config = loadConfig();
if (config.AI_ENABLED !== "true") {
  throw new Error(
    "AI is disabled. Do not provision the worker until generation is configured and approved.",
  );
}
const log = createFounderBrainLogger("worker");
const store = new PgBrainStore(config.DATABASE_URL, config.NODE_ENV === "production");
const role = await store.scoped(
  "00000000000000000000000000",
  (tx) => tx`select current_user as role`,
);
if (config.NODE_ENV === "production" && role[0]?.role !== "fb_worker") {
  throw new Error("The production dispatcher requires the restricted fb_worker database role.");
}
const jobs = new BrainJobs(store, config, undefined, (event) => logJobEvent(log, event));
let stopped = false;
for (const s of ["SIGTERM", "SIGINT"]) {
  process.on(s, () => {
    stopped = true;
  });
}
log.info("FounderBrain worker started. No automatic retries of ambiguous paid calls.");
const routinesEnabled = config.ROUTINES_ENABLED === "true";
let lastSweep = 0;
while (!stopped) {
  try {
    const worked = await jobs.tick();
    if (routinesEnabled && Date.now() - lastSweep > 60_000) {
      lastSweep = Date.now();
      try {
        const result = await sweepOnce(store, config);
        if (result.generated > 0)
          log.info({ generated: result.generated, scanned: result.scanned }, "Routine drafts generated.");
      } catch {
        log.error({ errorClass: "routine_sweep_failed" }, "Routine sweep failed; details withheld.");
      }
    }
    if (!worked) await new Promise((r) => setTimeout(r, 2000));
  } catch {
    // Never log the thrown value: it may wrap private Brain context.
    log.error(
      { errorClass: "cycle_failed" },
      "Worker cycle failed; details withheld to protect private context.",
    );
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await jobs.close();
await store.close();
log.info("FounderBrain worker stopped.");
