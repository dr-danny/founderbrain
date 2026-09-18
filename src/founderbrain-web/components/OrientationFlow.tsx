/**
 * First-run Typeform: name, ready, then Identity questions. Stays cinematic.
 */
import { useEffect, useRef, useState } from "react";
import { TypeformShell } from "./TypeformShell";
import { VoiceField } from "./VoiceField";

const NAME_KEY = "founderbrain.what-to-call-you";
const YES_KEY = "founderbrain.welcome-yes";
const STAGE_KEY = "founderbrain.identity-stage-asked";

const STAGES = [
  { value: "exploring", label: "Exploring" },
  { value: "building", label: "Building" },
  { value: "launched", label: "Launched" },
  { value: "growing", label: "Growing" },
] as const;

type IdentityDraft = {
  name: string;
  venture: string;
  role: string;
  stage: string;
  goal: string;
};

function readKey(key: string): string {
  try {
    return sessionStorage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeKey(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function nextIdentityField(identity: IdentityDraft): "venture" | "role" | "stage" | "goal" | null {
  if (!identity.venture.trim()) return "venture";
  if (!identity.role.trim()) return "role";
  if (readKey(STAGE_KEY) !== "1") return "stage";
  if (!identity.goal.trim()) return "goal";
  return null;
}

export function OrientationFlow({
  screen,
  saving,
  error,
  welcomeDone,
  identity,
  onNamed,
  onAdvance,
  onComplete,
  onDecline,
  onIdentity,
}: {
  screen: number;
  saving: boolean;
  error: string;
  welcomeDone: boolean;
  identity: IdentityDraft;
  onNamed: (name: string) => void;
  onAdvance: (nextScreen: number) => void | Promise<void>;
  onComplete: () => void | Promise<void>;
  onDecline: () => void;
  onIdentity: (field: "venture" | "role" | "stage" | "goal", value: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(() => identity.name.trim() || readKey(NAME_KEY));
  const [localError, setLocalError] = useState("");
  const [saidYes, setSaidYes] = useState(() => welcomeDone || readKey(YES_KEY) === "1");
  const [draft, setDraft] = useState({ venture: "", role: "", stage: identity.stage || "exploring", goal: "" });
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const readyName = name.trim().length >= 1;
  const identityField =
    saidYes || welcomeDone ? nextIdentityField({ ...identity, name: name.trim() || identity.name }) : null;
  const inIdentity = Boolean(identityField);

  useEffect(() => {
    if (identityField === "goal") areaRef.current?.focus();
    else inputRef.current?.focus();
  }, [identityField]);

  async function continueWithName() {
    const next = name.trim();
    if (!next) {
      setLocalError("Tell us what to call you.");
      inputRef.current?.focus();
      return;
    }
    setLocalError("");
    writeKey(NAME_KEY, next);
    onNamed(next);
    try {
      await onAdvance(2);
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  async function sayYes() {
    setLocalError("");
    writeKey(YES_KEY, "1");
    setSaidYes(true);
    try {
      await onAdvance(2);
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  async function commitIdentity(field: "venture" | "role" | "stage" | "goal", value: string) {
    const next = value.trim();
    if (!next) {
      setLocalError("Give us something to go on.");
      return;
    }
    setLocalError("");
    try {
      if (field === "stage") writeKey(STAGE_KEY, "1");
      await onIdentity(field, next);
      const merged = { ...identity, name: name.trim() || identity.name, [field]: next };
      if (!nextIdentityField(merged)) await onComplete();
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  if (!welcomeDone && !saidYes && (screen <= 1 || !readyName)) {
    return (
      <TypeformShell
        kicker=""
        screen={1}
        total={2}
        title="Welcome... what should we call you?"
        continueLabel="Continue"
        continueDisabled={!readyName}
        showBack={false}
        immersive
        onBack={() => undefined}
        onContinue={() => void continueWithName()}
        saving={saving}
      >
        <VoiceField
          label="What should we call you?"
          value={name}
          maxLength={40}
          placeholder="Your first name"
          onChange={(value) => {
            setName(value);
            setLocalError("");
          }}
          onEnter={() => void continueWithName()}
        />
        {(error || localError) && (
          <p className="entry-error" role="alert">
            {error || localError}
          </p>
        )}
      </TypeformShell>
    );
  }

  if (!welcomeDone && !saidYes) {
    return (
      <TypeformShell
        kicker=""
        screen={2}
        total={2}
        title={`Hi ${name.trim() || "there"}... ready to start?`}
        showBack={false}
        immersive
        hideContinue
        onBack={() => undefined}
        onContinue={() => void sayYes()}
        saving={saving}
      >
        <div className="typeform-choices welcome-choices">
          <button className="typeform-choice yes" type="button" onClick={() => void sayYes()} disabled={saving}>
            Yes
          </button>
          <button className="typeform-choice no" type="button" onClick={onDecline} disabled={saving}>
            No
          </button>
        </div>
        {(error || localError) && (
          <p className="entry-error" role="alert">
            {error || localError}
          </p>
        )}
      </TypeformShell>
    );
  }

  if (identityField === "venture") {
    return (
      <TypeformShell
        kicker=""
        screen={1}
        total={4}
        title={`${name.trim() || "Okay"}... what are you building?`}
        continueLabel="Continue"
        continueDisabled={!draft.venture.trim()}
        showBack={false}
        immersive
        onBack={() => undefined}
        onContinue={() => void commitIdentity("venture", draft.venture)}
        saving={saving}
      >
        <VoiceField
          label="Venture"
          value={draft.venture}
          maxLength={120}
          placeholder="The venture"
          onChange={(value) => setDraft((current) => ({ ...current, venture: value }))}
          onEnter={() => void commitIdentity("venture", draft.venture)}
        />
        {(error || localError) && (
          <p className="entry-error" role="alert">
            {error || localError}
          </p>
        )}
      </TypeformShell>
    );
  }

  if (identityField === "role") {
    return (
      <TypeformShell
        kicker=""
        screen={2}
        total={4}
        title="And what do you do there?"
        continueLabel="Continue"
        continueDisabled={!draft.role.trim()}
        showBack={false}
        immersive
        onBack={() => undefined}
        onContinue={() => void commitIdentity("role", draft.role)}
        saving={saving}
      >
        <VoiceField
          label="Role"
          value={draft.role}
          maxLength={80}
          placeholder="Founder, operator, builder"
          onChange={(value) => setDraft((current) => ({ ...current, role: value }))}
          onEnter={() => void commitIdentity("role", draft.role)}
        />
        {(error || localError) && (
          <p className="entry-error" role="alert">
            {error || localError}
          </p>
        )}
      </TypeformShell>
    );
  }

  if (identityField === "stage") {
    return (
      <TypeformShell
        kicker=""
        screen={3}
        total={4}
        title="Where is it right now?"
        showBack={false}
        immersive
        hideContinue
        onBack={() => undefined}
        onContinue={() => void commitIdentity("stage", draft.stage || "exploring")}
        saving={saving}
      >
        <div className="typeform-choices welcome-choices">
          {STAGES.map((stage) => (
            <button
              key={stage.value}
              className="typeform-choice yes"
              type="button"
              disabled={saving}
              onClick={() => void commitIdentity("stage", stage.value)}
            >
              {stage.label}
            </button>
          ))}
        </div>
        {(error || localError) && (
          <p className="entry-error" role="alert">
            {error || localError}
          </p>
        )}
      </TypeformShell>
    );
  }

  if (identityField === "goal") {
    return (
      <TypeformShell
        kicker=""
        screen={4}
        total={4}
        title="What needs to change?"
        continueLabel="Continue"
        continueDisabled={!draft.goal.trim()}
        showBack={false}
        immersive
        onBack={() => undefined}
        onContinue={() => void commitIdentity("goal", draft.goal)}
        saving={saving}
      >
        <VoiceField
          label="What needs to change?"
          value={draft.goal}
          maxLength={400}
          placeholder="The shift you need"
          multiline
          onChange={(value) => setDraft((current) => ({ ...current, goal: value }))}
        />
        {(error || localError) && (
          <p className="entry-error" role="alert">
            {error || localError}
          </p>
        )}
      </TypeformShell>
    );
  }

  return (
    <TypeformShell
      kicker=""
      screen={4}
      total={4}
      title="Got it."
      continueLabel="Continue"
      showBack={false}
      immersive
      onBack={() => undefined}
      onContinue={() => void onComplete()}
      saving={saving}
    >
      {(error || localError) && (
        <p className="entry-error" role="alert">
          {error || localError}
        </p>
      )}
    </TypeformShell>
  );
}
