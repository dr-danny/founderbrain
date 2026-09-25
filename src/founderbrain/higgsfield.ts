/**
 * src/founderbrain/higgsfield.ts
 *
 * WHAT THIS IS. Option 2 for the 30 pieces: the founder brings their own
 * Higgsfield API key (key id + secret), and FounderBrain uses it to make an
 * image or a short video for a piece. Higgsfield bills the founder directly.
 *
 * - The key is sealed in ge_blob with the founder's data key; only a hint is shown.
 * - Every generation is priced first with Higgsfield's estimate endpoint and
 *   reserved against a per-founder cap (default $50) before it is submitted.
 * - Output URLs on Higgsfield expire after about seven days, so completed media
 *   is copied into the private R2 bucket and served from there.
 * - Failed and moderated requests are not charged by Higgsfield; their reservation
 *   is released.
 */
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";

import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";
import { openBlob, sealBlob, unwrapDataKey } from "../server/storage/crypto.ts";
import { presignR2 } from "./r2.ts";
import { fetchGeneratedFile, higgsfieldFetch, r2Fetch } from "./media-http.ts";
import { requireR2, toItem, countMedia, type MediaItem, type MediaRow } from "./media.ts";

type Tx = TransactionSql;

const MAX_OUTPUT_BYTES = 300 * 1024 * 1024;

export const MODELS = {
  image: {
    path: "higgsfield-ai/soul/standard",
    label: "Higgsfield Soul image",
    body: (prompt: string) => ({ prompt, num_images: 1, resolution: "2K", aspect_ratio: "4:5" }),
  },
  video: {
    path: "minimax/hailuo-2.3/standard/text-to-video",
    label: "MiniMax Hailuo 2.3, 6 second video",
    body: (prompt: string) => ({ prompt, duration: 6, prompt_optimizer: true }),
  },
} as const;
export type MediaKind = keyof typeof MODELS;

export type HiggsfieldStatus = {
  connected: boolean;
  hint: string | null;
  spentUsd: number;
  capUsd: number;
};

type KeyRow = { key_blob_sha: string; key_hint: string; cap_usd: string | number; spent_usd: string | number };

async function sealKey(tx: Tx, workspace: string, plaintext: string): Promise<string> {
  const rows = await tx`select wrapped_key from founder where id=${workspace} and deleted_at is null`;
  if (!rows[0]) throw new DomainError(404, "workspace_missing", "Workspace not found.");
  const sealed = sealBlob(workspace, unwrapDataKey(workspace, rows[0].wrapped_key), Buffer.from(plaintext, "utf8"));
  await tx`
    insert into ge_blob(founder_id, sha, ciphertext, nonce, size_bytes)
    values (${workspace}, ${sealed.sha}, ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.sizeBytes})
    on conflict (founder_id, sha) do nothing
  `;
  return sealed.sha;
}

async function openKey(tx: Tx, workspace: string, sha: string): Promise<string> {
  const r = await tx`
    select b.ciphertext, b.nonce, f.wrapped_key
    from ge_blob b join founder f on f.id = b.founder_id
    where b.founder_id = ${workspace} and b.sha = ${sha}
  `;
  if (!r[0]) throw new DomainError(503, "higgsfield_key_missing", "Your Higgsfield key could not be read. Connect it again.");
  return openBlob(workspace, unwrapDataKey(workspace, r[0].wrapped_key), sha, r[0].ciphertext, r[0].nonce).toString("utf8");
}

async function loadKey(store: PgBrainStore, workspace: string): Promise<{ auth: string; row: KeyRow }> {
  return store.scoped(workspace, async (tx) => {
    const rows = await tx<KeyRow[]>`select key_blob_sha, key_hint, cap_usd, spent_usd from fb_higgsfield_key where founder_id = ${workspace}`;
    const row = rows[0];
    if (!row) throw new DomainError(409, "higgsfield_not_connected", "Connect your Higgsfield key first.");
    return { auth: `Key ${await openKey(tx, workspace, row.key_blob_sha)}`, row };
  });
}

