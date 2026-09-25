export type PackSections = {
  content: string;
  outreach: string;
  plan: string;
};

export function isPack(text: string): boolean {
  return text.includes("## Content") && text.includes("## Outreach") && text.includes("90 day plan");
}

function between(text: string, start: string, end: string | null): string {
  const from = text.indexOf(start);
  if (from < 0) return "";
  const body = text.slice(from + start.length);
  if (!end) return body.trim();
  const to = body.indexOf(end);
  return (to < 0 ? body : body.slice(0, to)).trim();
}

export function splitPack(text: string): PackSections {
  return {
    content: between(text, "## Content", "## Outreach"),
    outreach: between(text, "## Outreach", "90 day plan"),
    plan: between(text, "90 day plan", null).replace(/^#+\s*90 day plan\s*/i, "").trim(),
  };
}

export type ContentPiece = { n: number; text: string };

/** New packs mark each piece with a header 'N. Pillar · Format · Platform'. */
const HEADER_SPLIT = /\n(?=\d{1,2}\.\s[^\n]*·)/;
const PLAIN_SPLIT = /\n(?=\d+\.\s)/;

export function splitContent(content: string): { preamble: string; pieces: ContentPiece[] } {
  const text = "\n" + content.trim();
  const splitter = HEADER_SPLIT.test(text) ? HEADER_SPLIT : PLAIN_SPLIT;
  const chunks = text.split(splitter);
  const preamble = /^\s*\d+\.\s/.test(chunks[0] ?? "") ? "" : (chunks.shift() ?? "").trim();
  const pieces: ContentPiece[] = [];
  for (const chunk of chunks) {
    const match = chunk.trim().match(/^(\d+)\.\s*([\s\S]*)$/);
    if (match) pieces.push({ n: Number(match[1]), text: (match[2] ?? "").trim() });
  }
  return { preamble, pieces: pieces.sort((a, b) => a.n - b.n) };
}

export function joinContent(preamble: string, pieces: ContentPiece[]): string {
  return [preamble.trim(), piecesToMarkdown(pieces)].filter(Boolean).join("\n\n");
}

export function parsePieces(content: string): ContentPiece[] {
  return splitContent(content).pieces;
}

export function piecesToMarkdown(pieces: ContentPiece[]): string {
  return pieces.map((piece) => `${piece.n}. ${piece.text}`).join("\n\n");
}

export function joinPack(sections: PackSections): string {
  return ["## Content", sections.content.trim(), "## Outreach", sections.outreach.trim(), "90 day plan", sections.plan.trim()]
    .filter((part) => part.length > 0)
    .join("\n\n");
}
