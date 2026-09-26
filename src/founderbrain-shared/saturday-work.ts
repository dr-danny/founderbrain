/**
 * Saturday content and outreach are saved work, not checkboxes.
 * The same rules gate the chapter screens and the orientation write.
 */
export class OrientationWorkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrientationWorkError";
  }
}

export const MIN_PROSPECTS = 5;
export const MIN_ACCOUNTS = 25;
export const MIN_COPY = 40;

export function normalizeInstagramHandle(value: string): string {
  return value.trim().replace(/^@+/, "");
}

export function instagramHandleOk(value: string | undefined): boolean {
  return /^[A-Za-z0-9._]{1,30}$/.test(normalizeInstagramHandle(value ?? ""));
}

export function emailDomainOk(value: string | undefined): boolean {
  const domain = (value ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (
    domain.length < 4 ||
    domain.length > 253 ||
    domain.includes(" ") ||
    domain.includes("@") ||
    domain.includes("://")
  ) {
    return false;
  }
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
    domain,
  );
}

export function accountLines(value: string | undefined): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of (value ?? "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^@+/, "");
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function prospectLines(value: string | undefined): string[] {
  const lines: string[] = [];
  for (const raw of (value ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(EMAIL);
    if (!match) continue;
    const name = line.replace(match[0], "").replace(/[<>,;|]/g, " ").trim();
    if (name.length < 2) continue;
    lines.push(line);
  }
  return lines;
}

export function copyOk(value: string | undefined): boolean {
  return (value ?? "").trim().length >= MIN_COPY;
}

export type SaturdayAnswers = {
  track: "b2b" | "b2c" | null;
  contentAnswers: { instagramHandle?: string; emailDomain?: string };
  outreachAnswers: { copy?: string; accounts?: string; prospects?: string };
};

export function contentFieldBlock(state: SaturdayAnswers): string | null {
  if (state.track === "b2c") {
    return instagramHandleOk(state.contentAnswers.instagramHandle)
      ? null
      : "Enter your Instagram handle before finishing the content chapter.";
  }
  if (state.track === "b2b") {
    return emailDomainOk(state.contentAnswers.emailDomain)
      ? null
      : "Enter your email domain before finishing the content chapter.";
  }
  return "Choose B2B or B2C before finishing the content chapter.";
}

export function outreachFieldBlock(state: SaturdayAnswers): string | null {
  if (!copyOk(state.outreachAnswers.copy)) {
    return "Write the outreach copy you will actually send before finishing this chapter.";
  }
  if (state.track === "b2c") {
    const count = accountLines(state.outreachAnswers.accounts).length;
    return count >= MIN_ACCOUNTS
      ? null
      : `Enter ${MIN_ACCOUNTS} target accounts, one per line. ${count} so far.`;
  }
  if (state.track === "b2b") {
    const count = prospectLines(state.outreachAnswers.prospects).length;
    return count >= MIN_PROSPECTS
      ? null
      : `Enter at least ${MIN_PROSPECTS} prospects, one person per line with a name and an email. ${count} so far.`;
  }
  return "Choose B2B or B2C before finishing outreach.";
}

export type ContentPiece = { n: number; text: string };

const HEADER_SPLIT = /\n(?=\d{1,2}\.\s[^\n]*·)/;
const PLAIN_SPLIT = /\n(?=\d+\.\s)/;

/** Piece text from a pack or from the content section alone. Matches the studio splitter. */
export function contentSection(pack: string): string {
  const content = /^##\s+Content\s*$/im.exec(pack);
  if (!content) return pack;
  const rest = pack.slice(content.index + content[0].length);
  const outreach = /^##\s+Outreach\s*$/im.exec(rest);
  return (outreach ? rest.slice(0, outreach.index) : rest).trim();
}

export function parseContentPieces(content: string): ContentPiece[] {
  const text = "\n" + contentSection(content).trim();
  if (text.trim() === "") return [];
  const splitter = HEADER_SPLIT.test(text) ? HEADER_SPLIT : PLAIN_SPLIT;
  const chunks = text.split(splitter);
  if (chunks.length && !/^\s*\d+\.\s/.test(chunks[0] ?? "")) chunks.shift();
  const pieces: ContentPiece[] = [];
  for (const chunk of chunks) {
    const match = chunk.trim().match(/^(\d+)\.\s*([\s\S]*)$/);
    if (match) pieces.push({ n: Number(match[1]), text: (match[2] ?? "").trim() });
  }
  return pieces.sort((a, b) => a.n - b.n);
}

const NO_MEDIA = new Set(["none", "n/a", "na", "text only", "no media", "not needed"]);

export function pieceAsksForMedia(text: string): boolean {
  const match = text.match(/(?:^|\n)\s*Media:\s*(.+)/i);
  if (!match) return false;
  const value = match[1].trim().toLowerCase();
  return value.length > 0 && !NO_MEDIA.has(value);
}

export function missingPieceNumbers(pieces: ContentPiece[]): number[] {
  const have = new Set(pieces.map((piece) => piece.n));
  const missing: number[] = [];
  for (let n = 1; n <= 30; n += 1) if (!have.has(n)) missing.push(n);
  return missing;
}

export function piecesMissingMedia(
  pieces: ContentPiece[],
  readyPieceNumbers: Iterable<number>,
): number[] {
  const ready = new Set(readyPieceNumbers);
  return pieces
    .filter((piece) => pieceAsksForMedia(piece.text) && !ready.has(piece.n))
    .map((piece) => piece.n);
}

function listTail(values: number[]): string {
  const shown = values.slice(0, 8).join(", ");
  return values.length > 8 ? `${shown}, and ${values.length - 8} more` : shown;
}

export function contentPackBlock(
  content: string,
  readyPieceNumbers: Iterable<number>,
): string | null {
  const pieces = parseContentPieces(content);
  const missing = missingPieceNumbers(pieces);
  if (missing.length) {
    return `The content chapter needs all 30 pieces. Still missing ${listTail(missing)}.`;
  }
  const media = piecesMissingMedia(pieces, readyPieceNumbers);
  if (media.length) {
    return `Attach a saved file to every piece that asks for one. Still missing a file on ${listTail(media)}.`;
  }
  return null;
}
