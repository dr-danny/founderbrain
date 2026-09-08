/**
 * src/server/storage/limits-store.ts
 *
 * WHAT THIS IS. Where the owner's three storage limits are kept between restarts,
 * how they get back into `storage/paths.ts` when the container comes up again, and
 * the one place that decides how far below the machine's own ceiling an owner's
 * number is allowed to be raised or lowered.
 *
 * WHY IT EXISTS. `storageLimits()` in paths.ts is on the critical path of every
 * turn and must stay synchronous, so it cannot itself ask Postgres. This file does
 * the asking: it reads and writes the one `storage_limit_overrides` row, and it is
 * the only caller of `applyStoredLimits`, the seam paths.ts exposes for exactly
 * this. Every write here ends with that call, in the same function, so there is no
 * way to persist a new limit and forget to make the running process see it.
 *
 * THE FLOOR IS RAISED TO CURRENT USAGE WHEN IT CAN BE, NOT ALWAYS. An owner who
 * sets total-bytes below what their folder already holds would otherwise create a
 * refusal they cannot undo from the same screen: every save after that, including
 * one that deletes nothing, fails the size check before it starts, and the only
 * way out is a limit only a mentor can lift. `saveStorageLimitOverrides` closes
 * that door by raising the floor to `usage` when the caller can supply it cheaply.
 *
 * `loadStoredLimits`, THE BOOT PATH, CANNOT DO THE SAME THING AND SAYS SO RATHER
 * THAN GUESSING. Reading "how much is actually on disk right now" means reading
 * `ge_file` under row level security, which requires a founder id and a
 * transaction that sets `app.founder_id` — see db/rls.sql — and boot has neither: it
 * runs before any request, with no founder scoped to it. So the boot path applies
 * the owner's last saved number against the FIXED floor only. The residual risk is
 * narrow and already accepted elsewhere in this design: usage can only have grown
 * since the last save through activity that itself goes through harvest.ts's own
 * totalBytes/fileCount checks against whatever limit was in force at the time, so a
 * value that was safe when it was saved does not silently stop being enforced — it
 * can, at worst, start refusing a turn sooner than a fresh usage-aware floor would
 * have, which is the same direction detection's own "measured once per process"
 * limitation already falls in, not a new failure mode.
 *
 * WHAT CALLS IT. src/server/routes/limits.ts, on every GET and POST. Boot should
 * call `loadStoredLimits()` once, the same way src/server/index.ts already calls
 * `loadStoredAnthropicKeys()` at boot — see that file's own call site — but that
 * wiring is outside this file's ownership and is not done here.
 *
 * WHAT IT READS AND WRITES. The `storage_limit_overrides` table, one row, id
 * 'owner'. Nothing else: it does not read `ge_file` itself, for the RLS reason
 * above, and it never touches the filesystem.
 */

import { eq } from 'drizzle-orm';

import { getDb, type Queryable } from '../db/client.ts';
import { storageLimitOverrides } from '../db/schema.ts';
import {
  applyStoredLimits,
  FLOOR_FILE_BYTES,
  FLOOR_FILE_COUNT,
  FLOOR_TOTAL_BYTES,
  storageLimits,
  type StorageLimits,
  type StoredLimitRequest,
} from './paths.ts';

/** The only row this table ever holds. Matches the CHECK in migration 0004. */
const ROW_ID = 'owner';

/** The owner's raw, unclamped choice for each limit, or null when they have not set one. */
export interface StoredLimitOverrides {
  readonly fileBytes: number | null;
  readonly totalBytes: number | null;
  readonly fileCount: number | null;
}

/** No row yet means no override has ever been set. Same meaning as a row of three nulls. */
const NO_OVERRIDES: StoredLimitOverrides = Object.freeze({ fileBytes: null, totalBytes: null, fileCount: null });

/**
 * What is actually on disk right now, for the one floor computation in this file
 * that needs it. `largestFile` is the size of the biggest single file, which is
 * what a file-bytes override must not be set under: a limit below the largest file
 * already stored would make that file's own next edit un-saveable.
 */
export interface CurrentUsage {
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly largestFile: number;
}

/** The safe default when usage cannot be read cheaply: raise nothing, use the fixed floors. */
const ZERO_USAGE: CurrentUsage = Object.freeze({ totalBytes: 0, fileCount: 0, largestFile: 0 });

/** Sum, count and largest, from exactly the file list `deps.store.listFiles` already returns. */
export function usageFromFiles(files: readonly { readonly sizeBytes: number }[]): CurrentUsage {
  let totalBytes = 0;
  let largestFile = 0;
  for (const f of files) {
    totalBytes += f.sizeBytes;
    if (f.sizeBytes > largestFile) largestFile = f.sizeBytes;
  }
  return { totalBytes, fileCount: files.length, largestFile };
}

