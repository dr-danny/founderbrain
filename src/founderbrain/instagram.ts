/**
 * Instagram Login for the Saturday handle screen.
 * Reads the founder's own Business or Creator photos. Does not publish.
 * Tokens are sealed in ge_blob. The browser only sees a username and a count.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";
import { openBlob, sealBlob, unwrapDataKey } from "../server/storage/crypto.ts";
import { readOrientation, writeOrientation } from "./orientation.ts";
import { presignR2 } from "./r2.ts";
import { r2Fetch } from "./media-http.ts";
import { countMedia, r2FromConfig, safeName } from "./media.ts";

export const INSTAGRAM_SCOPE = "instagram_business_basic";
const AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH_HOST = "https://graph.instagram.com";
const GRAPH_VERSION = "v26.0";
const STATE_TTL_MS = 15 * 60 * 1000;
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const INSTAGRAM_PULL_LIMIT = 8;
const PULL_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type FetchLike = typeof fetch;

export function instagramConfigured(config: Config): boolean {
  return Boolean(config.INSTAGRAM_APP_ID && config.INSTAGRAM_APP_SECRET);
}

export function instagramRedirectUri(config: Config): string {
  return `${config.APP_ORIGIN.replace(/\/$/, "")}/instagram/callback`;
}

export function signInstagramState(secret: string, subject: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ kind: "instagram", sub: subject, exp: now + STATE_TTL_MS, n: now.toString(36) }),
    "utf8",
  ).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function readInstagramState(secret: string, state: string, now = Date.now()): { sub: string } {
  const [payload, mac] = state.split(".");
  if (!payload || !mac) throw new DomainError(400, "oauth_state_invalid", "Connect expired. Start again.");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new DomainError(400, "oauth_state_invalid", "Connect expired. Start again.");
  const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    kind?: string;
    sub?: string;
    exp?: number;
  };
  if (body.kind !== "instagram" || !body.sub || typeof body.exp !== "number" || body.exp < now)
    throw new DomainError(400, "oauth_state_invalid", "Connect expired. Start again.");
  return { sub: body.sub };
}

export function instagramAuthorizeUrl(config: Config, state: string): string {
  if (!config.INSTAGRAM_APP_ID)
    throw new DomainError(503, "instagram_not_configured", "Instagram Connect is not configured yet.");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.INSTAGRAM_APP_ID);
  url.searchParams.set("redirect_uri", instagramRedirectUri(config));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPE);
  url.searchParams.set("enable_fb_login", "false");
  url.searchParams.set("force_reauth", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Meta appends #_ to the redirect. It is not part of the code. */
