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

test("settleSaveDecision clears changed when draft matches what was sent", () => {
  const brain = emptyBrain();
  brain.identity.name = "Ada";
  const saved = {
    workspaceId: "w",
    version: 2,
    sha: "abc",
    updatedAt: null,
    brain: { ...brain, identity: { ...brain.identity, name: "Ada" } },
    readiness: { identity: false, customer: false, offer: false, voice: false, output: false },
    verified: true,
  };
  const decision = settleSaveDecision(brain, saved, { brain, expectedVersion: 1, key: "k1" });
  assert.equal(decision.changed, false);
  assert.match(decision.notice, /Saved\./);
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
    readiness: { identity: false, customer: false, offer: false, voice: false, output: false },
    verified: true,
  };
  const decision = settleSaveDecision(latest, saved, {
    brain: sent,
    expectedVersion: 2,
    key: "k2",
  });
  assert.equal(decision.changed, true);
  assert.equal(decision.nextDraft.identity.name, "Ada Lovelace");
  assert.match(decision.notice, /Keep editing to save the rest/);
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
