/**
 * Atlanta hub: the same cinematic stage as the typeform experience. The control
 * room: an explicit where-you-are banner, founder-language readiness by day
 * (every row jumps to the work it belongs to), routine drafts, and a readable
 * history of every saved version. Nothing is published or sent to customers.
 */
import { useEffect, useState } from "react";
import { atlantaReadyMap, type OrientationState } from "../../founderbrain-shared/orientation";
import type { BrainState, HistoryItem, RoutineDraft } from "../types";
import { missionCopy, missions, sectionFounderNames, stamp } from "../mission-copy";
import { BrandMark } from "./BrandMark";

const draftKindCopy: Record<RoutineDraft["kind"], string> = {
  monday_plan: "Weekly plan",
  content_top_up: "Content refill",
  readiness: "Readiness",
};

const dayCopy = {
  friday: {
    title: "Friday · Foundation",
    lede: "Who you serve, what you promise, and a short message to test it in real conversations.",
  },
  saturday: {
    title: "Saturday · Content + Outreach",
    lede: "Fine-tune how you sound, build your content engine, and start talking to the people on your list.",
  },
  sunday: {
    title: "Sunday · Operations + Assemble",
    lede: "Connect your systems, automate the busywork, handle objections, and pressure-test your 90-day plan.",
  },
} as const;

/** Where each readiness row takes the founder. */
const artifactTargets: Record<string, string> = {
  brainThesis: "mission-identity",
  firstOutput: "mission-output",
  voice: "mission-voice",
  contentChapter: "chapter-content",
  outreachChapter: "chapter-outreach",
  trackSetup: "mission-context",
  ghlAccount: "chapter-ghl",
};

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
  onOpenArtifact,
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
  onOpenArtifact: (target: string) => void;
  onBrain: () => void;
  onRestore: (version: number) => void;
}) {
  const map = atlantaReadyMap(state.readiness, orientation);
  const byDay = (day: keyof typeof dayCopy) => map.artifacts.filter((a) => a.day === day);
  const versions = [...history].sort((a, b) => b.version - a.version);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const visibleVersions = showAllVersions ? versions : versions.slice(0, 3);

  // Where the founder is: missions done, and the next one by number.
  const missionsDone = missions.filter((key) => state.readiness[key]).length;
  const nextMission = missions.find((key) => !state.readiness[key]);

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
          {map.green ? "You are ready for Atlanta." : "Here is where you stand for Atlanta."}
        </h1>
        <div className="typeform-body in atlanta-body">
          {/* Where you are, stated outright. The button is the next thing to click. */}
          <section className="atlanta-status" aria-label="Where you are">
            <div className="atlanta-status-text">
              <b>
                {missionsDone} of {missions.length} missions done
              </b>
              <span>
                {nextMission ? (
                  <>
                    Next up:{" "}
                    <b>
                      {missionCopy[nextMission].number} {missionCopy[nextMission].title}
                    </b>
                  </>
                ) : (
                  "Every mission is done. Walk the chapters below."
                )}
              </span>
            </div>
            <button className="entry-cta" type="button" onClick={onMissions}>
              {nextMission ? "Keep going" : "Review your work"}
            </button>
          </section>

          <div className="progress atlanta-progress">
            <b>
              {map.readyCount}/{map.total}
            </b>
            <span>
              {map.green
                ? "Everything on this list is done."
                : "of the list below is done. Finish the rest before the weekend."}
            </span>
            <progress
              value={map.readyCount}
              max={map.total}
              aria-label={`${map.readyCount} of ${map.total} Atlanta items done`}
            />
          </div>

          <p className="atlanta-lede">
            The weekend is the event. FounderBrain gets the work done before you land: your
            business profile, your content, your outreach, and your systems. Everything below
            opens the exact place where that work happens.
          </p>

          {(Object.keys(dayCopy) as Array<keyof typeof dayCopy>).map((day) => (
            <section key={day} className="atlanta-day">
              <h2>{dayCopy[day].title}</h2>
              <p>{dayCopy[day].lede}</p>
              <ul className="atlanta-artifacts">
                {byDay(day).map((artifact) => (
                  <li key={artifact.key} className={artifact.ready ? "ready" : "partial"}>
                    <button
                      type="button"
                      className="atlanta-artifact"
                      onClick={() => onOpenArtifact(artifactTargets[artifact.key] ?? "mission-identity")}
                    >
                      <span className="atlanta-artifact-mark" aria-hidden="true">
                        {artifact.ready ? "✓" : "○"}
                      </span>
                      <span className="atlanta-artifact-label">{artifact.label}</span>
                      <span className="atlanta-artifact-go" aria-hidden="true">
                        {artifact.ready ? "Open" : "Start"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="atlanta-day atlanta-versions-section">
            <h2>Your history</h2>
            <p>
              Every save is kept as its own version, so you can always go back. Each version shows
              what your business was and exactly what changed. Restoring an older version brings it
              back as the newest save; nothing is ever deleted.
            </p>
            {versions.length === 0 ? (
              <p className="atlanta-muted">Loading your saves…</p>
            ) : (
              <>
                <ol className="atlanta-versions">
                  {visibleVersions.map((item) => {
                    const current = item.version === state.version;
                    return (
                      <li key={item.version} className={current ? "current" : ""}>
                        <div className="atlanta-version-meta">
                          <b>
                            Version {item.version}
                            <span className="atlanta-track-chip">
                              {item.track === "b2c" ? "Sells to people (B2C)" : "Sells to businesses (B2B)"}
                              {item.hybrid ? " · also B2B" : ""}
                            </span>
                          </b>
                          <small>
                            {stamp(item.at)}
                            {item.venture ? ` · ${item.venture}` : ""}
                          </small>
                          <small className="atlanta-version-changed">
                            {item.changed === undefined
                              ? null
                              : item.changed.length === 5 || item.changed.length === 0
                                ? "First version"
                                : item.changed.length === 1
                                  ? `Changed: ${sectionFounderNames[item.changed[0] as keyof typeof sectionFounderNames]}`
                                  : `Changed: ${item.changed
                                      .map((key) => sectionFounderNames[key as keyof typeof sectionFounderNames])
                                      .join(", ")}`}
                          </small>
                        </div>
                        {current ? (
                          <span className="atlanta-current-tag">This is the one in use</span>
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
                              Go back to this version
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
                            Go back to this
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {versions.length > 3 ? (
                  <button
                    type="button"
                    className="atlanta-version-btn atlanta-show-all"
                    onClick={() => setShowAllVersions((value) => !value)}
                  >
                    {showAllVersions
                      ? "Show latest only"
                      : `Show all ${versions.length} versions`}
                  </button>
                ) : null}
              </>
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
            <button className="atlanta-secondary" type="button" onClick={onContent}>
              {orientation.contentCompletedAt ? "Review your content plan" : "Set up your content plan"}
            </button>
            <button className="atlanta-secondary" type="button" onClick={onOutreach}>
              {orientation.outreachCompletedAt ? "Review your outreach plan" : "Set up your outreach plan"}
            </button>
            <button className="atlanta-secondary" type="button" onClick={onGhl}>
              {orientation.ghlCompletedAt ? "Review GoHighLevel" : "Connect GoHighLevel"}
            </button>
            <button className="atlanta-secondary" type="button" onClick={onBrain}>
              Your files & downloads
            </button>
          </div>
          <small>Nothing is published or sent to customers.</small>
        </div>
      </section>
    </main>
  );
}