export function stripAuthCode(code: string): string {
  return code.replace(/#_$/, "").trim();
}

export function readShortToken(json: unknown): { accessToken: string; userId: string } {
  const row = (json as { data?: Array<{ access_token?: string; user_id?: string | number; permissions?: string }> })
    .data?.[0];
  if (!row?.access_token || row.user_id === undefined || row.user_id === null)
    throw new DomainError(422, "instagram_oauth_failed", "Instagram did not complete Connect. Try again.");
  const granted = (row.permissions ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!granted.includes(INSTAGRAM_SCOPE) || granted.some((part) => part !== INSTAGRAM_SCOPE))
    throw new DomainError(
      422,
      "instagram_scope",
      "Instagram offered more than read access. Connect was refused.",
    );
  return { accessToken: row.access_token, userId: String(row.user_id) };
}

export function handleDecision(
  saved: string | undefined,
  username: string,
): "fill" | "same" | "keep" {
  const next = username.replace(/^@/, "").trim().toLowerCase();
  const current = (saved ?? "").replace(/^@/, "").trim().toLowerCase();
  if (!next) return "keep";
  if (!current) return "fill";
  return current === next ? "same" : "keep";
}

export type InstagramMedia = {
  id?: string;
  media_type?: string;
  media_url?: string;
};

/** Photos only. Videos stay on Instagram. A missing URL is not a file we can keep. */
export function imageMedia(items: InstagramMedia[]): Array<{ id: string; url: string }> {
  const chosen: Array<{ id: string; url: string }> = [];
  for (const item of items) {
    if (chosen.length >= INSTAGRAM_PULL_LIMIT) break;
    if (item.media_type !== "IMAGE" || !item.id || !item.media_url?.startsWith("https://")) continue;
    chosen.push({ id: item.id, url: item.media_url });
  }
  return chosen;
}

export async function migrateInstagram(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./instagram.sql", import.meta.url), "utf8"));
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

export type InstagramStatus = {
  configured: boolean;
  connected: boolean;
  username: string | null;
};

export async function instagramStatus(
  store: PgBrainStore,
  workspace: string,
  config: Config,
): Promise<InstagramStatus> {
  const row = await store.scoped(workspace, async (tx) => {
    const rows = await tx`
      select username from fb_instagram_connection where founder_id = ${workspace}
    `;
    return rows[0] as { username: string } | undefined;
  });
  return {
    configured: instagramConfigured(config),
    connected: Boolean(row),
    username: row?.username ?? null,
  };
}

async function graphGet(
  path: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  url.searchParams.set("access_token", token);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  const json = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok)
    throw new DomainError(422, "instagram_oauth_failed", "Instagram did not complete Connect. Try again.");
  return json;
}

function readProfile(json: unknown): { userId: string; username: string } {
  const body = json as {
    user_id?: string | number;
    username?: string;
    data?: Array<{ user_id?: string | number; username?: string }>;
  };
  const row = body.data?.[0] ?? body;
  if (!row.user_id || !row.username)
    throw new DomainError(422, "instagram_oauth_failed", "Instagram did not complete Connect. Try again.");
  return { userId: String(row.user_id), username: row.username.replace(/^@/, "") };
}

async function exchangeShort(
  config: Config,
  code: string,
  fetchImpl: FetchLike,
): Promise<{ accessToken: string; userId: string }> {
  if (!config.INSTAGRAM_APP_ID || !config.INSTAGRAM_APP_SECRET)
    throw new DomainError(503, "instagram_not_configured", "Instagram Connect is not configured yet.");
  const body = new FormData();
  body.set("client_id", config.INSTAGRAM_APP_ID);
  body.set("client_secret", config.INSTAGRAM_APP_SECRET);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", instagramRedirectUri(config));
  body.set("code", stripAuthCode(code));
  const response = await fetchImpl(TOKEN_URL, { method: "POST", body, signal: AbortSignal.timeout(15_000) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new DomainError(422, "instagram_oauth_failed", "Instagram did not complete Connect. Try again.");
  return readShortToken(json);
}

async function exchangeLong(
  config: Config,
  shortToken: string,
  fetchImpl: FetchLike,
): Promise<{ accessToken: string; expiresIn: number }> {
  if (!config.INSTAGRAM_APP_SECRET)
    throw new DomainError(503, "instagram_not_configured", "Instagram Connect is not configured yet.");
  const url = new URL(`${GRAPH_HOST}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.INSTAGRAM_APP_SECRET);
  url.searchParams.set("access_token", shortToken);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!response.ok || !json.access_token)
    throw new DomainError(422, "instagram_oauth_failed", "Instagram did not complete Connect. Try again.");
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 5_183_944 };
}

async function saveConnection(
  store: PgBrainStore,
  workspace: string,
  tokens: { accessToken: string; userId: string; username: string; expiresIn: number },
): Promise<void> {
  const sha = await putBlob(store, workspace, JSON.stringify({ accessToken: tokens.accessToken }));
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
  await store.scoped(workspace, async (tx) => {
    await tx`
      insert into fb_instagram_connection
        (founder_id, ig_user_id, username, token_blob_sha, expires_at, connected_at, updated_at)
      values (${workspace}, ${tokens.userId}, ${tokens.username}, ${sha}, ${expiresAt}, now(), now())
      on conflict (founder_id) do update set
        ig_user_id = excluded.ig_user_id,
        username = excluded.username,
        token_blob_sha = excluded.token_blob_sha,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `;
  });
}

export async function completeInstagram(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<InstagramStatus & { handle: "fill" | "same" | "keep"; orientation: Awaited<ReturnType<typeof writeOrientation>> | null }> {
  const short = await exchangeShort(config, code, fetchImpl);
  const long = await exchangeLong(config, short.accessToken, fetchImpl);
  const profile = readProfile(
    await graphGet("me?fields=user_id,username", long.accessToken, fetchImpl),
  );
  await saveConnection(store, workspace, {
    accessToken: long.accessToken,
    userId: profile.userId,
    username: profile.username,
    expiresIn: long.expiresIn,
  });
  const current = await readOrientation(store, workspace);
  const decision = handleDecision(current.contentAnswers.instagramHandle, profile.username);
  const orientation =
    decision === "fill"
      ? await writeOrientation(store, workspace, {
          contentAnswers: { instagramHandle: profile.username },
        })
      : null;
  const status = await instagramStatus(store, workspace, config);
  return { ...status, handle: decision, orientation };
}

type StoredToken = {
  accessToken: string;
  userId: string;
  username: string;
  expiresAt: number;
  updatedAt: number;
};

async function readToken(store: PgBrainStore, workspace: string): Promise<StoredToken | null> {
  return store.scoped(workspace, async (tx) => {
    const rows = await tx`
      select c.ig_user_id, c.username, c.expires_at, c.updated_at, b.ciphertext, b.nonce, b.sha, f.wrapped_key
      from fb_instagram_connection c
      join ge_blob b on b.founder_id = c.founder_id and b.sha = c.token_blob_sha
      join founder f on f.id = c.founder_id
      where c.founder_id = ${workspace}
    `;
    const row = rows[0] as
      | {
          ig_user_id: string;
          username: string;
          expires_at: string | null;
          updated_at: string;
          ciphertext: Buffer;
          nonce: Buffer;
          sha: string;
          wrapped_key: Buffer;
        }
      | undefined;
    if (!row) return null;
    const plain = openBlob(
      workspace,
      unwrapDataKey(workspace, row.wrapped_key),
      row.sha,
      row.ciphertext,
      row.nonce,
    ).toString("utf8");
    const parsed = JSON.parse(plain) as { accessToken?: string };
    if (!parsed.accessToken) return null;
    return {
      accessToken: parsed.accessToken,
      userId: row.ig_user_id,
      username: row.username,
      expiresAt: row.expires_at ? Date.parse(row.expires_at) : 0,
      updatedAt: Date.parse(row.updated_at),
    };
  });
}

async function refreshIfDue(
  store: PgBrainStore,
  workspace: string,
  token: StoredToken,
  fetchImpl: FetchLike,
  now = Date.now(),
): Promise<StoredToken> {
  if (token.expiresAt && token.expiresAt <= now)
    throw new DomainError(422, "instagram_reconnect", "Instagram Connect expired. Connect again.");
  if (!token.expiresAt || token.expiresAt - now > REFRESH_WINDOW_MS || now - token.updatedAt < REFRESH_MIN_AGE_MS)
    return token;
  const url = new URL(`${GRAPH_HOST}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token.accessToken);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!response.ok || !json.access_token)
    throw new DomainError(422, "instagram_reconnect", "Instagram Connect expired. Connect again.");
  await saveConnection(store, workspace, {
    accessToken: json.access_token,
    userId: token.userId,
    username: token.username,
    expiresIn: json.expires_in ?? 5_183_944,
  });
  return { ...token, accessToken: json.access_token, expiresAt: now + (json.expires_in ?? 5_183_944) * 1000, updatedAt: now };
}

export async function pullInstagramPhotos(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ saved: number; skipped: number; username: string }> {
  const r2 = r2FromConfig(config);
  if (!r2) throw new DomainError(503, "media_not_configured", "Media storage is not set up yet.");
  const stored = await readToken(store, workspace);
  if (!stored) throw new DomainError(409, "instagram_not_connected", "Connect Instagram first.");
  const token = await refreshIfDue(store, workspace, stored, fetchImpl);
  const listed = (await graphGet(
    `${token.userId}/media?fields=id,media_type,media_url&limit=12`,
    token.accessToken,
    fetchImpl,
  )) as { data?: InstagramMedia[] };
  const images = imageMedia(listed.data ?? []);
  let saved = 0;
  let skipped = Math.max(0, (listed.data?.length ?? 0) - images.length);
  for (const image of images) {
    if ((await countMedia(store, workspace)) >= 200) break;
    const already = await store.scoped(workspace, async (tx) => {
      const rows = await tx`
        select id from fb_media
        where founder_id = ${workspace} and source = 'instagram' and provider_request_id = ${image.id}
      `;
      return Boolean(rows[0]);
    });
    if (already) {
      skipped += 1;
      continue;
    }
    const download = await fetchImpl(image.url, { signal: AbortSignal.timeout(8_000) });
    if (!download.ok) {
      skipped += 1;
      continue;
    }
    const contentType = (download.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!IMAGE_TYPES.has(contentType)) {
      skipped += 1;
      continue;
    }
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.byteLength <= 0 || bytes.byteLength > PULL_BYTES) {
      skipped += 1;
      continue;
    }
    const id = randomUUID();
    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : contentType === "image/gif" ? "gif" : "jpg";
    const key = `${workspace}/${id}/${safeName(`instagram-${image.id}.${ext}`)}`;
    const put = await r2Fetch(presignR2(r2, "PUT", key, 300), {
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(bytes.byteLength) },
      body: bytes,
    });
    if (!put.ok) {
      skipped += 1;
      continue;
    }
    await store.scoped(workspace, async (tx) => {
      await tx`
        insert into fb_media
          (id, founder_id, piece_n, kind, source, status, object_key, content_type, size_bytes, provider_request_id, cost_usd)
        values
          (${id}, ${workspace}, null, 'image', 'instagram', 'ready', ${key}, ${contentType}, ${bytes.byteLength}, ${image.id}, 0)
      `;
    });
    saved += 1;
  }
  return { saved, skipped, username: token.username };
}

export async function disconnectInstagram(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ disconnected: boolean; revoked: boolean }> {
  const token = await readToken(store, workspace);
  let revoked = false;
  if (token) {
    const url = new URL(`${GRAPH_HOST}/${GRAPH_VERSION}/me/permissions`);
    url.searchParams.set("access_token", token.accessToken);
    const response = await fetchImpl(url, { method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    revoked = Boolean(response?.ok);
  }
  const r2 = r2FromConfig(config);
  const rows = await store.scoped(workspace, async (tx) => {
    const media = await tx<{ id: string; object_key: string }[]>`
      select id, object_key from fb_media where founder_id = ${workspace} and source = 'instagram'
    `;
    await tx`delete from fb_media where founder_id = ${workspace} and source = 'instagram'`;
    await tx`delete from fb_instagram_connection where founder_id = ${workspace}`;
    return media;
  });
  if (r2) {
    for (const row of rows) {
      await r2Fetch(presignR2(r2, "DELETE", row.object_key, 60), { method: "DELETE" }).catch(() => undefined);
    }
  }
  return { disconnected: true, revoked };
}
