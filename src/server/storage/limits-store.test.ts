/**
 * src/server/storage/limits-store.test.ts
 *
 * WHAT THIS IS. The owner's stored storage limits, read, written, clamped, and
 * made live in storage/paths.ts — over a fake Postgres handle, the same shape
 * fail-closed.test.ts and turn.rules.test.ts already use for a Queryable that
 * answers exactly the calls under test and nothing else.
 *
 * WHY IT EXISTS. The one property this whole feature is for — the owner sets a
 * limit and the very next storageLimits() call sees it, with no restart — is a
 * cross-module fact, not a fact about one function's return value. So most of
 * these tests call limits-store.ts's public functions and then read
 * storageLimits() back out of paths.ts, exactly the way a real caller would.
 *
 * WHAT IT CALLS. ./limits-store.ts and ./paths.ts. No real Postgres, no real
 * statfsSync or totalmem: __setStorageDetectionForTest pins the host the same
 * way limits.test.ts already does, so a test does not depend on how much disk
 * this container happens to have today.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Queryable } from '../db/client.ts';
import {
  loadStoredLimits,
  readStoredLimitOverrides,
  saveStorageLimitOverrides,
  usageFromFiles,
  type CurrentUsage,
  type StoredLimitOverrides,
} from './limits-store.ts';
import { __setStorageDetectionForTest, applyStoredLimits, storageLimits } from './paths.ts';

const FLOOR_FILE_BYTES = 2 * 1024 * 1024;
const FLOOR_TOTAL_BYTES = 50 * 1024 * 1024;
const FLOOR_FILE_COUNT = 400;

const NO_USAGE: CurrentUsage = { totalBytes: 0, fileCount: 0, largestFile: 0 };
const NOW = new Date('2026-09-07T12:00:00.000Z');

interface FakeRow {
  id: string;
  fileBytes: number | null;
  totalBytes: number | null;
  fileCount: number | null;
  updatedAt: Date;
}

/**
 * A database handle that answers exactly the two statements limits-store.ts
 * makes: the SELECT readStoredLimitOverrides runs, and the upsert
 * saveStorageLimitOverrides runs. Nothing else is wired, so a call this file
 * does not expect throws with a useful stack rather than returning undefined
 * and failing somewhere confusing three lines later.
 */
function fakeDb(initial?: StoredLimitOverrides): { db: Queryable; row: () => FakeRow | undefined } {
  let stored: FakeRow | undefined =
    initial === undefined
      ? undefined
      : { id: 'owner', fileBytes: initial.fileBytes, totalBytes: initial.totalBytes, fileCount: initial.fileCount, updatedAt: NOW };

  const db = {
    select: () => ({
      from: () => ({
        where: async () => (stored ? [stored] : []),
      }),
    }),
    insert: () => ({
      values: (values: FakeRow) => ({
        onConflictDoUpdate: async (opts: { set: Partial<FakeRow> }) => {
          stored = stored ? { ...stored, ...opts.set } : { ...values };
        },
      }),
    }),
  } as unknown as Queryable;

  return { db, row: () => stored };
}

/** A database handle that fails every call, for the "Postgres is unreachable" cases. */
function brokenDb(): Queryable {
  const refuse = (): never => {
    throw new Error('the database is unreachable');
  };
  return { select: refuse, insert: refuse, update: refuse, delete: refuse, execute: refuse } as unknown as Queryable;
}

beforeEach(() => {
  // A generous fake host, well clear of any floor or ceiling, so a test that is
  // about the owner's own choice is not accidentally exercising detection too.
  __setStorageDetectionForTest({
    freeDiskBytes: () => 200 * 1024 * 1024 * 1024,
    totalMemoryBytes: () => 16 * 1024 * 1024 * 1024,
  });
  delete process.env.GE_LIMIT_FILE_BYTES;
  delete process.env.GE_LIMIT_TOTAL_BYTES;
  delete process.env.GE_LIMIT_FILE_COUNT;
});

afterEach(() => {
  // Clears the owner override paths.ts is holding, so one test's save cannot
  // leak into the next one in this same file's process.
  applyStoredLimits({ fileBytes: null, totalBytes: null, fileCount: null });
  __setStorageDetectionForTest(undefined);
  delete process.env.GE_LIMIT_FILE_BYTES;
  delete process.env.GE_LIMIT_TOTAL_BYTES;
  delete process.env.GE_LIMIT_FILE_COUNT;
});

