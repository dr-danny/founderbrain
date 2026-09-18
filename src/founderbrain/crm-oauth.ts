/**
 * HighLevel OAuth for FounderBrain Connect. Tokens are sealed in ge_blob.
 * Redirect path is /oauth/callback (must not contain "ghl").
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";
import { openBlob, sealBlob, unwrapDataKey } from "../server/storage/crypto.ts";

export const CRM_SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "locations.readonly",
  "socialplanner/post.readonly",
  "socialplanner/post.write",
  "socialplanner/account.readonly",
  "locations/customValues.readonly",
  "locations/customValues.write",
] as const;

const AUTHORIZE_HOST = "https://marketplace.gohighlevel.com/v2/oauth/chooselocation";
const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const STATE_TTL_MS = 15 * 60 * 1000;

export function crmOAuthConfigured(config: Config): boolean {
  return Boolean(config.HIGHLEVEL_CLIENT_ID && config.HIGHLEVEL_CLIENT_SECRET);
}

export function crmRedirectUri(config: Config): string {
  return `${config.APP_ORIGIN.replace(/\/$/, "")}/oauth/callback`;
}

export function signOauthState(secret: string, subject: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: subject, exp: now + STATE_TTL_MS, n: now.toString(36) }),
    "utf8",
  ).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function readOauthState(secret: string, state: string, now = Date.now()): { sub: string } {
  const [payload, mac] = state.split(".");
  if (!payload || !mac) throw new DomainError(400, "oauth_state_invalid", "Connect expired. Start again.");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new DomainError(400, "oauth_state_invalid", "Connect expired. Start again.");
  const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub?: string;
    exp?: number;
  };
  if (!body.sub || typeof body.exp !== "number" || body.exp < now)
    throw new DomainError(400, "oauth_state_invalid", "Connect expired. Start again.");
  return { sub: body.sub };
}

export function authorizeUrl(config: Config, state: string): string {
  if (!config.HIGHLEVEL_CLIENT_ID)
    throw new DomainError(503, "crm_oauth_not_configured", "Connect is not configured yet.");
  const url = new URL(AUTHORIZE_HOST);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", crmRedirectUri(config));
  url.searchParams.set("client_id", config.HIGHLEVEL_CLIENT_ID);
  url.searchParams.set("scope", CRM_SCOPES.join(" "));
  url.searchParams.set("state", state);
  if (config.HIGHLEVEL_VERSION_ID) url.searchParams.set("version_id", config.HIGHLEVEL_VERSION_ID);
  return url.toString();
}

export async function migrateCrmOauth(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./crm-oauth.sql", import.meta.url), "utf8"));
    });
  } finally {
    await sql.end();
  }
}

async function putBlob(store: PgBrainStore, workspace: string, plaintext: string): Promise<string> {
  return store.scoped(workspace, async (tx) => {
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
      values (${workspace}, ${sealed.sha}, ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.sizeBytes})
      on conflict (founder_id, sha) do nothing
    `;
    return sealed.sha;
  });
}

export async function exchangeCode(
  config: Config,
  code: string,
): Promise<{ accessToken: string; refreshToken: string; locationId: string; expiresIn: number }> {
  if (!config.HIGHLEVEL_CLIENT_ID || !config.HIGHLEVEL_CLIENT_SECRET)
    throw new DomainError(503, "crm_oauth_not_configured", "Connect is not configured yet.");
  const body = new URLSearchParams({
    client_id: config.HIGHLEVEL_CLIENT_ID,
    client_secret: config.HIGHLEVEL_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    user_type: "Location",
    redirect_uri: crmRedirectUri(config),
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    locationId?: string;
    expires_in?: number;
  };
  if (!response.ok || !json.access_token || !json.locationId)
    throw new DomainError(502, "crm_oauth_failed", "HighLevel did not complete Connect. Try again.");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? "",
    locationId: json.locationId,
    expiresIn: json.expires_in ?? 86400,
  };
}

export async function saveConnection(
  store: PgBrainStore,
  workspace: string,
  tokens: { accessToken: string; refreshToken: string; locationId: string; expiresIn: number },
): Promise<void> {
  const sha = await putBlob(
    store,
    workspace,
    JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }),
  );
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
  await store.scoped(workspace, async (tx) => {
    await tx`
      insert into fb_crm_connection (founder_id, location_id, token_blob_sha, expires_at, connected_at, updated_at)
      values (${workspace}, ${tokens.locationId}, ${sha}, ${expiresAt}, now(), now())
      on conflict (founder_id) do update set
        location_id = excluded.location_id,
        token_blob_sha = excluded.token_blob_sha,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `;
  });
}

export async function connectionStatus(
  store: PgBrainStore,
  workspace: string,
): Promise<{ connected: boolean; locationId: string | null }> {
  const row = await store.scoped(workspace, async (tx) => {
    const rows = await tx`
      select location_id from fb_crm_connection where founder_id = ${workspace}
    `;
    return rows[0] as { location_id: string } | undefined;
  });
  return { connected: Boolean(row), locationId: row?.location_id ?? null };
}

/** Kept so a future push job can open the token. Not returned to the browser. */
export async function readConnection(
  store: PgBrainStore,
  workspace: string,
): Promise<{ accessToken: string; refreshToken: string; locationId: string } | null> {
  return store.scoped(workspace, async (tx) => {
    const rows = await tx`
      select c.location_id, c.token_blob_sha, b.ciphertext, b.nonce, f.wrapped_key
      from fb_crm_connection c
      join ge_blob b on b.founder_id = c.founder_id and b.sha = c.token_blob_sha
      join founder f on f.id = c.founder_id
      where c.founder_id = ${workspace}
    `;
    const row = rows[0] as
      | {
          location_id: string;
          token_blob_sha: string;
          ciphertext: Buffer;
          nonce: Buffer;
          wrapped_key: Buffer;
        }
      | undefined;
    if (!row) return null;
    const plain = openBlob(
      workspace,
      unwrapDataKey(workspace, row.wrapped_key),
      row.token_blob_sha,
      row.ciphertext,
      row.nonce,
    ).toString("utf8");
    const tokens = JSON.parse(plain) as { accessToken: string; refreshToken: string };
    return { ...tokens, locationId: row.location_id };
  });
}
