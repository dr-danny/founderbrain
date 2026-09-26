import assert from "node:assert/strict";
import test from "node:test";
import { emptyBrain, sectionWouldApprove } from "../types";
import { missingMissionFields, missionFieldStatus } from "./mission-index.ts";

const sections = ["identity", "customer", "offer", "context", "voice"] as const;
test("mission index matches shared approval requirements for every required field", () => {
  const b = emptyBrain();
  for (const section of sections) {
    assert.equal(missingMissionFields(b, section).length === 0, sectionWouldApprove(b, section));
    const fields = missingMissionFields(b, section);
    for (const field of fields) {
      (b[section] as unknown as Record<string, unknown>)[field] = field === "sampleCount" ? 10 : "Sandbox answer";
    }
    assert.deepEqual(missingMissionFields(b, section), []);
    assert.equal(sectionWouldApprove(b, section), true);
    for (const field of fields) {
      const missing = structuredClone(b);
      (missing[section] as unknown as Record<string, unknown>)[field] = field === "sampleCount" ? 0 : "";
      assert.deepEqual(missingMissionFields(missing, section), [field]);
      assert.equal(sectionWouldApprove(missing, section), false);
    }
  }
});
test("None yet explicitly answers active channels; blank and placeholders do not", () => {
  const b = emptyBrain();
  for (const value of ["", "  ", "tbd", "n/a", "unknown"]) {
    b.context.channelsActive = value;
    assert.equal(missionFieldStatus(b, "context", "channelsActive").answered, false);
  }
  b.context.channelsActive = "None yet";
  assert.equal(missionFieldStatus(b, "context", "channelsActive").answered, true);
});
test("optional questions and conditional evidence never invent blockers", () => {
  const b = emptyBrain();
  assert.equal(missionFieldStatus(b, "identity", "team").required, false);
  assert.equal(missionFieldStatus(b, "offer", "price").required, false);
  assert.equal(missionFieldStatus(b, "customer", "evidence").required, false);
  b.customer.evidenceStatus = "supported";
  assert.equal(missionFieldStatus(b, "customer", "evidence").required, true);
  assert.ok(missingMissionFields(b, "customer").includes("evidence"));
});
test("Voice index distinguishes the example answer from ten stored samples", () => {
  const b = emptyBrain();
  Object.assign(b.voice, { tone: "Direct", boundaries: "No hype", sample: "Sandbox sentence", sampleCount: 0 });
  assert.deepEqual(missingMissionFields(b, "voice"), ["sampleCount"]);
  b.voice.sampleCount = 9;
  assert.deepEqual(missingMissionFields(b, "voice"), ["sampleCount"]);
  b.voice.sampleCount = 10;
  assert.deepEqual(missingMissionFields(b, "voice"), []);
});
