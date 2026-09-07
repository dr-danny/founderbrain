/**
 * src/server/storage/limits.test.ts
 *
 * WHAT THIS IS. storageLimits() under test: the three storage limits harvest.ts enforces,
 * detected from the host, overridable by configuration, cached for the life of the process.
 *
 * WHY IT EXISTS. This app is self-hosted, so the numbers a founder's own harvest enforces
 * cannot be picked for us in advance; they have to come from the box the app actually runs
 * on. Detection can be wrong in exactly one dangerous direction, though: if it ever came
 * back BELOW what a founder already has on disk, every future save would be refused, on a
 * folder that did nothing wrong. So the one fact worth more tests than any other here is
 * that detection cannot go below the floor, no matter what the fake host reports, and that
 * an operator who explicitly overrides is obeyed even when they ask for less than that.
 *
 * WHAT IT CALLS. storage/paths.ts only, through storageLimits() and the
 * __setStorageDetectionForTest seam that swaps statfsSync/totalmem for fakes. No real
 * filesystem statted, no database.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { __setStorageDetectionForTest, storageLimits } from './paths.ts';

// Mirrors the load-bearing floors in paths.ts: the three numbers this app hard-coded
// before detection existed. Not imported, because they are deliberately not exported —
// a test that could import them could also silently track a change to them. Kept here as
// plain numbers so a change to the floors in paths.ts without an equal change here is a
// failing test rather than a passing one that proves nothing.
const FLOOR_FILE_BYTES = 2 * 1024 * 1024;
const FLOOR_TOTAL_BYTES = 50 * 1024 * 1024;
const FLOOR_FILE_COUNT = 400;

const ENV_KEYS = ['GE_LIMIT_FILE_BYTES', 'GE_LIMIT_TOTAL_BYTES', 'GE_LIMIT_FILE_COUNT'] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  // A generous fake host by default, well clear of any floor or ceiling, so a test that
  // only cares about config overrides is not accidentally exercising the floor logic too.
  __setStorageDetectionForTest({
    freeDiskBytes: () => 200 * 1024 * 1024 * 1024,
    totalMemoryBytes: () => 16 * 1024 * 1024 * 1024,
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __setStorageDetectionForTest(undefined);
});

describe('storageLimits, config overrides', () => {
  it('honours a GE_LIMIT_FILE_BYTES override', () => {
    process.env.GE_LIMIT_FILE_BYTES = '12345';
    const limits = storageLimits();
    assert.equal(limits.fileBytes, 12345);
    assert.equal(limits.source.fileBytes, 'config');
  });

  it('honours a GE_LIMIT_TOTAL_BYTES override', () => {
    process.env.GE_LIMIT_TOTAL_BYTES = '999999';
    const limits = storageLimits();
    assert.equal(limits.totalBytes, 999999);
    assert.equal(limits.source.totalBytes, 'config');
  });

  it('honours a GE_LIMIT_FILE_COUNT override', () => {
    process.env.GE_LIMIT_FILE_COUNT = '7';
    const limits = storageLimits();
    assert.equal(limits.fileCount, 7);
    assert.equal(limits.source.fileCount, 'config');
  });

  it('honours an override below the floor: an operator who sets a small number has decided that', () => {
    process.env.GE_LIMIT_FILE_BYTES = '10';
    process.env.GE_LIMIT_TOTAL_BYTES = '10';
    process.env.GE_LIMIT_FILE_COUNT = '1';
    const limits = storageLimits();
    assert.equal(limits.fileBytes, 10);
    assert.equal(limits.totalBytes, 10);
    assert.equal(limits.fileCount, 1);
    assert.equal(limits.source.fileBytes, 'config');
    assert.equal(limits.source.totalBytes, 'config');
    assert.equal(limits.source.fileCount, 'config');
  });

  it('leaves the other two limits on detection when only one is overridden', () => {
    process.env.GE_LIMIT_FILE_BYTES = '12345';
    const limits = storageLimits();
    assert.equal(limits.source.fileBytes, 'config');
    assert.equal(limits.source.totalBytes, 'detection');
    assert.equal(limits.source.fileCount, 'detection');
  });
});

describe('storageLimits, detection', () => {
  it('never returns a limit below the floor, however little the fake host reports', () => {
    __setStorageDetectionForTest({
      freeDiskBytes: () => 1,
      totalMemoryBytes: () => 1,
    });
    const limits = storageLimits();
    assert.equal(limits.fileBytes, FLOOR_FILE_BYTES);
    assert.equal(limits.totalBytes, FLOOR_TOTAL_BYTES);
    assert.equal(limits.fileCount, FLOOR_FILE_COUNT);
    assert.equal(limits.detected.fileBytes, FLOOR_FILE_BYTES);
    assert.equal(limits.detected.totalBytes, FLOOR_TOTAL_BYTES);
    assert.equal(limits.detected.fileCount, FLOOR_FILE_COUNT);
    assert.equal(limits.source.fileBytes, 'detection');
    assert.equal(limits.source.totalBytes, 'detection');
    assert.equal(limits.source.fileCount, 'detection');
  });

  it('raises a limit above the floor on a host that genuinely has more room', () => {
    __setStorageDetectionForTest({
      freeDiskBytes: () => 200 * 1024 * 1024 * 1024, // 200 GiB
      totalMemoryBytes: () => 16 * 1024 * 1024 * 1024, // 16 GiB
    });
    const limits = storageLimits();
    assert.ok(limits.fileBytes > FLOOR_FILE_BYTES, 'fileBytes should be raised above the floor');
    assert.ok(limits.totalBytes > FLOOR_TOTAL_BYTES, 'totalBytes should be raised above the floor');
    assert.ok(limits.fileCount > FLOOR_FILE_COUNT, 'fileCount should be raised above the floor');
  });

  it('falls back to the floors, rather than throwing, when detection fails', () => {
    __setStorageDetectionForTest({
      freeDiskBytes: () => {
        throw new Error('statfsSync is not supported on this host');
      },
      totalMemoryBytes: () => 16 * 1024 * 1024 * 1024,
    });
    const limits = storageLimits();
    assert.equal(limits.fileBytes, FLOOR_FILE_BYTES);
    assert.equal(limits.totalBytes, FLOOR_TOTAL_BYTES);
    assert.equal(limits.fileCount, FLOOR_FILE_COUNT);
    // Not merely equal to the floor by coincidence of a small fake host: source still
    // says 'detection', because no override was set. A crash never reaches the caller.
    assert.equal(limits.source.fileBytes, 'detection');
    assert.equal(limits.source.totalBytes, 'detection');
    assert.equal(limits.source.fileCount, 'detection');
  });
});

describe('storageLimits, caching', () => {
  it('runs detection once and returns the same values on a second call', () => {
    let calls = 0;
    __setStorageDetectionForTest({
      freeDiskBytes: () => {
        calls++;
        return 200 * 1024 * 1024 * 1024;
      },
      totalMemoryBytes: () => 16 * 1024 * 1024 * 1024,
    });
    const first = storageLimits();
    const second = storageLimits();
    assert.equal(calls, 1, 'detection must not be re-run on a second call');
    assert.equal(first, second, 'the same cached object should be returned');
    assert.deepEqual(first, second);
  });
});
