/**
 * One-idea-per-screen Typeform shell: progress, Back/Continue, Enter to advance.
 * Reuses the Atlanta entry visual language from AuthPage.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { progressLabel } from "../orientation-copy";
import { BrandMark } from "./BrandMark";
import { TypedText } from "./TypedText";
import {
  countRequiredMissing,
  QuestionIndexModal,
  QuestionListIcon,
  type QuestionIndexConfig,
} from "./QuestionIndexModal";

/**
 * Hub continuity (Danny, 2026-09-21): every typeform screen offers a one-tap
 * exit back to the Atlanta hub so the interview and the hub read as one app.
 * App provides the handler; shells render the pill when one exists.
 */
export const TypeformExitContext = createContext<(() => void) | null>(null);

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
  immersive = false,
  hideContinue = false,
  /** Founder-facing position text (e.g. "Mission 3 of 6 · step 2 of 5"). Overrides screen/total. */
  progressText,
  /** Screen titles for the jump strip. With onJump, founders can open any screen directly. */
  steps,
  onJump,
  /** Move on without answering this screen. Nothing is marked done. */
  onSkip,
  skipLabel = "Skip for now",
  /** Every-question index modal for this mission section. Optional. */
  questionIndex,
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
  immersive?: boolean;
  hideContinue?: boolean;
  progressText?: string;
  steps?: string[];
  onJump?: (screen: number) => void;
  onSkip?: () => void;
  skipLabel?: string;
  questionIndex?: QuestionIndexConfig;
}) {
  const continueRef = useRef<HTMLButtonElement>(null);
  const [completedTitle, setCompletedTitle] = useState<string | null>(null);
  const titleDone = completedTitle === title;
  const onExit = useContext(TypeformExitContext);
  const [indexOpen, setIndexOpen] = useState(false);
  const [indexShowAll, setIndexShowAll] = useState(false);
  const lastIndexRequest = useRef(0);

  // Missing-completion escape hatch: bumping `request` opens the index in
  // missing-only mode so a founder who tried to finish without answering
  // everything required lands straight on what's left, no forced loop.
  useEffect(() => {
    const request = questionIndex?.request ?? 0;
    if (request > 0 && request !== lastIndexRequest.current) {
      setIndexShowAll(false);
      setIndexOpen(true);
    }
    lastIndexRequest.current = request;
  }, [questionIndex?.request]);

  useEffect(() => {
    // Never steal focus into the screen while the question index dialog owns it.
    if (!titleDone || indexOpen) return;
    if (document.activeElement?.closest(".question-index-trigger")) return;
    const field = document.querySelector(".typeform-name input") as HTMLInputElement | null;
    if (field) {
      // preventScroll: otherwise the caret-at-end drags long pre-filled answers to their tail.
      field.focus({ preventScroll: true });
      return;
    }
    if (!hideContinue) continueRef.current?.focus();
  }, [screen, title, titleDone, hideContinue, indexOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      // The question index dialog owns Enter/Escape while it's open.
      if (indexOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;
      if (target?.tagName === "INPUT" && (target as HTMLInputElement).type === "text") return;
      // A focused button (Questions trigger, Back, Skip, etc.) should get its own
      // default Enter/click behavior instead of being hijacked into onContinue.
      if (target?.closest("button, a, select, input, [contenteditable='true']")) return;
      if (hideContinue || continueDisabled || saving || !titleDone) return;
      event.preventDefault();
      onContinue();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [continueDisabled, saving, onContinue, hideContinue, titleDone, indexOpen]);

  const label = progressText ?? progressLabel(screen, total);
  const missingRequiredCount = questionIndex ? countRequiredMissing(questionIndex.items) : 0;

  return (
    <main className={immersive ? "entry-stage typeform-stage immersive" : "entry-stage typeform-stage"}>
      <div className="typeform-sequence" aria-hidden="true">
        <div className="typeform-sequence-fill" style={{ width: `${Math.max(4, (screen / total) * 100)}%` }} />
      </div>
      <p className="typeform-sequence-label" aria-live="polite">
        {label}
      </p>
      {steps && onJump ? (
        <nav className="typeform-steps" aria-label="Screens in this chapter">
          {steps.map((step, index) => (
            <button
              key={step}
              type="button"
              className={index + 1 === screen ? "typeform-step current" : "typeform-step"}
              aria-current={index + 1 === screen ? "step" : undefined}
              onClick={() => onJump(index + 1)}
              disabled={saving || index + 1 === screen}
            >
              {index + 1}. {step}
            </button>
          ))}
        </nav>
      ) : null}
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
      {onExit ? (
        <button className="typeform-hub-link" type="button" onClick={onExit}>
          <span aria-hidden="true">&larr;</span> Atlanta hub
        </button>
      ) : null}
      <section className="entry-panel typeform-panel" aria-labelledby="typeform-title">
        <header className="entry-brand-block">
          <BrandMark size={56} className="entry-mark" />
          <p className="entry-product">
            <span>Founder</span>Brain
          </p>
        </header>
        {immersive ? null : kicker ? <p className="entry-kicker">{kicker}</p> : null}
        <h1 id="typeform-title" className="entry-title">
          <TypedText key={title} text={title} onDone={() => setCompletedTitle(title)} />
        </h1>
        {/* Always available regardless of titleDone/TypedText gating: founders
            should be able to open the question map even mid-type or while
            controls below are still render-gated. Disabled only while saving. */}
        {questionIndex ? (
          <div className="question-index-control">
            <button
              type="button"
              className="question-index-trigger"
              onClick={() => {
                setIndexShowAll(true);
                setIndexOpen(true);
              }}
              disabled={saving}
              aria-haspopup="dialog"
            >
              <QuestionListIcon />
              Questions
              {missingRequiredCount > 0 ? (
                <span className="question-index-badge">{missingRequiredCount}</span>
              ) : null}
            </button>
          </div>
        ) : null}
        {/* Render-gate on titleDone: controls were opacity:0 + pointer-events:none
            while the title typed, which made them invisible to sighted keyboard
            users and dropped them from the accessibility tree (#28). */}
        {titleDone ? (
          <div className="typeform-body in">
            {children}
            {hideContinue && !showBack ? null : (
              <div className="typeform-actions">
                {showBack ? (
                  <button className="typeform-back" type="button" onClick={onBack} disabled={saving}>
                    Back
                  </button>
                ) : null}
                {onSkip ? (
                  <button className="typeform-back" type="button" onClick={onSkip} disabled={saving}>
                    {skipLabel}
                  </button>
                ) : null}
                {hideContinue ? null : (
                  <button
                    ref={continueRef}
                    className="entry-cta"
                    type="button"
                    onClick={onContinue}
                    disabled={continueDisabled || saving}
                  >
                    {saving ? "Saving…" : continueLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </section>
      {questionIndex ? (
        <QuestionIndexModal
          config={questionIndex}
          open={indexOpen}
          showAll={indexShowAll}
          onShowAllChange={setIndexShowAll}
          onClose={() => setIndexOpen(false)}
        />
      ) : null}
    </main>
  );
}
