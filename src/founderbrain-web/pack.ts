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

export function joinPack(sections: PackSections): string {
  return ["## Content", sections.content.trim(), "## Outreach", sections.outreach.trim(), "90 day plan", sections.plan.trim()]
    .filter((part) => part.length > 0)
    .join("\n\n");
}
