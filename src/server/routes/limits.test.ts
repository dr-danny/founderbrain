/**
 * src/server/routes/limits.test.ts
 *
 * WHAT THIS IS. `GET /api/limits` and `POST /api/limits`, driven through the real
 * HTTP surface with a real session cookie, exactly the way buildHarness drives
 * every other route in this folder.
 *
 * WHY POST RUNS AGAINST A FAKE DATABASE HANDLE, NOT A MISSING ONE. Unlike most of
 * this folder, this route's write path reaches storage/limits-store.ts, which
 * calls getDb() by default — a real Postgres pool. routes/setup-key.test.ts
 * documents why a route test that needed Postgres would be a route test nobody
 * ran on a laptop, and follows that by simply not driving the one route in that
 * file that writes. This file does not have that luxury: the one thing worth
 * proving here is the WIRING — that a POST actually reaches storage/paths.ts and
 * the very next GET (or the POST's own response) reflects it — so
 * __setLimitsDbForTest swaps the pool for the same small fake Queryable
 * storage/limits-store.test.ts already uses, rather than skipping the write path
 * at this layer entirely. The clamp arithmetic and precedence rules themselves
 * are proved once, thoroughly, in limits-store.test.ts; this file is about the
 * route's own job: auth, validation, the merge with what is already stored, and
 * the response shape.
 *
 * EVERY TEST CLOSES ITS INSTANCE IN A `finally`, AND THAT IS NOT TIDINESS.
 * routes/errors.test.ts already found this the hard way and wrote it down: a
 * close that sits after the assertions is a close a failing assertion throws
 * past, the instance never comes down, and the file times out at 30 seconds
 * with every subtest reported green. `finally` is what keeps that failure a red
 * assertion instead of a hang that names nothing.
 *
 * WHAT IT CALLS. The real Fastify instance from ./test-fixtures.ts, and
 * ./limits.ts's test seam.
 * WHAT IT READS AND WRITES. Nothing outside the process: the fake Queryable
 * below holds one row in a closure, never Postgres.
 */

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { FOUNDER_A } from '../auth/test-fixtures.ts';
import type { Queryable } from '../db/client.ts';
import { applyStoredLimits, __setStorageDetectionForTest } from '../storage/paths.ts';
import { __setLimitsDbForTest, type LimitsView } from './limits.ts';
import { buildHarness, type Harness } from './test-fixtures.ts';

const JSON_HEADERS = { 'content-type': 'application/json' };

interface FakeRow {
  id: string;
  fileBytes: number | null;
  totalBytes: number | null;
  fileCount: number | null;
  updatedAt: Date;
}

/** The same shape of fake limits-store.test.ts uses, one row held in a closure. */
function fakeDb(initial?: Partial<FakeRow>): Queryable {
  let stored: FakeRow | undefined =
    initial === undefined
      ? undefined
      : {
          id: 'owner',
          fileBytes: initial.fileBytes ?? null,
          totalBytes: initial.totalBytes ?? null,
          fileCount: initial.fileCount ?? null,
          updatedAt: new Date('2026-09-07T12:00:00.000Z'),
        };
  return {
    select: () => ({ from: () => ({ where: async () => (stored ? [stored] : []) }) }),
    insert: () => ({
      values: (values: FakeRow) => ({
        onConflictDoUpdate: async (opts: { set: Partial<FakeRow> }) => {
          stored = stored ? { ...stored, ...opts.set } : { ...values };
        },
      }),
    }),
  } as unknown as Queryable;
}

afterEach(() => {
  __setLimitsDbForTest(undefined);
  applyStoredLimits({ fileBytes: null, totalBytes: null, fileCount: null });
  __setStorageDetectionForTest(undefined);
});

