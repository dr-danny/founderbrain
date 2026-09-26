/**
 * First-run Typeform: name, ready, optional website, then Founder Brain intake.
 * Cursor-based so Back can reopen earlier answers.
 */
import { useEffect, useRef, useState } from "react";
import type { Brain } from "../types";
import { TypeformShell } from "./TypeformShell";
import { VoiceField } from "./VoiceField";
import {
  GUIDE_STEPS,
  nextGuideStep,
  readStepValue,
  type GuideStep,
} from "../guide-intake";
import { guideSequence, resolveInitialCursor } from "../lib/intake-navigation";

const NAME_KEY_BASE = "founderbrain.what-to-call-you";
const YES_KEY_BASE = "founderbrain.welcome-yes";
const SITE_KEY_BASE = "founderbrain.website-asked";
const CURSOR_KEY_BASE = "founderbrain.guide-cursor";

/**
 * Session-storage keys must be scoped per workspace: two workspaces (or two
 * users sharing a browser profile) previously shared one global cursor/name/
 * site key, so switching workspace could resume mid-guide with the wrong
 * answers. `workspaceKey` should be the current `state.workspaceId`.
 */
function scopedKey(base: string, workspaceKey: string): string {
  return workspaceKey ? `${base}::${workspaceKey}` : base;
}

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
  logoUrl?: string;
};

function normalizeSiteUrl(raw: string): string {
  let value = raw.trim();
  if (!value || value === "https://" || value === "http://") return "";
  value = value.replace(/^https?:\/\//i, "");
  return `https://${value}`;
}

function ReadingSite() {
  const lines = [
    "Reading your site...",
    "Finding what you sell...",
    "Looking for who you serve...",
    "Pulling the story together...",
  ];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((n) => (n + 1) % lines.length), 1600);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="site-reading" role="status">
      <div className="site-reading-ring" aria-hidden="true" />
      <p className="site-reading-line">{lines[index]}</p>
    </div>
  );
}

const sequence = guideSequence;

