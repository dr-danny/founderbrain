/**
 * Top application bar: brand home link, save status, and account/sign-out.
 * Keeps chrome out of the App state machine so layout stays readable.
 */
import type { BrainState, Config } from "../types";
import { stamp } from "../mission-copy";

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
              : "Saved"}
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
