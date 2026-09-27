import assert from "node:assert/strict";
import test from "node:test";
import { emptyBrain } from "../types";
import { patchBrain } from "./brain-draft.ts";
import { prepareGenerateJob, runExclusive, type LockRef } from "./generate-job.ts";
import type { Brain, BrainState } from "../types";

function stateFor(brain: Brain, version: number): BrainState {
  return {
    workspaceId: "w",
    version,
    sha: "sha",
    updatedAt: null,
    brain,
    readiness: {
      identity: false,
      customer: false,
      offer: false,
      voice: false,
      context: false,
      output: false,
    },
    verified: true,
  };
}

// Regression: the channel picker only writes to the local draft. Generate
// used to check the last-saved `state` for channels and mint the job's
// expectedVersion from `state.version`, so a channel pick that had not been
// saved yet looked like "no channels selected", and even once channels were
// detected, the job could be started against a version that predated them.
test("prepareGenerateJob blocks with no_channels before ever calling save", async () => {
  const saved = emptyBrain();
  let saveCalls = 0;
  const plan = await prepareGenerateJob({
    getDraft: () => saved,
    state: stateFor(saved, 1),
    save: async () => {
      saveCalls += 1;
      return stateFor(saved, 2);
    },
  });
  assert.deepEqual(plan, { kind: "no_channels" });
  assert.equal(saveCalls, 0);
});

test("prepareGenerateJob saves the live draft before minting a job version", async () => {
  const saved = emptyBrain();
  const draft = patchBrain(saved, "context", "contentChannels", "Instagram\nLinkedIn");
  const savedState = stateFor(saved, 1);
  let sentBrain: Brain | null = null;
  const plan = await prepareGenerateJob({
    getDraft: () => draft,
    state: savedState,
    save: async (brain) => {
      sentBrain = brain;
      return stateFor(brain, 2);
    },
  });
  assert.equal(sentBrain !== null, true);
  assert.equal(sentBrain, draft);
  assert.equal(plan.kind, "ready");
  if (plan.kind === "ready") {
    // The job must be started against the version save() actually returned,
    // not the stale version the draft was checked against.
    assert.equal(plan.state.version, 2);
    assert.equal(plan.state.brain.context.contentChannels, "Instagram\nLinkedIn");
  }
});

test("prepareGenerateJob skips saving when the draft already matches the saved brain", async () => {
  const saved = patchBrain(emptyBrain(), "context", "contentChannels", "Instagram");
  let saveCalls = 0;
  const plan = await prepareGenerateJob({
    getDraft: () => saved,
    state: stateFor(saved, 5),
    save: async () => {
      saveCalls += 1;
      return stateFor(saved, 6);
    },
  });
  assert.equal(saveCalls, 0);
  assert.deepEqual(plan, { kind: "ready", state: stateFor(saved, 5) });
});

test("prepareGenerateJob blocks with save_failed on a conflict, and starts no job", async () => {
  const saved = emptyBrain();
  const draft = patchBrain(saved, "context", "contentChannels", "TikTok");
  const plan = await prepareGenerateJob({
    getDraft: () => draft,
    state: stateFor(saved, 1),
    // Mirrors save()'s real contract: returns undefined on an unresolved
    // conflict/error, after it has already surfaced its own banner.
    save: async () => undefined,
  });
  assert.deepEqual(plan, { kind: "save_failed" });
});

test("prepareGenerateJob blocks with superseded when the draft moves during the save", async () => {
  const saved = emptyBrain();
  const firstPick = patchBrain(saved, "context", "contentChannels", "Instagram");
  const secondPick = patchBrain(firstPick, "context", "contentChannels", "Instagram\nYouTube");
  let live = firstPick;
  const plan = await prepareGenerateJob({
    getDraft: () => live,
    state: stateFor(saved, 1),
    save: async (brain) => {
      // Simulate the founder changing the selection again while this save
      // is still in flight, before save() resolves.
      live = secondPick;
      return stateFor(brain, 2);
    },
  });
  assert.deepEqual(plan, { kind: "superseded" });
});

test("runExclusive drops an overlapping call and clears the lock afterward", async () => {
  const lock: LockRef = { current: false };
  let running = 0;
  let maxConcurrent = 0;
  const control: { resolve: (() => void) | null } = { resolve: null };
  const slow = () =>
    new Promise<string>((resolve) => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      control.resolve = () => {
        running -= 1;
        resolve("done");
      };
    });

  const first = runExclusive(lock, slow);
  // Fired before the first call's promise settles or React could re-render;
  // a state-only guard (checked once per render) would not see this in time.
  const second = runExclusive(lock, slow);
  assert.equal(lock.current, true);

  const secondOutcome = await second;
  assert.deepEqual(secondOutcome, { kind: "already_running" });
  assert.equal(maxConcurrent, 1);

  control.resolve?.();
  const firstOutcome = await first;
  assert.deepEqual(firstOutcome, { kind: "ran", result: "done" });
  assert.equal(lock.current, false);

  // The lock is released, so a third call now runs.
  const third = await runExclusive(lock, async () => "again");
  assert.deepEqual(third, { kind: "ran", result: "again" });
});

test("runExclusive releases the lock even when the guarded function throws", async () => {
  const lock: LockRef = { current: false };
  await assert.rejects(
    runExclusive(lock, async () => {
      throw new Error("save blew up");
    }),
  );
  assert.equal(lock.current, false);
});
