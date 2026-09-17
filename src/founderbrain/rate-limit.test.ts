import assert from "node:assert/strict";
import test from "node:test";
import { SlidingWindowLimiter, mutationKey } from "./rate-limit.ts";

test("sliding window allows then refuses within the window", () => {
  let now = 1_000;
  const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1_000 }, () => now);
  assert.equal(limiter.take("ip:1").allowed, true);
  assert.equal(limiter.take("ip:1").allowed, true);
  const blocked = limiter.take("ip:1");
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.ok(blocked.retryAfterSec >= 1);
  now = 2_100;
  assert.equal(limiter.take("ip:1").allowed, true);
});

test("mutationKey normalises artifact accept paths", () => {
  assert.equal(mutationKey("POST", "/api/artifact/abc/accept"), "POST /api/artifact/:id/accept");
  assert.equal(mutationKey("PUT", "/api/brain"), "PUT /api/brain");
});
