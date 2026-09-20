/**
 * Unit tests for the Brain -> GoHighLevel push pipeline: the v3 values catalog
 * parser, the snapshot/first-pack decision logic, and the push-readiness gate.
 * Pure: no network, no database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  brainReadyForPush,
  defaultFirstPack,
  loadValueCatalog,
  sectionsForPush,
  snapshotFor,
} from "./ghl-push.ts";
import { emptyBrain, type Brain } from "../founderbrain-shared/domain.ts";

function brainWith(overrides: {
  track?: "b2b" | "b2c";
  hybrid?: boolean;
  model?: "" | "service" | "ecommerce";
  approvedAll?: boolean;
}): Brain {
  const b = emptyBrain();
  if (overrides.track) b.identity.track = overrides.track;
  if (overrides.hybrid !== undefined) b.identity.hybrid = overrides.hybrid;
  if (overrides.model !== undefined) b.identity.model = overrides.model;
  if (overrides.approvedAll) {
    b.identity.approved = true;
    b.customer.approved = true;
    b.offer.approved = true;
    b.voice.approved = true;
    b.context.approved = true;
  }
  return b;
}

describe("ghl values catalog", () => {
  it("parses the vendored v3 catalog with all eight sections", async () => {
    const catalog = await loadValueCatalog();
    const expected = [
      "B2B Essentials",
      "B2B Lead follow-up",
      "B2B Discovery booking",
      "B2B Proposal chase",
      "B2C Essentials",
      "B2C Comment to DM",
      "B2C DM qualify and book",
      "B2C Review request",
    ];
    for (const section of expected) {
      assert.ok(catalog.has(section), `missing section: ${section}`);
    }
    // v3 counts: 11+6+11+6 B2B and 11+7+10+0 B2C; Review request has zero
    // custom values because its templates are hand-pasted.
    assert.equal(catalog.get("B2B Essentials")!.length, 11);
    assert.equal(catalog.get("B2B Lead follow-up")!.length, 6);
    assert.equal(catalog.get("B2B Discovery booking")!.length, 11);
    assert.equal(catalog.get("B2B Proposal chase")!.length, 6);
    assert.equal(catalog.get("B2C Essentials")!.length, 11);
    assert.equal(catalog.get("B2C Comment to DM")!.length, 7);
    assert.equal(catalog.get("B2C DM qualify and book")!.length, 10);
    assert.equal(catalog.get("B2C Review request")!.length, 0);
  });

  it("v3 DM pack: two buttons plus the not-a-fit message, no third button", async () => {
    const catalog = await loadValueCatalog();
    const keys = (catalog.get("B2C DM qualify and book") ?? []).map((v) => v.key);
    assert.ok(keys.includes("dm_question_1_button_1"), "button 1 must exist");
    assert.ok(keys.includes("dm_question_1_button_2"), "button 2 must exist");
    assert.ok(!keys.includes("dm_question_1_button_3"), "v3 removed the third button");
    assert.ok(keys.includes("dm_not_a_fit_message"), "v3 added the not-a-fit message");
  });
});

describe("snapshot and first pack selection", () => {
  it("hybrid wins over track", () => {
    const b = brainWith({ track: "b2b", hybrid: true });
    assert.equal(snapshotFor(b), "Hybrid");
  });
  it("b2b without hybrid uses the B2B snapshot", () => {
    assert.equal(snapshotFor(brainWith({ track: "b2b", hybrid: false })), "B2B");
  });
  it("b2c uses the B2C snapshot", () => {
    assert.equal(snapshotFor(brainWith({ track: "b2c", hybrid: false })), "B2C");
  });
  it("service B2C defaults to DM qualify and book", () => {
    assert.equal(defaultFirstPack(brainWith({ track: "b2c", model: "service" })), "dm_qualify_book");
  });
  it("ecommerce B2C defaults to Comment to DM", () => {
    assert.equal(defaultFirstPack(brainWith({ track: "b2c", model: "ecommerce" })), "comment_to_dm");
  });
  it("b2b defaults to Lead follow-up", () => {
    assert.equal(defaultFirstPack(brainWith({ track: "b2b" })), "lead_follow_up");
  });
});

describe("sectionsForPush", () => {
  it("pushes B2B Essentials + Lead follow-up for a b2b founder", async () => {
    await loadValueCatalog();
    const wanted = sectionsForPush(brainWith({ track: "b2b" }), "lead_follow_up");
    const sections = new Set(wanted.map((w) => w.gname.split(" ")[0] + " " + w.gname.split(" ")[1]));
    assert.ok(wanted.some((w) => w.key === "greeting"), "essentials greeting present");
    assert.ok(wanted.some((w) => w.key === "lead_chase_1_subject"), "lead follow-up copy present");
    assert.ok(!wanted.some((w) => w.key === "c2d_dm1"), "no B2C pack on a B2B founder");
    void sections;
  });

  it("pushes B2C Essentials for a hybrid founder even on the b2b track (v3 rule)", async () => {
    await loadValueCatalog();
    const wanted = sectionsForPush(brainWith({ track: "b2b", hybrid: true }), "lead_follow_up");
    assert.ok(wanted.some((w) => w.key === "customer_welcome_subject"),
      "hybrid founder gets B2C Essentials (customer welcome), never the B2B client pair");
    assert.ok(!wanted.some((w) => w.key === "client_welcome_subject"),
      "B2C Essentials, not the B2B client welcome");
  });

  it("rejects a pack that is not in the library", async () => {
    await loadValueCatalog();
    assert.throws(() => sectionsForPush(brainWith({ track: "b2b" }), "onboarding"), {
      code: "unknown_pack",
    });
  });
});

describe("push readiness", () => {
  it("requires all five missions approved", () => {
    const b = brainWith({ track: "b2b", approvedAll: true });
    b.context.channelsActive = "Referral email to partners";
    b.context.customersNow = "12";
    b.context.target90 = "25 monthly orders";
    assert.equal(brainReadyForPush(b), true);
  });
  it("refuses when any mission is unapproved", () => {
    const b = brainWith({ track: "b2b", approvedAll: true });
    b.voice.approved = false;
    assert.equal(brainReadyForPush(b), false);
  });
  it("refuses when channels or numbers are placeholders", () => {
    const b = brainWith({ track: "b2b", approvedAll: true });
    b.context.channelsActive = "unknown";
    assert.equal(brainReadyForPush(b), false);
    b.context.channelsActive = "Referrals";
    b.context.customersNow = "tbd";
    assert.equal(brainReadyForPush(b), false);
  });
  it("wants numbers present even when the founder wrote unknown", () => {
    const b = brainWith({ track: "b2b", approvedAll: true });
    b.context.customersNow = "";
    b.context.target90 = "";
    assert.equal(brainReadyForPush(b), false);
  });
});