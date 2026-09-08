/// <reference types="node" />
/**
 * src/web/routes/Thread.test.ts
 *
 * WHAT IT IS. The one pure function Thread.tsx exports specifically so it can be tested
 * apart from the component: the name a pasted sample is stored under.
 *
 * WHY IT EXISTS. `saveAsFile` used to name every pasted sample `sample-<date>.md`, so a
 * founder's second paste on the same day silently replaced the first: same name, same
 * slug on the server, one file where there should have been two. `sampleFileName` is the
 * fix, and this is the test that a second paste minutes later really does produce a
 * different name rather than merely looking like it should.
 *
 * WHAT IT READS AND WRITES. Nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sampleFileName } from "./Thread.tsx";

test("two pastes on the same day, minutes apart, produce two different file names", () => {
  const first = sampleFileName(new Date("2026-09-08T14:23:05.000Z"));
  const second = sampleFileName(new Date("2026-09-08T14:41:12.000Z"));
  assert.notEqual(first, second);
  // Both still land on the same day, which is exactly the case the old name collided on.
  assert.ok(first.startsWith("sample-2026-09-08"));
  assert.ok(second.startsWith("sample-2026-09-08"));
});

test("the name ends in .md, and carries no character a stored slug would refuse", () => {
  const name = sampleFileName(new Date("2026-09-08T14:23:05.000Z"));
  assert.ok(name.endsWith(".md"));
  assert.equal(name, "sample-2026-09-08T14-23-05.md");
  assert.doesNotMatch(name, /:/, "a colon in a stored name is exactly what this rewrite removes");
});
