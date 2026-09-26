export type PackSections = {
  content: string;
  outreach: string;
  plan: string;
};

export function isPack(text: string): boolean {
  return text.includes("## Content") && text.includes("## Outreach") && text.includes("90 day plan");
}

/** Match section headings, never mentions of the plan inside prose or a pack title. */
export function splitPack(text: string): PackSections {
  const content = /^##\s+Content\s*$/im.exec(text);
  const outreach = /^##\s+Outreach\s*$/im.exec(text.slice(content ? content.index + content[0].length : 0));
  const outreachAt = outreach ? (content ? content.index + content[0].length : 0) + outreach.index : -1;
  const afterOutreach = outreachAt >= 0 ? outreachAt + outreach![0].length : content ? content.index + content[0].length : 0;
  const plan = /^(?:#{1,6}\s*)?90[ -]day plan\s*$/im.exec(text.slice(afterOutreach));
  const planAt = plan ? afterOutreach + plan.index : -1;
  const cleanContent = (value: string) => value.trim().replace(/^(?:##\s+Content\s*\n\s*)+/i, "").trim();
  return {
    content: content ? cleanContent(text.slice(content.index + content[0].length, outreachAt >= 0 ? outreachAt : planAt >= 0 ? planAt : undefined)) : "",
    outreach: outreachAt >= 0 ? text.slice(afterOutreach, planAt >= 0 ? planAt : undefined).trim() : "",
    plan: planAt >= 0 ? text.slice(planAt + plan![0].length).trim() : "",
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
