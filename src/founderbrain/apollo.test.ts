/**
 * Pure tests for the Apollo connection module: outcome mapping, key check
 * against a stubbed fetch, and the campaign figure parser. No network, no
 * database; the key in these fixtures is fake and the tests also assert it
 * never leaks into an error path.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { checkApolloKey, outcomeForApolloStatus, parseCampaigns } from "./apollo.ts";

const KEY = "test-key-not-real";

function jsonFetch(status: number, body: unknown) {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

test("Apollo status codes map to named outcomes", () => {
  assert.deepEqual(outcomeForApolloStatus(401), { kind: "auth_rejected" });
  assert.deepEqual(outcomeForApolloStatus(403), { kind: "forbidden" });
  assert.deepEqual(outcomeForApolloStatus(429), { kind: "rate_limited" });
  assert.deepEqual(outcomeForApolloStatus(503), { kind: "vendor_unavailable" });
  assert.equal(outcomeForApolloStatus(200), null);
  assert.equal(outcomeForApolloStatus(400), null);
});

test("key check accepts a 200 with a people array", async () => {
  const outcome = await checkApolloKey(KEY, jsonFetch(200, { people: [{ name: "a" }] }));
  assert.equal(outcome.kind, "ok");
});

test("key check maps specific failures to their own outcomes", async () => {
  assert.equal((await checkApolloKey(KEY, jsonFetch(401, {}))).kind, "auth_rejected");
  assert.equal((await checkApolloKey(KEY, jsonFetch(403, {}))).kind, "forbidden");
  assert.equal((await checkApolloKey(KEY, jsonFetch(429, {}))).kind, "rate_limited");
  assert.equal((await checkApolloKey(KEY, jsonFetch(500, {}))).kind, "vendor_unavailable");
  assert.equal((await checkApolloKey(KEY, jsonFetch(400, {}))).kind, "unreadable");
});

test("a 200 without a people array is unreadable, never stored as working", async () => {
  assert.equal((await checkApolloKey(KEY, jsonFetch(200, { error: "nope" }))).kind, "unreadable");
  assert.equal((await checkApolloKey(KEY, jsonFetch(200, "<html>"))).kind, "unreadable");
});

test("a refused call is unreadable and never leaks the key", async () => {
  const refusing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const outcome = await checkApolloKey(KEY, refusing);
  assert.equal(outcome.kind, "unreadable");
  assert.ok(!(outcome as { why?: string }).why?.includes(KEY));
});

test("campaign parser reads only the figures Apollo returned", () => {
  const campaigns = parseCampaigns({
    emailer_campaigns: [
      {
        id: "c1",
        name: "Outbound Q4",
        active: true,
        loaded_stats: true,
        unique_delivered: 120,
        unique_bounced: 3,
        unique_opened: 45,
        unique_replied: 7,
      },
      { id: "c2", name: "Fresh", loaded_stats: false, active: false },
    ],
  });
  assert.equal(campaigns.length, 2);
  assert.deepEqual(campaigns[0], {
    id: "c1",
    name: "Outbound Q4",
    active: true,
    loadedStats: true,
    uniqueDelivered: 120,
    uniqueBounced: 3,
    uniqueOpened: 45,
    uniqueReplied: 7,
  });
  assert.equal(campaigns[1]!.uniqueDelivered, null);
  assert.equal(campaigns[1]!.uniqueReplied, null);
  assert.equal(campaigns[1]!.active, false);
  assert.equal(campaigns[1]!.loadedStats, false);
});

test("campaign parser refuses to invent from junk shapes", () => {
  assert.deepEqual(parseCampaigns(null), []);
  assert.deepEqual(parseCampaigns({ emailer_campaigns: "no" }), []);
  const junk = parseCampaigns({ emailer_campaigns: [null, { name: 42 }, { active: "yes", unique_delivered: "12" }] });
  assert.equal(junk.length, 3);
  for (const c of junk) {
    assert.equal(c.id, null);
    assert.equal(c.name, null);
    assert.equal(c.uniqueDelivered, null);
  }
});