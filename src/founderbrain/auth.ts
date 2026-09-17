import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import { hexclaveEndpoints, type Config } from "./config.ts";
import { DomainError } from "./domain.ts";

/**
 * src/founderbrain/auth.ts
 *
 * WHAT THIS IS
 *   Turns a request into an identity, or refuses. Hexclave does the sign-in
 *   (a one-time code emailed to an invited founder, on Hexclave's hosted page)
 *   and the browser SDK hands us the resulting access token. The web app sends
 *   it as `x-stack-access-token`, the Worker forwards that header and nothing
 *   else, and this module checks the signature against the project's JWKS and
 *   the claims against what we configured. Nothing else is trusted.
 *
 * WHY THE API VERIFIES ITSELF
 *   The Worker refuses `/api/*` without the header, but presence is not proof.
 *   Verifying here means the API does not depend on the Worker being the only
 *   thing that can reach it. ORIGIN_SECRET guards the network path; this guards
 *   the identity. Both hold. `jose` caches the JWKS, avoiding a network call on
 *   each request. Cold starts, cache expiry and key rotation require a fetch;
 *   an outage can therefore block verification even for an unexpired token.
 *
 * WHAT IDENTIFIES A FOUNDER
 *   `hexclave|<projectId>|<sub>`. `sub` is Hexclave's user id: stable for the
 *   life of the user, not the email. The project id is in the key so two
 *   Hexclave projects (staging, production) can never collide. The API hostname
 *   is deliberately NOT in the key: the platform renamed from Stack Auth to
 *   Hexclave and moved hosts once already, and a key that contained the host
 *   would have orphaned every workspace.
 *
 * WHICH TOKENS ARE REFUSED
 *   Hexclave issues three kinds of access token with different `iss` and `aud`:
 *   regular (`.../projects/<id>`, aud `<id>`), anonymous
 *   (`.../projects-anonymous-users/<id>`, aud `<id>:anon`) and restricted
 *   (`.../projects-restricted-users/<id>`, aud `<id>:restricted`). Pinning issuer
 *   and audience to the regular form refuses the other two by construction. The
 *   `is_anonymous`, `is_restricted` and `email_verified` claims are checked as
 *   well, so the intent is visible and a future token shape cannot slip past.
 */

export interface Identity {
  /** Opaque, stable, never the email. What `ensureWorkspace` is keyed on. */
  subject: string;
  /** For display only. */
  email: string;
}
export type Authenticate = (request: FastifyRequest) => Promise<Identity>;

/** The header the Hexclave docs use for a user's access token on your own backend. */
export const ACCESS_TOKEN_HEADER = "x-stack-access-token";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function constantEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function workspaceSubject(projectId: string, sub: string): string {
  return `hexclave|${projectId}|${sub}`;
}

export function createAuthenticator(config: Config): Authenticate {
  if (config.FOUNDERBRAIN_LOCAL_DEMO === "true" && config.NODE_ENV === "production") {
    throw new Error("Local demo cannot authenticate production requests.");
  }
  if (config.FOUNDERBRAIN_LOCAL_DEMO === "true") {
    return async (req) => {
      if (!LOOPBACK.has(req.ip))
        throw new DomainError(403, "local_only", "Local demo is only available on loopback.");
      if (req.headers["x-dev-user"] !== "demo")
        throw new DomainError(401, "sign_in_required", "Open the local demo to continue.");
      return { subject: "local-demo|demo", email: "demo@local" };
    };
  }

  const projectId = config.HEXCLAVE_PROJECT_ID;
  if (!projectId) throw new Error("HEXCLAVE_PROJECT_ID is required outside the local demo.");
  const { issuer, jwks } = hexclaveEndpoints(config.HEXCLAVE_API_URL, projectId);
  const keys = createRemoteJWKSet(jwks, { timeoutDuration: 5000, cooldownDuration: 30000 });

  return async (req) => {
    const raw = req.headers[ACCESS_TOKEN_HEADER];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (typeof token !== "string" || token.length === 0) {
      throw new DomainError(401, "sign_in_required", "Sign in to continue.");
    }
    try {
      // Hexclave signs with ES256 only. Listing exactly that closes the algorithm
      // confusion door: an HS256 token signed with the public key is refused.
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: projectId,
        algorithms: ["ES256"],
        clockTolerance: 5,
      });
      if (typeof payload.sub !== "string" || payload.sub.length === 0)
        throw new Error("No subject");
      if (!payload.exp) throw new Error("No expiry");
      if (payload.is_anonymous === true) throw new Error("Anonymous session");
      if (payload.is_restricted === true) throw new Error("Restricted user");
      // Sign-in is a code emailed to the address, so a verified email is the
      // norm. Refusing an unverified one is what makes email safe to display.
      if (payload.email_verified !== true) throw new Error("Email not verified");
      const email = payload.email;
      if (typeof email !== "string" || !EMAIL_SHAPE.test(email)) throw new Error("No email");
      return { subject: workspaceSubject(projectId, payload.sub), email: email.toLowerCase() };
    } catch {
      throw new DomainError(
        401,
        "invalid_session",
        "Your session has expired or could not be verified. Sign in again.",
      );
    }
  };
}
