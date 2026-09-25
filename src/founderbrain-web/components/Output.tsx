/**
 * First-output mission UI: generate, edit, reconcile, and accept an artifact.
 * AI-off mode shows a deterministic preview from the structured brain.
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
  verified,
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
  verified: boolean;
  onText: (v: string) => void;
  onGenerate: () => void;
  onRetryGenerate: () => void;
  onReconcile: () => void;
  onAccept: () => void;
}) {
  if (!config.aiEnabled) {
    return (
      <div className="output-empty">
        <p className="eyebrow">OPERATOR CONFIGURATION</p>
        <h2>AI generation is not enabled.</h2>
        <p>Your structured missions still produce this deterministic preview:</p>
        <pre className="deterministic">{`Founder: ${brain.identity.name || "Not set"}
Venture: ${brain.identity.venture || "Not set"}
Customer: ${brain.customer.segment || "Not set"}
Problem: ${brain.customer.problem || "Not set"}
Offer: ${brain.offer.description || "Not set"}
Voice: ${brain.voice.tone || "Not set"}`}</pre>
        <p className="muted">No output is marked verified.</p>
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="output-empty">
        <p className="eyebrow">REVIEW ONLY</p>
        <h2>Build the 90 day plan.</h2>
        <p>
          This reads the Brain you already saved, pressure-tests the number, and writes the 90 day
          plan. Gaps stay gaps. Nothing is sent.
        </p>
        {jobNeedsReconcile && (
          <button className="button secondary" onClick={onReconcile}>
            Reconcile output
          </button>
        )}
        <button
          className="button primary"
          onClick={generationRetry ? onRetryGenerate : onGenerate}
          disabled={generating}
        >
          {generating ? "Building the plan…" : generationRetry ? "Retry the plan" : "Build the 90 day plan"}
        </button>
      </div>
    );
  }

  const accepted = Boolean(artifact.acceptedAt);
  return (
    <div className="artifact">
      <p className="eyebrow">
        {stale ? "STALE DRAFT" : accepted ? "ACCEPTED OUTPUT" : "DRAFT OUTPUT"}
      </p>
      <dl className="provenance">
        <dt>Source version</dt>
        <dd>v{artifact.sourceVersion}</dd>
        <dt>Input hash</dt>
        <dd>{artifact.inputHash}</dd>
      </dl>
      <textarea
        aria-label="Generated FounderBrain output"
        value={text}
        rows={12}
        readOnly={accepted || acceptRetry}
        disabled={accepting}
        onChange={(e) => onText(e.target.value)}
      />
      <div className="artifact-actions">
        <span>
          {verified && accepted
            ? "Verified by server"
            : accepted
              ? "Accepted, verification pending"
              : stale
                ? "Regenerate before acceptance"
                : "Edit before acceptance"}
        </span>
        {jobNeedsReconcile && (
          <button className="button secondary" onClick={onReconcile}>
            Reconcile output
          </button>
        )}
        {stale && (
          <button className="button secondary" onClick={onGenerate} disabled={generating}>
            {generating ? "Checking job…" : "Generate replacement"}
          </button>
        )}
        {!accepted && !stale && (
          <button className="button primary" onClick={onAccept} disabled={accepting}>
            {accepting ? "Accepting…" : acceptRetry ? "Retry acceptance" : "Accept reviewed output"}
          </button>
        )}
        {!accepted && accepting === false && (
          <button className="quiet" onClick={onRetryGenerate} disabled={!jobNeedsReconcile}>
            Retry generation
          </button>
        )}
      </div>
    </div>
  );
}
