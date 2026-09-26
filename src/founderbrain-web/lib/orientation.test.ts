/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOrientationPatch,
  atlantaReadyMap,
  emptyOrientationState,
  isFirstLoginComplete,
  OrientationWorkError,
} from "../../founderbrain-shared/orientation.ts";
import {
  contentPackBlock,
  instagramHandleOk,
  pieceAsksForMedia,
} from "../../founderbrain-shared/saturday-work.ts";
import {
  DROPPED_PREP_DELIVERY,
  GHL_STARTER_URL,
  chapterCopyCorpus,
  contentScreens,
  firstLoginScreens,
  ghlScreens,
  outreachScreens,
  progressLabel,
} from "../orientation-copy.ts";

test("first-login asks a name then ready to start", () => {
  assert.equal(firstLoginScreens.length, 2);
  assert.match(firstLoginScreens[0]?.title ?? "", /Welcome/);
  assert.match(firstLoginScreens[1]?.title ?? "", /ready to start/);
  assert.equal(progressLabel(2, 2), "2 of 2");
});

test("chapter order maps prep homework and skips dropped delivery", () => {
  assert.equal(contentScreens("b2b").length, 6);
  assert.equal(contentScreens("b2c").length, 6);
  assert.equal(outreachScreens("b2b").length, 3);
  assert.equal(outreachScreens("b2c").length, 3);
  assert.equal(ghlScreens(false).length, 5);
  assert.equal(ghlScreens(true).length, 5);
  assert.equal(ghlScreens(false)[2]?.id, "ghl-buy");
  assert.equal(ghlScreens(true)[2]?.id, "ghl-ready");
  assert.equal(ghlScreens(false)[2]?.externalLink?.href, GHL_STARTER_URL);
  assert.equal(ghlScreens(false)[3]?.id, "ghl-price");
  assert.equal(ghlScreens(false)[3]?.usage, true);
  assert.equal(ghlScreens(false)[4]?.id, "ghl-connect");
  assert.match(contentScreens("b2b")[2]!.title, /Email domain/i);
  assert.match(contentScreens("b2c")[2]!.title, /Instagram/i);
  assert.match(outreachScreens("b2b")[1]!.title, /Prospect/i);
  assert.match(outreachScreens("b2c")[1]!.title, /Twenty-five/i);

  const corpus = chapterCopyCorpus();
  for (const banned of DROPPED_PREP_DELIVERY) {
    assert.equal(corpus.includes(banned), false, `banned phrase leaked: ${banned}`);
  }
});

test("orientation patch completes once and resumes mid-flow", () => {
  const start = emptyOrientationState(new Date("2026-09-18T12:00:00.000Z"));
  assert.equal(isFirstLoginComplete(start), false);
  const mid = applyOrientationPatch(
    start,
    { firstLoginScreen: 3 },
    new Date("2026-09-18T12:01:00.000Z"),
  );
  assert.equal(mid.firstLoginScreen, 3);
  assert.equal(mid.firstLoginCompletedAt, null);
  const done = applyOrientationPatch(
    mid,
    { firstLoginScreen: 4, firstLoginComplete: true },
    new Date("2026-09-18T12:02:00.000Z"),
  );
  assert.equal(isFirstLoginComplete(done), true);
  assert.equal(done.firstLoginCompletedAt, "2026-09-18T12:02:00.000Z");
  const again = applyOrientationPatch(
    done,
    { firstLoginComplete: true },
    new Date("2026-09-18T13:00:00.000Z"),
  );
  assert.equal(again.firstLoginCompletedAt, "2026-09-18T12:02:00.000Z");
});

test("connecting GoHighLevel merges the flag and does not drop the account answer", () => {
  const start = applyOrientationPatch(emptyOrientationState(new Date("2026-09-25T12:00:00.000Z")), {
    ghlScreen: 3,
    ghlAnswers: { hasAccount: true },
  });
  const connected = applyOrientationPatch(
    start,
    { ghlScreen: 5, ghlComplete: true, ghlAnswers: { connected: true } },
    new Date("2026-09-25T12:05:00.000Z"),
  );
  assert.equal(connected.ghlAnswers.hasAccount, true);
  assert.equal(connected.ghlAnswers.connected, true);
  assert.equal(connected.ghlCompletedAt, "2026-09-25T12:05:00.000Z");
  assert.equal(connected.ghlScreen, 5);
});

test("atlanta ready map is green only when all artifacts are ready", () => {
  const prospects = [1, 2, 3, 4, 5].map((n) => `Person ${n} <p${n}@example.com>`).join("\n");
  const orientation = applyOrientationPatch(emptyOrientationState(), {
    firstLoginComplete: true,
    track: "b2b",
    contentComplete: true,
    outreachComplete: true,
    contentAnswers: {
      emailDomain: "northwind.example",
      bottleneck: "time",
      workflow: "batch-weekly",
    },
    outreachAnswers: {
      copy: "A real outreach note that is long enough to send on Saturday to a named person.",
      prospects,
    },
    ghlComplete: true,
    ghlAnswers: { hasAccount: true, connected: true },
  });
  const partial = atlantaReadyMap(
    { identity: true, customer: true, offer: true, voice: true, output: false },
    orientation,
  );
  assert.equal(partial.green, false);
  assert.ok(partial.readyCount < partial.total);

  const green = atlantaReadyMap(
    { identity: true, customer: true, offer: true, voice: true, output: true },
    orientation,
  );
  assert.equal(green.green, true);
  assert.equal(green.readyCount, green.total);
});

test("a checkbox cannot finish Saturday content or outreach", () => {
  assert.throws(
    () =>
      applyOrientationPatch(emptyOrientationState(), {
        track: "b2b",
        contentComplete: true,
        contentAnswers: { domainReady: true, thirtyPieces: true },
      }),
    OrientationWorkError,
  );
  assert.throws(
    () =>
      applyOrientationPatch(emptyOrientationState(), {
        track: "b2c",
        outreachComplete: true,
        outreachAnswers: { copyFinalised: true, targetAccounts: true },
      }),
    OrientationWorkError,
  );
  assert.equal(instagramHandleOk("@geauxride"), true);
  assert.equal(instagramHandleOk("not a handle"), false);
  const pieces = Array.from({ length: 30 }, (_, index) => {
    const n = index + 1;
    return `${n}. Pillar · Short post · LinkedIn\n\nBody ${n}\n\nMedia: Photo ${n}`;
  }).join("\n\n");
  assert.equal(pieceAsksForMedia("Body\n\nMedia: Photo of the shop"), true);
  assert.equal(pieceAsksForMedia("Body\n\nMedia: none"), false);
  assert.match(contentPackBlock(pieces, []) ?? "", /Still missing a file/);
  assert.equal(contentPackBlock(pieces, Array.from({ length: 30 }, (_, index) => index + 1)), null);
});
