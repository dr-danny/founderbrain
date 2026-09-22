/**
 * src/founderbrain/apollo.ts
 *
 * WHAT THIS IS. The Apollo connection for B2B founders. The founder pastes their
 * own API key; the app proves it works with the one call Apollo documents as
 * costing no credits, then seals the key. Maintenance runs read campaign
 * figures and nothing else. No enrichment, no contact adds, no sends, no
 * starting or stopping anything: those stay the founder's hands in Apollo.
 *
 * WHERE THE CONSTANTS COME FROM. Host, header and paths are the documented
 * values from `src/server/integrations/contracts/apollo.ts` (same repo, read
 * against Apollo's published reference). The campaign search endpoint answers
 * 403 for a non-master key; that outcome is named, not folded into "rejected",
 * so a founder with a scoped key is told the truth instead of remaking a key
 * that fails the same way.
 *
 * THE KEY NEVER APPEARS in a return value, a log line or an error from here.
 */
import { readFile } from "node:fs/promises";

import postgres from "postgres";
import { DomainError } from "./domain.ts";
import type { PgBrainStore } from "./store.ts";
import { openBlob, sealBlob, unwrapDataKey } from "../server/storage/crypto.ts";

const APOLLO_HOST = "https://api.apollo.io";
const KEY_CHECK_PATH = "/api/v1/mixed_people/api_search";
const CAMPAIGN_SEARCH_PATH = "/api/v1/emailer_campaigns/search";
const REQUEST_TIMEOUT_MS = 15_000;

export type ApolloKeyOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "auth_rejected" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "vendor_unavailable" }
  | { readonly kind: "unreadable"; readonly why: string };

export function outcomeForApolloStatus(status: number): ApolloKeyOutcome | null {
  if (status === 401) return { kind: "auth_rejected" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 429) return { kind: "rate_limited" };
  if (status >= 500) return { kind: "vendor_unavailable" };
  return null;
}

function readSearchBody(body: unknown): ApolloKeyOutcome {
  if (body === null || typeof body !== "object")
    return { kind: "unreadable", why: "Apollo answered 200 with no JSON object" };
  if (!Array.isArray((body as { people?: unknown }).people))
    return { kind: "unreadable", why: "Apollo answered 200 without a people array" };
  return { kind: "ok" };
}

