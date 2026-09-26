/**
 * src/founderbrain/media.ts
 *
 * WHAT THIS IS. Founder media for the 30 pieces. Option 1 of two: the founder
 * uploads their own images and video straight to the private R2 bucket through
 * a short-lived presigned PUT. Rows in fb_media hold the object key and status;
 * previews use short-lived presigned GETs. Option 2 (Higgsfield) lives in
 * higgsfield.ts and lands its output in the same bucket and table.
 */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";
import { presignR2, type R2Config } from "./r2.ts";
import { r2Fetch } from "./media-http.ts";

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_MEDIA_PER_FOUNDER = 200;
const UPLOAD_URL_SECONDS = 15 * 60;
const VIEW_URL_SECONDS = 60 * 60;

export const UPLOAD_TYPES: Record<string, "image" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

export async function migrateMedia(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./media.sql", import.meta.url), "utf8"));
    });
  } finally {
    await sql.end();
  }
}

export function r2FromConfig(config: Config): R2Config | null {
  if (!config.R2_ENDPOINT || !config.R2_BUCKET || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY)
    return null;
  return {
    endpoint: config.R2_ENDPOINT,
    bucket: config.R2_BUCKET,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  };
}

export function requireR2(config: Config): R2Config {
  const r2 = r2FromConfig(config);
  if (!r2) throw new DomainError(503, "media_not_configured", "Media storage is not set up yet.");
  return r2;
}

export type MediaItem = {
  id: string;
  pieceN: number | null;
  kind: "image" | "video";
  source: "upload" | "higgsfield";
  status: "pending" | "ready" | "failed";
  contentType: string | null;
  sizeBytes: number | null;
  url: string | null;
  prompt: string | null;
  costUsd: number;
  error: string | null;
  createdAt: string;
  name: string;
};

export type MediaRow = {
  id: string;
  piece_n: number | null;
  kind: "image" | "video";
  source: "upload" | "higgsfield";
  status: "pending" | "ready" | "failed";
  object_key: string;
  content_type: string | null;
  size_bytes: string | number | null;
  prompt: string | null;
  model: string | null;
  provider_request_id: string | null;
  cost_usd: string | number;
  error: string | null;
  created_at: Date | string;
};

export function toItem(r2: R2Config, row: MediaRow): MediaItem {
  return {
    id: row.id,
    pieceN: row.piece_n,
    kind: row.kind,
    source: row.source,
    status: row.status,
    contentType: row.content_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    url: row.status === "ready" ? presignR2(r2, "GET", row.object_key, VIEW_URL_SECONDS) : null,
    prompt: row.prompt,
    costUsd: Number(row.cost_usd),
    error: row.error,
    createdAt: new Date(row.created_at).toISOString(),
    name: row.object_key.split("/").pop() || "file",
  };
}

export function safeName(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "file").slice(-80);
}

export async function listMedia(config: Config, store: PgBrainStore, workspace: string): Promise<MediaItem[]> {
  const r2 = requireR2(config);
  return store.scoped(workspace, async (tx) => {
    const rows = await tx<MediaRow[]>`
      select * from fb_media where founder_id = ${workspace} order by created_at desc limit ${MAX_MEDIA_PER_FOUNDER}
    `;
    return rows.map((row) => toItem(r2, row));
  });
}

export async function countMedia(store: PgBrainStore, workspace: string): Promise<number> {
  return store.scoped(workspace, async (tx) => {
    const rows = await tx`select count(*)::int as n from fb_media where founder_id = ${workspace}`;
    return Number(rows[0]?.n ?? 0);
  });
}

export async function createUpload(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  input: { pieceN?: number | null; filename: string; contentType: string; size: number },
): Promise<{ item: MediaItem; uploadUrl: string }> {
  const r2 = requireR2(config);
  const kind = UPLOAD_TYPES[input.contentType];
  if (!kind)
    throw new DomainError(422, "media_type", "Upload a JPG, PNG, WebP, GIF, MP4, MOV, or WebM file.");
  if (!(input.size > 0) || input.size > MAX_UPLOAD_BYTES)
    throw new DomainError(422, "media_size", "Files can be up to 500 MB.");
  if ((await countMedia(store, workspace)) >= MAX_MEDIA_PER_FOUNDER)
    throw new DomainError(422, "media_limit", "You have reached 200 files. Remove some to add more.");
  const id = randomUUID();
  const key = `${workspace}/${id}/${safeName(input.filename)}`;
  const row = await store.scoped(workspace, async (tx) => {
    const rows = await tx<MediaRow[]>`
      insert into fb_media (id, founder_id, piece_n, kind, source, status, object_key, content_type, size_bytes)
      values (${id}, ${workspace}, ${input.pieceN ?? null}, ${kind}, 'upload', 'pending', ${key}, ${input.contentType}, ${input.size})
      returning *
    `;
    return rows[0]!;
  });
  return { item: toItem(r2, row), uploadUrl: presignR2(r2, "PUT", key, UPLOAD_URL_SECONDS) };
}

async function getRow(store: PgBrainStore, workspace: string, id: string): Promise<MediaRow> {
  const row = await store.scoped(workspace, async (tx) => {
    const rows = await tx<MediaRow[]>`select * from fb_media where founder_id = ${workspace} and id = ${id}`;
    return rows[0];
  });
  if (!row) throw new DomainError(404, "media_missing", "That file was not found.");
  return row;
}

export async function completeUpload(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  id: string,
): Promise<MediaItem> {
  const r2 = requireR2(config);
  const row = await getRow(store, workspace, id);
  if (row.source !== "upload") throw new DomainError(409, "media_source", "That file was not an upload.");
  const head = await r2Fetch(presignR2(r2, "HEAD", row.object_key, 60), { method: "HEAD" });
  if (!head.ok)
    throw new DomainError(409, "media_not_uploaded", "The file has not finished uploading. Try again.");
  const size = Number(head.headers.get("content-length") ?? row.size_bytes ?? 0);
  const updated = await store.scoped(workspace, async (tx) => {
    const rows = await tx<MediaRow[]>`
      update fb_media set status = 'ready', size_bytes = ${size}, updated_at = now()
      where founder_id = ${workspace} and id = ${id}
      returning *
    `;
    return rows[0]!;
  });
  return toItem(r2, updated);
}

export async function assignMedia(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  id: string,
  pieceN: number | null,
): Promise<MediaItem> {
  const r2 = requireR2(config);
  await getRow(store, workspace, id);
  const updated = await store.scoped(workspace, async (tx) => {
    const rows = await tx<MediaRow[]>`
      update fb_media set piece_n = ${pieceN}, updated_at = now()
      where founder_id = ${workspace} and id = ${id}
      returning *
    `;
    return rows[0]!;
  });
  return toItem(r2, updated);
}

export async function deleteMedia(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  id: string,
): Promise<{ ok: true }> {
  const r2 = requireR2(config);
  const row = await getRow(store, workspace, id);
  const res = await r2Fetch(presignR2(r2, "DELETE", row.object_key, 60), { method: "DELETE" });
  if (!res.ok && res.status !== 404)
    throw new DomainError(503, "media_delete_failed", "The file could not be removed. Try again.");
  await store.scoped(workspace, async (tx) => {
    await tx`delete from fb_media where founder_id = ${workspace} and id = ${id}`;
  });
  return { ok: true };
}
