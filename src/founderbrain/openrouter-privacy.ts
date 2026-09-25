/**
 * src/founderbrain/openrouter-privacy.ts
 *
 * WHAT THIS IS. Privacy-eligible OpenRouter model allowlist and the three
 * orchestration roles FounderBrain uses for invitation writing.
 *
 * WHY IT EXISTS. Requests must only target models we have reviewed for ZDR /
 * no-training routing. Role defaults keep thinker / runner / verifier fixed
 * without inventing model ids in the job path.
 */

export type OrchestrationRole = "thinker" | "runner" | "verifier";

export interface RoleModels {
  primary: string;
  fallback: string;
  maxTokens: number;
  /** Share of the reserved job budget this role may consume (0–1). */
  budgetShare: number;
}

/**
 * Models suitable for short founder-writing work and eligible under OpenRouter
 * ZDR routing (`provider.zdr: true`). Keep this list short and reviewed.
 *
 * Verified against https://openrouter.ai/api/v1/models on 2026-09-18. The old
 * `claude-3.5-sonnet` / `claude-3.5-haiku` ids were retired from the catalog,
 * which left thinker and verifier pointing at models that no longer resolve.
 * Mirror any change here in the OneDay Atlanta workspace guardrail allowlist.
 */
export const PRIVACY_ELIGIBLE_MODELS = [
  "anthropic/claude-sonnet-4",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-flash",
  "openai/gpt-4o-mini",
] as const;

export type PrivacyEligibleModel = (typeof PRIVACY_ELIGIBLE_MODELS)[number];

const ALLOWED = new Set<string>(PRIVACY_ELIGIBLE_MODELS);

/** Default roles for the 90 day plan orchestration. */
export const DEFAULT_ORCHESTRATION: Record<OrchestrationRole, RoleModels> = {
  thinker: {
    primary: "anthropic/claude-haiku-4.5",
    fallback: "google/gemini-2.5-flash",
    maxTokens: 800,
    budgetShare: 0.2,
  },
  runner: {
    primary: "anthropic/claude-sonnet-4",
    fallback: "anthropic/claude-sonnet-4.5",
    maxTokens: 2400,
    budgetShare: 0.55,
  },
  verifier: {
    primary: "anthropic/claude-haiku-4.5",
    fallback: "google/gemini-2.5-flash",
    maxTokens: 300,
    budgetShare: 0.25,
  },
};

export function isPrivacyEligibleModel(model: string): boolean {
  return ALLOWED.has(model);
}

export function assertPrivacyEligibleModel(model: string): void {
  if (!isPrivacyEligibleModel(model)) {
    throw new Error("Model is not on the FounderBrain privacy allowlist.");
  }
}

export function resolveOrchestration(overrides?: {
  thinker?: string;
  runner?: string;
  verifier?: string;
  thinkerFallback?: string;
  runnerFallback?: string;
  verifierFallback?: string;
}): Record<OrchestrationRole, RoleModels> {
  const pick = (role: OrchestrationRole, override?: string, fallbackOverride?: string): RoleModels => {
    const base = DEFAULT_ORCHESTRATION[role];
    const primary = override ?? base.primary;
    const fallback = fallbackOverride ?? base.fallback;
    assertPrivacyEligibleModel(primary);
    assertPrivacyEligibleModel(fallback);
    return { ...base, primary, fallback };
  };
  return {
    thinker: pick("thinker", overrides?.thinker, overrides?.thinkerFallback),
    runner: pick("runner", overrides?.runner, overrides?.runnerFallback),
    verifier: pick("verifier", overrides?.verifier, overrides?.verifierFallback),
  };
}

/** OpenRouter provider preferences: ZDR + deny data collection / training. */
export const OPENROUTER_PRIVACY_PROVIDER = {
  zdr: true,
  data_collection: "deny",
} as const;
