/**
 * Auth and boot screens shown before a confirmed workspace session.
 * Covers local-demo entry, Hexclave sign-in / re-sign-in, and session checking.
 * Presentation is editorial; Hexclave / demo behaviour is unchanged.
 */
import type { ReactNode } from "react";
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

function EntryShell({
  kicker,
  title,
  lede,
  action,
  notice,
  error,
}: {
  kicker?: string;
  title: string;
  lede: string;
  action?: ReactNode;
  notice?: string;
  error?: string;
}) {
  return (
    <main className="entry-stage">
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
      <section className="entry-panel">
        <header className="entry-brand-block">
          <p className="entry-brand">OneDay</p>
          <p className="entry-product">
            Founder<span>Brain</span>
          </p>
        </header>
        {kicker ? <p className="entry-kicker">{kicker}</p> : null}
        <h1 className="entry-title">{title}</h1>
        <p className="entry-lede">{lede}</p>
        {action}
        {notice ? (
          <p className="entry-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="entry-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

export function AuthPage(props: AuthPageProps) {
  if (props.kind === "boot") {
    return <EntryShell title="Opening your workspace" lede={props.message} />;
  }

  if (props.kind === "local-demo") {
    return (
      <EntryShell
        kicker="Local development"
        title="Build the brief your business can actually use."
        lede="This local demo stays visibly separate from production. On the real hostname, pilot founders sign in with a one-time code from Hexclave."
        notice={props.notice}
        error={props.error}
        action={
          <button className="entry-cta" type="button" onClick={props.onEnter}>
            Enter local demo
          </button>
        }
      />
    );
  }

  if (props.kind === "sign-in") {
    // There is no sign-in form here. Hexclave's hosted page asks for the email and the code;
    // this screen only explains that and offers the one button. It is shown when Hexclave has
    // no session for this browser, or the API refused the one it has before anything loaded.
    // An expiry mid-edit does NOT come here: the draft stays on screen with a banner instead.
    return (
      <EntryShell
        kicker="Private workspace · Atlanta"
        title={
          props.sessionExpired
            ? "Your sign-in has expired."
            : "Build the brief your business can actually use."
        }
        lede="Pilot access is invite-only. Sign in with a one-time code sent to the email you were invited under. No password is ever set."
        notice={props.notice}
        error={props.error}
        action={
          <button
            className="entry-cta"
            type="button"
            onClick={() => void props.hexclave.signIn().catch(() => props.onSignInError())}
          >
            {props.sessionExpired ? "Sign in again" : "Sign in"}
          </button>
        }
      />
    );
  }

  // We have a session claim but the API has not confirmed it yet, or refused it.
  return (
    <EntryShell
      kicker="Private workspace"
      title="Checking your sign-in…"
      lede="One moment. Your workspace is private to the email you signed in with."
      error={props.error}
    />
  );
}
