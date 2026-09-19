/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOrientationPatch,
  atlantaReadyMap,
  emptyOrientationState,
  isFirstLoginComplete,
} from "../../founderbrain-shared/orientation.ts";
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
<<<<<<< HEAD
  assert.equal(ghlScreens(false).length, 5);
  assert.equal(ghlScreens(true).length, 5);
  assert.equal(ghlScreens(false)[2]?.id, "ghl-buy");
  assert.equal(ghlScreens(true)[2]?.id, "ghl-ready");
  assert.equal(ghlScreens(false)[2]?.externalLink?.href, GHL_STARTER_URL);
  assert.equal(ghlScreens(false)[3]?.id, "ghl-price");
  assert.equal(ghlScreens(false)[3]?.usage, true);
  assert.equal(ghlScreens(false)[4]?.id, "ghl-connect");
=======
  assert.equal(ghlScreens(false).length, 4);
  assert.equal(ghlScreens(true).length, 4);
  assert.equal(ghlScreens(false)[2]?.id, "ghl-buy");
  assert.equal(ghlScreens(true)[2]?.id, "ghl-ready");
  assert.equal(ghlScreens(false)[2]?.externalLink?.href, GHL_STARTER_URL);
  assert.equal(ghlScreens(false)[3]?.id, "ghl-connect");
>>>>>>> origin/main
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

test("atlanta ready map is green only when all artifacts are ready", () => {
  const orientation = applyOrientationPatch(emptyOrientationState(), {
    firstLoginComplete: true,
    track: "b2b",
    contentComplete: true,
    outreachComplete: true,
    contentAnswers: {
      domainReady: true,
      thirtyPieces: true,
      bottleneck: "time",
      workflow: "batch-weekly",
    },
    outreachAnswers: { copyFinalised: true, prospectList: true },
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
