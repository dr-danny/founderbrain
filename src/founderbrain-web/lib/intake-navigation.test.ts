/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { emptyBrain } from "../types";
import {
  guideSequence,
  parseStoredCursor,
  resolveInitialCursor,
} from "./intake-navigation";

test("parseStoredCursor treats blank/absent as no cursor, not zero", () => {
  // Number("") === 0, which is the bug this guards against.
  assert.equal(parseStoredCursor(""), null);
  assert.equal(parseStoredCursor("   "), null);
  assert.equal(parseStoredCursor("not-a-number"), null);
  assert.equal(parseStoredCursor("-1"), null);
  assert.equal(parseStoredCursor("0"), 0);
  assert.equal(parseStoredCursor("4"), 4);
  assert.equal(parseStoredCursor("4.9"), 4);
});

test("resolveInitialCursor honors a valid stored cursor over everything else", () => {
  const brain = emptyBrain();
  const cursor = resolveInitialCursor({
    storedCursorRaw: "3",
    welcomeDone: false,
    yesAccepted: false,
    screen: 0,
    includeUrl: false,
    brain,
    track: null,
  });
  assert.equal(cursor, 3);
});

test("resolveInitialCursor with no stored cursor and welcome not done falls back to screen", () => {
  const brain = emptyBrain();
  assert.equal(
    resolveInitialCursor({
      storedCursorRaw: "",
      welcomeDone: false,
      yesAccepted: false,
      screen: 0,
      includeUrl: false,
      brain,
      track: null,
    }),
    0,
  );
  assert.equal(
    resolveInitialCursor({
      storedCursorRaw: "",
      welcomeDone: false,
      yesAccepted: false,
      screen: 2,
      includeUrl: false,
      brain,
      track: null,
    }),
    1,
  );
});

test("resolveInitialCursor with no stored cursor resumes at first missing required step", () => {
  const brain = emptyBrain();
  brain.identity.venture = "Acme";
  brain.offer.description = "Widgets";
  const cursor = resolveInitialCursor({
    storedCursorRaw: "",
    welcomeDone: true,
    yesAccepted: false,
    screen: 2,
    includeUrl: false,
    brain,
    track: null,
  });
  const seq = guideSequence(false);
  assert.equal(seq[cursor], "g:buyer");
});

test("resolveInitialCursor never blocks resume on a blank optional step", () => {
  const brain = emptyBrain();
  // Fill every required field, leave every optional field (price, proof,
  // workaround) blank, and resolve the track separately as GUIDE_STEPS does.
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
  const cursor = resolveInitialCursor({
    storedCursorRaw: "",
    welcomeDone: true,
    yesAccepted: false,
    screen: 2,
    includeUrl: false,
    brain,
    track: "b2b",
  });
  const seq = guideSequence(false);
  // Every required step (including track) is answered; resume lands at the
  // end of the sequence rather than stalling on an optional blank field.
  assert.equal(cursor, seq.length - 1);
});

test("guideSequence includes site-url only when includeUrl is set", () => {
  assert.equal(guideSequence(false).includes("site-url"), false);
  assert.equal(guideSequence(true).includes("site-url"), true);
});


test("saved intake resumes without old browser-only welcome flags", () => {
  const brain = emptyBrain();
  brain.identity.venture = "Sandbox saved answer";
  const cursor = resolveInitialCursor({ storedCursorRaw: "", welcomeDone: false, yesAccepted: false, screen: 2, includeUrl: false, brain, track: null });
  assert.equal(guideSequence(false)[cursor], "g:sells");
});

test("the final confirmation is a reachable step", () => {
  const sequence = guideSequence(false);
  assert.equal(sequence[sequence.length - 2], "g:sample");
  assert.equal(sequence[sequence.length - 1], "complete");
});