function pinHost(): void {
  // Generous and fixed, so a test asserting an exact value never depends on how
  // much disk this container happens to have today.
  __setStorageDetectionForTest({
    freeDiskBytes: () => 200 * 1024 * 1024 * 1024,
    totalMemoryBytes: () => 16 * 1024 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------------------
// Who may reach it
// ---------------------------------------------------------------------------

test('A STRANGER WITH NO SESSION REACHES NEITHER ENDPOINT', async () => {
  const h: Harness = await buildHarness();
  try {
    const get = await h.app.inject({ method: 'GET', url: '/api/limits' });
    assert.equal(get.statusCode, 401);
    const post = await h.app.inject({ method: 'POST', url: '/api/limits', headers: JSON_HEADERS, payload: {} });
    assert.equal(post.statusCode, 401);
  } finally {
    await h.app.close();
  }
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

test('with nothing ever set, GET reports detection with no owner value and nothing shadowed', async () => {
  pinHost();
  const h: Harness = await buildHarness();
  try {
    const cookie = await h.signIn();
    const res = await h.app.inject({ method: 'GET', url: '/api/limits', headers: { cookie } });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as LimitsView;
    for (const key of ['fileBytes', 'totalBytes', 'fileCount'] as const) {
      assert.equal(body[key].source, 'detection', key);
      assert.equal(body[key].requested, null, key);
      assert.equal(body[key].clamped, false, key);
      assert.equal(body[key].shadowedConfig, null, key);
      assert.equal(body[key].value, body[key].detected, key);
    }
  } finally {
    await h.app.close();
  }
});

test('GET reflects an owner value already in force, including that it was clamped', async () => {
  pinHost();
  applyStoredLimits({
    fileBytes: { requested: 999 * 1024 * 1024 * 1024, floor: 2 * 1024 * 1024 },
    totalBytes: null,
    fileCount: null,
  });
  const h: Harness = await buildHarness();
  try {
    const cookie = await h.signIn();
    const res = await h.app.inject({ method: 'GET', url: '/api/limits', headers: { cookie } });
    const body = JSON.parse(res.body) as LimitsView;
    assert.equal(body.fileBytes.source, 'owner');
    assert.equal(body.fileBytes.requested, 999 * 1024 * 1024 * 1024);
    assert.equal(body.fileBytes.clamped, true);
    assert.equal(body.fileBytes.value, body.fileBytes.detected);
  } finally {
    await h.app.close();
  }
});

// ---------------------------------------------------------------------------
// POST: validation, before anything is stored
// ---------------------------------------------------------------------------

test('a body that is not the right shape is refused as bad_request, and nothing is stored', async () => {
  pinHost();
  const h: Harness = await buildHarness();
  try {
    const cookie = await h.signIn();
    // Number.NaN is left out on purpose: JSON has no way to carry it, so
    // JSON.stringify({ totalBytes: NaN }) sends "totalBytes":null, which is a
    // valid, meaningful body (null clears an override) rather than a bad one.
    for (const payload of [
      { fileBytes: 'a lot' },
      { fileBytes: -5 },
      { fileBytes: 0 },
      { fileBytes: 1.5 },
      { fileCount: 'lots' },
      { fileCount: [1, 2, 3] },
    ]) {
      const res = await h.app.inject({ method: 'POST', url: '/api/limits', headers: { cookie, ...JSON_HEADERS }, payload });
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
      assert.equal((JSON.parse(res.body) as { error: string }).error, 'bad_request');
    }
    // storageLimits() must be exactly where it started: nothing from the loop above landed.
    const get = await h.app.inject({ method: 'GET', url: '/api/limits', headers: { cookie } });
    const body = JSON.parse(get.body) as LimitsView;
    assert.equal(body.fileBytes.source, 'detection');
  } finally {
    await h.app.close();
  }
});

// ---------------------------------------------------------------------------
// POST: the write path, against the fake Queryable
// ---------------------------------------------------------------------------

test('a save takes effect immediately: the POST response itself carries the new, post-clamp value', async () => {
  pinHost();
  __setLimitsDbForTest(fakeDb());
  const h: Harness = await buildHarness();
  try {
    const cookie = await h.signIn();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/limits',
      headers: { cookie, ...JSON_HEADERS },
      payload: { fileCount: 4321 },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body) as LimitsView;
    assert.equal(body.fileCount.value, 4321);
    assert.equal(body.fileCount.source, 'owner');
    assert.equal(body.fileCount.clamped, false);

    // No second request needed to prove it stuck: a fresh GET agrees.
    const get = await h.app.inject({ method: 'GET', url: '/api/limits', headers: { cookie } });
    assert.equal((JSON.parse(get.body) as LimitsView).fileCount.value, 4321);
  } finally {
    await h.app.close();
  }
});

test('a null clears an owner override and the limit returns to detection', async () => {
  pinHost();
  __setLimitsDbForTest(fakeDb({ fileBytes: 9_000_000 }));
  applyStoredLimits({ fileBytes: { requested: 9_000_000, floor: 2 * 1024 * 1024 }, totalBytes: null, fileCount: null });
  const h: Harness = await buildHarness();
  try {
    const cookie = await h.signIn();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/limits',
      headers: { cookie, ...JSON_HEADERS },
      payload: { fileBytes: null },
    });
    const body = JSON.parse(res.body) as LimitsView;
    assert.equal(body.fileBytes.source, 'detection');
    assert.equal(body.fileBytes.requested, null);
  } finally {
    await h.app.close();
  }
});

test('setting one limit leaves the other two exactly as they were', async () => {
  pinHost();
  const db = fakeDb();
  __setLimitsDbForTest(db);
  const h: Harness = await buildHarness();
  try {
    const cookie = await h.signIn();
    await h.app.inject({
      method: 'POST',
      url: '/api/limits',
      headers: { cookie, ...JSON_HEADERS },
      payload: { totalBytes: 60 * 1024 * 1024 },
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/limits',
      headers: { cookie, ...JSON_HEADERS },
      payload: { fileCount: 500 },
    });
    const body = JSON.parse(res.body) as LimitsView;
    assert.equal(body.totalBytes.value, 60 * 1024 * 1024, 'the earlier save must survive an unrelated later one');
    assert.equal(body.fileCount.value, 500);
  } finally {
    await h.app.close();
  }
});

test('a value the owner set below what is already on disk is raised to current usage, not refused', async () => {
  pinHost();
  __setLimitsDbForTest(fakeDb());
  const h: Harness = await buildHarness();
  try {
    const cookie = await h.signIn();
    h.store.putFile(FOUNDER_A, 'founder-brain.md', 'x'.repeat(80 * 1024 * 1024));

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/limits',
      headers: { cookie, ...JSON_HEADERS },
      payload: { totalBytes: 1024 },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body) as LimitsView;
    assert.equal(body.totalBytes.clamped, true);
    assert.ok(body.totalBytes.value >= 80 * 1024 * 1024, 'raised to at least what is already stored');
  } finally {
    await h.app.close();
  }
});

test('GE_LIMIT_* set alongside an owner value is reported as shadowed, not silently dropped', async () => {
  pinHost();
  __setLimitsDbForTest(fakeDb());
  const saved = process.env['GE_LIMIT_FILE_COUNT'];
  process.env['GE_LIMIT_FILE_COUNT'] = '10';
  const h: Harness = await buildHarness();
  try {
    const cookie = await h.signIn();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/limits',
      headers: { cookie, ...JSON_HEADERS },
      payload: { fileCount: 500 },
    });
    const body = JSON.parse(res.body) as LimitsView;
    assert.equal(body.fileCount.value, 500, 'the owner still wins');
    assert.equal(body.fileCount.shadowedConfig, 10, 'but the screen can say the Secret is present and ignored');
  } finally {
    await h.app.close();
    if (saved === undefined) delete process.env['GE_LIMIT_FILE_COUNT'];
    else process.env['GE_LIMIT_FILE_COUNT'] = saved;
  }
});
