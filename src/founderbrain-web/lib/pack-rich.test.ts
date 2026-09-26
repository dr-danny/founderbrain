import { test } from "node:test";
import assert from "node:assert/strict";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownManager } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { joinContent, splitContent, joinPack, splitPack } from "../pack";
const markdown = new MarkdownManager({ extensions: [StarterKit, TableKit] });
const rich = "## A heading\n\n**Bold** and *italic* and ++underlined++ and ~~struck~~.\n\n- First\n- Second\n\n1. One\n2. Two\n\n> Quote\n\n[Link](https://example.com) and `code`.\n\n| Item | Status |\n| --- | --- |\n| Draft | Ready |";
test("rich headings, marks, lists, links, quotes and tables survive Markdown storage", () => {
  const doc = markdown.parse(rich);
  const stored = markdown.serialize(doc);
  const again = markdown.parse(stored);
  assert.deepEqual(again, doc);
  for (const type of ['heading','bold','italic','underline','strike','bulletList','orderedList','blockquote','link','code','table']) assert.ok(JSON.stringify(again).includes(`"${type}"`), type);
});
test("rich post bodies preserve structural piece headers and all pack sections", () => {
  const body = markdown.serialize(markdown.parse(rich));
  const content = joinContent("Pillars", [{ n: 1, text: `Delivery · Long post · LinkedIn\n\n${body}` }, { n: 2, text: "Roasting · Short post · LinkedIn\nUnchanged." }]);
  const pack = { content, outreach: "## Follow-up\n\nA draft.", plan: "## Monday\n\nAn action." };
  assert.deepEqual(splitPack(joinPack(pack)), pack);
  assert.equal(splitContent(content).pieces.length, 2);
  assert.equal(splitContent(content).pieces[1]!.text, "Roasting · Short post · LinkedIn\nUnchanged.");
});
test("top-level plan title and prose mentions never bleed Content into plan", () => {
  const pack = '90 day plan\n\n## Content\n\n## Content\n\nPillars\n\n1. A · Short post · LinkedIn\nPost.\n\n## Outreach\n\nMention the 90 day plan in this message.\n\n## 90 day plan\n\n## Monday\nDo the work.';
  const split = splitPack(pack);
  assert.equal(split.plan, '## Monday\nDo the work.');
  assert.equal(split.outreach, 'Mention the 90 day plan in this message.');
  assert.equal(split.content, 'Pillars\n\n1. A · Short post · LinkedIn\nPost.');
});
test("a missing plan stays missing rather than showing the whole pack", () => {
  assert.equal(splitPack('90 day plan\n\n## Content\nPost\n\n## Outreach\nMessage').plan, '');
});
