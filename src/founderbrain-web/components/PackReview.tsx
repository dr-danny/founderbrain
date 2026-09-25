import { useState } from "react";
import { joinContent, joinPack, splitContent, splitPack, type PackSections } from "../pack";

const sections = [
  { key: "content", label: "Content" },
  { key: "outreach", label: "Outreach" },
  { key: "plan", label: "90 day plan" },
] as const;

/** Old packs wrote tasks ("Write down...", "Track...") instead of posts. */
function looksLikeTasks(content: string): boolean {
  const { pieces } = splitContent(content);
  if (!pieces.length) return false;
  const taskish = pieces.filter((p) =>
    /^\*?\*?[^\n]{0,60}\*?\*?\s*-\s*(Write|Track|Document|Create|Calculate|Ask|Record|Map|Build|Set up|Review|Identify|Compare|Pilot|Test|Visit|Send|Draft)\b/i.test(p.text),
  ).length;
  return taskish >= Math.ceil(pieces.length / 3);
}

function ContentEditor({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { preamble, pieces } = splitContent(value);
  if (!pieces.length) {
    return (
      <textarea id="pack-section" value={value} rows={14} onChange={(event) => onChange(event.target.value)} />
    );
  }
  return (
    <div className="pack-pieces">
      {preamble ? (
        <label className="pack-piece">
          <span>Pillars</span>
          <textarea value={preamble} rows={2} onChange={(event) => onChange(joinContent(event.target.value, pieces))} />
        </label>
      ) : null}
      {pieces.map((piece, index) => (
        <label key={piece.n} className="pack-piece">
          <span>Piece {piece.n}</span>
          <textarea
            value={piece.text}
            rows={Math.min(12, Math.max(4, piece.text.split("\n").length + 1))}
            onChange={(event) => {
              const next = pieces.slice();
              next[index] = { n: piece.n, text: event.target.value };
              onChange(joinContent(preamble, next));
            }}
          />
        </label>
      ))}
    </div>
  );
}

export function PackReview({
  text,
  accepting,
  onClose,
  onAccept,
  onRebuild,
}: {
  text: string;
  accepting: boolean;
  onClose: () => void;
  onAccept: (joined: string) => void;
  onRebuild?: () => void;
}) {
  const [draft, setDraft] = useState<PackSections>(() => splitPack(text));
  const [section, setSection] = useState<(typeof sections)[number]["key"]>("content");
  const current = sections.find((item) => item.key === section)!;
  const pieceCount = splitContent(draft.content).pieces.length;
  const oldStyle = looksLikeTasks(draft.content);

  return (
    <div className="pack-modal" role="dialog" aria-modal="true" aria-label="Review your V2 pack">
      <div className="pack-card">
        <p className="eyebrow">REVIEW BEFORE GOHIGHLEVEL</p>
        <h2>Edit each section, then accept.</h2>
        <p>Nothing is written to GoHighLevel until you accept this pack.</p>
        {oldStyle && onRebuild ? (
          <div className="pack-rebuild" role="note">
            <p>
              This pack was written before the content fix, so its pieces read like a to-do list instead of posts.
              Rebuild it to get 30 finished posts in your voice.
            </p>
            <button type="button" className="entry-cta" onClick={onRebuild} disabled={accepting}>
              Rebuild the pack
            </button>
          </div>
        ) : null}
        <div className="pack-tabs">
          {sections.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === section ? "entry-cta" : "typeform-external"}
              onClick={() => setSection(item.key)}
            >
              {item.label}
              {item.key === "content" && pieceCount ? ` (${pieceCount})` : ""}
            </button>
          ))}
        </div>
        <label className="pack-label" htmlFor="pack-section">
          {current.label}
        </label>
        {section === "content" ? (
          <ContentEditor value={draft.content} onChange={(next) => setDraft({ ...draft, content: next })} />
        ) : (
          <textarea
            id="pack-section"
            value={draft[section]}
            rows={14}
            onChange={(event) => setDraft({ ...draft, [section]: event.target.value })}
          />
        )}
        <div className="pack-actions">
          <button type="button" className="typeform-external" onClick={onClose} disabled={accepting}>
            Close
          </button>
          {onRebuild && !oldStyle ? (
            <button type="button" className="typeform-external" onClick={onRebuild} disabled={accepting}>
              Rebuild
            </button>
          ) : null}
          <button
            type="button"
            className="entry-cta"
            disabled={accepting || !draft.content.trim() || !draft.outreach.trim() || !draft.plan.trim()}
            onClick={() => onAccept(joinPack(draft))}
          >
            {accepting ? "Accepting…" : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
