/**
 * src/founderbrain/openrouter-keys.ts
 *
 * WHAT THIS IS. Server-side provision, load, spend gate, and revoke for
 * per-founder OpenRouter API keys. Ciphertext lives in ge_blob; metadata in
 * fb_openrouter_key. The plaintext key never leaves the API/worker process.
 *
 * WHY IT EXISTS. Danny's product rule: one key per user on signup, $20 lifetime
 * with no reset, 30-day expiry, revoke on account deletion, never expose to the
 * browser.
 */
import { readFile } from "node:fs/promises";
import postgres, { type TransactionSql } from "postgres";
import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";
import { openBlob, sealBlob, unwrapDataKey } from "../server/storage/crypto.ts";
import {
  OPENROUTER_KEY_TTL_DAYS,
  OPENROUTER_LIFETIME_USD,
  createOpenRouterManagement,
  openRouterKeyName,
  type OpenRouterManagement,
} from "./openrouter-management.ts";

type Tx = TransactionSql;

export interface StoredOpenRouterKey {
  founderId: string;
  keyHash: string;
  keyName: string;
  expiresAt: Date;
  lifetimeLimitUsd: number;
  spentMicroUsd: number;
  revokedAt: Date | null;
}

const LIFETIME_MICROUSD = OPENROUTER_LIFETIME_USD * 1_000_000;

export async function migrateOpenRouterKeys(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./openrouter-keys.sql", import.meta.url), "utf8"));
    });
  } finally {
    await sql.end();
  }
}

async function putKeyBlob(tx: Tx, workspace: string, plaintext: string): Promise<string> {
  const rows =
    await tx`select wrapped_key from founder where id=${workspace} and deleted_at is null`;
  if (!rows[0]) throw new DomainError(404, "workspace_missing", "Workspace not found.");
  const sealed = sealBlob(
    workspace,
    unwrapDataKey(workspace, rows[0].wrapped_key),
    Buffer.from(plaintext, "utf8"),
  );
  await tx`
    insert into ge_blob(founder_id, sha, ciphertext, nonce, size_bytes)
    values (
      ${workspace}, ${sealed.sha}, ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.sizeBytes}
    )
    on conflict (founder_id, sha) do nothing
  `;
  return sealed.sha;
}

