import { test } from "node:test";
import assert from "node:assert/strict";
import { joinContent, splitContent } from "../pack";

const NEW = [
  "Pillars: Missed deliveries; How we roast; Proof from our cafes; What wholesale gets wrong",
  "",
  "1. Missed deliveries · Short post · LinkedIn",
  "Your supplier did not forget you. They just never planned for Tuesday.",
  "2. Nothing here should split the post.",
  "Media: None",
  "",
  "2. How we roast · Long post · LinkedIn",
  "We roast on Monday so it lands by Wednesday.",
  "Media: photo of the roaster",
].join("\n");

test("splits new packs on piece headers, keeping numbered lines inside a post", () => {
  const { preamble, pieces } = splitContent(NEW);
  assert.match(preamble, /^Pillars:/);
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces.map((p) => p.n), [1, 2]);
  assert.match(pieces[0]!.text, /2\. Nothing here should split the post\./);
  assert.match(pieces[1]!.text, /^How we roast · Long post · LinkedIn/);
});

test("editing a piece and joining keeps the pillars and the other pieces", () => {
  const { preamble, pieces } = splitContent(NEW);
  const next = pieces.slice();
  next[1] = { n: 2, text: "How we roast · Long post · LinkedIn\nEdited." };
  const round = splitContent(joinContent(preamble, next));
  assert.match(round.preamble, /^Pillars:/);
  assert.equal(round.pieces.length, 2);
  assert.equal(round.pieces[1]!.text, "How we roast · Long post · LinkedIn\nEdited.");
});

test("old packs without headers still split on numbers", () => {
  const { pieces } = splitContent("**Four Pillars:**\n- A\n\n1. **Customer Research** - Write down x\n\n2. **Offer** - Track y");
  assert.equal(pieces.length, 2);
});
