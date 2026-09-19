/**
 * Minimal signed-in account chip for views without the full TopBar (Typeform
 * wizard and chapters). Same sign-out action, fixed top right.
 */
export function AccountChip({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="account-chip">
      <span className="account-chip-email">{email}</span>
      <button className="quiet" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
import type { BrainState, Config } from "../types";
import { stamp } from "../mission-copy";
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
