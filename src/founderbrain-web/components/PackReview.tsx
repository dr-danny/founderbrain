import { useEffect, useRef, useState } from "react";
import { joinContent, joinPack, splitContent, splitPack, type PackSections } from "../pack";
import { PackRichEditor } from "./PackRichEditor";

const sections = [
  { key: "content", label: "Content" },
  { key: "outreach", label: "Outreach" },
  { key: "plan", label: "90 day plan" },
] as const;

function looksLikeTasks(content: string): boolean {
  const { pieces } = splitContent(content);
  return pieces.length > 0 && pieces.filter((p) =>
    /^\*?\*?[^\n]{0,60}\*?\*?\s*-\s*(Write|Track|Document|Create|Calculate|Ask|Record|Map|Build|Set up|Review|Identify|Compare|Pilot|Test|Visit|Send|Draft)\b/i.test(p.text),
  ).length >= Math.ceil(pieces.length / 3);
}

export function PackReview({ text, accepting, onClose, onAccept, onRebuild }: {
  text: string; accepting: boolean; onClose: () => void;
  onAccept: (joined: string) => void; onRebuild?: () => void;
}) {
  const [draft, setDraft] = useState<PackSections>(() => splitPack(text));
  const [section, setSection] = useState<(typeof sections)[number]["key"]>("content");
  const [selected, setSelected] = useState(() => splitContent(splitPack(text).content).pieces.length ? 1 : 0);
  const [confirm, setConfirm] = useState<"close" | "rebuild" | null>(null);
  const modal = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const dirty = joinPack(draft) !== joinPack(splitPack(text));
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const savingRef = useRef(accepting); savingRef.current = accepting;
  const { preamble, pieces } = splitContent(draft.content);
  const currentPiece = pieces[selected - 1];
  // Keep the structural piece header separate, so rich formatting cannot break
  // the parser used by the content studio and selective regeneration.
  const header = currentPiece?.text.split("\n")[0] ?? "";
  const structured = header.includes("·");
  const editorText = section !== "content" ? draft[section]
    : !pieces.length ? draft.content
    : selected === 0 ? preamble
    : structured ? currentPiece!.text.slice(header.length).trim() : currentPiece?.text ?? "";
  const editorLabel = section !== "content" ? sections.find((s) => s.key === section)!.label
    : selected === 0 && pieces.length ? "Content pillars" : currentPiece ? `Piece ${currentPiece.n}` : "Content";

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!savingRef.current) { if (dirtyRef.current) setConfirm("close"); else close.current(); }
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [contenteditable="true"], [tabindex="0"]') ?? []);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);

  function change(value: string) {
    if (section !== "content") { setDraft((d) => ({ ...d, [section]: value })); return; }
    if (!pieces.length) { setDraft((d) => ({ ...d, content: value })); return; }
    if (!selected) { setDraft((d) => ({ ...d, content: joinContent(value, pieces) })); return; }
    const next = pieces.map((p, i) => i === selected - 1 ? { ...p, text: structured ? `${header}\n\n${value}` : value } : p);
    setDraft((d) => ({ ...d, content: joinContent(preamble, next) }));
  }
  return (
    <div className="pack-modal pack-review-modal" role="dialog" aria-modal="true" aria-labelledby="pack-review-title" aria-describedby="pack-review-description" ref={modal}>
      <div className="pack-card pack-review-card">
        <header className="pack-review-header">
          <div><p className="eyebrow">YOUR V2 PACK</p><h2 id="pack-review-title">Review your pack.</h2></div>
          <p id="pack-review-description">Review and edit before accepting. Nothing is sent to GoHighLevel here.</p>
        </header>
        {looksLikeTasks(draft.content) && onRebuild ? <p className="pack-legacy-note" role="note">This older pack contains tasks rather than finished posts. Use Rebuild to replace it.</p> : null}
        <div className="pack-review-tabs" role="tablist" aria-label="Pack sections">
          {sections.map((item) => <button key={item.key} type="button" role="tab" id={`pack-tab-${item.key}`}
            aria-selected={section === item.key} aria-controls="pack-review-panel" disabled={accepting}
            onClick={() => { setSection(item.key); setConfirm(null); }}>
            {item.label}{item.key === "content" && pieces.length ? <span>{pieces.length}</span> : null}
          </button>)}
        </div>
        <div className={`pack-review-workspace${section === "content" && pieces.length ? " has-pieces" : ""}`}
          id="pack-review-panel" role="tabpanel" aria-labelledby={`pack-tab-${section}`}>
          {section === "content" && pieces.length ? <nav className="pack-piece-picker" aria-label="Choose content piece">
            <button type="button" className="pack-pillars-button" aria-current={selected === 0 ? "page" : undefined}
              disabled={accepting} onClick={() => setSelected(0)}>Pillars & direction</button>
            <p>CHOOSE A POST</p>
            <div className="pack-piece-grid">{pieces.map((piece, index) => <button key={piece.n} type="button"
              aria-label={`Edit piece ${piece.n}`} aria-current={selected === index + 1 ? "page" : undefined}
              title={piece.text.split("\n")[0]} disabled={accepting} onClick={() => setSelected(index + 1)}>{piece.n}</button>)}</div>
            <p className="pack-picker-hint">One post at a time.<br />Your edits stay when you switch.</p>
          </nav> : null}
          <section className="pack-document" aria-label={`${editorLabel} editor`}>
            <header className="pack-document-heading"><div><h3>{editorLabel}</h3>{structured && section === "content" && selected > 0 ? <p>{header}</p> : null}</div>
              {section === "content" && pieces.length ? <div className="pack-piece-arrows">
                <button type="button" aria-label="Previous piece" disabled={selected === 0 || accepting} onClick={() => setSelected(selected - 1)}>Previous</button>
                <button type="button" aria-label="Next piece" disabled={selected === pieces.length || accepting} onClick={() => setSelected(selected + 1)}>Next</button>
              </div> : null}
            </header>
            <PackRichEditor key={`${section}-${selected}`} value={editorText} label={editorLabel} onChange={change} disabled={accepting} />
          </section>
        </div>
        <footer className="pack-review-footer">
          {confirm ? <div className="pack-confirm" role="alert">
            <p>{confirm === "close" ? "Discard your unsaved edits and close?" : "Rebuild replaces this draft with newly generated content and uses AI credits."}</p>
            <button type="button" onClick={() => setConfirm(null)}>Keep editing</button>
            <button type="button" onClick={() => { if (confirm === "close") onClose(); else onRebuild?.(); }}> {confirm === "close" ? "Discard edits" : "Rebuild now"}</button>
          </div> : <>
            <p className="pack-edit-status" role="status">{accepting ? "Saving your pack…" : dirty ? "Unsaved edits · Accept to save" : "Draft · Review all three sections"}</p>
            <div className="pack-review-actions">
              <button type="button" disabled={accepting} onClick={() => dirty ? setConfirm("close") : onClose()}>Close</button>
              {onRebuild ? <button type="button" disabled={accepting} onClick={() => setConfirm("rebuild")}>Rebuild</button> : null}
              <button type="button" className="pack-primary" disabled={accepting || !draft.content.trim() || !draft.outreach.trim() || !draft.plan.trim()} onClick={() => onAccept(joinPack(draft))}>{accepting ? "Saving…" : "Accept pack"}</button>
            </div>
          </>}
        </footer>
      </div>
    </div>
  );
}
