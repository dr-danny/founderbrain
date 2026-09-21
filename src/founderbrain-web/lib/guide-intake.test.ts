/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { emptyBrain } from "../types";
import { GUIDE_STEPS, guideIsComplete, nextGuideStep } from "../guide-intake";

/** Pins the #66 intake loop: the first empty guide step is the routing target. */

test("fresh brain routes to venture first", () => {
  const brain = emptyBrain();
  const first = nextGuideStep(brain, null);
  assert.equal(first?.id, "venture");
  assert.equal(guideIsComplete(brain, null), false);
});

test("venture empty while later steps filled still routes to venture", () => {
  const brain = emptyBrain();
  // Simulate the zombie state: cursor pinned at the sample step with its value
  // saved, but venture (skipped by a site-import failure) still empty.
  brain.voice.sample = "A sentence in the founder voice.";
  brain.voice.tone = "direct";
  brain.voice.boundaries = "no hype";
  const first = nextGuideStep(brain, "b2b");
  assert.equal(first?.id, "venture");
  assert.equal(guideIsComplete(brain, "b2b"), false);
});

test("guide completes only when every required step is filled", () => {
  const brain = emptyBrain();
  for (const step of GUIDE_STEPS) {
    if (step.section === "track") continue;
    const bucket = brain[step.section] as unknown as Record<string, unknown>;
    if (step.kind === "choices") {
      bucket[step.field] =
        step.field === "stage"
          ? "building"
          : step.field === "revenueBand"
            ? "under10k"
            : "service";
      continue;
    }
    bucket[step.field] = "filled answer";
  }
  // Track is stored outside the Brain: complete when the resolved track is set.
  assert.equal(guideIsComplete(brain, "b2b"), true);
  assert.equal(guideIsComplete(brain, null), false);
  assert.equal(nextGuideStep(brain, null)?.id, "track");
  assert.equal(nextGuideStep(brain, "b2b"), null);
});