function hf(auth: string, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Response> {
  return higgsfieldFetch(auth, path, init);
}

function friendly(status: number, fallback: string): DomainError {
  if (status === 401 || status === 403)
    return new DomainError(422, "higgsfield_key_invalid", "Higgsfield did not accept that key. Check the key id and secret.");
  if (status === 402)
    return new DomainError(422, "higgsfield_balance", "Your Higgsfield balance is empty. Top up at open.higgsfield.ai, then try again.");
  if (status === 429)
    return new DomainError(429, "higgsfield_busy", "Higgsfield is rate limiting your key. Wait a minute and try again.");
  return new DomainError(502, "higgsfield_failed", fallback);
}

async function estimateWith(auth: string, kind: MediaKind, prompt: string): Promise<number> {
  const model = MODELS[kind];
  const res = await hf(auth, `estimate/${model.path}`, { method: "POST", body: model.body(prompt) });
  if (!res.ok) throw friendly(res.status, "Higgsfield could not price that request. Try again.");
  const body = (await res.json().catch(() => ({}))) as { usd?: string | number };
  const usd = Number(body.usd);
  if (!Number.isFinite(usd) || usd < 0) throw new DomainError(502, "higgsfield_failed", "Higgsfield returned no price for that request.");
  return Math.round(usd * 10_000) / 10_000;
}

export async function higgsfieldStatus(store: PgBrainStore, workspace: string): Promise<HiggsfieldStatus> {
  return store.scoped(workspace, async (tx) => {
    const rows = await tx<KeyRow[]>`select key_hint, cap_usd, spent_usd, key_blob_sha from fb_higgsfield_key where founder_id = ${workspace}`;
    const row = rows[0];
    return row
      ? { connected: true, hint: row.key_hint, spentUsd: Number(row.spent_usd), capUsd: Number(row.cap_usd) }
      : { connected: false, hint: null, spentUsd: 0, capUsd: 50 };
  });
}

export async function connectHiggsfield(
  store: PgBrainStore,
  workspace: string,
  input: { keyId: string; keySecret: string },
): Promise<HiggsfieldStatus> {
  const keyId = input.keyId.trim();
  const keySecret = input.keySecret.trim();
  if (!/^[^\s:]{8,200}$/.test(keyId) || !/^[^\s:]{8,400}$/.test(keySecret))
    throw new DomainError(422, "higgsfield_key_format", "Paste the key id and the secret exactly as Higgsfield shows them.");
  // A price check is free and proves the key works before it is stored.
  await estimateWith(`Key ${keyId}:${keySecret}`, "image", "Test price check");
  await store.scoped(workspace, async (tx) => {
    const sha = await sealKey(tx, workspace, `${keyId}:${keySecret}`);
    await tx`
      insert into fb_higgsfield_key (founder_id, key_blob_sha, key_hint)
      values (${workspace}, ${sha}, ${"…" + keyId.slice(-4)})
      on conflict (founder_id) do update set key_blob_sha = excluded.key_blob_sha, key_hint = excluded.key_hint
    `;
  });
  return higgsfieldStatus(store, workspace);
}

export async function disconnectHiggsfield(store: PgBrainStore, workspace: string): Promise<HiggsfieldStatus> {
  await store.scoped(workspace, async (tx) => {
    await tx`delete from fb_higgsfield_key where founder_id = ${workspace}`;
  });
  return higgsfieldStatus(store, workspace);
}

export async function estimateMedia(
  store: PgBrainStore,
  workspace: string,
  input: { kind: MediaKind; prompt: string },
): Promise<{ usd: number; model: string; remainingUsd: number }> {
  const { auth, row } = await loadKey(store, workspace);
  const usd = await estimateWith(auth, input.kind, input.prompt);
  return { usd, model: MODELS[input.kind].label, remainingUsd: Math.max(0, Number(row.cap_usd) - Number(row.spent_usd)) };
}

export async function generateMedia(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  input: { kind: MediaKind; prompt: string; pieceN?: number | null },
): Promise<MediaItem> {
  const r2 = requireR2(config);
  if ((await countMedia(store, workspace)) >= 200)
    throw new DomainError(422, "media_limit", "You have reached 200 files. Remove some to add more.");
  const { auth } = await loadKey(store, workspace);
  const model = MODELS[input.kind];
  const usd = await estimateWith(auth, input.kind, input.prompt);
  const reserved = await store.scoped(workspace, async (tx) => {
    const rows = await tx`
      update fb_higgsfield_key set spent_usd = spent_usd + ${usd}
      where founder_id = ${workspace} and spent_usd + ${usd} <= cap_usd
      returning spent_usd
    `;
    return rows.length > 0;
  });
  if (!reserved)
    throw new DomainError(422, "higgsfield_cap", "This would go over your $50 FounderBrain limit for Higgsfield.");
  const release = () =>
    store.scoped(workspace, async (tx) => {
      await tx`update fb_higgsfield_key set spent_usd = greatest(0, spent_usd - ${usd}) where founder_id = ${workspace}`;
    });
  let requestId = "";
  try {
    const res = await hf(auth, model.path, { method: "POST", body: model.body(input.prompt) });
    if (!res.ok) throw friendly(res.status, "Higgsfield did not accept that request. Try again.");
    const body = (await res.json().catch(() => ({}))) as { request_id?: string };
    if (!body.request_id) throw new DomainError(502, "higgsfield_failed", "Higgsfield did not return a request id.");
    requestId = body.request_id;
  } catch (err) {
    await release();
    throw err;
  }
  const id = randomUUID();
  const row = await store.scoped(workspace, async (tx) => {
    const rows = await tx<MediaRow[]>`
      insert into fb_media (id, founder_id, piece_n, kind, source, status, object_key, prompt, model, provider_request_id, cost_usd)
      values (${id}, ${workspace}, ${input.pieceN ?? null}, ${input.kind}, 'higgsfield', 'pending',
              ${`${workspace}/${id}/higgsfield`}, ${input.prompt}, ${model.path}, ${requestId}, ${usd})
      returning *
    `;
    return rows[0]!;
  });
  return toItem(r2, row);
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export async function refreshMedia(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  id: string,
): Promise<MediaItem> {
  const r2 = requireR2(config);
  const row = await store.scoped(workspace, async (tx) => {
    const rows = await tx<MediaRow[]>`select * from fb_media where founder_id = ${workspace} and id = ${id}`;
    return rows[0];
  });
  if (!row) throw new DomainError(404, "media_missing", "That file was not found.");
  if (row.source !== "higgsfield" || row.status !== "pending" || !row.provider_request_id) return toItem(r2, row);
  const { auth } = await loadKey(store, workspace);
  const res = await hf(auth, `requests/${encodeURIComponent(row.provider_request_id)}/status`, { method: "GET" });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw friendly(res.status, "");
    return toItem(r2, row);
  }
  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    error?: string;
    images?: Array<{ url?: string }>;
    video?: { url?: string };
  };
  if (body.status === "failed" || body.status === "nsfw" || body.status === "canceled") {
    const reason =
      body.status === "nsfw"
        ? "Higgsfield's content check blocked this one. Try a different description."
        : "Higgsfield could not make this one. You were not charged.";
    const failed = await store.scoped(workspace, async (tx) => {
      await tx`update fb_higgsfield_key set spent_usd = greatest(0, spent_usd - ${Number(row.cost_usd)}) where founder_id = ${workspace}`;
      const rows = await tx<MediaRow[]>`
        update fb_media set status = 'failed', error = ${reason}, cost_usd = 0, updated_at = now()
        where founder_id = ${workspace} and id = ${id} and status = 'pending'
        returning *
      `;
      return rows[0] ?? row;
    });
    return toItem(r2, failed);
  }
  if (body.status !== "completed") return toItem(r2, row);
  const outputUrl = body.video?.url ?? body.images?.[0]?.url;
  if (!outputUrl || !outputUrl.startsWith("https://")) return toItem(r2, row);
  // Copy out of Higgsfield before its URL expires.
  const download = await fetchGeneratedFile(outputUrl);
  if (!download.ok) return toItem(r2, row);
  const declared = Number(download.headers.get("content-length") ?? 0);
  if (declared > MAX_OUTPUT_BYTES) throw new DomainError(422, "media_size", "That output is too large to store.");
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.byteLength > MAX_OUTPUT_BYTES) throw new DomainError(422, "media_size", "That output is too large to store.");
  const contentType = (download.headers.get("content-type") ?? (row.kind === "video" ? "video/mp4" : "image/jpeg")).split(";")[0]!.trim();
  const key = `${workspace}/${id}/higgsfield.${EXT[contentType] ?? (row.kind === "video" ? "mp4" : "jpg")}`;
  const put = await r2Fetch(presignR2(r2, "PUT", key, 300), {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(bytes.byteLength) },
    body: bytes,
  });
  if (!put.ok) throw new DomainError(503, "media_store_failed", "The file was made but could not be saved. Refresh to try again.");
  const ready = await store.scoped(workspace, async (tx) => {
    const rows = await tx<MediaRow[]>`
      update fb_media set status = 'ready', object_key = ${key}, content_type = ${contentType},
             size_bytes = ${bytes.byteLength}, updated_at = now()
      where founder_id = ${workspace} and id = ${id}
      returning *
    `;
    return rows[0]!;
  });
  return toItem(r2, ready);
}
