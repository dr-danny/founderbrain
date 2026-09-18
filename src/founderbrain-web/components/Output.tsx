/**
 * First-output mission UI: write, edit, refresh, and keep a private draft.
 * AI-off mode shows a preview from the structured brain.
 */
import type { Artifact, Brain, Config } from "../types";

export function Output({
  config,
  brain,
  artifact,
  text,
  stale,
  generating,
  generationRetry,
  accepting,
  acceptRetry,
  jobNeedsReconcile,
  onText,
  onGenerate,
  onRetryGenerate,
  onReconcile,
  onAccept,
}: {
  config: Config;
  brain: Brain;
  artifact: Artifact | null;
  text: string;
  stale: boolean;
  generating: boolean;
  generationRetry: boolean;
  accepting: boolean;
  acceptRetry: boolean;
  jobNeedsReconcile: boolean;
  onText: (v: string) => void;
  onGenerate: () => void;
  onRetryGenerate: () => void;
  onReconcile: () => void;
  onAccept: () => void;
}) {
  if (!config.aiEnabled) {
    return (
      <div className="output-empty">
        <h2>Writing is turned off.</h2>
        <p>Here is what your missions say so far:</p>
        <pre className="deterministic">{`Founder: ${brain.identity.name || "Not set"}
Venture: ${brain.identity.venture || "Not set"}
Customer: ${brain.customer.segment || "Not set"}
Problem: ${brain.customer.problem || "Not set"}
Offer: ${brain.offer.description || "Not set"}
Voice: ${brain.voice.tone || "Not set"}`}</pre>
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="output-empty">
        <h2>Write a private draft.</h2>
        <p>We'll use your approved missions. Nothing is sent to a customer.</p>
        {jobNeedsReconcile && (
          <button className="button secondary" onClick={onReconcile}>
            Refresh
          </button>
        )}
        <button
          className="button primary"
          onClick={generationRetry ? onRetryGenerate : onGenerate}
          disabled={generating}
        >
          {generating ? "Writing…" : generationRetry ? "Try again" : "Write draft"}
        </button>
      </div>
    );
  }

  const accepted = Boolean(artifact.acceptedAt);
  const showRefresh = jobNeedsReconcile;
  const showReplace = stale;
  const showKeep = !accepted && !stale;
  const showRetry = !accepted && !accepting && jobNeedsReconcile;
  const status = accepted
    ? null
    : stale
      ? "This draft is out of date."
      : "Review this before you keep it.";

  return (
    <div className="artifact">
      <p className="eyebrow">{stale ? "OUT OF DATE" : accepted ? "SAVED" : "DRAFT"}</p>
      <textarea
        aria-label="Generated FounderBrain output"
        value={text}
        rows={12}
        readOnly={accepted || acceptRetry}
        disabled={accepting}
        onChange={(e) => onText(e.target.value)}
      />
      {(status || showRefresh || showReplace || showKeep || showRetry) && (
        <div className="artifact-actions">
          {status && <span>{status}</span>}
          {showRefresh && (
            <button className="button secondary" onClick={onReconcile}>
              Refresh
            </button>
          )}
          {showReplace && (
            <button className="button secondary" onClick={onGenerate} disabled={generating}>
              {generating ? "Writing…" : "Write a fresh draft"}
            </button>
          )}
          {showKeep && (
            <button className="button primary" onClick={onAccept} disabled={accepting}>
              {accepting ? "Saving…" : acceptRetry ? "Try saving again" : "Keep this"}
            </button>
          )}
          {showRetry && (
            <button className="quiet" onClick={onRetryGenerate}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
