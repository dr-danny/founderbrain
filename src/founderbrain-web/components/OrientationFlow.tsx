/**
 * First-run Typeform: name, ready, optional website import, then Founder Brain intake.
 */
import { useState } from "react";
import type { Brain } from "../types";
import { TypeformShell } from "./TypeformShell";
import { VoiceField } from "./VoiceField";
import { GUIDE_STEPS, type GuideStep } from "../guide-intake";

const NAME_KEY = "founderbrain.what-to-call-you";
const YES_KEY = "founderbrain.welcome-yes";
const SITE_KEY = "founderbrain.website-asked";
const STAGE_KEY = "founderbrain.identity-stage-asked";

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

type Proposal = {
  identity?: Record<string, string>;
  customer?: Record<string, string>;
  offer?: Record<string, string>;
  voice?: Record<string, string>;
  track?: "b2b" | "b2c";
};

function nextStep(brain: Brain, track: string | null): GuideStep | null {
  return (
    GUIDE_STEPS.find((step) => {
      if (step.id === "stage" && readKey(STAGE_KEY) === "1") return false;
      return step.empty(brain, track);
    }) ?? null
  );
}

export function OrientationFlow({
  screen,
  saving,
  error,
  welcomeDone,
  brain,
  track,
  siteImportEnabled,
  onNamed,
  onAdvance,
  onComplete,
  onDecline,
  onFill,
  onTrack,
  onImport,
}: {
  screen: number;
  saving: boolean;
  error: string;
  welcomeDone: boolean;
  brain: Brain;
  track: string | null;
  siteImportEnabled: boolean;
  onNamed: (name: string) => void;
  onAdvance: (nextScreen: number) => void | Promise<void>;
  onComplete: () => void | Promise<void>;
  onDecline: () => void;
  onFill: (section: "identity" | "customer" | "offer" | "voice", field: string, value: string) => Promise<void>;
  onTrack: (value: "b2b" | "b2c") => Promise<void>;
  onImport: (url: string) => Promise<{ proposal: Proposal }>;
}) {
  const [name, setName] = useState(() => brain.identity.name.trim() || readKey(NAME_KEY));
  const [localError, setLocalError] = useState("");
  const [saidYes, setSaidYes] = useState(() => welcomeDone || readKey(YES_KEY) === "1");
  const [siteAsked, setSiteAsked] = useState(() => readKey(SITE_KEY) === "1" || readKey(SITE_KEY) === "skip");
  const [wantSite, setWantSite] = useState(readKey(SITE_KEY) === "1");
  const [siteUrl, setSiteUrl] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const readyName = name.trim().length >= 1;
  const step = nextStep(brain, track);
  const locked = saving || busy;

  async function continueWithName() {
    const next = name.trim();
    if (!next) {
      setLocalError("Tell us what to call you.");
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
    writeKey(YES_KEY, "1");
    setSaidYes(true);
    try {
      await onAdvance(2);
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  async function skipSite() {
    writeKey(SITE_KEY, "skip");
    setSiteAsked(true);
    setWantSite(false);
  }

  async function scrapeSite() {
    const url = siteUrl.trim();
    if (!url.startsWith("https://")) {
      setLocalError("Use an https address.");
      return;
    }
    setLocalError("");
    setBusy(true);
    try {
      const result = await onImport(url);
      setProposal(result.proposal);
      writeKey(SITE_KEY, "1");
      setSiteAsked(true);
      setWantSite(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not read that website. We'll ask instead.");
      writeKey(SITE_KEY, "skip");
      setSiteAsked(true);
      setWantSite(false);
    } finally {
      setBusy(false);
    }
  }

  async function applyProposal() {
    if (!proposal) return;
    setBusy(true);
    try {
      for (const [field, value] of Object.entries(proposal.identity ?? {})) {
        if (value) await onFill("identity", field, value);
      }
      for (const [field, value] of Object.entries(proposal.customer ?? {})) {
        if (value) await onFill("customer", field, value);
      }
      for (const [field, value] of Object.entries(proposal.offer ?? {})) {
        if (value) await onFill("offer", field, value);
      }
      for (const [field, value] of Object.entries(proposal.voice ?? {})) {
        if (value) await onFill("voice", field, value);
      }
      if (proposal.track) await onTrack(proposal.track);
      if (proposal.identity?.stage) writeKey(STAGE_KEY, "1");
      setProposal(null);
    } catch {
      setLocalError("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commitStep(stepNow: GuideStep, value: string) {
    const next = value.trim();
    if (!next && !stepNow.optional) {
      setLocalError("Give us something to go on.");
      return;
    }
    setLocalError("");
    try {
      if (stepNow.id === "stage") writeKey(STAGE_KEY, "1");
      if (next) {
        if (stepNow.section === "track") await onTrack(next as "b2b" | "b2c");
        else await onFill(stepNow.section, stepNow.field, next);
      } else if (stepNow.id === "stage") {
        writeKey(STAGE_KEY, "1");
      }
      setDraft("");
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
        saving={locked}
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
        saving={locked}
      >
        <div className="typeform-choices welcome-choices">
          <button className="typeform-choice yes" type="button" onClick={() => void sayYes()} disabled={locked}>
            Yes
          </button>
          <button className="typeform-choice no" type="button" onClick={onDecline} disabled={locked}>
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

  if (!siteAsked) {
    return (
      <TypeformShell
        kicker=""
        screen={1}
        total={2}
        title="Do you have a website?"
        showBack={false}
        immersive
        hideContinue
        onBack={() => undefined}
        onContinue={() => undefined}
        saving={locked}
      >
        <div className="typeform-choices welcome-choices">
          <button
            className="typeform-choice yes"
            type="button"
            disabled={locked}
            onClick={() => {
              writeKey(SITE_KEY, "1");
              setWantSite(true);
              setSiteAsked(true);
            }}
          >
            Yes
          </button>
          <button className="typeform-choice no" type="button" disabled={locked} onClick={() => void skipSite()}>
            No
          </button>
        </div>
      </TypeformShell>
    );
  }

  if (wantSite && !proposal && readKey(SITE_KEY) === "1") {
    return (
      <TypeformShell
        kicker=""
        screen={1}
        total={2}
        title={busy ? "Reading your site..." : "What's the address?"}
        continueLabel={busy ? "Working" : "Continue"}
        continueDisabled={busy || !siteUrl.trim()}
        showBack={false}
        immersive
        onBack={() => undefined}
        onContinue={() => void scrapeSite()}
        saving={locked}
      >
        <VoiceField
          label="Website"
          value={siteUrl}
          maxLength={200}
          placeholder="https://your-site.com"
          onChange={setSiteUrl}
          onEnter={() => void scrapeSite()}
        />
        {!siteImportEnabled ? (
          <p className="entry-lede typeform-lede">If we cannot read it, we will just ask you instead.</p>
        ) : null}
        {(error || localError) && (
          <p className="entry-error" role="alert">
            {error || localError}
          </p>
        )}
      </TypeformShell>
    );
  }

  if (proposal) {
    const lines = [
      proposal.identity?.venture,
      proposal.offer?.description,
      proposal.customer?.segment,
    ].filter(Boolean) as string[];
    return (
      <TypeformShell
        kicker=""
        screen={2}
        total={2}
        title="Does this look right?"
        showBack={false}
        immersive
        hideContinue
        onBack={() => undefined}
        onContinue={() => void applyProposal()}
        saving={locked}
      >
        <ul className="typeform-bullets">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="typeform-choices welcome-choices">
          <button className="typeform-choice yes" type="button" disabled={locked} onClick={() => void applyProposal()}>
            Yes
          </button>
          <button
            className="typeform-choice no"
            type="button"
            disabled={locked}
            onClick={() => {
              setProposal(null);
              writeKey(SITE_KEY, "skip");
              setWantSite(false);
            }}
          >
            No, I'll type it
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

  if (!step) {
    return (
      <TypeformShell
        kicker=""
        screen={1}
        total={1}
        title="Got it."
        continueLabel="Continue"
        showBack={false}
        immersive
        onBack={() => undefined}
        onContinue={() => void onComplete()}
        saving={locked}
      >
        {(error || localError) && (
          <p className="entry-error" role="alert">
            {error || localError}
          </p>
        )}
      </TypeformShell>
    );
  }

  if (step.kind === "choices") {
    return (
      <TypeformShell
        kicker=""
        screen={1}
        total={1}
        title={step.title}
        showBack={false}
        immersive
        hideContinue
        onBack={() => undefined}
        onContinue={() => undefined}
        saving={locked}
      >
        <div className="typeform-choices welcome-choices">
          {step.choices?.map((choice) => (
            <button
              key={choice.value}
              className="typeform-choice yes"
              type="button"
              disabled={locked}
              onClick={() => void commitStep(step, choice.value)}
            >
              {choice.label}
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

  return (
    <TypeformShell
      kicker=""
      screen={1}
      total={1}
      title={step.title}
      continueLabel={step.optional ? "Skip or continue" : "Continue"}
      continueDisabled={!step.optional && !draft.trim()}
      showBack={false}
      immersive
      onBack={() => undefined}
      onContinue={() => void commitStep(step, draft)}
      saving={locked}
    >
      <VoiceField
        label={step.title}
        value={draft}
        maxLength={step.kind === "long" ? 400 : 160}
        placeholder={step.placeholder ?? ""}
        multiline={step.kind === "long"}
        onChange={setDraft}
        onEnter={step.kind === "long" ? undefined : () => void commitStep(step, draft)}
      />
      {(error || localError) && (
        <p className="entry-error" role="alert">
          {error || localError}
        </p>
      )}
    </TypeformShell>
  );
}
