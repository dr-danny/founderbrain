/**
 * Public, unauthenticated launch/recovery screen for GoHighLevel entry points, both
 * served by the FounderBrain website itself (not the Marketplace listing):
 *   - /highlevel: where a GoHighLevel Marketplace "Open" / "Manage" link for the
 *     installed FounderBrain app lands.
 *   - /oauth/callback with a missing or malformed code/state: the connect step did
 *     not come back with what FounderBrain needed to finish verifying it.
 *
 * This component is deliberately dumb: no useFounderBrainApp, no session check, no
 * API calls, no fetch. It never claims a GoHighLevel account is connected, and never
 * claims nothing changed externally - it has no way to know either. It only points
 * back to the real app in the top-level window (`target="_top"`, so a stray iframe
 * embed cannot trap the click).
 */
import { EntryShell } from "./AuthPage";

export type HighLevelLaunchVariant = "marketplace" | "oauth-recovery";

const COPY: Record<
  HighLevelLaunchVariant,
  { kicker: string; title: string; lede: string; bullets: string[] }
> = {
  marketplace: {
    kicker: "GoHighLevel",
    title: "Open FounderBrain.",
    lede: "Installed in GoHighLevel? FounderBrain runs on its own website. The Marketplace app connects your subaccount to your FounderBrain workspace.",
    bullets: [
      "Sign in with your existing FounderBrain account.",
      "Start Connect GoHighLevel from inside FounderBrain.",
      "No need to uninstall anything here first.",
    ],
  },
  "oauth-recovery": {
    kicker: "GoHighLevel",
    title: "Open FounderBrain.",
    lede: "FounderBrain could not finish verifying this connection. Open FounderBrain and start Connect GoHighLevel again.",
    bullets: [
      "Sign in with your existing FounderBrain account.",
      "Start Connect GoHighLevel from inside FounderBrain.",
      "No need to uninstall anything here first.",
    ],
  },
};

export function HighLevelLaunchScreen({ variant }: { variant: HighLevelLaunchVariant }) {
  const copy = COPY[variant];
  return (
    <EntryShell
      kicker={copy.kicker}
      title={copy.title}
      lede={copy.lede}
      action={
        <>
          <ul className="typeform-bullets highlevel-recovery-bullets">
            {copy.bullets.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {/* Same-origin, top-level navigation: works even if this screen was ever
              reached from inside a frame, and never depends on any app state. */}
          <a className="entry-cta highlevel-launch-cta" href="/" target="_top" rel="noopener">
            Open FounderBrain
          </a>
        </>
      }
    />
  );
}
