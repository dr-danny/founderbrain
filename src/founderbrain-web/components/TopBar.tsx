/**
 * Minimal signed-in account chip for views without the full TopBar (Typeform
 * wizard and chapters). Same sign-out action, fixed top right.
 */
export function AccountChip({
  email,
  usage,
  onSignOut,
}: {
  email: string;
  /** Founder-facing metered totals (tokens, site reads, price so far). */
  usage?: import("../types").UsageResponse | null;
  onSignOut: () => void;
}) {
  const tokens = usage ? usage.ai.inputTokens + usage.ai.outputTokens : null;
  const tooltip = usage
    ? `${usage.ai.events} AI actions · ${usage.firecrawl.scrapes} site reads (${usage.firecrawl.credits} credits)`
    : undefined;
  return (
    <div className="account-chip">
      {usage ? (
        <span className="account-chip-usage" title={tooltip}>
          {compactTokens(tokens!)} tokens used
        </span>
      ) : null}
      <div className="account-chip-row">
        <span className="account-chip-email">{email}</span>
        <button className="quiet" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <div className="account-chip-footer">
        <span className="account-chip-maker">
          Made with <span className="maker-heart" aria-label="love">&hearts;</span> by Danny
        </span>
        <a
          className="account-chip-tipjar"
          href="https://venmo.com/Danny-Mehditash"
          target="_blank"
          rel="noopener noreferrer"
          title="Tip the builder on Venmo"
        >
          <span className="tipjar-coin" aria-hidden="true" />
          Tip Jar
        </a>
      </div>
    </div>
  );
}
import type { BrainState, Config } from "../types";
import { compactTokens, stamp } from "../mission-copy";
import { BrandMark } from "./BrandMark";

/**
 * Top application bar: brand home link, save status, and account/sign-out.
 * Keeps chrome out of the App state machine so layout stays readable.
 */
export function TopBar({
  config,
  email,
  state,
  changed,
  saving,
  onHome,
  onSignOut,
}: {
  config: Config;
  email: string;
  state: BrainState;
  changed: boolean;
  saving: boolean;
  onHome: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <button className="wordmark link-button" onClick={onHome} aria-label="FounderBrain home">
        <BrandMark size={28} className="wordmark-mark" />
        <span>Founder</span>Brain
      </button>
      <div className="save-state" aria-live="polite">
        <i className={changed ? "dot draft" : "dot"} />
        {saving
          ? "Saving…"
          : changed
            ? "Draft not saved"
            : state.version === 0
              ? "Not saved yet"
              : `Saved · v${state.version}`}
        {state.updatedAt && <small>{stamp(state.updatedAt)}</small>}
      </div>
      <div className="account">
        {config.authMode === "local-demo" && <span className="demo">LOCAL DEMO</span>}
        <span>{email}</span>
        <button className="quiet" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
