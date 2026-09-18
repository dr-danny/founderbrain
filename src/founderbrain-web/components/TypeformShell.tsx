/**
 * One-idea-per-screen Typeform shell: progress, Back/Continue, Enter to advance.
 * Reuses the Atlanta entry visual language from AuthPage.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { progressLabel } from "../orientation-copy";

export function TypeformShell({
  kicker,
  screen,
  total,
  title,
  children,
  continueLabel = "Continue",
  continueDisabled = false,
  showBack,
  onBack,
  onContinue,
  saving = false,
}: {
  kicker: string;
  screen: number;
  total: number;
  title: string;
  children: ReactNode;
  continueLabel?: string;
  continueDisabled?: boolean;
  showBack: boolean;
  onBack: () => void;
  onContinue: () => void;
  saving?: boolean;
}) {
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus();
  }, [screen, title]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;
      if (target?.tagName === "INPUT" && (target as HTMLInputElement).type === "text") return;
      if (continueDisabled || saving) return;
      event.preventDefault();
      onContinue();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [continueDisabled, saving, onContinue]);

  const label = progressLabel(screen, total);

  return (
    <main className="entry-stage typeform-stage">
      <div className="entry-media" aria-hidden="true">
        <img
          className="entry-photo"
          src="/atlanta-skyline.jpg"
          alt=""
          width={1920}
          height={1282}
          decoding="async"
          fetchPriority="high"
        />
      </div>
      <div className="entry-veil" aria-hidden="true" />
      <section className="entry-panel typeform-panel" aria-labelledby="typeform-title">
        <header className="entry-brand-block">
          <p className="entry-brand">OneDay</p>
          <p className="entry-product">
            Founder<span>Brain</span>
          </p>
        </header>
        <p className="entry-kicker">{kicker}</p>
        <p className="typeform-progress" aria-live="polite">
          {label}
        </p>
        <div
          className="typeform-bar"
          role="progressbar"
          aria-valuenow={screen}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={label}
        >
          <div className="typeform-bar-fill" style={{ width: `${(screen / total) * 100}%` }} />
        </div>
        <h1 id="typeform-title" className="entry-title">
          {title}
        </h1>
        <div className="typeform-body">{children}</div>
        <div className="typeform-actions">
          {showBack ? (
            <button className="typeform-back" type="button" onClick={onBack} disabled={saving}>
              Back
            </button>
          ) : null}
          <button
            ref={continueRef}
            className="entry-cta"
            type="button"
            onClick={onContinue}
            disabled={continueDisabled || saving}
          >
            {saving ? "Saving…" : continueLabel}
          </button>
        </div>
      </section>
    </main>
  );
}
