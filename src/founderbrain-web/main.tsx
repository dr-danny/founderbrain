import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { HighLevelLaunchScreen } from "./components/HighLevelLaunchScreen";
import { classifyOauthCallback, type UsableOauthCallback } from "./lib/oauth-callback";
import "./styles.css";

/**
 * Public/GHL-isolation routing, resolved once, synchronously, before the first render.
 *
 *   - /highlevel is FounderBrain's own launch page, where a GoHighLevel Marketplace
 *     "Open"/"Manage" link for the installed app lands (not the Marketplace listing).
 *     It never mounts useFounderBrainApp: no session check, no config/API fetch.
 *
 *   - /oauth/callback's query/fragment is classified and stripped from the address
 *     bar HERE, before `<App/>` ever mounts, for every shape (valid or not). This is
 *     not just cosmetic: the Hexclave SDK it constructs later (inside
 *     useFounderBrainApp, once config loads) also reads the current URL on init, and
 *     an `error`+`state` pair meant for GoHighLevel's Connect step reads to it as its
 *     own hosted-page denial (`OAUTH_PROVIDER_ACCESS_DENIED`), hijacking sign-in
 *     before our own callback effect ever runs. Stripping the query here, before that
 *     SDK object exists, is what keeps GoHighLevel's callback isolated from identity.
 *
 *     - "invalid" (missing/blank/duplicated/ambiguous code+error/state) shows the
 *       public recovery screen instead of booting auth.
 *     - A legitimate "code" or "error" classification is kept only in page memory
 *       (this module scope, then a React prop) and handed to `<App/>` as
 *       `initialOauthCallback`. `use-founderbrain-app.ts` consumes that value -
 *       never `window.location.search` again - once the existing authenticated
 *       gate (api + email + the one-shot `oauthHandled` ref + the `/oauth/callback`
 *       path marker) allows it to. Nothing here is logged, stored, or rendered.
 */
function stripQueryAndFragment() {
  if (window.location.search || window.location.hash) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

let publicScreen: "marketplace" | "oauth-recovery" | null = null;
let initialOauthCallback: UsableOauthCallback | null = null;

if (window.location.pathname === "/highlevel") {
  publicScreen = "marketplace";
  stripQueryAndFragment();
} else if (window.location.pathname === "/oauth/callback") {
  const classification = classifyOauthCallback(window.location.search);
  stripQueryAndFragment();
  if (classification.kind === "invalid") {
    publicScreen = "oauth-recovery";
  } else {
    initialOauthCallback = classification;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {publicScreen ? (
      <HighLevelLaunchScreen variant={publicScreen} />
    ) : (
      <App initialOauthCallback={initialOauthCallback} />
    )}
  </StrictMode>,
);
