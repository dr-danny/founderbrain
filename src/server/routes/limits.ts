/**
 * src/server/routes/limits.ts
 *
 * WHAT THIS IS. `GET /api/limits` and `POST /api/limits`. The Setup screen's read
 * of the three storage limits — largest file, largest whole folder, most files —
 * and the one way the owner changes them, taking effect immediately, with no
 * restart.
 *
 * WHY IT EXISTS. `storage/paths.ts`'s `storageLimits()` already resolves these
 * three numbers, from GE_LIMIT_* or from what the host detects, for every save a
 * founder makes. This route is what lets the owner see that resolution and add a
 * third, higher-precedence source: their own choice, made once, on a screen they
 * can actually read and change. `storage/limits-store.ts` does the persistence
 * and the cache invalidation; this file is the HTTP shape around it.
 *
 * A CHANGE HERE MUST BE VISIBLE AS A CHANGE, NOT A SILENT SUBSTITUTION. An owner
 * who types a number too big for this machine to hold does not get a refusal —
 * `storage/paths.ts` clamps it — but the screen showing them "your file limit is
 * now 40 MB" when they typed 4 GB would be a lie by omission. `requested` and
 * `clamped` on every limit are what let the screen say "we set this to 40 MB,
 * which is as high as this machine goes" instead.
 *
 * WHAT CALLS IT. ./index.ts registers it. The Setup screen calls GET on load and
 * POST when the owner saves.
 * WHAT IT READS. `deps.auth`, the session's founder. `deps.store.listFiles`, so a
 * save can raise the floor an owner-set value is clamped to, to what is already
 * on disk — see storage/limits-store.ts for why that has to happen here, inside
 * this request's founder scope, rather than inside that module. The
 * `storage_limit_overrides` row, through storage/limits-store.ts.
 * WHAT IT WRITES. The `storage_limit_overrides` row, and the in-process override
 * storage/paths.ts holds for the rest of this container's life.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Queryable } from '../db/client.ts';
import {
  readStoredLimitOverrides,
  saveStorageLimitOverrides,
  usageFromFiles,
  type StoredLimitOverrides,
} from '../storage/limits-store.ts';
import { storageLimits, type LimitOverride, type LimitSource, type StorageLimits } from '../storage/paths.ts';
import { ERRORS, errorBody } from './errors.ts';
import type { RouteDeps } from './deps.ts';

/**
 * TEST SEAM, not for production use. limits-store.ts's DB functions default to
 * `getDb()`, a real Postgres pool this folder's route tests deliberately do not
 * open — see routes/setup-key.test.ts's own header for why a route test that
 * needed Postgres would be a route test nobody ran on a laptop. This lets
 * limits.test.ts drive the whole POST flow — validation, the merge with what is
 * already stored, the usage-aware clamp, persistence — against a fake, the same
 * way storage/paths.ts's __setStorageDetectionForTest swaps the host for a fake.
 * Undefined in production, always: every real request falls through to
 * limits-store.ts's own default.
 */
let testDb: Queryable | undefined;
export function __setLimitsDbForTest(db: Queryable | undefined): void {
  testDb = db;
}

/**
 * One limit, shaped for the Setup screen.
 *
 *   value           what is actually enforced right now.
 *   detected        what this machine would give a founder who had set nothing.
 *   source          which of 'owner' | 'config' | 'detection' produced `value`.
 *   requested       what the owner typed, even when `value` had to move away from
 *                   it. Null when the owner has not set this limit.
 *   clamped         true when `value` differs from `requested`.
 *   shadowedConfig  the GE_LIMIT_* value for this limit, ONLY when one is set and
 *                   is being overridden by the owner's own choice. Null otherwise,
 *                   including when no GE_LIMIT_* was ever set — a Secret that is
 *                   quietly doing nothing must read differently from a Secret
 *                   that was never there.
 */
