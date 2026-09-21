/**
 * Atlanta hub: the same cinematic stage as the typeform experience (Danny,
 * 2026-09-21), now the control room. Readiness by day, routine drafts, and the
 * full Brain version history with restore-to-switch. Nothing is published.
 */
import { useEffect, useState } from "react";
import { atlantaReadyMap, type OrientationState } from "../../founderbrain-shared/orientation";
import type { BrainState, HistoryItem, RoutineDraft } from "../types";
import { stamp } from "../mission-copy";
import { BrandMark } from "./BrandMark";

const draftKindCopy: Record<RoutineDraft["kind"], string> = {
  monday_plan: "Weekly plan",
  content_top_up: "Content refill",
  readiness: "Readiness",
};

const dayCopy = {
  friday: {
    title: "Friday · Foundation",
    lede: "Ideal customer, value proposition, and a Sales Challenge to test messaging.",
  },
  saturday: {
    title: "Saturday · Content + Outreach",
    lede: "Refine voice, execute the content engine, and run outreach. Tooling like Apollo stays weekend work.",
  },
  sunday: {
    title: "Sunday · Operations + Assemble",
    lede: "System connections, workflow automation, objection handling, and a 90-day plan pressure-test.",
  },
} as const;

export function AtlantaReady({
  state,
  orientation,
  drafts,
  history,
  onDraftStatus,
  onContent,
  onOutreach,
  onGhl,
  onMissions,
  onBrain,
  onRestore,
}: {
  state: BrainState;
  orientation: OrientationState;
  drafts: RoutineDraft[];
  history: HistoryItem[];
  onDraftStatus: (id: string, status: "read" | "dismissed") => void;
  onContent: () => void;
  onOutreach: () => void;
  onGhl: () => void;
  onMissions: () => void;
  onBrain: () => void;
  onRestore: (version: number) => void;
}) {
  const map = atlantaReadyMap(state.readiness, orientation);
  const byDay = (day: keyof typeof dayCopy) => map.artifacts.filter((a) => a.day === day);
  const versions = [...history].sort((a, b) => b.version - a.version);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);

  // Clear any pending restore confirm when the version set changes.
  useEffect(() => {
    setConfirmRestore(null);
  }, [state.version, history.length]);

  return (
    <main className="entry-stage typeform-stage atlanta-stage">
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
      <section className="entry-panel typeform-panel atlanta-panel" aria-labelledby="atlanta-title">
        <header className="entry-brand-block">
          <BrandMark size={56} className="entry-mark" />
          <p className="entry-product">
            <span>Founder</span>Brain
          </p>
        </header>
        <p className="entry-kicker">ATLANTA &middot; SEP 25&ndash;27</p>
        <h1 id="atlanta-title" className="entry-title">
          {map.green ? "You are Green for Atlanta." : "What ready means in Atlanta."}
        </h1>
        <div className="typeform-body in atlanta-body">
          <p className="atlanta-lede">
            The weekend is the event. FounderBrain is how you arrive with real artifacts &mdash; not
            a recording, not a Google Form.
          </p>
          <div className="progress atlanta-progress">
            <b>
              {map.readyCount}/{map.total}
            </b>
            <span>
              {map.green ? "Green — all artifacts ready" : "artifacts ready · partial is not Green"}
            </span>
            <progress
              value={map.readyCount}
              max={map.total}
              aria-label={`${map.readyCount} of ${map.total} Atlanta artifacts ready`}
            />
          </div>

          {(Object.keys(dayCopy) as Array<keyof typeof dayCopy>).map((day) => (
            <section key={day} className="atlanta-day">
              <h2>{dayCopy[day].title}</h2>
              <p>{dayCopy[day].lede}</p>
              <ul className="atlanta-artifacts">
                {byDay(day).map((artifact) => (
                  <li key={artifact.key} className={artifact.ready ? "ready" : "partial"}>
                    <span aria-hidden="true">{artifact.ready ? "✓" : "○"}</span>
                    {artifact.label}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="atlanta-day atlanta-versions">
            <h2>Versions</h2>
            <p>
              Every save is kept. Restoring an older version brings it back as the newest version;
              nothing is deleted.
            </p>
            {versions.length === 0 ? (
              <p className="atlanta-muted">Loading saved versions…</p>
            ) : (
              <ol className="atlanta-versions">
                {versions.map((item) => {
                  const current = item.version === state.version;
                  return (
                    <li key={item.version} className={current ? "current" : ""}>
                      <div className="atlanta-version-meta">
                        <b>v{item.version}</b>
                        <small>
                          {stamp(item.at)} · {item.sha.slice(0, 8)}
                        </small>
                      </div>
                      {current ? (
                        <span className="atlanta-current-tag">Current</span>
                      ) : confirmRestore === item.version ? (
                        <span className="atlanta-confirm">
                          <button
                            type="button"
                            className="atlanta-version-btn primary"
                            onClick={() => {
                              setConfirmRestore(null);
                              onRestore(item.version);
                            }}
                          >
                            Restore v{item.version}
                          </button>
                          <button
                            type="button"
                            className="atlanta-version-btn"
                            onClick={() => setConfirmRestore(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="atlanta-version-btn"
                          onClick={() => setConfirmRestore(item.version)}
                        >
                          Restore
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {drafts.length > 0 ? (
            <section className="atlanta-day atlanta-drafts">
              <h2>This week</h2>
              <p>Drafts your routine wrote. Read each before anything goes anywhere. Nothing here is published.</p>
              <ul className="routine-drafts">
                {drafts.map((draft) => (
                  <li key={draft.id} className="routine-draft">
                    <details
                      onToggle={(event) => {
                        if ((event.currentTarget as HTMLDetailsElement).open && draft.status === "pending")
                          onDraftStatus(draft.id, "read");
                      }}
                    >
                      <summary>
                        <b>{draft.title}</b>
                        <span className="routine-kind">
                          {draftKindCopy[draft.kind]} &middot;{" "}
                          {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
                            new Date(draft.createdAt),
                          )}
                        </span>
                      </summary>
                      <pre className="routine-body">{draft.body}</pre>
                      <div className="routine-actions">
                        <button type="button" className="mission-save" onClick={() => onDraftStatus(draft.id, "dismissed")}>
                          Dismiss
                        </button>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="atlanta-actions">
            <button className="entry-cta" type="button" onClick={onMissions}>
              Continue missions
            </button>
            <button className="atlanta-secondary" type="button" onClick={onContent}>
              {orientation.contentCompletedAt ? "Review content chapter" : "Content chapter"}
            </button>
            <button className="atlanta-secondary" type="button" onClick={onOutreach}>
              {orientation.outreachCompletedAt ? "Review outreach chapter" : "Outreach chapter"}
            </button>
            <button className="atlanta-secondary" type="button" onClick={onGhl}>
              {orientation.ghlCompletedAt ? "Review GoHighLevel chapter" : "GoHighLevel chapter"}
            </button>
            <button className="atlanta-secondary" type="button" onClick={onBrain}>
              Brain &amp; exports
            </button>
          </div>
          <small>Nothing is published or sent to customers.</small>
        </div>
      </section>
    </main>
  );
}
