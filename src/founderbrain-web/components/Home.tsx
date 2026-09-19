/**
 * Private workspace home: next action plus Atlanta artifacts occupying the stage.
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
  onGhl,
}: {
  state: BrainState;
  draft: Brain;
  orientation: OrientationState;
  onBegin: () => void;
  onHistory: () => void;
  onAtlanta: () => void;
  onContent: () => void;
  onOutreach: () => void;
  onGhl: () => void;
}) {
  const complete = Object.values(state.readiness).filter(Boolean).length;
  const atlanta = atlantaReadyMap(state.readiness, orientation);

  function openArtifact(key: string) {
    if (key === "contentChapter") onContent();
    else if (key === "outreachChapter") onOutreach();
    else if (key === "ghlAccount") onGhl();
    else if (key === "trackSetup") onAtlanta();
    else onBegin();
  }

  return (
    <article className="home-card home-workspace">
      <div className="home-main">
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h1>
          {draft.identity.venture
            ? `${draft.identity.venture}, in focus.`
            : "Build a brief that knows your business."}
        </h1>
        <p>Five small missions. One private Brain. Nothing is published or sent.</p>
        <div className="progress">
          <b>{complete}/5</b>
          <span>missions complete</span>
          <progress value={complete} max={5} aria-label={`${complete} of 5 missions complete`} />
        </div>
        <div className="home-actions">
          <button className="button primary" type="button" onClick={onBegin}>
            Continue mission
          </button>
          <button className="button secondary" type="button" onClick={onHistory}>
            See Brain history
          </button>
        </div>
      </div>
      <aside className="home-side">
        <div className="home-side-head">
          <p className="eyebrow">ATLANTA · SEP 25–27</p>
          <p className="home-side-status">
            {atlanta.green
              ? "Green. Every artifact is ready."
              : `${atlanta.readyCount}/${atlanta.total} ready · partial is not Green`}
          </p>
        </div>
        <progress
          className="home-side-progress"
          value={atlanta.readyCount}
          max={atlanta.total}
          aria-label={`${atlanta.readyCount} of ${atlanta.total} Atlanta artifacts ready`}
        />
        <ul className="home-artifact-list">
          {atlanta.artifacts.map((artifact) => (
            <li key={artifact.key}>
              <button
                type="button"
                className={artifact.ready ? "home-artifact ready" : "home-artifact"}
                onClick={() => openArtifact(artifact.key)}
              >
                <span aria-hidden="true">{artifact.ready ? "✓" : "○"}</span>
                {artifact.label}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </article>
  );
}