export interface LimitView {
  readonly value: number;
  readonly detected: number;
  readonly source: LimitSource;
  readonly requested: number | null;
  readonly clamped: boolean;
  readonly shadowedConfig: number | null;
}

export interface LimitsView {
  readonly fileBytes: LimitView;
  readonly totalBytes: LimitView;
  readonly fileCount: LimitView;
}

function viewOf(
  value: number,
  detected: number,
  source: LimitSource,
  owner: LimitOverride | null,
  shadowedConfig: number | null,
): LimitView {
  return {
    value,
    detected,
    source,
    requested: owner === null ? null : owner.requested,
    clamped: owner !== null && owner.clamped,
    shadowedConfig,
  };
}

/**
 * The body GET and POST both send, built from whatever storageLimits() says right
 * now. POST calls this AFTER saving, so the owner sees the true post-clamp result
 * without a second request.
 */
export function limitsView(limits: StorageLimits = storageLimits()): LimitsView {
  return {
    fileBytes: viewOf(
      limits.fileBytes,
      limits.detected.fileBytes,
      limits.source.fileBytes,
      limits.owner.fileBytes,
      limits.shadowedConfig.fileBytes,
    ),
    totalBytes: viewOf(
      limits.totalBytes,
      limits.detected.totalBytes,
      limits.source.totalBytes,
      limits.owner.totalBytes,
      limits.shadowedConfig.totalBytes,
    ),
    fileCount: viewOf(
      limits.fileCount,
      limits.detected.fileCount,
      limits.source.fileCount,
      limits.owner.fileCount,
      limits.shadowedConfig.fileCount,
    ),
  };
}

/**
 * One limit from the owner: a positive whole number, or null to clear the
 * override and fall back to GE_LIMIT_* or detection. Undefined (the field left
 * out of the body entirely) means "leave this one exactly as it is".
 *
 * RANGE IS NOT CHECKED HERE. A value bigger than this machine can hold is
 * clamped and reported by storage/paths.ts, never refused — that is the whole
 * safety property this feature exists for, and rejecting a large number at the
 * door would just move the failure from a form that explains itself to one that
 * does not. What IS refused, as a plain 400, is a value that could not have come
 * from a number input working correctly: not a number, a fraction, zero,
 * negative, or big enough that no host detection could ever have produced it
 * honestly.
 */
const LimitInput = z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional();

const LimitsBody = z.object({
  fileBytes: LimitInput,
  totalBytes: LimitInput,
  fileCount: LimitInput,
});

export async function registerLimitsRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get('/api/limits', async (request, reply) => {
    if (!(await deps.auth.requireFounder(request, reply))) return reply;
    return reply.send(limitsView());
  });

  app.post('/api/limits', async (request, reply) => {
    if (!(await deps.auth.requireFounder(request, reply))) return reply;
    const founder = deps.auth.founderOf(request);

    const parsed = LimitsBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(ERRORS.badRequest.status).send(errorBody(ERRORS.badRequest));
    }

    // A field left out of the body is "leave this one alone", not "clear it" —
    // null is what clears an override. Falling back to what is already stored
    // is what stops a save of fileBytes alone from wiping the other two.
    const current = await readStoredLimitOverrides(testDb);
    const next: StoredLimitOverrides = {
      fileBytes: parsed.data.fileBytes === undefined ? current.fileBytes : parsed.data.fileBytes,
      totalBytes: parsed.data.totalBytes === undefined ? current.totalBytes : parsed.data.totalBytes,
      fileCount: parsed.data.fileCount === undefined ? current.fileCount : parsed.data.fileCount,
    };

    // Read through this request's own founder-scoped store, never a bare cross
    // founder query: see storage/limits-store.ts's header on why current usage
    // can only be read correctly here, inside a request that already carries a
    // founder id, and not inside that module.
    const files = await deps.store.listFiles(founder.id);
    const usage = usageFromFiles(files);

    const limits = await saveStorageLimitOverrides(next, usage, deps.clock.now(), testDb);
    return reply.send(limitsView(limits));
  });
}
