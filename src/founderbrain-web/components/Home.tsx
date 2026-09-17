/**
 * Private workspace home: progress toward the five missions and entry CTAs.
 * First stop after auth; does not edit brain fields itself.
 */
import type { Brain, BrainState } from "../types";

export function Home({
  state,
  draft,
  onBegin,
  onHistory,
}: {
  state: BrainState;
  draft: Brain;
  onBegin: () => void;
  onHistory: () => void;
}) {
  const complete = Object.values(state.readiness).filter(Boolean).length;
  return (
    <article className="home-card">
      <p className="eyebrow">FOUNDERBRAIN / PRIVATE WORKSPACE</p>
      <h1>
        {draft.identity.venture
          ? `${draft.identity.venture}, in focus.`
          : "Build a brief that knows your business."}
      </h1>
      <p>Five small missions. One durable brain. Save partial thinking whenever it is useful.</p>
      <div className="progress">
        <b>{complete}/5</b>
        <span>missions complete</span>
        <progress value={complete} max={5} aria-label={`${complete} of 5 missions complete`} />
      </div>
      <div className="home-actions">
        <button className="button primary" onClick={onBegin}>
          Continue mission
        </button>
        <button className="button secondary" onClick={onHistory}>
          See Brain history
        </button>
      </div>
      <small>Nothing is published or sent to customers.</small>
    </article>
  );
}