/** Read the one settings row. No row is not an error: it is "nothing set yet". */
export async function readStoredLimitOverrides(db: Queryable = getDb()): Promise<StoredLimitOverrides> {
  const rows = await db.select().from(storageLimitOverrides).where(eq(storageLimitOverrides.id, ROW_ID));
  const row = rows[0];
  if (row === undefined) return NO_OVERRIDES;
  return { fileBytes: row.fileBytes, totalBytes: row.totalBytes, fileCount: row.fileCount };
}

/** Write the one settings row, creating it on the first save. */
async function writeStoredLimitOverrides(
  overrides: StoredLimitOverrides,
  at: Date,
  db: Queryable = getDb(),
): Promise<void> {
  await db
    .insert(storageLimitOverrides)
    .values({
      id: ROW_ID,
      fileBytes: overrides.fileBytes,
      totalBytes: overrides.totalBytes,
      fileCount: overrides.fileCount,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: storageLimitOverrides.id,
      set: {
        fileBytes: overrides.fileBytes,
        totalBytes: overrides.totalBytes,
        fileCount: overrides.fileCount,
        updatedAt: at,
      },
    });
}

/** null stays null (no override); a number carries the floor it must be clamped to. */
function toRequest(value: number | null, floor: number): StoredLimitRequest | null {
  return value === null ? null : { requested: value, floor };
}

/**
 * The one place `Math.max(fixed floor, usage)` is computed, so limits-store.ts's
 * two callers — save and boot load — cannot quietly disagree about what "the
 * floor" means for a given limit.
 */
function applyOverrides(overrides: StoredLimitOverrides, usage: CurrentUsage): void {
  applyStoredLimits({
    fileBytes: toRequest(overrides.fileBytes, Math.max(FLOOR_FILE_BYTES, usage.largestFile)),
    totalBytes: toRequest(overrides.totalBytes, Math.max(FLOOR_TOTAL_BYTES, usage.totalBytes)),
    fileCount: toRequest(overrides.fileCount, Math.max(FLOOR_FILE_COUNT, usage.fileCount)),
  });
}

/**
 * Persist the owner's choice and make it live, in that order — the database
 * first, because a value only held in memory disappears at the next restart with
 * nobody having been told it might, exactly as saveAnthropicKey in
 * agent/anthropic-key-store.ts reasons about the same ordering.
 *
 * `usage`, WHEN THE CALLER HAS IT, IS WHAT MAKES THE CLAMP SAFE RATHER THAN JUST
 * PRESENT. src/server/routes/limits.ts is expected to pass real usage, read
 * through the caller's own founder-scoped `deps.store.listFiles`, which is
 * already RLS-correct because it runs inside the request's own founder context.
 * Passing `usageFromFiles([])` (or omitting it) is only safe to do knowingly —
 * see this file's own header for why the boot path has to.
 *
 * Returns the freshly resolved `storageLimits()`, post-clamp, so a caller building
 * an HTTP response never has to make a second call to see what actually landed.
 */
export async function saveStorageLimitOverrides(
  overrides: StoredLimitOverrides,
  usage: CurrentUsage,
  at: Date,
  db: Queryable = getDb(),
): Promise<StorageLimits> {
  await writeStoredLimitOverrides(overrides, at, db);
  applyOverrides(overrides, usage);
  return storageLimits();
}

export interface LoadReport {
  /** True when a stored row was found and applied, false when there was none to apply. */
  readonly applied: boolean;
  /** True when Postgres could not be asked at all. Never fatal: see this file's header. */
  readonly noDatabase: boolean;
}

/**
 * Put whatever the owner last saved back into paths.ts. Called once, at boot,
 * before the first request — see this file's header for why that wiring lives in
 * src/server/index.ts and not here.
 *
 * NEVER FATAL. No database means the founder is already being told about the
 * database elsewhere in boot, which is the thing to fix first; this simply
 * leaves storageLimits() exactly where it already was (GE_LIMIT_* or detection),
 * which is the behaviour every deployment had before this feature existed.
 */
export async function loadStoredLimits(db: Queryable = getDb()): Promise<LoadReport> {
  let overrides: StoredLimitOverrides;
  try {
    overrides = await readStoredLimitOverrides(db);
  } catch {
    // The message is not carried: it is a driver's writing and can hold a
    // connection string, and the caller has nothing useful to do with it either
    // way. src/server/agent/anthropic-key-store.ts's loader makes the same call.
    return { applied: false, noDatabase: true };
  }
  // ZERO_USAGE, not a guess at what is on disk: see the header on why boot cannot
  // read current usage, and toRequest/applyOverrides fall back to the fixed
  // floors when usage is zero.
  applyOverrides(overrides, ZERO_USAGE);
  const applied = overrides.fileBytes !== null || overrides.totalBytes !== null || overrides.fileCount !== null;
  return { applied, noDatabase: false };
}
