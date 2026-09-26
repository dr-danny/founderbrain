import assert from "node:assert/strict";
import test from "node:test";
import { emptyBrain } from "../types";
import { brainsEqual, nextSaveOperation, patchBrain, settleSaveDecision } from "./brain-draft.ts";
import {
  interpretJobStatus,
  interpretPollTimeout,
  nextPollWaitMs,
  JOB_POLL_INITIAL_WAIT_MS,
} from "./job-poll.ts";

test("patchBrain clears approved when a field changes", () => {
  const brain = emptyBrain();
  brain.identity.approved = true;
  const next = patchBrain(brain, "identity", "name", "Ada");
  assert.equal(next.identity.name, "Ada");
  assert.equal(next.identity.approved, false);
});

test("patchBrain can set approved explicitly", () => {
  const brain = emptyBrain();
  const next = patchBrain(brain, "identity", "approved", true);
  assert.equal(next.identity.approved, true);
});

test("patchBrain is a no-op when the value is unchanged: same reference, approval untouched", () => {
  const brain = emptyBrain();
  brain.identity.approved = true;
  brain.identity.name = "Ada";
  const next = patchBrain(brain, "identity", "name", "Ada");
  assert.equal(next, brain);
  assert.equal(next.identity.approved, true);
});

test("patchBrain no-op on the same track does not clear customer/context approval", () => {
  const brain = emptyBrain();
  brain.identity.approved = true;
  brain.customer.approved = true;
  brain.context.approved = true;
  // identity.track defaults to "b2b"; re-sending the same track is a no-op.
  const next = patchBrain(brain, "identity", "track", "b2b");
  assert.equal(next, brain);
  assert.equal(next.customer.approved, true);
  assert.equal(next.context.approved, true);
});

test("patchBrain on an actual track change reopens customer/context approval", () => {
  const brain = emptyBrain();
  brain.identity.approved = true;
  brain.customer.approved = true;
  brain.context.approved = true;
  const next = patchBrain(brain, "identity", "track", "b2c");
  assert.notEqual(next, brain);
  assert.equal(next.identity.track, "b2c");
  assert.equal(next.identity.approved, false);
  assert.equal(next.customer.approved, false);
  assert.equal(next.context.approved, false);
});

test("patchBrain on a real field change still returns a new object and clears approval", () => {
  const brain = emptyBrain();
  brain.voice.approved = true;
  const next = patchBrain(brain, "voice", "sampleCount", 10);
  assert.notEqual(next, brain);
  assert.equal(next.voice.sampleCount, 10);
  assert.equal(next.voice.approved, false);
});

test("patchBrain no-op when the sample count refresh repeats the same stored count", () => {
  const brain = emptyBrain();
  brain.voice.approved = true;
  brain.voice.sampleCount = 10;
  const next = patchBrain(brain, "voice", "sampleCount", 10);
  assert.equal(next, brain);
  assert.equal(next.voice.approved, true);
});

test("settleSaveDecision clears changed when draft matches what was sent", () => {
  const brain = emptyBrain();
  brain.identity.name = "Ada";
  const saved = {
    workspaceId: "w",
    version: 2,
    sha: "abc",
    updatedAt: null,
    brain: { ...brain, identity: { ...brain.identity, name: "Ada" } },
    readiness: { identity: false, customer: false, offer: false, voice: false, context: false, output: false },
    verified: true,
  };
  const decision = settleSaveDecision(brain, saved, { brain, expectedVersion: 1, key: "k1" });
  assert.equal(decision.changed, false);
  assert.match(decision.notice, /Saved as version 2/);
});

test("settleSaveDecision keeps local edits when draft moved on during save", () => {
  const sent = emptyBrain();
  sent.identity.name = "Ada";
  const latest = emptyBrain();
  latest.identity.name = "Ada Lovelace";
  const saved = {
    workspaceId: "w",
    version: 3,
    sha: "def",
    updatedAt: null,
    brain: sent,
    readiness: { identity: false, customer: false, offer: false, voice: false, context: false, output: false },
    verified: true,
  };
  const decision = settleSaveDecision(latest, saved, {
    brain: sent,
    expectedVersion: 2,
    key: "k2",
  });
  assert.equal(decision.changed, true);
  assert.equal(decision.nextDraft.identity.name, "Ada Lovelace");
  assert.match(decision.notice, /New local edits remain unsaved/);
});

test("nextSaveOperation reuses the key for an identical retry", () => {
  const brain = emptyBrain();
  const existing = { brain, expectedVersion: 4, key: "same-key" };
  const again = nextSaveOperation(existing, brain, 4, () => "new-key");
  assert.equal(again.key, "same-key");
});

test("nextSaveOperation mints a new key when the draft changed", () => {
  const brain = emptyBrain();
  const existing = { brain, expectedVersion: 4, key: "old" };
  const edited = patchBrain(brain, "identity", "name", "Ada");
  const again = nextSaveOperation(existing, edited, 4, () => "fresh");
  assert.equal(again.key, "fresh");
  assert.equal(brainsEqual(again.brain, edited), true);
});

test("job poll wait backs off up to the cap", () => {
  let wait = JOB_POLL_INITIAL_WAIT_MS;
  wait = nextPollWaitMs(wait);
  assert.ok(wait > JOB_POLL_INITIAL_WAIT_MS);
  for (let i = 0; i < 20; i += 1) wait = nextPollWaitMs(wait);
  assert.equal(wait, 5_000);
});

test("interpretJobStatus and timeout outcomes", () => {
  assert.equal(interpretJobStatus("completed").kind, "completed");
  assert.equal(interpretJobStatus("failed").kind, "failed");
  assert.equal(interpretJobStatus("uncertain").kind, "uncertain");
  assert.equal(interpretJobStatus("running").kind, "continue");
  assert.equal(interpretPollTimeout("running").kind, "still_running");
  assert.equal(interpretPollTimeout(null).kind, "unresolved");
});
