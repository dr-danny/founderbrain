/**
 * src/founderbrain/voice-samples.ts
 *
 * WHAT THIS IS. Founder voice samples for the Brain's voice capture, the app
 * version of the original intake's Path A/B (10-20 of their own writing, one
 * piece per sample). Rows live in fb_voice_sample, RLS-bound to the founder.
 * Approval of the Voice mission is gated on having at least ten samples.
 */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";

export const MIN_VOICE_SAMPLES = 10;
const MAX_SAMPLES = 25;
const MAX_SAMPLE_CHARS = 20_000;

export async function migrateVoiceSamples(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./voice-samples.sql", import.meta.url), "utf8"));
    });
  } finally {
    await sql.end();
  }
}

export type VoiceSample = { id: string; name: string; chars: number; createdAt: string };

export async function listVoiceSamples(
  store: PgBrainStore,
  workspace: string,
): Promise<VoiceSample[]> {
  return store.scoped(workspace, async (tx) => {
    const rows = await tx<{ id: string; name: string; content: string; created_at: string }[]>`
      select id, name, content, created_at from fb_voice_sample
      where founder_id = ${workspace}
      order by created_at asc
    `;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      chars: r.content.length,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  });
}

export async function addVoiceSample(
  store: PgBrainStore,
  workspace: string,
  config: Config,
  input: { name: string; text: string },
): Promise<{ count: number }> {
  const name = input.name.trim().slice(0, 120);
  const text = input.text.replace(/\r\n/g, "\n").trim();
  if (!name) throw new DomainError(422, "invalid_request", "Give the sample a short name.");
  if (text.length < 40)
    throw new DomainError(422, "sample_too_short", "That sample is too short to be a voice sample.");
  if (text.length > MAX_SAMPLE_CHARS)
    throw new DomainError(
      413,
      "sample_too_long",
      `Keep each sample under ${Math.floor(MAX_SAMPLE_CHARS / 1000)}k characters. Split longer pieces.`,
    );
  const id = randomUUID();
  await store.scoped(workspace, async (tx) => {
    const count = await tx<{ n: string }[]>`
      select count(*) as n from fb_voice_sample where founder_id = ${workspace}
    `;
    if (Number(count[0]?.n ?? 0) >= MAX_SAMPLES)
      throw new DomainError(413, "too_many_samples", "That is plenty. Twenty-five samples is the cap.");
    await tx`
      insert into fb_voice_sample (id, founder_id, name, content) values (${id}, ${workspace}, ${name}, ${text})
    `;
  });
  void config;
  return await listCount(store, workspace);
}

export async function deleteVoiceSample(
  store: PgBrainStore,
  workspace: string,
  id: string,
): Promise<{ count: number }> {
  validSampleId(id);
  await store.scoped(workspace, async (tx) => {
    await tx`delete from fb_voice_sample where founder_id = ${workspace} and id = ${id}`;
  });
  return await listCount(store, workspace);
}

function validSampleId(id: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new DomainError(422, "invalid_request", "Unknown sample.");
}

async function listCount(store: PgBrainStore, workspace: string): Promise<{ count: number }> {
  const all = await listVoiceSamples(store, workspace);
  return { count: all.length };
}