describe('usageFromFiles', () => {
  it('sums bytes, counts files, and finds the largest, from an empty list up', () => {
    assert.deepEqual(usageFromFiles([]), { totalBytes: 0, fileCount: 0, largestFile: 0 });
    assert.deepEqual(usageFromFiles([{ sizeBytes: 10 }, { sizeBytes: 30 }, { sizeBytes: 20 }]), {
      totalBytes: 60,
      fileCount: 3,
      largestFile: 30,
    });
  });
});

describe('reading the stored row', () => {
  it('answers all-null when no row has ever been written, not a throw', async () => {
    const { db } = fakeDb(undefined);
    const overrides = await readStoredLimitOverrides(db);
    assert.deepEqual(overrides, { fileBytes: null, totalBytes: null, fileCount: null });
  });

  it('reads back exactly what was written', async () => {
    const { db } = fakeDb({ fileBytes: 999, totalBytes: null, fileCount: 50 });
    assert.deepEqual(await readStoredLimitOverrides(db), { fileBytes: 999, totalBytes: null, fileCount: 50 });
  });
});

describe('precedence: owner beats config, config beats detection', () => {
  it('an owner value wins outright, even over a GE_LIMIT_* override', async () => {
    process.env.GE_LIMIT_FILE_BYTES = '5000000';
    const { db } = fakeDb();
    await saveStorageLimitOverrides({ fileBytes: 9_000_000, totalBytes: null, fileCount: null }, NO_USAGE, NOW, db);

    const limits = storageLimits();
    assert.equal(limits.fileBytes, 9_000_000);
    assert.equal(limits.source.fileBytes, 'owner');
    // The Setup screen must be able to say the Secret is present and ignored.
    assert.equal(limits.shadowedConfig.fileBytes, 5_000_000);
  });

  it('with no owner value, a GE_LIMIT_* override still wins over detection', async () => {
    process.env.GE_LIMIT_TOTAL_BYTES = '123456789';
    const limits = storageLimits();
    assert.equal(limits.totalBytes, 123_456_789);
    assert.equal(limits.source.totalBytes, 'config');
    assert.equal(limits.shadowedConfig.totalBytes, null, 'nothing is being shadowed when nobody is winning over it');
  });

  it('with neither an owner value nor a GE_LIMIT_* override, detection wins', () => {
    const limits = storageLimits();
    assert.equal(limits.source.fileCount, 'detection');
    assert.equal(limits.owner.fileCount, null);
    assert.equal(limits.shadowedConfig.fileCount, null);
  });

  it('a null clears the owner override and returns that limit to whatever is under it', async () => {
    const { db } = fakeDb();
    await saveStorageLimitOverrides({ fileBytes: 9_000_000, totalBytes: null, fileCount: null }, NO_USAGE, NOW, db);
    assert.equal(storageLimits().source.fileBytes, 'owner');

    process.env.GE_LIMIT_FILE_BYTES = '5000000';
    await saveStorageLimitOverrides({ fileBytes: null, totalBytes: null, fileCount: null }, NO_USAGE, NOW, db);

    const limits = storageLimits();
    assert.equal(limits.fileBytes, 5_000_000, 'falls through to the config override once the owner value is cleared');
    assert.equal(limits.source.fileBytes, 'config');
    assert.equal(limits.owner.fileBytes, null);
  });
});

describe('the core regression: storageLimits() sees a save immediately', () => {
  it('reflects the new value on the very next call, with no reload and no restart', async () => {
    const before = storageLimits().fileCount;
    const { db } = fakeDb();
    await saveStorageLimitOverrides({ fileBytes: null, totalBytes: null, fileCount: 4_321 }, NO_USAGE, NOW, db);
    const after = storageLimits();
    assert.notEqual(after.fileCount, before);
    assert.equal(after.fileCount, 4_321);
    assert.equal(after.source.fileCount, 'owner');
  });
});

