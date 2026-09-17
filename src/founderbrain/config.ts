import { z } from 'zod';
import { assertMasterKeyPresent } from '../server/storage/crypto.ts';

/**
 * src/founderbrain/config.ts
 *
 * The one place FounderBrain reads its environment. Every other module takes a
 * `Config` and never touches `process.env`.
 *
 * Sign-in is Hexclave (the platform formerly named Stack Auth). The API needs
 * two public facts to verify what the browser hands it: the project id, which is
 * the token audience and part of the issuer, and the Hexclave API origin, which
 * hosts the project's JWKS. Neither is a secret. There is no secret server key
 * here on purpose: v1 verifies tokens locally and never calls Hexclave.
 */

const positive = z.coerce.number().int().positive();
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().min(1),
  PORT: positive.max(65535).default(8080),
  APP_ORIGIN: z.string().url(),
  ORIGIN_SECRET: z.string().min(32).optional(),
  /** The Hexclave project id, a UUID shown in the dashboard URL after `/projects/`. */
  HEXCLAVE_PROJECT_ID: z.string().uuid('HEXCLAVE_PROJECT_ID must be the project UUID').optional(),
  /** Hexclave API origin. Host of the JWKS and prefix of the token issuer. Bare HTTPS origin. */
  HEXCLAVE_API_URL: z.string().url().default('https://api.hexclave.com'),
  /** Only when the project has `requirePublishableClientKey` on. Safe to send to the browser. */
  HEXCLAVE_PUBLISHABLE_CLIENT_KEY: z.string().regex(/^pck_[A-Za-z0-9_-]+$/, 'HEXCLAVE_PUBLISHABLE_CLIENT_KEY must start with pck_').optional(),
  FOUNDERBRAIN_LOCAL_DEMO: z.enum(['true', 'false']).default('false'),
  AI_ENABLED: z.enum(['true', 'false']).default('false'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_INPUT_USD_PER_MILLION: z.coerce.number().positive().optional(),
  AI_OUTPUT_USD_PER_MILLION: z.coerce.number().positive().optional(),
  AI_WORKSPACE_DAILY_MICROUSD: positive.optional(),
  AI_GLOBAL_DAILY_MICROUSD: positive.optional(),
});
export type Config = z.infer<typeof envSchema>;

/**
 * A bare HTTPS origin: scheme and host, nothing after. Anything else would let a
 * path or query sneak into the JWKS URL and the issuer we compare against.
 */
export function bareHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      (url.pathname === '/' || url.pathname === '') &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** The Hexclave URLs the authenticator derives from configuration. Exported so tests and docs agree. */
export function hexclaveEndpoints(apiUrl: string, projectId: string): { issuer: string; jwks: URL } {
  const origin = new URL(apiUrl).origin;
  return {
    issuer: `${origin}/api/v1/projects/${projectId}`,
    jwks: new URL(`${origin}/api/v1/projects/${projectId}/.well-known/jwks.json`),
  };
}

export function loadConfig(raw: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('Invalid FounderBrain configuration: ' + parsed.error.issues.map((i) => i.path.join('.')).join(', '));
  }
  const c = parsed.data;
  const local = c.FOUNDERBRAIN_LOCAL_DEMO === 'true';
  if (local && c.NODE_ENV === 'production') throw new Error('Local demo authentication is forbidden in production.');
  if (!local) {
    if (!c.ORIGIN_SECRET) throw new Error('ORIGIN_SECRET must be set so only the Worker can reach the API.');
    if (!c.HEXCLAVE_PROJECT_ID) throw new Error('Hexclave must be configured: HEXCLAVE_PROJECT_ID.');
    if (new URL(c.APP_ORIGIN).protocol !== 'https:') throw new Error('Production origins must use HTTPS.');
  }
  if (!bareHttpsOrigin(c.HEXCLAVE_API_URL)) {
    throw new Error('HEXCLAVE_API_URL must be a bare HTTPS origin such as https://api.hexclave.com.');
  }
  if (
    c.AI_ENABLED === 'true' &&
    (!c.ANTHROPIC_API_KEY ||
      !c.AI_MODEL ||
      !c.AI_INPUT_USD_PER_MILLION ||
      !c.AI_OUTPUT_USD_PER_MILLION ||
      !c.AI_WORKSPACE_DAILY_MICROUSD ||
      !c.AI_GLOBAL_DAILY_MICROUSD)
  ) {
    throw new Error('AI requires a model, key, explicit prices and approved daily budget caps.');
  }
  assertMasterKeyPresent();
  return c;
}
