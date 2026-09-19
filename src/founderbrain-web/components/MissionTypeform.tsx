/**
 * Missions through the one-idea-per-screen Typeform shell.
 * Field screens, Yes/No-style approve screen, output last. Back crosses missions.
 */
import { useEffect, useState } from "react";
import { missions, missionCopy, type Mission } from "../mission-copy";
import { sectionWouldApprove, type Artifact, type Brain, type Config, type MissionSection } from "../types";
import { Output } from "./Output";
import { TypeformShell } from "./TypeformShell";
import { VoiceField } from "./VoiceField";

type ChoiceOption = { value: string; label: string };
type FieldKind = "text" | "multi" | "choice";
type FieldDef = {
  field: string;
  title: string;
  kind: FieldKind;
  maxLength: number;
  placeholder: string;
  options?: ChoiceOption[];
};

const STAGE_OPTIONS: ChoiceOption[] = [
  { value: "exploring", label: "Exploring" },
  { value: "building", label: "Building" },
  { value: "launched", label: "Launched" },
  { value: "growing", label: "Growing" },
];

const EVIDENCE_OPTIONS: ChoiceOption[] = [
  { value: "hypothesis", label: "Hypothesis" },
  { value: "supported", label: "Supported" },
];

const MISSION_FIELDS: Record<Exclude<Mission, "output">, FieldDef[]> = {
  identity: [
    { field: "name", title: "Your name", kind: "text", maxLength: 40, placeholder: "Your first name" },
    { field: "venture", title: "Venture", kind: "text", maxLength: 80, placeholder: "Venture name" },
    { field: "role", title: "Role", kind: "text", maxLength: 60, placeholder: "Founder, CTO, ..." },
    { field: "stage", title: "Stage", kind: "choice", maxLength: 20, placeholder: "", options: STAGE_OPTIONS },
    { field: "goal", title: "What needs to change?", kind: "multi", maxLength: 400, placeholder: "The change you are trying to make" },
  ],
  customer: [
    { field: "segment", title: "Customer segment", kind: "text", maxLength: 120, placeholder: "Who has the problem" },
    { field: "problem", title: "Problem", kind: "multi", maxLength: 600, placeholder: "The problem they hit" },
    { field: "outcome", title: "Desired outcome", kind: "multi", maxLength: 600, placeholder: "What better looks like" },
    { field: "workaround", title: "Current workaround", kind: "multi", maxLength: 600, placeholder: "How they cope today" },
    { field: "evidenceStatus", title: "Evidence status", kind: "choice", maxLength: 12, placeholder: "", options: EVIDENCE_OPTIONS },
    { field: "evidence", title: "Evidence", kind: "multi", maxLength: 600, placeholder: "Required when evidence is supported" },
  ],
  offer: [
    { field: "description", title: "Offer", kind: "multi", maxLength: 600, placeholder: "What you promise" },
    { field: "delivery", title: "Delivery", kind: "multi", maxLength: 400, placeholder: "How it is delivered" },
    { field: "outcome", title: "Outcome", kind: "multi", maxLength: 400, placeholder: "What the customer gets" },
    { field: "cta", title: "Call to action", kind: "text", maxLength: 160, placeholder: "The next move" },
    { field: "price", title: "Price or pricing frame", kind: "text", maxLength: 160, placeholder: "Optional" },
  ],
  voice: [
    { field: "tone", title: "Tone", kind: "multi", maxLength: 400, placeholder: "How it should sound" },
    { field: "boundaries", title: "Boundaries", kind: "multi", maxLength: 400, placeholder: "What it never says" },
    { field: "sample", title: "Sample", kind: "multi", maxLength: 600, placeholder: "One sample sentence" },
  ],
};

type ScreenDef =
  | { mission: Exclude<Mission, "output">; kind: "field"; index: number }
  | { mission: Exclude<Mission, "output">; kind: "confirm" }
  | { mission: "output"; kind: "output" };

const SCREENS: ScreenDef[] = [];
for (const step of Object.entries(MISSION_FIELDS) as [Exclude<Mission, "output">, FieldDef[]][]) {
  step[1].forEach((_, index) => SCREENS.push({ mission: step[0], kind: "field", index }));
  SCREENS.push({ mission: step[0], kind: "confirm" });
}
SCREENS.push({ mission: "output", kind: "output" });

function screenIndexOf(mission: Mission): number {
  const found = SCREENS.findIndex((screen) => screen.mission === mission);
  return found >= 0 ? found : SCREENS.length - 1;
}

