import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { HighLevelLaunchScreen, type HighLevelLaunchVariant } from "./components/HighLevelLaunchScreen";
import { classifyOauthCallback } from "./lib/oauth-callback";
import "./styles.css";

/**
 * Public routes that must never mount useFounderBrainApp: no session check, no
 * config/API fetch, no auth boot. Resolved once, synchronously, before the first
 * render, so nothing here can flash an auth/boot screen first.
 *   - /highlevel is FounderBrain's own launch page, where a GoHighLevel Marketplace
 *     "Open"/"Manage" link for the installed app lands (not the Marketplace listing).
 *   - /oauth/callback with a code/state shape that is not a legitimate code+state
 *     or error+state callback shows the same recovery screen instead of booting.
 *     A legitimate callback (either shape) is left alone: it falls through to the
 *     existing authenticated flow in ./use-founderbrain-app, unchanged.
 */
function resolvePublicScreen(): HighLevelLaunchVariant | null {
  const { pathname, search } = window.location;
  if (pathname === "/highlevel") return "marketplace";
  if (pathname === "/oauth/callback") {
    const classification = classifyOauthCallback(search);
    if (classification.kind === "invalid") return "oauth-recovery";
  }
  return null;
}

const publicScreen = resolvePublicScreen();
if (publicScreen) {
  // Strip any query/fragment immediately, for both variants. /highlevel never needs
  // one, and an invalid /oauth/callback's values were only just classified as not a
  // usable callback; either way nothing here is logged, stored, or read again.
  if (window.location.search || window.location.hash) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {publicScreen ? <HighLevelLaunchScreen variant={publicScreen} /> : <App />}
  </StrictMode>,
);
