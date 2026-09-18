/**
 * First-login: ask what to call them, then Yes continues / No signs out.
 */
import { useEffect, useRef, useState } from "react";
import { TypeformShell } from "./TypeformShell";

const NAME_KEY = "founderbrain.what-to-call-you";

function readStoredName(): string {
  try {
    return sessionStorage.getItem(NAME_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function storeName(name: string) {
  try {
    sessionStorage.setItem(NAME_KEY, name);
  } catch {
    /* private mode */
  }
}

export function OrientationFlow({
  screen,
  saving,
  error,
  knownName = "",
  onNamed,
  onAdvance,
  onComplete,
  onDecline,
}: {
  screen: number;
  saving: boolean;
  error: string;
  knownName?: string;
  onNamed: (name: string) => void;
  onAdvance: (nextScreen: number) => void | Promise<void>;
  onComplete: () => void | Promise<void>;
  onDecline: () => void;
}) {
  const step = screen > 2 ? 1 : Math.min(Math.max(screen, 1), 2);
  const [name, setName] = useState(() => knownName.trim() || readStoredName());
  const [localError, setLocalError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = name.trim().length >= 1;

  useEffect(() => {
    if (step === 1) inputRef.current?.focus();
  }, [step]);

  async function continueWithName() {
    const next = name.trim();
    if (!next) {
      setLocalError("Tell us what to call you.");
      inputRef.current?.focus();
      return;
    }
    setLocalError("");
    storeName(next);
    onNamed(next);
    try {
      await onAdvance(2);
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  async function sayYes() {
    setLocalError("");
    try {
      await onComplete();
    } catch {
      setLocalError("Could not save. Try again.");
    }
  }

  if (step === 1) {
    return (
      <TypeformShell
        kicker=""
        screen={1}
        total={2}
        title="Welcome... what should we call you?"
        continueLabel="Continue"
        continueDisabled={!ready}
        showBack={false}
        immersive
        onBack={() => undefined}
        onContinue={() => void continueWithName()}
        saving={saving}
      >
        <label className="typeform-name">
          <span className="visually-hidden">What should we call you?</span>
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value.slice(0, 40));
              setLocalError("");
            }}
            maxLength={40}
            autoComplete="nickname"
            spellCheck={false}
            placeholder="Your first name"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void continueWithName();
              }
            }}
          />
        </label>
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
