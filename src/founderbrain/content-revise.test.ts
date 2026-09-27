/// <reference types="node" />
/**
 * All fixture text below is synthetic sandbox data written for this test.
 * No founder content, no live pack text, and no network/model calls: this
 * only exercises the pure `parseRevisedPieces` parser/validator. The
 * `originalText` on each request stands in for what server.ts reads from
 * the persisted pack -- never a client-supplied value.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseRevisedPieces, type RevisionRequest } from "./content-revise.ts";

const requests: RevisionRequest[] = [
  { n: 1, feedback: "", originalText: "Pillar \u00b7 Short post \u00b7 LinkedIn\nOriginal piece one body.\nMedia: none" },
  { n: 2, feedback: "", originalText: "Pillar \u00b7 Short post \u00b7 LinkedIn\nOriginal piece two body.\nMedia: none" },
];

test("parseRevisedPieces keeps a well-formed reply that repeats its heading", () => {
  const raw =
    "1. Pillar \u00b7 Short post \u00b7 LinkedIn\nRewritten piece one.\nMedia: none\n\n" +
    "2. Pillar \u00b7 Short post \u00b7 LinkedIn\nRewritten piece two.\nMedia: none";
  const result = parseRevisedPieces(raw, requests);
  assert.deepEqual(result.map((p) => p.n), [1, 2]);
  assert.match(result[0]!.text, /Rewritten piece one/);
  assert.match(result[1]!.text, /Rewritten piece two/);
});

test("parseRevisedPieces restores a heading the model dropped, using the persisted original -- not the model's reply", () => {
  const raw = "2. Rewritten piece two with no heading line at all.\nMedia: none";
  const result = parseRevisedPieces(raw, requests);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.n, 2);
  assert.match(result[0]!.text, /^Pillar \u00b7 Short post \u00b7 LinkedIn\n/);
  assert.match(result[0]!.text, /Rewritten piece two with no heading line/);
});

test("parseRevisedPieces overwrites a malformed/drifted heading the model wrote, forcing the canonical platform back", () => {
  // The model invents its own heading and moves the piece to Instagram --
  // this must never be trusted, model reply or not.
  const raw = "1. Growth \u00b7 Long post \u00b7 Instagram\nA rewrite that drifted platform.\nMedia: none";
  const result = parseRevisedPieces(raw, requests);
  assert.equal(result.length, 1);
  assert.match(result[0]!.text, /^Pillar \u00b7 Short post \u00b7 LinkedIn\n/);
  assert.doesNotMatch(result[0]!.text, /Instagram/);
});

test("parseRevisedPieces drops any number the founder never asked to revise", () => {
  const raw =
    "1. Pillar \u00b7 Short post \u00b7 LinkedIn\nRewritten piece one.\nMedia: none\n\n" +
    "7. Pillar \u00b7 Short post \u00b7 LinkedIn\nA piece nobody asked for.\nMedia: none";
  const result = parseRevisedPieces(raw, requests);
  assert.deepEqual(result.map((p) => p.n), [1]);
});

test("parseRevisedPieces keeps only the first entry when the model repeats a number", () => {
  const raw =
    "1. Pillar \u00b7 Short post \u00b7 LinkedIn\nFirst version of piece one.\nMedia: none\n\n" +
    "1. Pillar \u00b7 Short post \u00b7 LinkedIn\nSecond, contradictory version of piece one.\nMedia: none";
  const result = parseRevisedPieces(raw, requests);
  assert.equal(result.length, 1);
  assert.match(result[0]!.text, /First version of piece one/);
});

test("parseRevisedPieces returns nothing usable from a reply with no numbered pieces", () => {
  const result = parseRevisedPieces("Sorry, I cannot help with that.", requests);
  assert.deepEqual(result, []);
});

test("parseRevisedPieces skips a numbered entry that comes back with an empty body", () => {
  const raw = "1. \n\n2. Pillar \u00b7 Short post \u00b7 LinkedIn\nReal rewrite.\nMedia: none";
  const result = parseRevisedPieces(raw, requests);
  assert.deepEqual(result.map((p) => p.n), [2]);
});
