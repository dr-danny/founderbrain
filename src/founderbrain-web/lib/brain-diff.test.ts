import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyBrain } from "../../founderbrain-shared/domain";
import { changedCount, diffBrains } from "./brain-diff";

describe("diffBrains", () => {
  it("marks only changed fields and uses human labels", () => {
    const left = emptyBrain();
    const right = emptyBrain();
    left.identity.name = "Ada";
    right.identity.name = "Ada";
    right.identity.venture = "Launchhouse";
    right.customer.segment = "Founders";

    const rows = diffBrains(left, right);
    const changed = rows.filter((row) => row.changed);
    assert.equal(changedCount(rows), 2);
    assert.ok(changed.some((row) => row.label === "Venture" && row.right === "Launchhouse"));
    assert.ok(changed.some((row) => row.label === "Customer segment" && row.right === "Founders"));
    assert.ok(rows.some((row) => row.section === "Identity" && row.label === "Your name"));
  });

  it("renders booleans as Yes/No", () => {
    const left = emptyBrain();
    const right = emptyBrain();
    right.identity.approved = true;
    const row = diffBrains(left, right).find(
      (entry) => entry.sectionKey === "identity" && entry.field === "approved",
    );
    assert.deepEqual(
      { left: row?.left, right: row?.right, changed: row?.changed },
      { left: "No", right: "Yes", changed: true },
    );
  });
});
