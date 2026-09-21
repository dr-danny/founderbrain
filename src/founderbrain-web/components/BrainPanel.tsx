/**
 * Brain history, version compare/restore, exports, and workspace delete.
 * Server versions are authoritative; App wires the API callbacks.
 */
import type { BrainState, HistoryItem } from "../types";
import { sectionFounderNames, stamp } from "../mission-copy";
import { BrainDiff } from "./BrainDiff";

export function BrainPanel({
  state,
  history,
  comparison,
  deleteOpen,
  deleteText,
  onDeleteOpen,
  onDeleteText,
  onDelete,
  onCompare,
  onRestore,
  onDownload,
  onPrivacy,
}: {
  state: BrainState;
  history: HistoryItem[];
  comparison: BrainState | null;
  deleteOpen: boolean;
  deleteText: string;
  onDeleteOpen: () => void;
  onDeleteText: (v: string) => void;
  onDelete: () => void;
  onCompare: (v: number) => void;
  onRestore: (v: number) => void;
  onDownload: (format: "json" | "markdown") => void;
  onPrivacy: () => void;
}) {
  return (
    <article className="brain-card">
      <div className="brain-heading">
        <div>
          <p className="eyebrow">YOUR BRAIN</p>
          <h1>Versioned, not guessed.</h1>
          <p>Server state is authoritative. Compare before restoring.</p>
        </div>
        <div className="exports">
          <button className="button secondary" onClick={() => onDownload("markdown")}>
            Download MD
          </button>
          <button className="button secondary" onClick={() => onDownload("json")}>
            Download JSON
          </button>
        </div>
      </div>
      <div className="history-grid">
        <section>
          <h2>Saved versions</h2>
          {history.length === 0 ? (
            <p className="muted">Open Brain history to load saved revisions.</p>
          ) : (
            <ol className="versions">
              {history.map((item) => (
                <li key={item.version}>
                  <div>
                    <b>
                      Version {item.version}
                      {item.track ? (
                        <span className="atlanta-track-chip brain-track-chip">
                          {item.track === "b2c" ? "Sells to people (B2C)" : "Sells to businesses (B2B)"}
                          {item.hybrid ? " · also B2B" : ""}
                        </span>
                      ) : null}
                    </b>
                    <small>{stamp(item.at)}</small>
                    <small>
                      {item.changed === undefined
                        ? null
                        : item.changed.length === 5 || item.changed.length === 0
                          ? "First version"
                          : `Changed: ${item.changed.map((key) => sectionFounderNames[key as keyof typeof sectionFounderNames]).join(", ")}`}
                    </small>
                  </div>
                  <button className="quiet" onClick={() => onCompare(item.version)}>
                    Compare
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="compare">
          <h2>
            {comparison
              ? `Current v${state.version} vs v${comparison.version}`
              : `Current v${state.version}`}
          </h2>
          {comparison ? (
            <BrainDiff
              left={state.brain}
              right={comparison.brain}
              leftLabel="Current saved"
              rightLabel={`Selected v${comparison.version}`}
            />
          ) : (
            <p className="muted">
              Select a saved version to compare field by field before restoring.
            </p>
          )}
          {comparison && comparison.version !== state.version && (
            <button className="button primary" onClick={() => onRestore(comparison.version)}>
              Restore this version
            </button>
          )}
        </section>
      </div>
      <section className="delete-zone">
        <h2>Delete this workspace</h2>
        <p>
          This deletes your workspace content, not just this browser session. It cannot be undone.
          Backup retention and billing reconciliation are handled by the operator.{" "}
          <button className="quiet linkish" type="button" onClick={onPrivacy}>
            Privacy and data use
          </button>
        </p>
        {deleteOpen ? (
          <div>
            <label className="field" htmlFor="delete-confirm">
              <span>Type DELETE to continue</span>
              <input
                id="delete-confirm"
                value={deleteText}
                onChange={(event) => onDeleteText(event.target.value)}
                aria-invalid={deleteText.length > 0 && deleteText !== "DELETE"}
              />
            </label>
            <button className="button danger" disabled={deleteText !== "DELETE"} onClick={onDelete}>
              Delete workspace
            </button>
          </div>
        ) : (
          <button className="quiet" onClick={onDeleteOpen}>
            Delete workspace…
          </button>
        )}
      </section>
    </article>
  );
}
