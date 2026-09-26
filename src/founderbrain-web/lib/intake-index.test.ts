/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { emptyBrain } from "../types";
import { GUIDE_STEPS } from "../guide-intake";
import { firstMissingItem, guideIndexItems, guideStepStatus } from "./intake-index";

test("guideIndexItems includes name, ready, site plus every GUIDE_STEP", () => {
  const brain = emptyBrain();
  const items = guideIndexItems({
    brain,
    track: null,
    name: "",
    readyAnswered: false,
    siteAnswered: false,
  });
  assert.equal(items.length, 3 + GUIDE_STEPS.length);
  assert.equal(items[0]!.id, "name");
  assert.equal(items[1]!.id, "ready");
  assert.equal(items[2]!.id, "site-ask");
  for (const step of GUIDE_STEPS) {
    assert.ok(items.some((item) => item.id === step.id), `missing item for ${step.id}`);
  }
});

test("ready and site-ask are always nonblocking (optional)", () => {
  const brain = emptyBrain();
  const items = guideIndexItems({ brain, track: null, name: "", readyAnswered: false, siteAnswered: false });
  const ready = items.find((item) => item.id === "ready")!;
  const site = items.find((item) => item.id === "site-ask")!;
  assert.equal(ready.required, false);
  assert.equal(site.required, false);
});

test("name needs a saved Brain value, not just an old local nickname", () => {
  const brain = emptyBrain();
  const typed = guideIndexItems({ brain, track: null, name: "Danny", readyAnswered: false, siteAnswered: false });
  assert.equal(typed.find((item) => item.id === "name")!.answered, false);
  assert.match(typed.find((item) => item.id === "name")!.detail!, /Save this name/);

  brain.identity.name = "Danny";
  const saved = guideIndexItems({ brain, track: null, name: "", readyAnswered: false, siteAnswered: false });
  assert.equal(saved.find((item) => item.id === "name")!.answered, true);
});

test("guideStepStatus mirrors step.empty/optional honestly", () => {
  const brain = emptyBrain();
  const venture = GUIDE_STEPS.find((s) => s.id === "venture")!;
  const price = GUIDE_STEPS.find((s) => s.id === "price")!;
  assert.deepEqual(guideStepStatus(brain, null, venture), { required: true, answered: false });
  assert.deepEqual(guideStepStatus(brain, null, price), { required: false, answered: false });
  brain.identity.venture = "Acme";
  brain.offer.price = "$100/mo";
  assert.deepEqual(guideStepStatus(brain, null, venture), { required: true, answered: true });
  assert.deepEqual(guideStepStatus(brain, null, price), { required: false, answered: true });
});

// "exploring" (Pre-revenue) is a real answer, not the empty sentinel -- pins
// the same bug class as guide-intake.test.ts's stage test, but through the
// index item's answered flag.
test("stage choice step counts a real (non-empty-string) choice as answered", () => {
  const brain = emptyBrain();
  brain.identity.stage = "exploring";
  const stage = GUIDE_STEPS.find((s) => s.id === "stage")!;
  assert.equal(guideStepStatus(brain, null, stage).answered, true);
});

test("firstMissingItem finds the first required-but-unanswered item in item order", () => {
  const brain = emptyBrain();
  const items = guideIndexItems({ brain, track: null, name: "Danny", readyAnswered: true, siteAnswered: true });
  const missing = firstMissingItem(items);
  assert.equal(missing?.id, "name");
});

test("firstMissingItem is null once every required item is answered", () => {
  const brain = emptyBrain();
  brain.identity.name = "Danny";
  for (const step of GUIDE_STEPS) {
    if (step.optional) continue;
    if (step.section === "track") continue; // track comes from the `track` param
    const bucket = brain[step.section] as unknown as Record<string, unknown>;
    if (step.kind === "choices") {
      bucket[step.field] = step.field === "stage" ? "building" : "b2b";
      continue;
    }
    bucket[step.field] = "answered";
  }
  const items = guideIndexItems({ brain, track: "b2b", name: "Danny", readyAnswered: true, siteAnswered: true });
  assert.equal(firstMissingItem(items), null);
});

test("legacy sparse profiles can render the full index without a missing-field crash", () => {
  const brain = emptyBrain();
  delete (brain.offer as unknown as Record<string, unknown>).why;
  delete (brain.identity as unknown as Record<string, unknown>).stage;
  delete (brain.customer as unknown as Record<string, unknown>).evidence;
  const items = guideIndexItems({ brain, track: null, name: "", readyAnswered: false, siteAnswered: false });
  assert.equal(items.length, 3 + GUIDE_STEPS.length);
  assert.equal(items.find((item) => item.id === "why")!.answered, false);
  assert.equal(items.find((item) => item.id === "stage")!.answered, false);
  assert.equal(items.find((item) => item.id === "proof")!.answered, false);
  assert.equal(items.find((item) => item.id === "proof")!.required, false);
});
