import { z } from 'zod';
import { assertMasterKeyPresent } from '../server/storage/crypto.ts';

/**
 * src/founderbrain/config.ts
 *
 * The one place FounderBrain reads its environment. Every other module takes a
 * `Config` and never touches `process.env`.
 *
 * Sign-in is Cloudflare Access in front of the Worker. The API only needs two
 * facts to verify what Access hands it: the team domain, which is the JWT issuer
 * and the host of the JWKS, and the application's AUD tag. Neither is a secret.
 * The Access session itself lives in Cloudflare and never in this process.
 */

const positive = z.coerce.number().int().positive();
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  DATABASE_URL: z.string().min(1),
  PORT: positive.max(65535).default(8080),
  APP_ORIGIN: z.string().url(),
  ORIGIN_SECRET: z.string().min(32).optional(),
  /** `https://<team>.cloudflareaccess.com`. Issuer of the Access JWT and host of its JWKS. */
  CF_ACCESS_TEAM_DOMAIN: z.string().url().optional(),
  /** The Access application's Audience tag. 64 hex characters, shown in the Zero Trust dashboard. */
  CF_ACCESS_AUD: z.string().regex(/^[a-f0-9]{64}$/i, 'CF_ACCESS_AUD must be the 64 character hex AUD tag').optional(),
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

/** Team domains are always `<team>.cloudflareaccess.com`, HTTPS, and nothing after the host. */
export function validAccessTeamDomain(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.cloudflareaccess.com') &&
      url.hostname.length > '.cloudflareaccess.com'.length &&
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
    if (!c.CF_ACCESS_TEAM_DOMAIN || !c.CF_ACCESS_AUD) {
      throw new Error('Cloudflare Access must be configured: CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.');
    }
    if (!validAccessTeamDomain(c.CF_ACCESS_TEAM_DOMAIN)) {
      throw new Error('CF_ACCESS_TEAM_DOMAIN must be https://<team>.cloudflareaccess.com with no path.');
    }
    if (new URL(c.APP_ORIGIN).protocol !== 'https:') throw new Error('Production origins must use HTTPS.');
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
