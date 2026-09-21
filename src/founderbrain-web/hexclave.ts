import { HexclaveClientApp } from "@hexclave/js";
import type { HexclaveClientConfig } from "./types";

/**
 * The one place the browser touches the Hexclave SDK. Everything the rest of the app needs
 * is three verbs: who is signed in, a token for the API, and sign out.
 *
 * WHY THE SDK AT ALL
 *   Sign-in is a one-time code emailed by Hexclave and entered on Hexclave's hosted page.
 *   The SDK is what receives the resulting session when the founder lands back here, keeps
 *   the refresh token, and mints short-lived access tokens for our API. Writing that by hand
 *   would mean re-implementing the token exchange against a moving REST API for no gain.
 *
 * WHAT IS SWITCHED OFF, AND WHY
 *   - All analytics, including click tracking and session replays. Both can capture text
 *     from the DOM. Brain text must never leave this origin except to our own API.
 *   - The dev tool overlay. It has no place in a pilot user's browser.
 *   - Automatic prefetch. We call `getUser()` ourselves at the moment we need it.
 */
export interface HexclaveSession {
  /** For the account display only. The API's `/me` answer is the one we trust. */
  email: string | null;
  /** The current access token, refreshed by the SDK when needed. Null when signed out. */
  getToken(): Promise<string | null>;
  /** Ends the Hexclave session and navigates to `/`. */
  signOut(): Promise<void>;
}
export interface Hexclave {
  /** The signed-in founder, or null. Resolves the hosted-page return on first call. */
  currentSession(): Promise<HexclaveSession | null>;
  /** Full navigation to Hexclave's hosted sign-in page. Comes back to `/` when done. */
  signIn(): Promise<void>;
}

export function createHexclave(config: HexclaveClientConfig): Hexclave {
  const app = new HexclaveClientApp({
    projectId: config.projectId,
    publishableClientKey: config.publishableClientKey ?? undefined,
    baseUrl: config.apiUrl,
    tokenStore: "cookie",
    urls: { default: { type: "hosted" }, afterSignIn: "/", afterSignOut: "/", home: "/" },
    devTool: false,
    noAutomaticPrefetch: true,
    analytics: { enabled: false, replays: { enabled: false } },
  });
  // #77: the SDK can throw a raw TypeError from its token store while a session is
  // mid-handoff (seen once right after the OAuth callback as "Cannot read properties
  // of undefined (reading 'has')"). Returning null instead routes the caller to the
  // clean session-expired path instead of printing SDK internals to a founder.
  const safeUser = async () => {
    try {
      return await app.getUser();
    } catch {
      return null;
    }
  };
  const safeToken = async (user: { id: string } & { getAccessToken(): Promise<string | null> }) => {
    try {
      return await user.getAccessToken();
    } catch {
      return null;
    }
  };
  return {
    async currentSession() {
      const user = await safeUser();
      if (!user) return null;
      return {
        email: user.primaryEmail,
        async getToken() {
          // A new-tab sign-in replaces the SDK session. Read it again for each request,
          // but never send this founder's unsaved draft under another founder's token.
          const current = await safeUser();
          return current?.id === user.id ? await safeToken(current) : null;
        },
        signOut: () => app.signOut({ redirectUrl: "/" }),
      };
    },
    signIn: () => app.redirectToSignIn(),
  };
}
