import { loadConfig } from './config.ts';
import { PgBrainStore } from './store.ts';
import { BrainJobs } from './jobs.ts';
import { createFounderBrainLogger, logJobEvent } from './logging.ts';

const config = loadConfig();
if (config.AI_ENABLED !== 'true') throw new Error('AI is disabled. Do not provision the worker until generation is configured and approved.');
const log = createFounderBrainLogger('worker');
const store = new PgBrainStore(config.DATABASE_URL);
const role = await store.scoped('00000000000000000000000000', (tx) => tx`select current_user as role`);
if (config.NODE_ENV === 'production' && role[0]?.role !== 'fb_worker') {
  throw new Error('The production dispatcher requires the restricted fb_worker database role.');
}
const jobs = new BrainJobs(store, config, undefined, (event) => logJobEvent(log, event));
let stopped = false;
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { stopped = true; });
log.info('FounderBrain worker started. No automatic retries of ambiguous paid calls.');
while (!stopped) {
  try {
    const worked = await jobs.tick();
    if (!worked) await new Promise((r) => setTimeout(r, 2000));
  } catch {
    // Never log the thrown value: it may wrap private Brain context.
    log.error({ errorClass: 'cycle_failed' }, 'Worker cycle failed; details withheld to protect private context.');
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await jobs.close();
await store.close();
log.info('FounderBrain worker stopped.');
