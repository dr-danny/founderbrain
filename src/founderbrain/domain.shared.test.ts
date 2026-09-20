import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyBrain,
  fieldNeedsAttention,
  present,
  readiness,
  sectionWouldApprove,
} from "../founderbrain-shared/domain.ts";
import { contentHash, readiness as serverReadiness, validateBrain } from "./domain.ts";

test("present rejects empty and placeholder values", () => {
  assert.equal(present("Ada"), true);
  assert.equal(present("  "), false);
  assert.equal(present("tbd"), false);
  assert.equal(present("N/A"), false);
  assert.equal(fieldNeedsAttention("unknown"), true);
});

test("sectionWouldApprove matches shared readiness rules without requiring prior approval", () => {
  const brain = emptyBrain();
  assert.equal(sectionWouldApprove(brain, "identity"), false);
  brain.identity = {
    name: "Ada",
    venture: "Northwind",
    role: "Founder",
    stage: "exploring",
    goal: "Find a useful problem",
    track: "b2b",
    hybrid: false,
    model: "",
    approved: false,
  };
  assert.equal(sectionWouldApprove(brain, "identity"), true);
  assert.equal(readiness(brain).identity, false, "approved flag still required for readiness");
});

test("server readiness uses contentHash for accepted output", () => {
  const brain = emptyBrain();
  brain.identity = {
    name: "Ada",
    venture: "Northwind",
    role: "Founder",
    stage: "exploring",
    goal: "Find a useful problem",
    track: "b2b",
    hybrid: false,
    model: "",
    approved: true,
  };
  const hash = contentHash(brain);
  const artifact = {
    id: "a1",
    text: "hello",
    sourceVersion: 1,
    sourceHash: hash,
    inputHash: "in",
    acceptedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  assert.equal(serverReadiness(brain, artifact).output, true);
  assert.equal(serverReadiness(brain, { ...artifact, sourceHash: "other" }).output, false);
});

test("validateBrain refuses approved incomplete sections", () => {
  const brain = emptyBrain();
  brain.identity.approved = true;
  assert.throws(() => validateBrain(brain), /identity/);
});
