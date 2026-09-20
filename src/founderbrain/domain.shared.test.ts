import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyBrain,
  fieldNeedsAttention,
  present,
  readiness,
  sectionWouldApprove,
} from "../founderbrain-shared/domain.ts";
import { contentHash, exportMarkdown, readiness as serverReadiness, validateBrain } from "./domain.ts";

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
    modelNearestFit: false,
    modelNote: "",
    team: "",
    revenueBand: "",
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
    modelNearestFit: false,
    modelNote: "",
    team: "",
    revenueBand: "",
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

test("new identity fields default on legacy brains and export stays additive", () => {
  // A pre-team/nearest-fit blob must still parse: zod defaults cover it.
  const legacy = validateBrain({
    schemaVersion: 1,
    identity: { name: "Ada", venture: "Northwind", role: "Founder", stage: "exploring", goal: "g", approved: false },
    customer: { segment: "s", problem: "p", outcome: "o", workaround: "w", evidenceStatus: "hypothesis", evidence: "", approved: false },
    offer: { description: "d", delivery: "dl", outcome: "o", cta: "c", price: "", approved: false },
    voice: { tone: "t", boundaries: "b", sample: "s", sampleCount: 10, approved: false },
  });
  assert.equal(legacy.identity.team, "");
  assert.equal(legacy.identity.modelNearestFit, false);
  assert.equal(legacy.identity.modelNote, "");
});

test("exportMarkdown emits the Team line only when the founder names a team", () => {
  const brain = emptyBrain();
  brain.identity = { ...brain.identity, name: "Ada", venture: "Northwind" };
  const without = exportMarkdown(brain, 1);
  assert.equal(without.includes("Team:"), false);
  const withTeam = { ...brain, identity: { ...brain.identity, team: "Maya runs the customer voice" } };
  const withExport = exportMarkdown(withTeam, 2);
  assert.ok(withExport.includes("Team: Maya runs the customer voice"));
});

test("exportMarkdown flags a nearest-fit Model instead of writing a third value", () => {
  const brain = emptyBrain();
  const flagged = {
    ...brain,
    identity: {
      ...brain.identity,
      track: "b2c" as const,
      model: "service" as const,
      modelNearestFit: true,
      modelNote: "a subscription app",
    },
  };
  const md = exportMarkdown(flagged, 3);
  assert.ok(md.includes("Model is service, the nearest fit. The business is really a subscription app."));
  const noNote = {
    ...brain,
    identity: { ...brain.identity, track: "b2c" as const, model: "ecommerce" as const, modelNearestFit: true },
  };
  assert.ok(exportMarkdown(noNote, 3).includes("Model is ecommerce, the nearest fit."));
});
