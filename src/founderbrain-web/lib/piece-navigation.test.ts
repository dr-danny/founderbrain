/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { indexOfPiece, jumpToNextMissingIndex, nextMissingPiece } from "./piece-navigation.ts";

test("nextMissingPiece goes to the next gap after the current piece", () => {
  assert.equal(nextMissingPiece(3, [11, 5, 20]), 5);
});

test("nextMissingPiece wraps around to the first gap once past the last one", () => {
  assert.equal(nextMissingPiece(25, [3, 5, 11]), 3);
});

test("nextMissingPiece returns null when nothing is missing, instead of looping", () => {
  assert.equal(nextMissingPiece(3, []), null);
});

test("nextMissingPiece is not fooled by an already-covered current piece landing in the list twice", () => {
  assert.equal(nextMissingPiece(5, [5, 5, 9]), 9);
});

test("indexOfPiece finds the position of a piece number in the shown list", () => {
  const pieces = [{ n: 1 }, { n: 2 }, { n: 3 }];
  assert.equal(indexOfPiece(pieces, 3), 2);
  assert.equal(indexOfPiece(pieces, 99), -1);
});

test("jumpToNextMissingIndex chains lookup + index resolution into one explicit target", () => {
  const pieces = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }];
  // 11 pieces missing media on a live 30-piece pack; from piece 2, the studio
  // should land exactly on piece 3 next -- not silently step through piece by
  // piece hoping the founder notices.
  assert.equal(jumpToNextMissingIndex(pieces, 2, [3, 4, 11]), 2);
});

test("jumpToNextMissingIndex returns null when the target piece is not in the shown list", () => {
  const pieces = [{ n: 1 }, { n: 2 }];
  assert.equal(jumpToNextMissingIndex(pieces, 2, [11]), null);
});

test("jumpToNextMissingIndex returns null once every piece has media", () => {
  const pieces = [{ n: 1 }, { n: 2 }];
  assert.equal(jumpToNextMissingIndex(pieces, 1, []), null);
});