function fieldValue(draft: Brain, mission: Exclude<Mission, "output">, field: string): string {
  const section = draft[mission] as unknown as Record<string, unknown>;
  return typeof section[field] === "string" ? String(section[field]) : "";
}

export function MissionTypeform(props: {
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
  onFinished: () => void;
  onTranscribe?: (blob: Blob, seconds: number) => Promise<string>;
  onText: (value: string) => void;
  onGenerate: () => void;
  onReconcile: () => void;
  onAccept: () => void;
}) {
  const [idx, setIdx] = useState(() => screenIndexOf(props.mission));
  useEffect(() => {
    setIdx(screenIndexOf(props.mission));
  }, [props.mission]);

  const total = SCREENS.length;
  const current = SCREENS[Math.min(Math.max(idx, 0), total - 1)]!;
  const go = (next: number) => setIdx(Math.min(Math.max(next, 0), total - 1));
  const draft = props.draft;

  if (current.kind === "output") {
    return (
      <TypeformShell
        kicker={`Mission 5 · ${missionCopy.output.title}`}
        screen={total}
        total={total}
        title="Your first output"
        continueLabel="Done"
        showBack
        onBack={() => go(total - 2)}
        onContinue={props.onFinished}
        saving={props.saving}
      >
        <Output
          config={props.config}
          brain={draft}
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
      </TypeformShell>
    );
  }

  const active = missionCopy[current.mission];
  const index = missions.indexOf(current.mission);
  const next = missions[index + 1];
  const sectionApproved = Boolean(draft[current.mission]?.approved);
  const canApprove = sectionWouldApprove(draft, current.mission as MissionSection);

  if (current.kind === "confirm") {
    return (
      <TypeformShell
        kicker={`Mission ${index + 1} · ${active.title}`}
        screen={idx + 1}
        total={total}
        title={sectionApproved ? `${active.title} is locked in. Keep it?` : `Lock in ${active.title.toLowerCase()}?`}
        hideContinue={!sectionApproved}
        continueLabel={next ? `Next: ${missionCopy[next].title}` : "Continue"}
        showBack
        onBack={() => go(idx - 1)}
        onContinue={() => go(idx + 1)}
        saving={props.saving}
      >
        {canApprove || sectionApproved ? null : (
          <p className="entry-lede typeform-lede">
            Approve needs every required field filled. You can also continue with a draft.
          </p>
        )}
        <div className="typeform-choices mission-choices">
          <button
            type="button"
            className="typeform-choice yes"
            disabled={props.saving || (!sectionApproved && !canApprove)}
            onClick={() => props.onApprove(current.mission as MissionSection)}
          >
            {sectionApproved ? "Remove approval" : "Approve mission"}
          </button>
          <button
            type="button"
            className="typeform-choice no"
            disabled={props.saving}
            onClick={() => go(idx + 1)}
          >
            {sectionApproved ? "Keep as is" : "Not yet"}
          </button>
        </div>
        <div className="mission-save-row">
          <button
            type="button"
            className="mission-save"
            disabled={!props.changed || props.saving}
            onClick={props.onSave}
          >
            Save draft
          </button>
          {props.canRetrySave && !props.saving ? (
            <button type="button" className="mission-save" onClick={props.onRetrySave}>
              Retry save
            </button>
          ) : null}
        </div>
      </TypeformShell>
    );
  }

  const def = MISSION_FIELDS[current.mission][current.index]!;
  const value = fieldValue(draft, current.mission, def.field);
  const advance = () => go(idx + 1);

  return (
    <TypeformShell
      kicker={`Mission ${index + 1} · ${active.title}`}
      screen={idx + 1}
      total={total}
      title={def.title}
      showBack
      onBack={() => (idx === 0 ? props.onFinished() : go(idx - 1))}
      onContinue={advance}
      saving={props.saving}
    >
      {def.kind === "choice" && def.options ? (
        <div className="typeform-choices mission-choices">
          {def.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === value ? "typeform-choice picked" : "typeform-choice"}
              disabled={props.saving}
              onClick={() => props.onPatch(current.mission, def.field, option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <VoiceField
          label={def.title}
          value={value}
          maxLength={def.maxLength}
          placeholder={def.placeholder}
          multiline={def.kind === "multi"}
          serverTranscribe={props.onTranscribe}
          onEnter={def.kind === "text" ? advance : undefined}
          onChange={(next) => props.onPatch(current.mission, def.field, next)}
        />
      )}
      {def.field === "evidence" && draft.customer.evidenceStatus !== "supported" ? (
        <p className="entry-lede typeform-lede">Only needed when evidence is supported.</p>
      ) : null}
    </TypeformShell>
  );
}
