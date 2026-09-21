/**
 * Files and downloads (Danny, 2026-09-21): the same cinematic glass stage as
 * the hub. Exports, a readable version history with field-by-field compare,
 * and restore. Deletion lives in the account chip's branded modal.
 */
import type { BrainState, HistoryItem } from "../types";
import { sectionFounderNames, stamp } from "../mission-copy";
import { BrainDiff } from "./BrainDiff";
import { BrandMark } from "./BrandMark";

export function BrainPanel({
  state,
  history,
  comparison,
  onCompare,
  onRestore,
  onDownload,
  onHome,
  onPrivacy,
}: {
  state: BrainState;
  history: HistoryItem[];
  comparison: BrainState | null;
  onCompare: (v: number) => void;
  onRestore: (v: number) => void;
  onDownload: (format: "json" | "markdown") => void;
  onHome: () => void;
  onPrivacy: () => void;
}) {
  const versions = [...history].sort((a, b) => b.version - a.version);
  return (
    <main className="entry-stage typeform-stage atlanta-stage brain-stage">
      <div className="entry-media" aria-hidden="true">
        <img
          className="entry-photo"
          src="/atlanta-skyline.jpg"
          alt=""
          width={1920}
          height={1282}
          decoding="async"
          fetchPriority="high"
        />
      </div>
      <div className="entry-veil" aria-hidden="true" />
      <section className="entry-panel typeform-panel atlanta-panel" aria-labelledby="brain-title">
        <header className="entry-brand-block">
          <BrandMark size={56} className="entry-mark" />
          <p className="entry-product">
            <span>Founder</span>Brain
          </p>
        </header>
        <p className="entry-kicker">YOUR BRAIN</p>
        <h1 id="brain-title" className="entry-title">
          Your files and downloads.
        </h1>
        <div className="typeform-body in atlanta-body">
          <p className="atlanta-lede">
            Everything your work produced lives here: your Brain as markdown or JSON, and every
            saved version. Nothing was ever published or sent to customers.
          </p>

          <div className="atlanta-actions">
            <button className="entry-cta" type="button" onClick={onHome}>
              Back to Atlanta
            </button>
            <button className="atlanta-secondary" type="button" onClick={() => onDownload("markdown")}>
              Download Brain as markdown
            </button>
            <button className="atlanta-secondary" type="button" onClick={() => onDownload("json")}>
              Download Brain as JSON
            </button>
            <button className="atlanta-secondary" type="button" onClick={onPrivacy}>
              Privacy and data use
            </button>
          </div>

          <section className="atlanta-day">
            <h2>Saved versions</h2>
            <p>Pick any version to compare it field by field with the one in use, then restore it if it is the one you want.</p>
            {versions.length === 0 ? (
              <p className="atlanta-muted">Loading your saves…</p>
            ) : (
              <ol className="atlanta-versions brain-versions">
                {versions.map((item) => {
                  const current = item.version === state.version;
                  return (
                    <li key={item.version} className={current ? "current" : ""}>
                      <div className="atlanta-version-meta">
                        <b>
                          Version {item.version}
                          {item.track ? (
                            <span className="atlanta-track-chip">
                              {item.hybrid
                                ? "Sells to businesses and people (Hybrid)"
                                : item.track === "b2c"
                                  ? "Sells to people (B2C)"
                                  : "Sells to businesses (B2B)"}
                            </span>
                          ) : null}
                        </b>
                        <small>
                          {stamp(item.at)}
                          {item.venture ? ` · ${item.venture}` : ""}
                        </small>
                        <small className="atlanta-version-changed">
                          {item.changed === undefined
                            ? null
                            : item.changed.length === 5
                              ? "First version"
                              : item.changed.length === 0
                                ? "Same content as the version before it"
                                : `Changed: ${item.changed
                                    .map((key) => sectionFounderNames[key as keyof typeof sectionFounderNames])
                                    .join(", ")}`}
                        </small>
                      </div>
                      {current ? (
                        <span className="atlanta-current-tag">In use</span>
                      ) : (
                        <button
                          type="button"
                          className="atlanta-version-btn"
                          onClick={() => onCompare(item.version)}
                        >
                          Compare
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="atlanta-day">
            <h2>
              {comparison
                ? `Version ${state.version} (in use) next to version ${comparison.version}`
                : `Version ${state.version} (in use)`}
            </h2>
            {comparison ? (
              <>
                <BrainDiff
                  left={state.brain}
                  right={comparison.brain}
                  leftLabel="In use"
                  rightLabel={`Selected v${comparison.version}`}
                />
                {comparison.version !== state.version ? (
                  <button
                    type="button"
                    className="atlanta-version-btn primary"
                    onClick={() => onRestore(comparison.version)}
                  >
                    Make version {comparison.version} current
                  </button>
                ) : null}
              </>
            ) : (
              <p className="atlanta-muted">
                Select a version above to compare it field by field before restoring.
              </p>
            )}
          </section>

          <small>
            Deleting your account lives in the menu at the top right, and always asks twice.
          </small>
        </div>
      </section>
    </main>
  );
}
