import { useState } from "react";
import { joinPack, splitPack, type PackSections } from "../pack";

const sections = [
  { key: "content", label: "Content" },
  { key: "outreach", label: "Outreach" },
  { key: "plan", label: "90 day plan" },
] as const;

export function PackReview({
  text,
  accepting,
  onClose,
  onAccept,
}: {
  text: string;
  accepting: boolean;
  onClose: () => void;
  onAccept: (joined: string) => void;
}) {
  const [draft, setDraft] = useState<PackSections>(() => splitPack(text));
  const [section, setSection] = useState<(typeof sections)[number]["key"]>("content");
  const current = sections.find((item) => item.key === section)!;

  return (
    <div className="pack-modal" role="dialog" aria-modal="true" aria-label="Review your V2 pack">
      <div className="pack-card">
        <p className="eyebrow">REVIEW BEFORE GOHIGHLEVEL</p>
        <h2>Edit each section, then accept.</h2>
        <p>Nothing is written to GoHighLevel until you accept this pack.</p>
        <div className="pack-tabs">
          {sections.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === section ? "entry-cta" : "typeform-external"}
              onClick={() => setSection(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="pack-label" htmlFor="pack-section">
          {current.label}
        </label>
        <textarea
          id="pack-section"
          value={draft[section]}
          rows={14}
          onChange={(event) => setDraft({ ...draft, [section]: event.target.value })}
        />
        <div className="pack-actions">
          <button type="button" className="typeform-external" onClick={onClose} disabled={accepting}>
            Close
          </button>
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
