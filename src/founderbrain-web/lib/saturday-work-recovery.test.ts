/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  duplicatePieceNumbers,
  enforceCanonicalHeading,
  hasStructuredHeading,
  parseContentPieces,
  pieceCoverage,
  piecesToContentText,
  replaceContentSection,
  serializeContentSection,
  splitContentSection,
} from "../../founderbrain-shared/saturday-work.ts";

// All pack text below is synthetic sandbox fixture data, never fetched from
// a real account. It exists only to exercise the piece-splitter/heading/
// preamble invariants under test. trackSetupReady's own tests live in
// src/founderbrain-web/lib/orientation.test.ts.
const SANDBOX_PIECE = (n: number, pillar = "Pillar", format = "Short post", platform = "LinkedIn") =>
  `${n}. ${pillar} \u00b7 ${format} \u00b7 ${platform}\nSandbox body text for piece ${n}.\nMedia: none`;

function sandboxContentSection(count: number, preamble?: string): string {
  const pieces = Array.from({ length: count }, (_, i) => SANDBOX_PIECE(i + 1));
  const body = pieces.join("\n\n");
  return preamble ? `## Content\n\n${preamble}\n\n${body}` : `## Content\n\n${body}`;
}

function sandboxPack(contentSectionText: string): string {
  return `${contentSectionText}\n\n## Outreach\n\n1. Sandbox outreach line one\n\n2. Sandbox outreach line two\n\n90 day plan\n\nSandbox plan body.`;
}

test("pieceCoverage separates saved-file count from unique piece coverage", () => {
  // The reported live-account shape: 30 attachment rows, but piece 3 has two
  // files on it, so only 29 distinct pieces actually have media.
  const rows = [1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
  assert.equal(rows.length, 30);
  const result = pieceCoverage(rows);
  assert.equal(result.attachedCount, 30);
  assert.equal(result.coveredCount, 29);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.duplicatePieces, [3]);
});

test("pieceCoverage ignores unattached (null) rows and reports zero duplicates cleanly", () => {
  const result = pieceCoverage([1, null, 2, undefined, 3]);
  assert.equal(result.attachedCount, 3);
  assert.equal(result.coveredCount, 3);
  assert.equal(result.duplicateCount, 0);
  assert.deepEqual(result.duplicatePieces, []);
});

test("pieceCoverage with nothing attached is all zeroes, not a crash", () => {
  const result = pieceCoverage([]);
  assert.deepEqual(result, {
    attachedCount: 0,
    coveredCount: 0,
    duplicateCount: 0,
    duplicatePieces: [],
  });
});

test("duplicatePieceNumbers finds only the numbers that repeat", () => {
  const pieces = [{ n: 1, text: "a" }, { n: 2, text: "b" }, { n: 2, text: "b again" }, { n: 3, text: "c" }];
  assert.deepEqual(duplicatePieceNumbers(pieces), [2]);
  assert.deepEqual(duplicatePieceNumbers([{ n: 1, text: "a" }]), []);
});

test("hasStructuredHeading only looks at the first line", () => {
  assert.equal(hasStructuredHeading("Pillar \u00b7 Short post \u00b7 LinkedIn\nBody text"), true);
  assert.equal(hasStructuredHeading("Body text with no heading at all"), false);
  // A stray middle dot two lines down must not count as a heading.
  assert.equal(hasStructuredHeading("Body line one\nPillar \u00b7 Short post \u00b7 LinkedIn"), false);
});

test("enforceCanonicalHeading restores a heading the model dropped entirely", () => {
  const original = "Pillar \u00b7 Short post \u00b7 LinkedIn\nOriginal sandbox body.\nMedia: none";
  const revisedWithoutHeading = "A punchier sandbox rewrite of the body.\nMedia: none";
  const restored = enforceCanonicalHeading(revisedWithoutHeading, original);
  assert.equal(restored, "Pillar \u00b7 Short post \u00b7 LinkedIn\nA punchier sandbox rewrite of the body.\nMedia: none");
});

test("enforceCanonicalHeading overwrites a malformed/drifted heading the model wrote instead of trusting it", () => {
  const original = "Pillar \u00b7 Short post \u00b7 LinkedIn\nOriginal.\nMedia: none";
  // The model wrote its own heading-like line, moving the piece to a
  // different platform. The canonical original heading must win regardless.
  const revisedWithWrongHeading = "Growth \u00b7 Long post \u00b7 Instagram\nRewrite that drifted platform.\nMedia: none";
  const enforced = enforceCanonicalHeading(revisedWithWrongHeading, original);
  assert.equal(enforced, "Pillar \u00b7 Short post \u00b7 LinkedIn\nRewrite that drifted platform.\nMedia: none");
});

test("enforceCanonicalHeading does not fabricate a heading the original never had", () => {
  const original = "Plain body with no pillar heading at all.";
  const revised = "A rewrite, also with no heading.";
  assert.equal(enforceCanonicalHeading(revised, original), revised);
});