describe('clamping: never a throw, always a visible reduction or floor', () => {
  it('a value set above what this machine can take is reduced to what it can take, and says so', async () => {
    // The fake host above detects a large but finite ceiling. Asking for ten
    // times the total memory is not a number any real host would produce.
    const { db } = fakeDb();
    const requested = 999 * 1024 * 1024 * 1024 * 1024; // absurdly large
    await saveStorageLimitOverrides({ fileBytes: requested, totalBytes: null, fileCount: null }, NO_USAGE, NOW, db);

    const limits = storageLimits();
    assert.ok(limits.owner.fileBytes !== null);
    assert.equal(limits.owner.fileBytes.requested, requested, 'the raw ask is still reported, even though it was too big');
    assert.equal(limits.owner.fileBytes.clamped, true);
    assert.equal(limits.fileBytes, limits.detected.fileBytes, 'clamped to exactly what detection says this machine holds');
    assert.ok(limits.fileBytes < requested);
  });

  it('a garbage value (zero, negative, or not-a-number) is clamped to the floor rather than crashing', async () => {
    for (const garbage of [0, -5, Number.NaN]) {
      const { db } = fakeDb();
      await saveStorageLimitOverrides({ fileBytes: null, totalBytes: garbage, fileCount: null }, NO_USAGE, NOW, db);
      const limits = storageLimits();
      assert.equal(limits.totalBytes, FLOOR_TOTAL_BYTES, `garbage value ${String(garbage)} should fall back to the floor`);
      assert.equal(limits.source.totalBytes, 'owner');
    }
  });

  it('the floor is raised to the founder\'s current usage, so a save cannot lock out the next one', async () => {
    const { db } = fakeDb();
    const usage: CurrentUsage = { totalBytes: 80 * 1024 * 1024, fileCount: 10, largestFile: 3 * 1024 * 1024 };
    // The owner asks for less than what is already on disk.
    await saveStorageLimitOverrides({ fileBytes: null, totalBytes: 10 * 1024 * 1024, fileCount: null }, usage, NOW, db);

    const limits = storageLimits();
    assert.equal(limits.totalBytes, usage.totalBytes, 'raised to current usage, not left at the requested value or the fixed floor');
    assert.ok(limits.owner.totalBytes !== null && limits.owner.totalBytes.clamped);
  });

  it('below the fixed floor is still honoured when usage is lower than the floor', async () => {
    const { db } = fakeDb();
    await saveStorageLimitOverrides({ fileBytes: 1024, totalBytes: null, fileCount: null }, NO_USAGE, NOW, db);
    assert.equal(storageLimits().fileBytes, FLOOR_FILE_BYTES);
  });
});

describe('loadStoredLimits, the boot path', () => {
  it('restores what was saved before a restart', async () => {
    const { db } = fakeDb({ fileBytes: null, totalBytes: null, fileCount: 777 });
    const report = await loadStoredLimits(db);
    assert.equal(report.applied, true);
    assert.equal(report.noDatabase, false);
    assert.equal(storageLimits().fileCount, 777);
    assert.equal(storageLimits().source.fileCount, 'owner');
  });

  it('reports nothing applied when no row has ever been written', async () => {
    const { db } = fakeDb(undefined);
    const report = await loadStoredLimits(db);
    assert.equal(report.applied, false);
    assert.equal(report.noDatabase, false);
    assert.equal(storageLimits().source.fileCount, 'detection');
  });

  it('never throws when the database cannot be reached, and leaves detection/config in force', async () => {
    process.env.GE_LIMIT_FILE_COUNT = '42';
    const report = await loadStoredLimits(brokenDb());
    assert.equal(report.noDatabase, true);
    assert.equal(report.applied, false);
    assert.equal(storageLimits().fileCount, 42, 'boot failing to read the row must not disturb what was already in force');
  });

  it('falls back to the fixed floor rather than current usage, since boot has no founder to read usage under', async () => {
    // Below the fixed floor. loadStoredLimits cannot know that 500 GB is already
    // on disk (that would need a founder-scoped, RLS-correct read this module
    // deliberately does not attempt at boot), so it clamps to the plain floor.
    const { db } = fakeDb({ fileBytes: null, totalBytes: 10, fileCount: null });
    await loadStoredLimits(db);
    assert.equal(storageLimits().totalBytes, FLOOR_TOTAL_BYTES);
  });
});
