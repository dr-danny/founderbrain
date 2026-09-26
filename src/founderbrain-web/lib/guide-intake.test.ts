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

const stageStep = () => GUIDE_STEPS.find((step) => step.id === "stage")!;

test("blank stage sentinel is the only value the stage step treats as empty", () => {
  const brain = emptyBrain();
  assert.equal(brain.identity.stage, "");
  assert.equal(stageStep().empty(brain, null), true);
});

for (const value of ["exploring", "building", "launched", "growing"] as const) {
  test(`real stage value "${value}" (incl. Pre-revenue) is never treated as empty`, () => {
    const brain = emptyBrain();
    brain.identity.stage = value;
    assert.equal(stageStep().empty(brain, null), false);
  });
}

test("stage left blank still routes the guide to the stage step", () => {
  const brain = emptyBrain();
  brain.identity.venture = "Acme";
  brain.offer.description = "Widgets";
  brain.customer.segment = "Ops managers";
  const next = nextGuideStep(brain, null);
  assert.equal(next?.id, "stage");
});

test("optional blank fields (price, proof, workaround) never block completion", () => {
  const brain = emptyBrain();
  brain.identity.venture = "Acme";
  brain.identity.role = "Founder";
  brain.identity.goal = "More customers";
  brain.identity.stage = "exploring";
  brain.offer.description = "Widgets";
  brain.offer.why = "Faster";
  brain.offer.delivery = "Shipped";
  brain.offer.cta = "Buy now";
  brain.customer.segment = "Ops managers";
  brain.customer.problem = "Too slow";
  brain.customer.outcome = "Faster ops";
  brain.voice.tone = "Direct";
  brain.voice.boundaries = "No hype";
  brain.voice.sample = "We ship fast.";
  // price, proof, workaround left blank on purpose.
  assert.equal(brain.offer.price.trim(), "");
  assert.equal(brain.customer.evidence.trim(), "");
  assert.equal(brain.customer.workaround.trim(), "");
  assert.equal(nextGuideStep(brain, "b2b"), null);
  assert.equal(guideIsComplete(brain, "b2b"), true);
});

test("a single missing required field still blocks completion even with optionals blank", () => {
  const brain = emptyBrain();
  brain.identity.venture = "Acme";
  brain.identity.role = "Founder";
  // identity.goal left empty on purpose: a required gap.
  brain.identity.stage = "exploring";
  brain.offer.description = "Widgets";
  brain.offer.why = "Faster";
  brain.offer.delivery = "Shipped";
  brain.offer.cta = "Buy now";
  brain.customer.segment = "Ops managers";
  brain.customer.problem = "Too slow";
  brain.customer.outcome = "Faster ops";
  brain.voice.tone = "Direct";
  brain.voice.boundaries = "No hype";
  brain.voice.sample = "We ship fast.";
  assert.equal(nextGuideStep(brain, "b2b")?.id, "goal");
  assert.equal(guideIsComplete(brain, "b2b"), false);
});