/** Does this key work? The key never appears in a return value or error. */
export async function checkApolloKey(
  key: string,
  fetchImpl: typeof globalThis.fetch = fetch,
): Promise<ApolloKeyOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${APOLLO_HOST}${KEY_CHECK_PATH}`, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ person_titles: ["ceo"], per_page: 1 }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "unreadable", why: error instanceof Error ? error.message : "the call failed" };
  }
  if (response.status === 401) return { kind: "auth_rejected" };
  if (response.status === 403) return { kind: "forbidden" };
  if (response.status === 429) return { kind: "rate_limited" };
  if (response.status >= 500) return { kind: "vendor_unavailable" };
  if (response.status < 200 || response.status >= 300)
    return { kind: "unreadable", why: `Apollo answered ${String(response.status)}` };
  const body: unknown = await response.json().catch(() => null);
  return readSearchBody(body);
}

// ---------------------------------------------------------------------------
// Campaign figures (the sequence-health read). Parse defensively: only figures
// Apollo returned are reported, and every numeric field is read only when it
// is a number. A missing field is reported as absent, never as zero.
// ---------------------------------------------------------------------------

export type CampaignFigures = {
  readonly id: string | null;
  readonly name: string | null;
  readonly active: boolean | null;
  readonly loadedStats: boolean;
  readonly uniqueDelivered: number | null;
  readonly uniqueBounced: number | null;
  readonly uniqueOpened: number | null;
  readonly uniqueReplied: number | null;
};

export type CampaignRead =
  | { readonly kind: "ok"; readonly campaigns: readonly CampaignFigures[] }
  | { readonly kind: "auth_rejected" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "vendor_unavailable" }
  | { readonly kind: "unreadable"; readonly why: string };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Pure parser so the response shape can be held in tests without a live key. */
export function parseCampaigns(body: unknown): readonly CampaignFigures[] {
  const campaigns = (body as { emailer_campaigns?: unknown } | null)?.emailer_campaigns;
  if (!Array.isArray(campaigns)) return [];
  return campaigns.map((c) => {
    const row = (c ?? {}) as Record<string, unknown>;
    return {
      id: typeof row.id === "string" ? row.id : null,
      name: typeof row.name === "string" ? row.name : null,
      active: typeof row.active === "boolean" ? row.active : null,
      loadedStats: row.loaded_stats === true,
      uniqueDelivered: num(row.unique_delivered),
      uniqueBounced: num(row.unique_bounced),
      uniqueOpened: num(row.unique_opened),
      uniqueReplied: num(row.unique_replied),
    };
  });
}

export async function readCampaigns(
  key: string,
  fetchImpl: typeof globalThis.fetch = fetch,
): Promise<CampaignRead> {
  let response: Response;
  try {
    response = await fetchImpl(`${APOLLO_HOST}${CAMPAIGN_SEARCH_PATH}`, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ per_page: 10, page: 1 }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { kind: "vendor_unavailable" };
  }
  if (response.status === 401) return { kind: "auth_rejected" };
  if (response.status === 403) return { kind: "forbidden" };
  if (response.status === 429) return { kind: "rate_limited" };
  if (response.status >= 500) return { kind: "vendor_unavailable" };
  if (response.status < 200 || response.status >= 300)
    return { kind: "unreadable", why: `Apollo answered ${String(response.status)}` };
  const body: unknown = await response.json().catch(() => null);
  if (body === null || typeof body !== "object") return { kind: "ok", campaigns: [] };
  return { kind: "ok", campaigns: parseCampaigns(body) };
}

// ---------------------------------------------------------------------------
// Storage. Same shape as fb_crm_connection: the key sealed in ge_blob, the
// row carries only a hash and the read verdicts.
// ---------------------------------------------------------------------------

export async function migrateApollo(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./apollo.sql", import.meta.url), "utf8"));
    });
  } finally {
    await sql.end();
  }
}

export type ApolloStatus = { connected: boolean; checkedAt: string | null; sequencesReadable: boolean | null };

export async function apolloStatus(store: PgBrainStore, workspace: string): Promise<ApolloStatus> {
  const row = await store.scoped(workspace, async (tx) =>
    tx<{ checked_at: string; sequences_readable: boolean | null }[]>`
      select checked_at, sequences_readable from fb_apollo_connection where founder_id = ${workspace}
    `,
  );
  return {
    connected: Boolean(row[0]),
    checkedAt: row[0] ? new Date(row[0].checked_at).toISOString() : null,
    sequencesReadable: row[0]?.sequences_readable ?? null,
  };
}

async function putKeyBlob(store: PgBrainStore, workspace: string, key: string): Promise<string> {
  return store.scoped(workspace, async (tx) => {
    const rows =
      await tx`select wrapped_key from founder where id=${workspace} and deleted_at is null`;
    if (!rows[0]) throw new DomainError(404, "workspace_missing", "Workspace not found.");
    const sealed = sealBlob(
      workspace,
      unwrapDataKey(workspace, rows[0].wrapped_key),
      Buffer.from(key, "utf8"),
    );
    await tx`
      insert into ge_blob(founder_id, sha, ciphertext, nonce, size_bytes)
      values (${workspace}, ${sealed.sha}, ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.sizeBytes})
      on conflict (founder_id, sha) do nothing
    `;
    return sealed.sha;
  });
}

/** Prove the key, seal it, and record whether the key can read sequences. */
export async function connectApollo(
  store: PgBrainStore,
  workspace: string,
  key: string,
): Promise<ApolloStatus> {
  const outcome = await checkApolloKey(key);
  if (outcome.kind === "auth_rejected")
    throw new DomainError(422, "apollo_key_rejected", "Apollo did not accept that key. Check it and paste it again.");
  if (outcome.kind === "forbidden")
    throw new DomainError(
      422,
      "apollo_key_forbidden",
      "The key reached Apollo but the search endpoint is not open to it: the plan or the key scope is missing it.",
    );
  if (outcome.kind === "rate_limited")
    throw new DomainError(429, "apollo_rate_limited", "Apollo is rate limiting the check. Wait a minute and try again.");
  if (outcome.kind === "vendor_unavailable")
    throw new DomainError(503, "apollo_unavailable", "Apollo did not answer. Try again in a few minutes.");
  if (outcome.kind === "unreadable")
    throw new DomainError(503, "apollo_unreadable", "The check could not be read. Try again in a minute.");

  const campaignRead = await readCampaigns(key);
  const sequencesReadable = campaignRead.kind === "ok" ? true : campaignRead.kind === "forbidden" ? false : null;

  const sha = await putKeyBlob(store, workspace, key);
  await store.scoped(workspace, async (tx) => {
    await tx`
      insert into fb_apollo_connection (founder_id, key_blob_sha, sequences_readable, checked_at, connected_at, updated_at)
      values (${workspace}, ${sha}, ${sequencesReadable}, now(), now(), now())
      on conflict (founder_id) do update set
        key_blob_sha = excluded.key_blob_sha,
        sequences_readable = excluded.sequences_readable,
        checked_at = excluded.checked_at,
        updated_at = excluded.updated_at
    `;
  });
  return apolloStatus(store, workspace);
}

export async function disconnectApollo(store: PgBrainStore, workspace: string): Promise<void> {
  await store.scoped(workspace, async (tx) => {
    await tx`delete from fb_apollo_connection where founder_id = ${workspace}`;
  });
}

/** For maintenance reads only. Never logged, never returned to the browser. */
export async function readApolloKey(store: PgBrainStore, workspace: string): Promise<string | null> {
  const rows = await store.scoped(workspace, async (tx) =>
    tx<{ key_blob_sha: string; ciphertext: Buffer; nonce: Buffer; wrapped_key: Buffer }[]>`
      select c.key_blob_sha, b.ciphertext, b.nonce, f.wrapped_key
      from fb_apollo_connection c
      join ge_blob b on b.founder_id = c.founder_id and b.sha = c.key_blob_sha
      join founder f on f.id = c.founder_id
      where c.founder_id = ${workspace}
    `,
  );
  const row = rows[0];
  if (!row) return null;
  return openBlob(
    workspace,
    unwrapDataKey(workspace, row.wrapped_key),
    row.key_blob_sha,
    row.ciphertext,
    row.nonce,
  ).toString("utf8");
}