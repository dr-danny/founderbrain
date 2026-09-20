/**
 * Pure-logic tests for the routines module (Phase 1: Monday plan, content
 * top-up, readiness digest). DB paths run in CI with Postgres; here we cover
 * the scheduling math and the deterministic readiness gaps.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { dueKinds, isoWeekKey, localNow, mondayOf, mondayOfIsoWeek, readinessGaps } from "./routines.ts";
import { emptyBrain, readiness as sharedReadiness } from "../founderbrain-shared/domain.ts";
import type { BrainState } from "../founderbrain-shared/domain.ts";

const LA = "America/Los_Angeles";

function stateFor(): BrainState {
  const brain = emptyBrain();
  return {
    workspaceId: "w1",
    version: 1,
    sha: "sha",
    updatedAt: null,
    brain,
    readiness: sharedReadiness(brain),
    verified: false,
  };
}

test("isoWeekKey matches ISO 8601 around the year boundary", () => {
  // 2026-09-16 was a Wednesday in ISO week 38.
  assert.equal(isoWeekKey(new Date(Date.UTC(2026, 8, 16))), "2026-W38");
  // 2026-01-01 falls in the last week of 2025.
  assert.equal(isoWeekKey(new Date(Date.UTC(2026, 0, 1))), "2026-W01");
  // Monday 2026-09-21 starts week 39.
  assert.equal(isoWeekKey(new Date(Date.UTC(2026, 8, 21))), "2026-W39");
});

test("mondayOf returns the Monday of the week", () => {
  assert.equal(mondayOf(new Date(Date.UTC(2026, 8, 16))), "2026-09-14"); // Wed -> Mon
  assert.equal(mondayOf(new Date(Date.UTC(2026, 8, 21))), "2026-09-21"); // Mon itself
});

test("mondayOfIsoWeek resolves the Monday of an ISO week key", () => {
  assert.equal(mondayOfIsoWeek("2026-W38"), "2026-09-14");
  assert.equal(mondayOfIsoWeek("2026-W39"), "2026-09-21");
  assert.equal(mondayOfIsoWeek("2026-W01"), mondayOf(new Date(Date.UTC(2025, 11, 29)))); // 2026-W01 Monday
});

test("localNow resolves the founder wall clock and rejects junk", () => {
  const at = new Date("2026-09-21T15:30:00Z"); // 08:30 in Los Angeles (PDT, UTC-7)
  const local = localNow("America/Los_Angeles", at)!;
  assert.equal(local.dateKey, "2026-09-21");
  assert.equal(local.weekday, 1);
  assert.equal(local.hour, 8);
  assert.equal(localNow("", at), null);
  assert.equal(localNow("Not/AZone", at), null);
});

test("dueKinds honours the local schedule and the toggles", () => {
  const base: Parameters<typeof dueKinds>[0] = {
    timezone: LA,
    mondayPlan: true,
    contentTopUp: true,
    readinessDigest: true,
  };
  // Monday 06:30 LA: nothing due yet.
  assert.deepEqual(dueKinds(base, new Date("2026-09-21T13:30:00Z")), []);
  // Monday 07:30 LA: only the Monday plan.
  assert.deepEqual(dueKinds(base, new Date("2026-09-21T14:00:00Z")).map((d) => d.kind), ["monday_plan"]);
  // Monday 08:30 LA: plan + content top-up + readiness.
  const all = dueKinds(base, new Date("2026-09-21T15:00:00Z"));
  assert.deepEqual(all.map((d) => d.kind), ["monday_plan", "content_top_up", "readiness"]);
  // Wednesday afternoon: plan and top-up still owed this week (late), readiness daily.
  const wed = new Date("2026-09-23T20:00:00Z");
  assert.deepEqual(dueKinds(base, wed).map((d) => d.kind), ["monday_plan", "content_top_up", "readiness"]);
  // Sunday: nothing Monday-bound, readiness still daily.
  const sun = new Date("2026-09-27T20:00:00Z");
  assert.deepEqual(dueKinds(base, sun).map((d) => d.kind), ["readiness"]);
  // Toggles off remove the kinds.
  assert.deepEqual(
    dueKinds({ ...base, mondayPlan: false, contentTopUp: false }, wed).map((d) => d.kind),
    ["readiness"],
  );
  // No timezone: never due (the sweep only processes registered timezones).
  assert.deepEqual(dueKinds({ ...base, timezone: "" }, wed), []);
});

test("readinessGaps lists the real gaps gate by gate", () => {
  const gaps = readinessGaps(stateFor());
  assert.ok(gaps.some((g) => g.includes("Identity")));
  assert.ok(gaps.some((g) => g.includes("Customer")));
  assert.ok(gaps.some((g) => g.includes("Offer")));
  assert.ok(gaps.some((g) => g.includes("Voice")));
  assert.ok(gaps.some((g) => g.includes("Channels")));
  assert.ok(gaps.some((g) => g.includes("First output")));
  assert.ok(gaps.some((g) => g.includes("Voice samples: 0 of 10")));
});

test("readinessGaps uses the B2C gate, not the B2B one", () => {
  const s = stateFor();
  s.brain.identity.track = "b2c";
  const gaps = readinessGaps(s);
  assert.ok(gaps.some((g) => g.includes("Instagram")));
  assert.ok(!gaps.some((g) => g.includes("domain is fresh")));
  const s2 = stateFor();
  s2.brain.context.domainStatus = "fresh";
  const gaps2 = readinessGaps(s2);
  assert.ok(gaps2.some((g) => g.includes("SPF, DKIM and DMARC")));
});

test("a green brain with accepted output writes no readiness draft", () => {
  const s = stateFor();
  // Fill every section and approve it, then readiness passes.
  s.brain.identity = {
    ...s.brain.identity,
    name: "Ada", venture: "Northwind", role: "Founder", goal: "g", approved: true,
  };
  s.brain.customer = {
    ...s.brain.customer,
    segment: "s", problem: "p", outcome: "o", workaround: "w", evidenceStatus: "supported", evidence: "e", approved: true,
  };
  s.brain.offer = {
    ...s.brain.offer,
    description: "d", delivery: "dl", outcome: "o", cta: "c", approved: true,
  };
  s.brain.voice = { ...s.brain.voice, tone: "t", boundaries: "b", sample: "s", sampleCount: 10, approved: true };
  s.brain.context = { ...s.brain.context, channelsActive: "c", customersNow: "n", target90: "t", approved: true };
  s.readiness = sharedReadiness(s.brain);
  s.readiness.output = true;
  assert.deepEqual(readinessGaps(s), []);
});
