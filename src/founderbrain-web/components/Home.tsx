/**
 * Private workspace home: progress toward the five missions and Atlanta-ready.
 * First stop after orientation; does not edit brain fields itself.
 */
import type { OrientationState } from "../../founderbrain-shared/orientation";
import { atlantaReadyMap } from "../../founderbrain-shared/orientation";
import type { Brain, BrainState } from "../types";

export function Home({
  state,
  draft,
  orientation,
  onBegin,
  onHistory,
  onAtlanta,
  onContent,
  onOutreach,
}: {
  state: BrainState;
  draft: Brain;
  orientation: OrientationState;
  onBegin: () => void;
  onHistory: () => void;
  onAtlanta: () => void;
  onContent: () => void;
  onOutreach: () => void;
}) {
  const complete = Object.values(state.readiness).filter(Boolean).length;
  const atlanta = atlantaReadyMap(state.readiness, orientation);
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
      <div className="progress atlanta-home-progress">
        <b>
          {atlanta.readyCount}/{atlanta.total}
        </b>
        <span>
          {atlanta.green ? "Green for Atlanta" : "Atlanta artifacts · partial is not Green"}
        </span>
        <progress
          value={atlanta.readyCount}
          max={atlanta.total}
          aria-label={`${atlanta.readyCount} of ${atlanta.total} Atlanta artifacts ready`}
        />
      </div>
      <div className="home-actions">
        <button className="button primary" type="button" onClick={onBegin}>
          Continue mission
        </button>
        <button className="button secondary" type="button" onClick={onAtlanta}>
          Atlanta-ready map
        </button>
        <button className="button secondary" type="button" onClick={onContent}>
          Content chapter
        </button>
        <button className="button secondary" type="button" onClick={onOutreach}>
          Outreach chapter
        </button>
        <button className="button secondary" type="button" onClick={onHistory}>
          See Brain history
        </button>
      </div>
      <small>Nothing is published or sent to customers.</small>
    </article>
  );
}
