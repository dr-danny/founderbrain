import { test } from "node:test";
import assert from "node:assert/strict";
import { replacePieces, unsupportedPieces } from "./orchestrate.ts";

const brain = JSON.stringify({
  identity: { track: "b2b", venture: "Northwind Coffee Roasters" },
  offer: { description: "Weekly delivery, $18 per pound, $120 minimum, within 48 hours" },
});
const content = [
  "## Content",
  "",
  "Pillars: Delivery; Roasting; Cafes; Beliefs",
  "",
  "1. Delivery · Short post · LinkedIn",
  "Coffee lands within 48 hours of the roast. $120 minimum.",
  "Media: None",
  "",
  "2. Roasting · Short post · LinkedIn",
  "Big roasters want 50 pounds minimum. We do 20-pound orders.",
  "Media: Photo of bags",
].join("\n");

test("flags only pieces with numbers the Brain does not contain", () => {
  const flagged = unsupportedPieces(content, brain);
  assert.deepEqual(flagged.map((f) => f.n), [2]);
  assert.deepEqual(flagged[0]!.reasons.sort(), ["20", "50"]);
});

test("replaces rewritten pieces by number and keeps the rest", () => {
  const next = replacePieces(content, "2. Roasting · Short post · LinkedIn\nWe roast small so cafes order what they use.\nMedia: Photo of bags");
  assert.match(next, /^## Content/);
  assert.match(next, /1\. Delivery · Short post · LinkedIn\nCoffee lands within 48 hours/);
  assert.match(next, /2\. Roasting[^\n]*\nWe roast small/);
  assert.equal(unsupportedPieces(next, brain).length, 0);
});
