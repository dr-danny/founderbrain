/**
 * Deterministic "jump to the next piece missing media" helper for the 30
 * pieces studio. Pure so the routing math is testable without mounting the
 * component: clicking "Next piece" 30 times to find gaps is a silent loop,
 * this always names an exact target piece and index instead.
 */

/**
 * Given the current piece number and the sorted-or-unsorted list of piece
 * numbers still missing media, return the next one to jump to (wrapping
 * around to the first missing piece past the current one). Returns null when
 * nothing is missing.
 */
export function nextMissingPiece(currentPieceN: number, missing: number[]): number | null {
  if (!missing.length) return null;
  const sorted = [...new Set(missing)].sort((a, b) => a - b);
  return sorted.find((n) => n > currentPieceN) ?? sorted[0]!;
}

/** Resolve a target piece number to its position in the shown piece list. */
export function indexOfPiece(pieces: Array<{ n: number }>, targetPieceN: number): number {
  return pieces.findIndex((piece) => piece.n === targetPieceN);
}

/**
 * One call that goes straight from "current position, list of gaps" to the
 * index the studio should jump the cursor to. Returns null when there is no
 * missing piece to go to, or the target piece is not in the shown list.
 */
export function jumpToNextMissingIndex(
  pieces: Array<{ n: number }>,
  currentPieceN: number,
  missing: number[],
): number | null {
  const target = nextMissingPiece(currentPieceN, missing);
  if (target === null) return null;
  const index = indexOfPiece(pieces, target);
  return index === -1 ? null : index;
}