export function OrientationFlow({
  screen,
  saving,
  error,
  welcomeDone,
  brain,
  track,
  siteImportEnabled,
  workspaceKey,
  onNamed,
  onAdvance,
  onComplete,
  onDecline,
  onFill,
  onApplyIntake,
  onTrack,
  onImport,
  onTranscribe,
}: {
  screen: number;
  saving: boolean;
  error: string;
  welcomeDone: boolean;
  brain: Brain;
  track: string | null;
  siteImportEnabled: boolean;
  /** Scopes sessionStorage keys (name/yes/site/cursor) so switching workspace
   *  never resumes with another workspace's saved progress. Pass `state.workspaceId`. */
  workspaceKey: string;
  onNamed: (name: string) => void;
  onAdvance: (nextScreen: number) => void | Promise<void>;
  onComplete: () => void | Promise<void>;
  onDecline: () => void;
  /** Resolves with the freshly saved Brain (not the pre-save one) so callers
   *  right after a save never act on a stale closed-over `brain` prop. */
  onFill: (section: "identity" | "customer" | "offer" | "voice", field: string, value: string) => Promise<Brain>;
  onApplyIntake: (proposal: Proposal) => Promise<void>;
  onTrack: (value: "b2b" | "b2c") => Promise<void>;
  onImport: (url: string) => Promise<{ proposal: Proposal; logoUrl?: string }>;
  onTranscribe?: (blob: Blob, seconds: number) => Promise<string>;
}) {
  const NAME_KEY = scopedKey(NAME_KEY_BASE, workspaceKey);
  const YES_KEY = scopedKey(YES_KEY_BASE, workspaceKey);
  const SITE_KEY = scopedKey(SITE_KEY_BASE, workspaceKey);
  const CURSOR_KEY = scopedKey(CURSOR_KEY_BASE, workspaceKey);

  const [name, setName] = useState(() => brain.identity.name.trim() || readKey(NAME_KEY));
  const [localError, setLocalError] = useState("");
  const [wantSite, setWantSite] = useState(readKey(SITE_KEY) === "1");
  const [siteUrl, setSiteUrl] = useState("https://");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [cursor, setCursor] = useState(() =>
    resolveInitialCursor({
      storedCursorRaw: readKey(CURSOR_KEY),
      welcomeDone,
      yesAccepted: readKey(YES_KEY) === "1",
      screen,
      includeUrl: wantSite || readKey(SITE_KEY) === "1",
      brain,
      track,
    }),
  );

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

  // The stored cursor must never sit on a filled guide step while an earlier
  // guide step is still empty: that state only arises from a stale cursor
  // (workspace deleted, storage reset, or an import failure that shifted the
  // sequence) and produced a silent intake loop (#66). Snap back to the first
  // empty step instead of letting Continue write and bounce forever.
  const clampedRef = useRef(false);
  useEffect(() => {
    if (clampedRef.current) return;
    clampedRef.current = true;
    const empty = nextGuideStep(brain, track);
    if (!empty || !step) return;
    if (empty.id === step.id) return;
    const emptyIdx = seq.indexOf(`g:${empty.id}`);
    if (emptyIdx >= 0 && emptyIdx < safe) {
      moveTo(emptyIdx);
    }
    // Run once on mount: brain and cursor are read before first paint.
  }, []);

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

  /** Leave the intake when the guide is complete; otherwise go to the first
   *  empty step instead of silently completing a partial guide (#66). */
  async function finishOrRoute(latestBrain: Brain = brain) {
    const empty = nextGuideStep(latestBrain, track);
    if (!empty) {
      if (submitting.current) return;
      submitting.current = true;
      setBusy(true);
      try { await onComplete(); }
      catch { setLocalError("Could not finish setup. Your answers are saved. Try again."); }
      finally { submitting.current = false; setBusy(false); }
      return;
    }
    const emptyIdx = seq.indexOf(`g:${empty.id}`);
    if (emptyIdx >= 0) {
      moveTo(emptyIdx);
      return;
    }
    // Unreachable step (should not happen: the sequence holds every guide step).
    setLocalError("A few answers are still missing. Continue to fill them in.");
  }

  // `latestBrain` lets the very last commitStep hand over the just-saved Brain
  // instead of the `brain` prop, which is still the pre-save value until the
  // parent re-renders (#final-step-stale-brain).
  function goNext(latestBrain: Brain = brain) {
    if (safe >= seq.length - 1) {
      finishOrRoute(latestBrain);
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
    try {
      await onAdvance(2);
      goNext();
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  async function scrapeSite() {
    const url = normalizeSiteUrl(siteUrl);
    if (!url) {
      setLocalError("Add the rest of the address.");
      return;
    }
    if (!siteImportEnabled) {
      writeKey(SITE_KEY, "skip");
      setWantSite(false);
      // Dropping site-url shifts every later index; land on venture explicitly
      // so the venture question is never skipped (#66).
      moveTo(sequence(false).indexOf("g:venture"));
      return;
    }
    setBusy(true);
    setLocalError("");
    try {
      const result = await onImport(url);
      setProposal({ ...result.proposal, logoUrl: result.logoUrl });
      writeKey(SITE_KEY, "1");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not read that website. We'll ask instead.");
      writeKey(SITE_KEY, "skip");
      setWantSite(false);
      // Same index shift as the disabled-import path: never skip venture (#66).
      moveTo(sequence(false).indexOf("g:venture"));
    } finally {
      setBusy(false);
    }
  }

  async function applyProposal() {
    if (!proposal) return;
    setBusy(true);
    try {
      await onApplyIntake(proposal);
      if (proposal.track) await onTrack(proposal.track);
      setProposal(null);
      goNext();
    } catch {
      setLocalError("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commitStep(stepNow: GuideStep, value: string) {
    if (locked || submitting.current) return;
    const next = value.trim();
    if (!next && !stepNow.optional) {
      setLocalError("Give us something to go on.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      // Track fresh state as we go: onFill resolves with the Brain the server
      // actually saved, which is the only reliable state to route the very
      // last step against (the `brain` prop can still be one save behind).
      let latestBrain = brain;
      // Empty optional answers must also save, so clearing a prior answer sticks.
      if (next || stepNow.optional) {
        if (stepNow.section === "track") await onTrack(next as "b2b" | "b2c");
        else latestBrain = await onFill(stepNow.section, stepNow.field, next);
      }
      goNext(latestBrain);
    } catch {
      setLocalError("Could not save. Try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
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
          serverTranscribe={onTranscribe}
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
    const rows = [
      ["Business", proposal.identity?.venture],
      ["Sells", proposal.offer?.description],
      ["Buyer", proposal.customer?.segment],
      ["Problem", proposal.customer?.problem],
      ["Price", proposal.offer?.price],
    ].filter((row): row is [string, string] => Boolean(row[1]));
    return (
      <TypeformShell
        kicker=""
        title="Does this look right?"
        immersive
        hideContinue
        onContinue={() => void applyProposal()}
        {...frame}
      >
        <article className="site-card">
          {proposal.logoUrl ? (
            <img className="site-card-logo" src={proposal.logoUrl} alt="" />
          ) : (
            <div className="site-card-logo fallback" aria-hidden="true">
              {(proposal.identity?.venture || "B").slice(0, 1)}
            </div>
          )}
          <div className="site-card-body">
            <h2>{proposal.identity?.venture || "Your business"}</h2>
            <dl>
              {rows.map(([label, value]) => (
                <div key={label} className="site-card-row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </article>
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
        title="What's the address?"
        continueLabel="Continue"
        continueDisabled={busy || !normalizeSiteUrl(siteUrl)}
        immersive
        onContinue={() => void scrapeSite()}
        {...frame}
      >
        {busy ? (
          <ReadingSite />
        ) : (
          <VoiceField
            label="Website"
            value={siteUrl}
            maxLength={200}
            placeholder="your-site.com"
            serverTranscribe={onTranscribe}
            onChange={(value) => {
              if (value.startsWith("https://") || value.startsWith("http://")) setSiteUrl(value);
              else setSiteUrl(`https://${value.replace(/^\/+/, "")}`);
            }}
            onEnter={() => void scrapeSite()}
          />
        )}
        {!siteImportEnabled && !busy ? (
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
    // The explicit final confirmation also handles returning founders whose
    // answers are saved but whose first-login completion flag never persisted.
    const guideComplete = nextGuideStep(brain, track) === null;
    if (guideComplete && !welcomeDone) {
      return (
        <TypeformShell
          kicker=""
          title="Your answers are saved. Continue..."
          continueLabel="Continue"
          immersive
          onContinue={() => void finishOrRoute()}
          {...frame}
        >
          <p className="entry-lede typeform-lede">Nothing else is needed. Continue to finish setting up.</p>
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
        title="Got it."
        continueLabel="Continue"
        immersive
        onContinue={() => finishOrRoute()}
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
    // Template PR #8: the track is confirmed from who pays, never asked cold.
    const buyer = step.id === "track" ? brain.customer.segment.trim() : "";
    const title =
      step.id === "track" && buyer
        ? `You said "${buyer}" pays you. Sell to other businesses, or individual consumers?`
        : step.title;
    return (
      <TypeformShell
        kicker=""
        title={title}
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
        serverTranscribe={onTranscribe}
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
