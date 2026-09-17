import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import { DomainError } from './domain.ts';

/**
 * src/founderbrain/auth.ts
 *
 * WHAT THIS IS
 *   Turns a request into an identity, or refuses. Cloudflare Access does the
 *   sign-in (One-time PIN to an allowed email) and puts a signed JWT on every
 *   request that reaches the Worker as `Cf-Access-Jwt-Assertion`. The Worker
 *   forwards it here. This module checks the signature against the team's JWKS
 *   and the claims against what we configured, and nothing else is trusted.
 *
 * WHY THE API VERIFIES AGAIN
 *   Access already checked the user before the Worker saw the request, and the
 *   Worker refuses `/api/*` without the header. Verifying here anyway means the
 *   API does not depend on the Worker being the only thing that can reach it.
 *   ORIGIN_SECRET guards the network path; this guards the identity. Both hold.
 *
 * WHAT IDENTIFIES A FOUNDER
 *   `issuer|sub`. `sub` is Access's stable id for an email within our account.
 *   It is not the email, so the email can be shown but never used as a key. The
 *   caveat, written down in the docs: `sub` changes if a user is removed from the
 *   Zero Trust organisation and added again. That is an operator action with a
 *   recovery path, not something a founder can do to themselves.
 */

export interface Identity {
  /** Opaque, stable, never the email. What `ensureWorkspace` is keyed on. */
  subject: string;
  /** For display only. */
  email: string;
}
export type Authenticate = (request: FastifyRequest) => Promise<Identity>;

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function constantEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function createAuthenticator(config: Config): Authenticate {
  if (config.FOUNDERBRAIN_LOCAL_DEMO === 'true' && config.NODE_ENV === 'production') {
    throw new Error('Local demo cannot authenticate production requests.');
  }
  if (config.FOUNDERBRAIN_LOCAL_DEMO === 'true') {
    return async (req) => {
      if (!LOOPBACK.has(req.ip)) throw new DomainError(403, 'local_only', 'Local demo is only available on loopback.');
      if (req.headers['x-dev-user'] !== 'demo') throw new DomainError(401, 'sign_in_required', 'Open the local demo to continue.');
      return { subject: 'local-demo|demo', email: 'demo@local' };
    };
  }

  const issuer = config.CF_ACCESS_TEAM_DOMAIN!.replace(/\/$/, '');
  const audience = config.CF_ACCESS_AUD!;
  const keys = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), {
    timeoutDuration: 5000,
    cooldownDuration: 30000,
  });

  return async (req) => {
    const raw = req.headers[ACCESS_JWT_HEADER];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (typeof token !== 'string' || token.length === 0) {
      throw new DomainError(401, 'sign_in_required', 'Sign in to continue.');
    }
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'], clockTolerance: 5 });
      // A service token carries an empty `sub`. Only people get a workspace.
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('No subject');
      if (!payload.exp) throw new Error('No expiry');
      // `type` is `app` for an application token and `org` for the global session token.
      if (payload.type !== undefined && payload.type !== 'app') throw new Error('Not an application token');
      const email = payload.email;
      if (typeof email !== 'string' || !EMAIL_SHAPE.test(email)) throw new Error('No verified email');
      return { subject: issuer + '|' + payload.sub, email: email.toLowerCase() };
    } catch {
      throw new DomainError(401, 'invalid_session', 'Your session has expired or could not be verified. Sign in again.');
    }
  };
}
