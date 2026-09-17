/**
 * Mission stage: heading, form or output, and save/approve footer.
 */
import { sectionWouldApprove, type Brain, type Config, type MissionSection } from "../types";
import { missionCopy, missions, type Mission } from "../mission-copy";
import { MissionForm } from "./MissionForm";
import { Output } from "./Output";
import type { Artifact } from "../types";

export function MissionStage(props: {
  mission: Mission;
  draft: Brain;
  saving: boolean;
  changed: boolean;
  config: Config;
  artifact: Artifact | null;
  artifactText: string;
  artifactStale: boolean;
  generating: boolean;
  generationRetry: boolean;
  accepting: boolean;
  acceptRetry: boolean;
  jobNeedsReconcile: boolean;
  verified: boolean;
  canRetrySave: boolean;
  onPatch: (section: Exclude<Mission, "output">, field: string, value: string | boolean) => void;
  onSave: () => void;
  onRetrySave: () => void;
  onApprove: (section: MissionSection) => void;
  onNext: (mission: Mission) => void;
  onText: (value: string) => void;
  onGenerate: () => void;
  onReconcile: () => void;
  onAccept: () => void;
}) {
  const active = missionCopy[props.mission];
  const index = missions.indexOf(props.mission);
  const next = missions[index + 1];
  const section = props.mission === "output" ? null : props.draft[props.mission];

  return (
    <article className="mission-card">
      <div className="mission-heading">
        <span className="mission-number">{active.number}</span>
        <div>
          <p className="eyebrow">MISSION {active.number}</p>
          <h1>{active.title}</h1>
          <p>{active.note}</p>
        </div>
      </div>
      {props.mission !== "output" && (
        <MissionForm
          mission={props.mission}
          draft={props.draft}
          saving={props.saving}
          onPatch={props.onPatch}
        />
      )}
      {props.mission === "output" && (
        <Output
          config={props.config}
          brain={props.draft}
          artifact={props.artifact}
          text={props.artifactText}
          stale={props.artifactStale}
          generating={props.generating}
          generationRetry={props.generationRetry}
          accepting={props.accepting}
          acceptRetry={props.acceptRetry}
          jobNeedsReconcile={props.jobNeedsReconcile}
          verified={props.verified}
          onText={props.onText}
          onGenerate={props.onGenerate}
          onRetryGenerate={props.onGenerate}
          onReconcile={props.onReconcile}
          onAccept={props.onAccept}
        />
      )}
      <footer className="mission-actions">
        {section && (
          <button
            className="button secondary"
            onClick={props.onSave}
            disabled={!props.changed || props.saving}
          >
            Save draft
          </button>
        )}
        {props.canRetrySave && !props.saving && (
          <button className="button secondary" onClick={props.onRetrySave}>
            Retry save
          </button>
        )}
        {section && (
          <button
            className="button primary"
            onClick={() => props.onApprove(props.mission as MissionSection)}
            disabled={
              props.saving ||
              (!section.approved &&
                !sectionWouldApprove(props.draft, props.mission as MissionSection))
            }
          >
            {section.approved
              ? "Remove approval"
              : sectionWouldApprove(props.draft, props.mission as MissionSection)
                ? "Approve mission"
                : "Complete required fields"}
          </button>
        )}
        {next && (
          <button className="button ghost" onClick={() => props.onNext(next)}>
            Next: {missionCopy[next].title}
          </button>
        )}
      </footer>
    </article>
  );
}
