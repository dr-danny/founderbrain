/**
 * Later Typeform chapters: content (30 pieces / bottleneck / workflow) and outreach.
 * Maps onto existing missions without a second product surface.
 */
import { useEffect, useMemo, useState } from "react";
import type {
  ContentAnswers,
  FounderTrack,
  GhlAnswers,
  OrientationPatch,
  OrientationState,
  OutreachAnswers,
} from "../../founderbrain-shared/orientation";
import type { UsageResponse } from "../types";
import {
  contentScreens,
  contentTotal,
  ghlScreens,
  ghlTotal,
  outreachScreens,
  outreachTotal,
  type TypeformScreen,
} from "../orientation-copy";
import { TypeformShell } from "./TypeformShell";

type ChapterProps = {
  orientation: OrientationState;
  saving: boolean;
  error: string;
  onPatch: (patch: OrientationPatch) => Promise<void>;
  onFinished: () => void;
};

function ScreenBody({
  screen,
  textValue,
  onText,
  confirmValue,
  onConfirm,
}: {
  screen: TypeformScreen;
  textValue: string;
  onText: (value: string) => void;
  confirmValue: boolean;
  onConfirm: (value: boolean) => void;
}) {
  return (
    <>
      {screen.body.map((line) => (
        <p key={line} className="entry-lede typeform-lede">
          {line}
        </p>
      ))}
      {screen.confirm ? (
        <label className="typeform-confirm">
          <input
            type="checkbox"
            checked={confirmValue}
            onChange={(event) => onConfirm(event.target.checked)}
          />
          <span>{screen.confirm.label}</span>
        </label>
      ) : null}
      {screen.textField ? (
        <label className="typeform-field">
          <span>{screen.textField.label}</span>
          <input
            type="text"
            value={textValue}
            placeholder={screen.textField.placeholder}
            onChange={(event) => onText(event.target.value)}
            maxLength={500}
          />
        </label>
      ) : null}
      {screen.externalLink ? (
        <a
          className="typeform-external"
          href={screen.externalLink.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {screen.externalLink.label}
        </a>
      ) : null}
    </>
  );
}

export function ContentChapter({ orientation, saving, error, onPatch, onFinished }: ChapterProps) {
  const screens = useMemo(() => contentScreens(orientation.track), [orientation.track]);
  const screen = Math.min(Math.max(orientation.contentScreen, 1), contentTotal);
  const current = screens[screen - 1]!;
  const [text, setText] = useState(orientation.contentAnswers.bottleneck ?? "");
  const [confirm, setConfirm] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setText(orientation.contentAnswers.bottleneck ?? "");
    if (current.confirm) {
      const key = current.confirm.key as keyof ContentAnswers;
      setConfirm(Boolean(orientation.contentAnswers[key]));
    } else setConfirm(false);
  }, [screen, orientation.contentAnswers, current.confirm]);

  const needsConfirm = Boolean(current.confirm);
  const needsText = Boolean(current.textField);
  const isChoice = Boolean(current.choices?.length);
  const continueDisabled = (needsConfirm && !confirm) || (needsText && text.trim().length < 2);

  async function persist(patch: OrientationPatch) {
    setLocalError("");
    try {
      await onPatch(patch);
    } catch {
      setLocalError("Could not save progress. Try again.");
      throw new Error("save_failed");
    }
  }

  async function continueForward() {
    try {
      if (isChoice) return;
      const answers: ContentAnswers = { ...orientation.contentAnswers };
      if (current.confirm) {
        (answers as Record<string, boolean | string | undefined>)[current.confirm.key] = confirm;
      }
      if (current.textField) {
        (answers as Record<string, boolean | string | undefined>)[current.textField.key] =
          text.trim();
      }
      if (screen >= contentTotal) {
        await persist({
          contentScreen: contentTotal,
          contentComplete: true,
          contentAnswers: answers,
        });
        onFinished();
        return;
      }
      await persist({ contentScreen: screen + 1, contentAnswers: answers });
    } catch {
      /* localError set */
    }
  }

  async function choose(value: string) {
    try {
      if (current.id === "track") {
        await persist({ track: value as FounderTrack, contentScreen: screen + 1 });
        return;
      }
      if (current.id === "workflow") {
        await persist({
          contentScreen: contentTotal,
          contentComplete: true,
          contentAnswers: { ...orientation.contentAnswers, workflow: value },
        });
        onFinished();
        return;
      }
      await persist({
        contentScreen: screen + 1,
        contentAnswers: { ...orientation.contentAnswers, workflow: value },
      });
    } catch {
      /* localError set */
    }
  }

  async function goBack() {
    if (screen <= 1) return;
    try {
      await persist({ contentScreen: screen - 1 });
    } catch {
      /* localError set */
    }
  }

  return (
    <TypeformShell
      kicker="Atlanta prep · Content chapter"
      screen={screen}
      total={contentTotal}
      title={current.title}
      continueLabel="Continue"
      hideContinue={isChoice}
      continueDisabled={continueDisabled}
      showBack={screen > 1}
      onBack={() => void goBack()}
      onContinue={() => void continueForward()}
      saving={saving}
    >
      <ScreenBody
        screen={current}
        textValue={text}
        onText={setText}
        confirmValue={confirm}
        onConfirm={setConfirm}
      />
      {isChoice ? (
        <p className="entry-lede typeform-lede">Choose below.</p>
      ) : null}
      {current.choices ? (
        <div className="typeform-choices">
          {current.choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className="typeform-choice"
              disabled={saving}
              onClick={() => void choose(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
      {(error || localError) && (
        <p className="entry-error" role="alert">
          {error || localError}
        </p>
      )}
    </TypeformShell>
  );
}

export function OutreachChapter({ orientation, saving, error, onPatch, onFinished }: ChapterProps) {
  const screens = useMemo(() => outreachScreens(orientation.track), [orientation.track]);
  const screen = Math.min(Math.max(orientation.outreachScreen, 1), outreachTotal);
  const current = screens[screen - 1]!;
  const [confirm, setConfirm] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (current.confirm) {
      const key = current.confirm.key as keyof OutreachAnswers;
      setConfirm(Boolean(orientation.outreachAnswers[key]));
    } else setConfirm(false);
  }, [screen, orientation.outreachAnswers, current.confirm]);

  const continueDisabled = Boolean(current.confirm) && !confirm;

  async function persist(patch: OrientationPatch) {
    setLocalError("");
    try {
      await onPatch(patch);
    } catch {
      setLocalError("Could not save progress. Try again.");
      throw new Error("save_failed");
    }
  }

  async function continueForward() {
    try {
      const answers: OutreachAnswers = { ...orientation.outreachAnswers };
      if (current.confirm) {
        (answers as Record<string, boolean | undefined>)[current.confirm.key] = confirm;
      }
      if (screen >= outreachTotal) {
        await persist({
          outreachScreen: outreachTotal,
          outreachComplete: true,
          outreachAnswers: answers,
        });
        onFinished();
        return;
      }
      await persist({ outreachScreen: screen + 1, outreachAnswers: answers });
    } catch {
      /* localError set */
    }
  }

  async function goBack() {
    if (screen <= 1) return;
    try {
      await persist({ outreachScreen: screen - 1 });
    } catch {
      /* localError set */
    }
  }

  return (
    <TypeformShell
      kicker="Atlanta prep · Outreach chapter"
      screen={screen}
      total={outreachTotal}
      title={current.title}
      continueLabel={current.continueLabel ?? "Continue"}
      continueDisabled={continueDisabled}
      showBack={screen > 1}
      onBack={() => void goBack()}
      onContinue={() => void continueForward()}
      saving={saving}
    >
      <ScreenBody
        screen={current}
        textValue=""
        onText={() => undefined}
        confirmValue={confirm}
        onConfirm={setConfirm}
      />
      {(error || localError) && (
        <p className="entry-error" role="alert">
          {error || localError}
        </p>
      )}
    </TypeformShell>
  );
}

const money = (microUsd: number): string => {
  const usd = microUsd / 1_000_000;
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
};

/** Metered price lines for the pre-connect summary. Text only: matches the Typeform body. */
function UsagePriceLines({ usage }: { usage: UsageResponse }) {
  const ai = usage.ai;
  const fc = usage.firecrawl;
  if (ai.events === 0 && fc.scrapes === 0) {
    return (
      <p className="entry-lede typeform-lede">
        Nothing metered yet. Your price stays $0.00 until you use AI or import a website.
      </p>
    );
  }
  return (
    <div>
      {ai.events > 0 ? (
        <p className="entry-lede typeform-lede">
          AI: {ai.inputTokens.toLocaleString()} tokens in, {ai.outputTokens.toLocaleString()} out
          across {ai.events} run{ai.events === 1 ? "" : "s"} → {money(ai.priceMicroUsd)}
        </p>
      ) : null}
      {fc.scrapes > 0 ? (
        <p className="entry-lede typeform-lede">
          Pages read from your website: {fc.credits.toLocaleString()} credit
          {fc.credits === 1 ? "" : "s"} across {fc.scrapes} import{fc.scrapes === 1 ? "" : "s"} →{" "}
          {money(fc.priceMicroUsd)}
        </p>
      ) : null}
      <p className="entry-lede typeform-lede">
        <strong>Final price: {money(usage.totalMicroUsd)}</strong>
      </p>
    </div>
  );
}

function UsagePrice({ loadUsage }: { loadUsage?: () => Promise<UsageResponse> }) {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!loadUsage) {
      setFailed(true);
      return;
    }
    void loadUsage().then(
      (value) => {
        if (alive) setUsage(value);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [loadUsage]);
  if (failed) {
    return (
      <p className="entry-lede typeform-lede">
        Price unavailable right now. It still carries with your account when you sync.
      </p>
    );
  }
  if (!usage) return <p className="entry-lede typeform-lede">Tallying your usage…</p>;
  return <UsagePriceLines usage={usage} />;
}

export function GhlChapter({
  orientation,
  saving,
  error,
  onPatch,
  onFinished,
  connectEnabled = false,
  connecting = false,
  onConnect,
  loadUsage,
  onGhlPush,
}: ChapterProps & {
  connectEnabled?: boolean;
  connecting?: boolean;
  onGhlPush?: () => Promise<{ snapshot: string; firstPack: string; pushed: string[]; skipped: string[]; proven: boolean }>;
  onConnect?: () => void | Promise<void>;
  loadUsage?: () => Promise<UsageResponse>;
}) {
  const screens = useMemo(
    () => ghlScreens(orientation.ghlAnswers.hasAccount),
    [orientation.ghlAnswers.hasAccount],
  );
  const screen = Math.min(Math.max(orientation.ghlScreen, 1), ghlTotal);
  const current = screens[screen - 1]!;
  const [localError, setLocalError] = useState("");
  const isChoice = Boolean(current.choices?.length);
  const isConnect = current.id === "ghl-connect";
  const connected = orientation.ghlAnswers.connected === true;
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [pushResult, setPushResult] = useState<{ snapshot: string; firstPack: string; pushed: string[]; skipped: string[]; proven: boolean } | null>(null);
  const [pushError, setPushError] = useState("");

  async function persist(patch: OrientationPatch) {
    setLocalError("");
    try {
      await onPatch(patch);
    } catch {
      setLocalError("Could not save progress. Try again.");
      throw new Error("save_failed");
    }
  }

  async function continueForward() {
    try {
      if (isChoice) return;
      if (screen >= ghlTotal) {
        await persist({
          ghlScreen: ghlTotal,
          ghlComplete: true,
          ghlAnswers: orientation.ghlAnswers,
        });
        onFinished();
        return;
      }
      await persist({ ghlScreen: screen + 1, ghlAnswers: orientation.ghlAnswers });
    } catch {
      /* localError set */
    }
  }

  async function choose(value: string) {
    try {
      const answers: GhlAnswers = {
        ...orientation.ghlAnswers,
        hasAccount: value === "yes",
      };
      await persist({ ghlScreen: screen + 1, ghlAnswers: answers });
    } catch {
      /* localError set */
    }
  }

  async function goBack() {
    if (screen <= 1) return;
    try {
      await persist({ ghlScreen: screen - 1 });
    } catch {
      /* localError set */
    }
  }

  return (
    <TypeformShell
      kicker="Atlanta prep · GoHighLevel"
      screen={screen}
      total={ghlTotal}
      title={current.title}
      continueLabel={
        isConnect
          ? connected
            ? "Back to Home"
            : connectEnabled
              ? "Connect GoHighLevel"
              : "Connect is not configured"
          : "Continue"
      }
      hideContinue={isChoice}
      continueDisabled={(isConnect && !connected && !connectEnabled)}
      showBack={screen > 1}
      onBack={() => void goBack()}
      onContinue={() => {
        if (isConnect && !connected && onConnect) {
          void onConnect();
          return;
        }
        void continueForward();
      }}
      saving={saving || connecting}
    >
      <ScreenBody
        screen={current}
        textValue=""
        onText={() => undefined}
        confirmValue={false}
        onConfirm={() => undefined}
      />
      {current.usage ? <UsagePrice loadUsage={loadUsage} /> : null}
      {isChoice ? (
        <p className="entry-lede typeform-lede">Choose below.</p>
      ) : null}
      {isConnect && connected ? (
        <p className="entry-lede typeform-lede">Connected. You can leave this chapter.</p>
      ) : null}
      {isConnect && connected && !pushed ? (
        <div className="mission-save-row">
          <button
            type="button"
            className="typeform-external"
            onClick={() => {
              setPushing(true);
              setPushError("");
              void (onGhlPush?.() ?? Promise.reject(new Error("unavailable")))
                .then((result) => {
                  setPushResult(result);
                  setPushed(true);
                })
                .catch((e: unknown) => {
                  setPushing(false);
                  setPushError(String(e instanceof Error ? e.message : e).slice(0, 200));
                });
            }}
            disabled={pushing || saving}
          >
            {pushing ? "Writing your copy into GoHighLevel…" : "Fill my workflow copy"}
          </button>
        </div>
      ) : null}
      {pushResult ? (
        <p className="entry-lede typeform-lede">
          Snapshot {pushResult.snapshot} · first pack {pushResult.firstPack} · {pushResult.pushed.length} values written
          {pushResult.skipped.length ? `, ${pushResult.skipped.length} already had your words` : ""} · verified in
          GoHighLevel: {pushResult.proven ? "yes" : "unverified"}
        </p>
      ) : null}
      {pushError ? (
        <p className="entry-error" role="alert">
          {pushError}
        </p>
      ) : null}
      {current.choices ? (
        <div className="typeform-choices">
          {current.choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className="typeform-choice"
              disabled={saving}
              onClick={() => void choose(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
      {(error || localError) && (
        <p className="entry-error" role="alert">
          {error || localError}
        </p>
      )}
    </TypeformShell>
  );
}
