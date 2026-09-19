/**
 * src/founderbrain/openrouter-management.ts
 *
 * WHAT THIS IS. OpenRouter Management API client for per-user API keys.
 * Create / get / delete only. Never used for chat completions.
 *
 * WHY IT EXISTS. FounderBrain provisions one capped key per founder on signup
 * and revokes it on delete. Management traffic must stay out of provider.ts
 * (inference) so the money path and admin path stay separable.
 *
 * AUTH. Bearer management key (OPENROUTER_MANAGEMENT_KEY). Regular sk-or
 * inference keys are rejected by these routes.
 *
 * WORKSPACE. `workspace_id` is only accepted on create; OpenRouter has no way to
 * move a key afterwards. Without it every founder key lands in the account's
 * Default workspace and misses the OneDay Atlanta guardrail.
 */
import { DomainError } from "./domain.ts";

const KEYS_URL = "https://openrouter.ai/api/v1/keys";

export const OPENROUTER_KEY_NAME_PREFIX = "OneDay-Founderbrain-";
export const OPENROUTER_LIFETIME_USD = 20;
export const OPENROUTER_KEY_TTL_DAYS = 30;

export interface CreatedOpenRouterKey {
  hash: string;
  key: string;
  name: string;
  limit: number | null;
  limitReset: string | null;
  expiresAt: string | null;
}

export interface OpenRouterKeyStatus {
  hash: string;
  name: string;
  disabled: boolean;
  limit: number | null;
  limitRemaining: number | null;
  limitReset: string | null;
  expiresAt: string | null;
  usage: number;
}

export interface OpenRouterManagement {
  createUserKey(email: string, now?: Date): Promise<CreatedOpenRouterKey>;
  getKey(hash: string): Promise<OpenRouterKeyStatus>;
  deleteKey(hash: string): Promise<void>;
}

export function openRouterKeyName(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 200 || !normalized.includes("@")) {
    throw new DomainError(422, "invalid_request", "A verified email is required to provision AI.");
  }
  return `${OPENROUTER_KEY_NAME_PREFIX}${normalized}`;
}

export function openRouterKeyExpiresAt(now = new Date(), ttlDays = OPENROUTER_KEY_TTL_DAYS): string {
  const expires = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  // OpenRouter requires second precision (rejects minute-only timestamps).
  return expires.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function authHeaders(managementKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${managementKey}`,
    "Content-Type": "application/json",
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function createOpenRouterManagement(
  managementKey: string,
  workspaceId?: string,
): OpenRouterManagement {
  if (!managementKey || managementKey.length < 16) {
    throw new Error("OPENROUTER_MANAGEMENT_KEY is required for key administration.");
  }

  return {
    async createUserKey(email, now = new Date()) {
      const name = openRouterKeyName(email);
      const expiresAt = openRouterKeyExpiresAt(now);
      const response = await fetch(KEYS_URL, {
        method: "POST",
        headers: authHeaders(managementKey),
        body: JSON.stringify({
          name,
          limit: OPENROUTER_LIFETIME_USD,
          limit_reset: null,
          expires_at: expiresAt,
          include_byok_in_limit: false,
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
        }),
        signal: AbortSignal.timeout(30000),
      });
      const payload = (await readJson(response)) as {
        key?: string;
        data?: { hash?: string; name?: string; limit?: number | null; limit_reset?: string | null; expires_at?: string | null };
        error?: { message?: string };
      } | null;
      if (!response.ok || !payload?.key || !payload.data?.hash) {
        throw new DomainError(
          503,
          "openrouter_provision_failed",
          "AI key provisioning is temporarily unavailable. Try again shortly.",
        );
      }
      return {
        hash: payload.data.hash,
        key: payload.key,
        name: payload.data.name ?? name,
        limit: payload.data.limit ?? OPENROUTER_LIFETIME_USD,
        limitReset: payload.data.limit_reset ?? null,
        expiresAt: payload.data.expires_at ?? expiresAt,
      };
    },

    async getKey(hash) {
      const response = await fetch(`${KEYS_URL}/${encodeURIComponent(hash)}`, {
        method: "GET",
        headers: authHeaders(managementKey),
        signal: AbortSignal.timeout(15000),
      });
      const payload = (await readJson(response)) as {
        data?: {
          hash?: string;
          name?: string;
          disabled?: boolean;
          limit?: number | null;
          limit_remaining?: number | null;
          limit_reset?: string | null;
          expires_at?: string | null;
          usage?: number;
        };
      } | null;
      if (!response.ok || !payload?.data?.hash) {
        throw new DomainError(
          503,
          "openrouter_status_failed",
          "AI key status could not be verified. Try again shortly.",
        );
      }
      const d = payload.data;
      return {
        hash: d.hash!,
        name: d.name ?? "",
        disabled: Boolean(d.disabled),
        limit: d.limit ?? null,
        limitRemaining: d.limit_remaining ?? null,
        limitReset: d.limit_reset ?? null,
        expiresAt: d.expires_at ?? null,
        usage: typeof d.usage === "number" ? d.usage : 0,
      };
    },

    async deleteKey(hash) {
      const response = await fetch(`${KEYS_URL}/${encodeURIComponent(hash)}`, {
        method: "DELETE",
        headers: authHeaders(managementKey),
        signal: AbortSignal.timeout(15000),
      });
      // 404 means already gone — treat as success for revoke-on-delete.
      if (response.ok || response.status === 404) return;
      throw new DomainError(
        503,
        "openrouter_revoke_failed",
        "AI key revocation is temporarily unavailable. Try again shortly.",
      );
    },
  };
}
