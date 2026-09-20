/**
 * Golden tests for the copy-rules port, sentences taken from the vendored
 * Launchhouse template's fixture corpus
 * (vendor/launchhouse-founder-template/.claude/tests/fixtures). Each case
 * keeps the template's pass/hold verdict.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { checkCopy, promiseReplyHeld } from "./copy-rules.ts";

const B2B = { track: "b2b" as const, brainJson: "{}" };
const B2C = { track: "b2c" as const, brainJson: "{}" };

test("rule 3 holds 'We guarantee you a reply.'", () => {
  const f = promiseReplyHeld("We guarantee you a reply.");
  assert.equal(f?.kind, "HOLD");
  assert.equal(f?.code, "prose.promise-reply");
});

test("rule 3 holds 'Replies are guaranteed within a week.'", () => {
  assert.equal(promiseReplyHeld("Replies are guaranteed within a week.")?.kind, "HOLD");
});

test("rule 3 holds 'A reply is promised to every lead on the list.'", () => {
  assert.equal(promiseReplyHeld("A reply is promised to every lead on the list.")?.kind, "HOLD");
});

test("rule 3 passes the negated form", () => {
  assert.equal(
    promiseReplyHeld("Replies are not guaranteed, because they depend on the list, the offer and the timing."),
    null,
  );
});

test("rule 3 passes 'No one can guarantee you a reply.'", () => {
  assert.equal(promiseReplyHeld("No one can guarantee you a reply."), null);
});

test("rule 3 passes a promise to reply ourselves, not that they reply", () => {
  assert.equal(promiseReplyHeld("We promise to reply to every message you send us."), null);
});

test("rule 2 holds bot DMs to every new follower (hold-cold-dm-offer)", () => {
  const f = checkCopy("Use a bot to DM every new follower with the offer.", B2C);
  assert.equal(f[0]?.kind, "HOLD");
  assert.equal(f[0]?.code, "dm.automation-cold");
});

test("rule 2 holds automated cold DM promises", () => {
  assert.equal(checkCopy("We will auto DM everyone who likes your posts.", B2C)[0]?.kind, "HOLD");
  assert.equal(checkCopy("DMs go out on autopilot, around the clock.", B2C)[0]?.kind, "HOLD");
});

test("rule 2 passes replying to people who wrote first", () => {
  assert.equal(checkCopy("When they comment, we reply in the DMs.", B2C).length, 0);
  assert.equal(checkCopy("Send this only to people who messaged you first.", B2C).length, 0);
});

test("rule 1 holds Apollo talk on the B2C track", () => {
  const f = checkCopy("We set up an Apollo sequence for you.", B2C);
  assert.equal(f[0]?.kind, "HOLD");
  assert.equal(f[0]?.code, "track.wrong-track-word");
});

test("rule 1 holds cold email on the B2C track", () => {
  assert.equal(checkCopy("A cold email sequence fills the calendar.", B2C)[0]?.kind, "HOLD");
});

test("rule 1 passes the negated form", () => {
  assert.equal(checkCopy("No cold email here; the recipe audience comes from posts.", B2C).length, 0);
});

test("rule 1 holds DM openers on the B2B track", () => {
  assert.equal(checkCopy("Start from the DM openers file.", B2B)[0]?.code, "track.wrong-track-word");
});

test("reviewer holds a price the Brain does not contain", () => {
  const f = checkCopy("Join 500 founders who paid $99 to start.", {
    track: "b2b",
    brainJson: '{"offer":{"price":""}}',
  });
  assert.equal(f[0]?.kind, "HOLD");
  assert.equal(f[0]?.code, "proof.unconfirmed-claim");
});

test("reviewer passes a claim the Brain confirms", () => {
  const brain = JSON.stringify({ offer: { price: "$99" } });
  assert.equal(checkCopy("It is $99 to start.", { track: "b2b", brainJson: brain }).length, 0);
});

test("reviewer passes copy with no numbers at all", () => {
  assert.equal(checkCopy("Book a call this week.", B2B).length, 0);
});

test("clean workflow copy produces no findings", () => {
  const copy = "Thanks for reaching out! Here is the booking link so you can pick a time that works.";
  assert.equal(checkCopy(copy, B2B).length, 0);
});
