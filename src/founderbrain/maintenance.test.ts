/**
 * Pure tests for the maintenance reads: the sequence-health body builder, the
 * GoHighLevel posts parser, and the new dueKinds schedules. No network, no
 * database; every figure in the fixtures is fabricated test data that only
 * ever lives here.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { campaignsBody, dueKinds } from "./routines.ts";
import { type CampaignFigures } from "./apollo.ts";
import { figuresOf, parsePostList } from "./ghl-maintenance.ts";

function c(over: Partial<CampaignFigures>): CampaignFigures {
  return {
    id: "c1",
    name: "Outbound Q4",
    active: true,
    loadedStats: true,
    uniqueDelivered: null,
    uniqueBounced: null,
    uniqueOpened: null,
    uniqueReplied: null,
    ...over,
  };
}

test("sequence health body reports only returned figures", () => {
  const body = campaignsBody([c({ uniqueDelivered: 120, uniqueBounced: 3, uniqueOpened: 45, uniqueReplied: 7 })]);
  assert.ok(body.includes("Outbound Q4"));
  assert.ok(body.includes("delivered: 120"));
  assert.ok(body.includes("replied: 7"));
  assert.ok(!body.includes("rate"));
  assert.ok(body.includes("Nothing was sent, started or stopped"));
});

test("sequence health body says not returned, never zero", () => {
  const body = campaignsBody([c({ name: "Fresh", active: false })]);
  assert.ok(body.includes("not returned"));
  assert.ok(!body.includes("delivered: 0"));
  assert.ok(body.includes("paused"));
});

test("what worked parser reads the posts list shape and collects figures", () => {
  const posts = parsePostList({
    results: {
      posts: [
        {
          _id: "p1",
          message: "First line\nsecond line",
          platform: "facebook",
          scheduled_at: "2026-09-18T10:00:00Z",
          likes: 12,
          comments: 2,
          stats: { impressions: 300 },
        },
        { id: "p2", message: "", caption: "Caption instead" },
      ],
    },
  });
  assert.equal(posts.length, 2);
  assert.equal(posts[0]!.id, "p1");
  assert.equal(posts[0]!.firstLine, "First line");
  assert.equal(posts[0]!.platform, "facebook");
  assert.equal(posts[0]!.figures.likes, 12);
  assert.equal(posts[0]!.figures.impressions, 300);
  assert.equal(posts[1]!.id, "p2");
  assert.equal(posts[1]!.firstLine, "Caption instead");
  assert.deepEqual(posts[1]!.figures, {});
});

test("figures only count shallow numbers the API put on the object", () => {
  const figures = figuresOf({ likes: 4, nested: { a: 1 }, arr: [1], text: "x", nan: Number.NaN });
  assert.deepEqual(figures, { likes: 4 });
});

test("posts parser returns nothing for junk responses instead of guessing", () => {
  assert.deepEqual(parsePostList(null), []);
  assert.deepEqual(parsePostList({ results: {} }), []);
  assert.deepEqual(parsePostList({ results: [] }).length, 0);
});

const LA = "America/Los_Angeles";

function settings(over: Partial<Parameters<typeof dueKinds>[0]> = {}) {
  return {
    timezone: LA,
    mondayPlan: false,
    contentTopUp: false,
    readinessDigest: false,
    sequenceHealth: true,
    whatWorked: true,
    ...over,
  };
}

test("sequence health fires weekdays from 09:00 founder-local", () => {
  const tue0900 = new Date("2026-09-22T16:00:00Z"); // Tue 09:00 PDT
  const tue0859 = new Date("2026-09-22T15:59:00Z");
  const sat0900 = new Date("2026-09-26T16:00:00Z"); // Saturday
  assert.ok(dueKinds(settings(), tue0900).some((d) => d.kind === "sequence_health"));
  assert.ok(!dueKinds(settings(), tue0859).some((k) => k.kind === "sequence_health"));
  assert.ok(!dueKinds(settings(), sat0900).some((k) => k.kind === "sequence_health"));
  assert.ok(
    !dueKinds(settings({ sequenceHealth: false }), tue0900).some((k) => k.kind === "sequence_health"),
  );
});

test("what worked fires Friday 16:00 onward within its ISO week", () => {
  const fri1600 = new Date("2026-09-25T23:00:00Z"); // Fri 16:00 PDT
  const fri1559 = new Date("2026-09-25T22:59:00Z");
  const thu1600 = new Date("2026-09-24T23:00:00Z");
  const sat1700 = new Date("2026-09-26T00:00:00Z"); // Saturday 10:00 PDT, late is fine
  assert.ok(dueKinds(settings(), fri1600).some((k) => k.kind === "what_worked"));
  assert.ok(!dueKinds(settings(), fri1559).some((k) => k.kind === "what_worked"));
  assert.ok(!dueKinds(settings(), thu1600).some((k) => k.kind === "what_worked"));
  assert.ok(dueKinds(settings(), sat1700).some((k) => k.kind === "what_worked"));
  assert.ok(!dueKinds(settings({ whatWorked: false }), fri1600).some((k) => k.kind === "what_worked"));
});