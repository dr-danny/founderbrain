/**
 * First-login Typeform: expectations → what → why → Atlanta outcome → Identity.
 * Skip is not offered. Progress persists server-side before advancing.
 */
import { useState } from "react";
import { firstLoginScreens, firstLoginTotal } from "../orientation-copy";
import { TypeformShell } from "./TypeformShell";

export function OrientationFlow({
  screen,
  saving,
  error,
  onAdvance,
  onBack,
  onComplete,
}: {
  screen: number;
  saving: boolean;
  error: string;
  onAdvance: (nextScreen: number) => void | Promise<void>;
  onBack: (prevScreen: number) => void | Promise<void>;
  onComplete: () => void | Promise<void>;
}) {
  const index = Math.min(Math.max(screen, 1), firstLoginTotal) - 1;
  const current = firstLoginScreens[index]!;
  const [localError, setLocalError] = useState("");

  async function continueForward() {
    setLocalError("");
    try {
      if (screen >= firstLoginTotal) {
        await onComplete();
        return;
      }
      await onAdvance(screen + 1);
    } catch {
      setLocalError("Could not save progress. Try again.");
    }
  }

  async function goBack() {
    if (screen <= 1) return;
    setLocalError("");
    try {
      await onBack(screen - 1);
    } catch {
      setLocalError("Could not save progress. Try again.");
    }
  }

  return (
    <TypeformShell
      kicker="Atlanta prep · First login"
      screen={screen}
      total={firstLoginTotal}
      title={current.title}
      continueLabel={current.continueLabel ?? "Continue"}
      showBack={screen > 1}
      onBack={() => void goBack()}
      onContinue={() => void continueForward()}
      saving={saving}
    >
      {current.body.map((line) => (
        <p key={line} className="entry-lede typeform-lede">
          {line}
        </p>
      ))}
      {current.bullets ? (
        <ul className="typeform-bullets">
          {current.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {(error || localError) && (
        <p className="entry-error" role="alert">
          {error || localError}
        </p>
      )}
    </TypeformShell>
  );
}
