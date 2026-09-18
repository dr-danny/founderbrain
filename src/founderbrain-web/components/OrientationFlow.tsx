/**
 * First-run Typeform: name, ready, optional website, then Founder Brain intake.
 * Cursor-based so Back can reopen earlier answers.
 */
import { useEffect, useState } from "react";
import type { Brain } from "../types";
import { TypeformShell } from "./TypeformShell";
import { VoiceField } from "./VoiceField";
import { GUIDE_STEPS, readStepValue, type GuideStep } from "../guide-intake";

const NAME_KEY = "founderbrain.what-to-call-you";
const YES_KEY = "founderbrain.welcome-yes";
const SITE_KEY = "founderbrain.website-asked";
const STAGE_KEY = "founderbrain.identity-stage-asked";
const CURSOR_KEY = "founderbrain.guide-cursor";

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

function sequence(includeUrl: boolean): string[] {
  const items = ["name", "ready", "site-ask"];
  if (includeUrl) items.push("site-url");
  for (const step of GUIDE_STEPS) items.push(`g:${step.id}`);
  return items;
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
  const [wantSite, setWantSite] = useState(readKey(SITE_KEY) === "1");
  const [siteUrl, setSiteUrl] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const stored = Number(readKey(CURSOR_KEY));
    if (Number.isFinite(stored) && stored >= 0) return stored;
    if (welcomeDone || readKey(YES_KEY) === "1") return 2;
    return screen <= 1 ? 0 : 1;
  });

  const includeUrl = wantSite || readKey(SITE_KEY) === "1";
  const seq = sequence(includeUrl);
  const total = seq.length;
  const safe = Math.min(Math.max(cursor, 0), Math.max(total - 1, 0));
  const current = seq[safe] ?? "name";
  const guideId = current.startsWith("g:") ? current.slice(2) : "";
  const step = GUIDE_STEPS.find((item) => item.id === guideId) ?? null;
  const locked = saving || busy;
  const showBack = safe > 0;

  useEffect(() => {
    writeKey(CURSOR_KEY, String(safe));
  }, [safe]);

  useEffect(() => {
    if (!step) {
      setDraft("");
      return;
    }
    setDraft(readStepValue(brain, track, step));
  }, [step?.id]);

  function moveTo(next: number) {
    setLocalError("");
    setProposal(null);
    const clamped = Math.min(Math.max(next, 0), Math.max(seq.length - 1, 0));
    writeKey(CURSOR_KEY, String(clamped));
    setCursor(clamped);
  }

  function goBack() {
    moveTo(safe - 1);
  }

  function goNext() {
    if (safe >= seq.length - 1) {
      void onComplete();
      return;
    }
    moveTo(safe + 1);
  }

  async function continueWithName() {
    const next = name.trim();
    if (!next) {
      setLocalError("Tell us what to call you.");
      return;
    }
    writeKey(NAME_KEY, next);
    onNamed(next);
    try {
      await onAdvance(2);
      goNext();
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  async function sayYes() {
    writeKey(YES_KEY, "1");
    setSaidYes(true);
    try {
      await onAdvance(2);
      goNext();
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  async function scrapeSite() {
    const url = siteUrl.trim();
    if (!url.startsWith("https://")) {
      setLocalError("Use an https address.");
      return;
    }
    if (!siteImportEnabled) {
      writeKey(SITE_KEY, "skip");
      setWantSite(false);
      goNext();
      return;
    }
    setBusy(true);
    setLocalError("");
    try {
      const result = await onImport(url);
      setProposal(result.proposal);
      writeKey(SITE_KEY, "1");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not read that website. We'll ask instead.");
      writeKey(SITE_KEY, "skip");
      setWantSite(false);
      goNext();
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
      goNext();
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
    try {
      if (stepNow.id === "stage") writeKey(STAGE_KEY, "1");
      if (next) {
        if (stepNow.section === "track") await onTrack(next as "b2b" | "b2c");
        else await onFill(stepNow.section, stepNow.field, next);
      }
      goNext();
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  const frame = {
    screen: safe + 1,
    total,
    showBack,
    onBack: goBack,
    saving: locked,
  };

  if (current === "name") {
    return (
      <TypeformShell
        kicker=""
        title="Welcome... what should we call you?"
        continueLabel="Continue"
        continueDisabled={!name.trim()}
        immersive
        onContinue={() => void continueWithName()}
        {...frame}
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

  if (current === "ready") {
    return (
      <TypeformShell
        kicker=""
        title={`Hi ${name.trim() || "there"}... ready to start?`}
        immersive
        hideContinue
        onContinue={() => void sayYes()}
        {...frame}
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

  if (current === "site-ask") {
    return (
      <TypeformShell
        kicker=""
        title="Do you have a website?"
        immersive
        hideContinue
        onContinue={() => undefined}
        {...frame}
      >
        <div className="typeform-choices welcome-choices">
          <button
            className="typeform-choice yes"
            type="button"
            disabled={locked}
            onClick={() => {
              writeKey(SITE_KEY, "1");
              setWantSite(true);
              moveTo(safe + 1);
            }}
          >
            Yes
          </button>
          <button
            className="typeform-choice no"
            type="button"
            disabled={locked}
            onClick={() => {
              writeKey(SITE_KEY, "skip");
              setWantSite(false);
              moveTo(safe + 1);
            }}
          >
            No
          </button>
        </div>
      </TypeformShell>
    );
  }

  if (current === "site-url" && proposal) {
    const lines = [proposal.identity?.venture, proposal.offer?.description, proposal.customer?.segment].filter(
      Boolean,
    ) as string[];
    return (
      <TypeformShell
        kicker=""
        title="Does this look right?"
        immersive
        hideContinue
        onContinue={() => void applyProposal()}
        {...frame}
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

  if (current === "site-url") {
    return (
      <TypeformShell
        kicker=""
        title={busy ? "Reading your site..." : "What's the address?"}
        continueLabel={busy ? "Working" : "Continue"}
        continueDisabled={busy || !siteUrl.trim()}
        immersive
        onContinue={() => void scrapeSite()}
        {...frame}
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

  if (!step) {
    return (
      <TypeformShell
        kicker=""
        title="Got it."
        continueLabel="Continue"
        immersive
        onContinue={() => void onComplete()}
        {...frame}
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
        title={step.title}
        immersive
        hideContinue
        onContinue={() => undefined}
        {...frame}
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
      title={step.title}
      continueLabel={step.optional ? "Skip or continue" : "Continue"}
      continueDisabled={!step.optional && !draft.trim()}
      immersive
      onContinue={() => void commitStep(step, draft)}
      {...frame}
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