async function getKeyBlob(tx: Tx, workspace: string, sha: string): Promise<string> {
  const r = await tx`
    select b.ciphertext, b.nonce, f.wrapped_key
    from ge_blob b
    join founder f on f.id = b.founder_id
    where b.founder_id = ${workspace} and b.sha = ${sha}
  `;
  if (!r[0]) {
    throw new DomainError(503, "openrouter_key_missing", "AI credentials are not available.");
  }
  return openBlob(
    workspace,
    unwrapDataKey(workspace, r[0].wrapped_key),
    sha,
    r[0].ciphertext,
    r[0].nonce,
  ).toString("utf8");
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function keyIsUsable(row: StoredOpenRouterKey, now = new Date()): void {
  if (row.revokedAt) {
    throw new DomainError(403, "openrouter_key_revoked", "AI access for this account was revoked.");
  }
  if (asDate(row.expiresAt).getTime() <= now.getTime()) {
    throw new DomainError(
      403,
      "openrouter_key_expired",
      "The AI key for this account has expired. Contact support to continue.",
    );
  }
  if (row.spentMicroUsd >= LIFETIME_MICROUSD) {
    throw new DomainError(
      429,
      "openrouter_lifetime_limit",
      "The lifetime AI budget for this account is spent. Editing and exports remain available.",
    );
  }
}

/** Validate live OpenRouter key settings before persisting a provisioned key. */
export function assertProvisionedKeyContract(
  status: {
    limit: number | null;
    limitReset: string | null;
    disabled: boolean;
    expiresAt: string | null;
  },
  expectedExpiresAt?: string | null,
): void {
  if (status.disabled) {
    throw new DomainError(
      503,
      "openrouter_provision_failed",
      "AI key provisioning returned a disabled key and was rejected.",
    );
  }
  if (status.limit !== OPENROUTER_LIFETIME_USD) {
    throw new DomainError(
      503,
      "openrouter_provision_failed",
      "AI key provisioning returned an unexpected spend limit and was rejected.",
    );
  }
  if (status.limitReset !== null) {
    throw new DomainError(
      503,
      "openrouter_provision_failed",
      "AI key provisioning returned a renewable limit and was rejected.",
    );
  }
  if (!status.expiresAt) {
    throw new DomainError(
      503,
      "openrouter_provision_failed",
      "AI key provisioning returned a key without expiry and was rejected.",
    );
  }
  if (expectedExpiresAt) {
    const live = Date.parse(status.expiresAt);
    const expected = Date.parse(expectedExpiresAt);
    if (
      !Number.isFinite(live) ||
      !Number.isFinite(expected) ||
      Math.abs(live - expected) > 120_000
    ) {
      throw new DomainError(
        503,
        "openrouter_provision_failed",
        "AI key provisioning returned an unexpected expiry and was rejected.",
      );
    }
  }
}

function rowFromDb(r: {
  founder_id: string;
  key_hash: string;
  key_name: string;
  expires_at: Date | string;
  lifetime_limit_usd: number | string;
  spent_microusd: number | string;
  revoked_at: Date | string | null;
}): StoredOpenRouterKey {
  return {
    founderId: r.founder_id,
    keyHash: r.key_hash,
    keyName: r.key_name,
    expiresAt: asDate(r.expires_at),
    lifetimeLimitUsd: Number(r.lifetime_limit_usd),
    spentMicroUsd: Number(r.spent_microusd),
    revokedAt: r.revoked_at ? asDate(r.revoked_at) : null,
  };
}

// postgres.js Row is structurally matching but not nominally typed for our helper.
function keyRow(r: object): StoredOpenRouterKey {
  return rowFromDb(r as Parameters<typeof rowFromDb>[0]);
}

export async function ensureOpenRouterKey(
  store: PgBrainStore,
  config: Config,
  workspace: string,
  email: string,
  management?: OpenRouterManagement,
): Promise<StoredOpenRouterKey> {
  const client =
    management ??
    (config.OPENROUTER_MANAGEMENT_KEY
      ? createOpenRouterManagement(config.OPENROUTER_MANAGEMENT_KEY)
      : undefined);
  if (!client) {
    throw new DomainError(
      503,
      "openrouter_not_configured",
      "AI provisioning is not configured yet.",
    );
  }
  const existing = await store.scoped(workspace, async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"or-key:" + workspace}))`;
    const rows = await tx`
      select founder_id, key_hash, key_name, expires_at, lifetime_limit_usd, spent_microusd, revoked_at
      from fb_openrouter_key
      where founder_id = ${workspace}
      for update
    `;
    return rows[0] ?? null;
  });
  if (existing) {
    const row = keyRow(existing);
    if (!row.revokedAt) return row;
    throw new DomainError(403, "openrouter_key_revoked", "AI access for this account was revoked.");
  }

  const created = await client.createUserKey(email);
  try {
    if (created.limitReset !== null) {
      throw new DomainError(
        503,
        "openrouter_provision_failed",
        "AI key provisioning returned a renewable limit and was rejected.",
      );
    }
    const verified = await client.getKey(created.hash);
    assertProvisionedKeyContract(verified, created.expiresAt);
  } catch (error) {
    await client.deleteKey(created.hash).catch(() => {});
    throw error;
  }

  try {
    return await store.scoped(workspace, async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${"or-key:" + workspace}))`;
      const raced = await tx`
        select founder_id, key_hash, key_name, expires_at, lifetime_limit_usd, spent_microusd, revoked_at
        from fb_openrouter_key
        where founder_id = ${workspace}
        for update
      `;
      if (raced[0]) {
        await client.deleteKey(created.hash).catch(() => {});
        return keyRow(raced[0]);
      }
      const sha = await putKeyBlob(tx, workspace, created.key);
      const expiresAt =
        created.expiresAt ??
        new Date(Date.now() + OPENROUTER_KEY_TTL_DAYS * 864e5).toISOString();
      const inserted = await tx`
        insert into fb_openrouter_key (
          founder_id, key_hash, key_name, key_blob_sha, expires_at, lifetime_limit_usd, spent_microusd
        ) values (
          ${workspace},
          ${created.hash},
          ${created.name || openRouterKeyName(email)},
          ${sha},
          ${expiresAt},
          ${OPENROUTER_LIFETIME_USD},
          0
        )
        on conflict (founder_id) do nothing
        returning founder_id, key_hash, key_name, expires_at, lifetime_limit_usd, spent_microusd, revoked_at
      `;
      if (!inserted[0]) {
        await client.deleteKey(created.hash).catch(() => {});
        const winner = await tx`
          select founder_id, key_hash, key_name, expires_at, lifetime_limit_usd, spent_microusd, revoked_at
          from fb_openrouter_key
          where founder_id = ${workspace}
        `;
        if (!winner[0]) {
          throw new DomainError(
            503,
            "openrouter_provision_failed",
            "AI key provisioning raced and could not be completed. Try again shortly.",
          );
        }
        return keyRow(winner[0]);
      }
      return keyRow(inserted[0]);
    });
  } catch (error) {
    // Persist failed after remote create (and we were not a clean race-loss return).
    await client.deleteKey(created.hash).catch(() => {});
    throw error;
  }
}

