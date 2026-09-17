/**
 * Auth and boot screens shown before a confirmed workspace session.
 * Covers local-demo entry, Hexclave sign-in / re-sign-in, and session checking.
 */
import type { Hexclave } from "../hexclave";

type AuthPageProps =
  | { kind: "boot"; message: string }
  | {
      kind: "local-demo";
      notice: string;
      error: string;
      onEnter: () => void;
    }
  | {
      kind: "sign-in";
      sessionExpired: boolean;
      notice: string;
      error: string;
      hexclave: Hexclave;
      onSignInError: () => void;
    }
  | {
      kind: "checking";
      error: string;
    };

export function AuthPage(props: AuthPageProps) {
  if (props.kind === "boot") {
    return (
      <main className="boot">
        <div className="mark">FB</div>
        <p>{props.message}</p>
      </main>
    );
  }

  if (props.kind === "local-demo") {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="wordmark">
            <span>Founder</span>Brain
          </div>
          <p className="eyebrow">LOCAL DEMO</p>
          <h1>Build the brief your business can actually use.</h1>
          <p>
            This is a local development demo. It is visibly separate from production sign-in, which
            is a one-time code from Hexclave on the real hostname.
          </p>
          <button className="button primary" onClick={props.onEnter}>
            Enter local demo
          </button>
          {props.notice && (
            <p className="notice" role="status">
              {props.notice}
            </p>
          )}
          {props.error && (
            <p className="error" role="alert">
              {props.error}
            </p>
          )}
        </section>
      </main>
    );
  }

  if (props.kind === "sign-in") {
    // There is no sign-in form here. Hexclave's hosted page asks for the email and the code;
    // this screen only explains that and offers the one button. It is shown when Hexclave has
    // no session for this browser, or the API refused the one it has before anything loaded.
    // An expiry mid-edit does NOT come here: the draft stays on screen with a banner instead.
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="wordmark">
            <span>Founder</span>Brain
          </div>
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1>
            {props.sessionExpired
              ? "Your sign-in has expired."
              : "Build the brief your business can actually use."}
          </h1>
          <p>
            Pilot access is invite-only. Sign in with a one-time code sent to the email you were
            invited under. No password is ever set.
          </p>
          <button
            className="button primary"
            onClick={() => void props.hexclave.signIn().catch(() => props.onSignInError())}
          >
            {props.sessionExpired ? "Sign in again" : "Sign in"}
          </button>
          {props.notice && (
            <p className="notice" role="status">
              {props.notice}
            </p>
          )}
          {props.error && (
            <p className="error" role="alert">
              {props.error}
            </p>
          )}
        </section>
      </main>
    );
  }

  // We have a session claim but the API has not confirmed it yet, or refused it.
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="wordmark">
          <span>Founder</span>Brain
        </div>
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h1>Checking your sign-in…</h1>
        <p>One moment. Your workspace is private to the email you signed in with.</p>
        {props.error && (
          <p className="error" role="alert">
            {props.error}
          </p>
        )}
      </section>
    </main>
  );
}
