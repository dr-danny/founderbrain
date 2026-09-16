import { z } from 'zod';
import { assertMasterKeyPresent } from '../server/storage/crypto.ts';

const positive = z.coerce.number().int().positive();
const envSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('production'),
  DATABASE_URL: z.string().min(1), PORT: positive.max(65535).default(8080),
  APP_ORIGIN: z.string().url(), ORIGIN_SECRET: z.string().min(32).optional(),
  SUPABASE_URL: z.string().url().optional(), SUPABASE_ANON_KEY: z.string().optional(),
  FOUNDERBRAIN_LOCAL_DEMO: z.enum(['true','false']).default('false'),
  AI_ENABLED: z.enum(['true','false']).default('false'), ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(), AI_INPUT_USD_PER_MILLION: z.coerce.number().positive().optional(),
  AI_OUTPUT_USD_PER_MILLION: z.coerce.number().positive().optional(), AI_WORKSPACE_DAILY_MICROUSD: positive.optional(),
  AI_GLOBAL_DAILY_MICROUSD: positive.optional(),
});
export type Config = z.infer<typeof envSchema>;
export function loadConfig(raw:NodeJS.ProcessEnv=process.env):Config {
  const parsed=envSchema.safeParse(raw);
  if(!parsed.success) throw new Error('Invalid FounderBrain configuration: '+parsed.error.issues.map(i=>i.path.join('.')).join(', '));
  const c=parsed.data; const local=c.FOUNDERBRAIN_LOCAL_DEMO==='true';
  if(local && c.NODE_ENV==='production') throw new Error('Local demo authentication is forbidden in production.');
  if(!local && (!c.ORIGIN_SECRET || !c.SUPABASE_URL || !c.SUPABASE_ANON_KEY)) throw new Error('Production sign-in and origin authentication must be configured.');
  if(!local && (new URL(c.APP_ORIGIN).protocol!=='https:' || new URL(c.SUPABASE_URL!).protocol!=='https:')) throw new Error('Production origins must use HTTPS.');
  if(c.SUPABASE_ANON_KEY){
    const payload=c.SUPABASE_ANON_KEY.split('.')[1];
    if(c.SUPABASE_ANON_KEY.startsWith('sb_secret_')) throw new Error('Use a Supabase publishable key, not a service key.');
    if(payload){try{if(JSON.parse(Buffer.from(payload,'base64url').toString()).role==='service_role') throw new Error('service key');}catch(e){if(e instanceof Error&&e.message==='service key')throw new Error('Use a Supabase anon key, not a service-role key.');}}
  }
  if(c.AI_ENABLED==='true' && (!c.ANTHROPIC_API_KEY||!c.AI_MODEL||!c.AI_INPUT_USD_PER_MILLION||!c.AI_OUTPUT_USD_PER_MILLION||!c.AI_WORKSPACE_DAILY_MICROUSD||!c.AI_GLOBAL_DAILY_MICROUSD)) throw new Error('AI requires a model, key, explicit prices and approved daily budget caps.');
  assertMasterKeyPresent();
  return c;
}