test(
  "regression: a revision that drops or rewrites its heading no longer swallows the next piece " +
    "(reproduces the reported piece-2-into-piece-1 defect on synthetic sandbox data)",
  () => {
    const section = sandboxContentSection(4);
    const before = parseContentPieces(sandboxPack(section));
    assert.deepEqual(before.map((p) => p.n), [1, 2, 3, 4]);

    // Simulate the model dropping piece 2's structured heading, the way the
    // real defect happened, and NOT running it through enforceCanonicalHeading.
    const brokenPieces = before.map((p) =>
      p.n === 2 ? { n: 2, text: "Rewritten body with no heading line." } : p,
    );
    const brokenContent = piecesToContentText(brokenPieces);
    const brokenPack = replaceContentSection(sandboxPack(section), brokenContent);
    const reparsedBroken = parseContentPieces(brokenPack);
    // This is the defect: piece 2's body, having no '\u00b7', is invisible as
    // a boundary and gets folded into piece 1.
    assert.equal(reparsedBroken.some((p) => p.n === 2), false);
    assert.match(reparsedBroken.find((p) => p.n === 1)?.text ?? "", /Rewritten body with no heading line/);

    // Now the same rewrite, but run through the fix: the canonical original
    // heading is enforced, so the boundary survives and piece 2 stays piece 2.
    const fixedPieces = before.map((p) =>
      p.n === 2
        ? { n: 2, text: enforceCanonicalHeading("Rewritten body with no heading line.", p.text) }
        : p,
    );
    const fixedContent = piecesToContentText(fixedPieces);
    const fixedPack = replaceContentSection(sandboxPack(section), fixedContent);
    const reparsedFixed = parseContentPieces(fixedPack);
    assert.deepEqual(reparsedFixed.map((p) => p.n), [1, 2, 3, 4]);
    assert.match(reparsedFixed.find((p) => p.n === 2)?.text ?? "", /Rewritten body with no heading line/);
    assert.doesNotMatch(reparsedFixed.find((p) => p.n === 1)?.text ?? "", /Rewritten body with no heading line/);
  },
);

test("replaceContentSection never touches the Outreach section's own numbered lines", () => {
  const section = sandboxContentSection(3);
  const pack = sandboxPack(section);
  const nextContent = piecesToContentText([
    { n: 1, text: "Rewritten piece one." },
    { n: 2, text: "Untouched piece two body." },
    { n: 3, text: "Untouched piece three body." },
  ]);
  const next = replaceContentSection(pack, nextContent);
  assert.match(next, /Sandbox outreach line one/);
  assert.match(next, /Sandbox outreach line two/);
  assert.match(next, /Sandbox plan body/);
  assert.match(next, /Rewritten piece one/);
});

test("replaceContentSection returns the pack unchanged when there is no Content section to bound the edit to", () => {
  const pack = "Just some prose with no sections at all.";
  assert.equal(replaceContentSection(pack, "1. New content"), pack);
});

test("piecesToContentText round-trips through parseContentPieces on synthetic pieces", () => {
  const pieces = [
    { n: 1, text: "Pillar \u00b7 Short post \u00b7 LinkedIn\nBody one.\nMedia: none" },
    { n: 2, text: "Pillar \u00b7 Short post \u00b7 LinkedIn\nBody two.\nMedia: none" },
  ];
  const content = piecesToContentText(pieces);
  const pack = sandboxPack(`## Content\n\n${content}`);
  const reparsed = parseContentPieces(pack);
  assert.deepEqual(reparsed, pieces);
});

test("splitContentSection returns the preamble (e.g. the Pillars line) separately from the pieces", () => {
  const preamble = "Pillars: Sandbox A; Sandbox B; Sandbox C; Sandbox D";
  const section = sandboxContentSection(3, preamble);
  const { preamble: parsedPreamble, pieces } = splitContentSection(sandboxPack(section));
  assert.equal(parsedPreamble, preamble);
  assert.deepEqual(pieces.map((p) => p.n), [1, 2, 3]);
});

test("serializeContentSection round-trips the preamble through a revision instead of dropping it", () => {
  const preamble = "Pillars: Sandbox A; Sandbox B; Sandbox C; Sandbox D";
  const section = sandboxContentSection(3, preamble);
  const pack = sandboxPack(section);
  const { preamble: parsedPreamble, pieces } = splitContentSection(pack);

  // Simulate a one-piece revision: only piece 2's body changes. The
  // heading is kept (this test is about the preamble, not heading
  // enforcement -- that has its own tests above), matching what
  // enforceCanonicalHeading would produce in the real route.
  const revised = pieces.map((p) =>
    p.n === 2 ? { n: 2, text: "Pillar \u00b7 Short post \u00b7 LinkedIn\nRevised body for piece two." } : p,
  );
  const nextContent = serializeContentSection(parsedPreamble, revised);
  const nextPack = replaceContentSection(pack, nextContent);

  const { preamble: preambleAfter, pieces: piecesAfter } = splitContentSection(nextPack);
  assert.equal(preambleAfter, preamble, "the Pillars preamble must survive a piece revision");
  assert.deepEqual(piecesAfter.map((p) => p.n), [1, 2, 3]);
  assert.match(piecesAfter.find((p) => p.n === 2)?.text ?? "", /Revised body for piece two/);
});

test("serializeContentSection with an empty preamble serializes the same as piecesToContentText", () => {
  const pieces = [{ n: 1, text: "Pillar \u00b7 Short post \u00b7 LinkedIn\nBody.\nMedia: none" }];
  assert.equal(serializeContentSection("", pieces), piecesToContentText(pieces));
});
