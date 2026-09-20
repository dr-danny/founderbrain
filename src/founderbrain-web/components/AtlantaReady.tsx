/**
 * Atlanta-ready destination: Friday / Saturday / Sunday artifacts.
 * Progress is FounderBrain readiness + chapter completion — not an external form.
 */
import { atlantaReadyMap, type OrientationState } from "../../founderbrain-shared/orientation";
import type { BrainState, RoutineDraft } from "../types";

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
  onDraftStatus,
  onContent,
  onOutreach,
  onGhl,
  onMissions,
}: {
  state: BrainState;
  orientation: OrientationState;
  drafts: RoutineDraft[];
  onDraftStatus: (id: string, status: "read" | "dismissed") => void;
  onContent: () => void;
  onOutreach: () => void;
  onGhl: () => void;
  onMissions: () => void;
}) {
  const map = atlantaReadyMap(state.readiness, orientation);
  const byDay = (day: keyof typeof dayCopy) => map.artifacts.filter((a) => a.day === day);

  return (
    <article className="home-card atlanta-card">
      <p className="eyebrow">ATLANTA · SEP 25–27</p>
      <h1>{map.green ? "You are Green for Atlanta." : "What ready means in Atlanta."}</h1>
      <p>
        The weekend is the event. FounderBrain is how you arrive with real artifacts — not a
        recording, not a Google Form.
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

      <div className="home-actions">
        <button className="button primary" type="button" onClick={onMissions}>
          Continue missions
        </button>
        <button className="button secondary" type="button" onClick={onContent}>
          {orientation.contentCompletedAt ? "Review content chapter" : "Content chapter"}
        </button>
        <button className="button secondary" type="button" onClick={onOutreach}>
          {orientation.outreachCompletedAt ? "Review outreach chapter" : "Outreach chapter"}
        </button>
        <button className="button secondary" type="button" onClick={onGhl}>
          {orientation.ghlCompletedAt ? "Review GoHighLevel chapter" : "GoHighLevel chapter"}
        </button>
      </div>
      <small>Nothing is published or sent to customers.</small>
    </article>
  );
}
