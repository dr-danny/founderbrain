/**
 * Version-conflict dialog: compare remote saved brain vs local draft.
 * Escape / Close keep the draft; load server replaces it.
 */
import type { RefObject } from "react";
import type { Brain, BrainState } from "../types";
import { BrainDiff } from "./BrainDiff";

export function ConflictDialog({
  conflict,
  draft,
  closeRef,
  onKeepDraft,
  onLoadServer,
}: {
  conflict: BrainState;
  draft: Brain;
  closeRef: RefObject<HTMLButtonElement | null>;
  onKeepDraft: () => void;
  onLoadServer: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <button
          ref={closeRef}
          className="quiet dialog-close"
          onClick={onKeepDraft}
          aria-label="Keep my draft and close conflict"
        >
          Close
        </button>
        <p className="eyebrow">SAVED ELSEWHERE</p>
        <h2 id="conflict-title">A newer copy was saved somewhere else.</h2>
        <p>Compare the text before choosing. Escape keeps your draft.</p>
        <BrainDiff
          left={conflict.brain}
          right={draft}
          leftLabel="Saved copy"
          rightLabel="Your draft"
        />
        <div className="dialog-actions">
          <button className="button secondary" onClick={onLoadServer}>
            Use saved copy
          </button>
          <button className="button primary" onClick={onKeepDraft}>
            Keep my draft
          </button>
        </div>
      </section>
    </div>
  );
}
