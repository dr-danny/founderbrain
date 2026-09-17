/**
 * Version-conflict dialog: compare remote saved brain vs local draft.
 * Escape / Close keep the draft; load server replaces it.
 */
import type { RefObject } from "react";
import type { Brain, BrainState } from "../types";

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
        <p className="eyebrow">VERSION CONFLICT</p>
        <h2 id="conflict-title">Version {conflict.version} was saved elsewhere.</h2>
        <p>
          Compare the actual text before choosing. Escape keeps your draft against the current
          version.
        </p>
        <div className="conflict-compare">
          <pre>
            <b>Current saved v{conflict.version}</b>
            {"\n"}
            {JSON.stringify(conflict.brain, null, 2)}
          </pre>
          <pre>
            <b>Your draft</b>
            {"\n"}
            {JSON.stringify(draft, null, 2)}
          </pre>
        </div>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onLoadServer}>
            Load server version
          </button>
          <button className="button primary" onClick={onKeepDraft}>
            Keep my draft
          </button>
        </div>
      </section>
    </div>
  );
}