export async function loadOpenRouterApiKey(
  store: PgBrainStore,
  workspace: string,
  now = new Date(),
): Promise<{ apiKey: string; meta: StoredOpenRouterKey }> {
  return store.scoped(workspace, async (tx) => {
    const rows = await tx`
      select founder_id, key_hash, key_name, key_blob_sha, expires_at,
             lifetime_limit_usd, spent_microusd, revoked_at
      from fb_openrouter_key
      where founder_id = ${workspace}
      for update
    `;
    const row = rows[0];
    if (!row) {
      throw new DomainError(
        503,
        "openrouter_key_missing",
        "AI credentials are not provisioned for this account yet.",
      );
    }
    const meta: StoredOpenRouterKey = {
      founderId: row.founder_id,
      keyHash: row.key_hash,
      keyName: row.key_name,
      expiresAt: asDate(row.expires_at),
      lifetimeLimitUsd: Number(row.lifetime_limit_usd),
      spentMicroUsd: Number(row.spent_microusd),
      revokedAt: row.revoked_at ? asDate(row.revoked_at) : null,
    };
    keyIsUsable(meta, now);
    const apiKey = await getKeyBlob(tx, workspace, row.key_blob_sha);
    return { apiKey, meta };
  });
}

export async function recordOpenRouterSpend(
  store: PgBrainStore,
  workspace: string,
  costMicroUsd: number,
  options: { allowOverLifetime?: boolean } = {},
): Promise<void> {
  if (!Number.isSafeInteger(costMicroUsd) || costMicroUsd < 0) {
    throw new DomainError(503, "openrouter_spend_invalid", "Spend could not be recorded.");
  }
  if (costMicroUsd === 0) return;
  await store.scoped(workspace, async (tx) => {
    const updated = options.allowOverLifetime
      ? await tx`
          update fb_openrouter_key
          set spent_microusd = spent_microusd + ${costMicroUsd}
          where founder_id = ${workspace}
            and revoked_at is null
          returning spent_microusd
        `
      : await tx`
          update fb_openrouter_key
          set spent_microusd = spent_microusd + ${costMicroUsd}
          where founder_id = ${workspace}
            and revoked_at is null
            and spent_microusd + ${costMicroUsd} <= ${LIFETIME_MICROUSD}
          returning spent_microusd
        `;
    if (!updated.length) {
      throw new DomainError(
        429,
        "openrouter_lifetime_limit",
        "The lifetime AI budget for this account is spent. Editing and exports remain available.",
      );
    }
  });
}

export async function revokeOpenRouterKey(
  store: PgBrainStore,
  config: Config,
  workspace: string,
  management?: OpenRouterManagement,
): Promise<void> {
  const row = await store.scoped(workspace, async (tx) => {
    const rows = await tx`
      select key_hash, revoked_at from fb_openrouter_key where founder_id = ${workspace} for update
    `;
    return rows[0] ?? null;
  });
  if (!row || row.revoked_at) return;

  const client =
    management ??
    (config.OPENROUTER_MANAGEMENT_KEY
      ? createOpenRouterManagement(config.OPENROUTER_MANAGEMENT_KEY)
      : undefined);
  if (client) {
    await client.deleteKey(row.key_hash);
  }

  await store.scoped(workspace, async (tx) => {
    await tx`
      update fb_openrouter_key
      set revoked_at = now()
      where founder_id = ${workspace} and revoked_at is null
    `;
  });
}
