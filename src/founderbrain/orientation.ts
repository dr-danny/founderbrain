/**
 * Server-side orientation progress: migrate, read, write-with-readback.
 * Completing first-login orientation must persist before Identity is awarded.
 */
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { DomainError } from "./domain.ts";
import type { PgBrainStore } from "./store.ts";
import {
  applyOrientationPatch,
  emptyOrientationState,
  orientationPatchSchema,
  orientationStateSchema,
  type OrientationPatch,
  type OrientationState,
} from "../founderbrain-shared/orientation.ts";

type OrientationRow = {
  first_login_screen: number;
  first_login_completed_at: Date | string | null;
  track: string | null;
  content_screen: number;
  content_completed_at: Date | string | null;
  content_answers: unknown;
  outreach_screen: number;
  outreach_completed_at: Date | string | null;
  outreach_answers: unknown;
  updated_at: Date | string;
};

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToState(row: OrientationRow): OrientationState {
  return orientationStateSchema.parse({
    firstLoginScreen: row.first_login_screen,
    firstLoginCompletedAt: iso(row.first_login_completed_at),
    track: row.track,
    contentScreen: row.content_screen,
    contentCompletedAt: iso(row.content_completed_at),
    contentAnswers: row.content_answers ?? {},
    outreachScreen: row.outreach_screen,
    outreachCompletedAt: iso(row.outreach_completed_at),
    outreachAnswers: row.outreach_answers ?? {},
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  });
}

export async function migrateOrientation(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./orientation.sql", import.meta.url), "utf8"));
    });
  } finally {
    await sql.end();
  }
}

export async function readOrientation(
  store: PgBrainStore,
  workspaceId: string,
): Promise<OrientationState> {
  const row = await store.scoped(workspaceId, async (tx) => {
    const rows = await tx<OrientationRow[]>`
      select
        first_login_screen,
        first_login_completed_at,
        track,
        content_screen,
        content_completed_at,
        content_answers,
        outreach_screen,
        outreach_completed_at,
        outreach_answers,
        updated_at
      from fb_orientation
      where founder_id = ${workspaceId}
    `;
    return rows[0] ?? null;
  });
  if (!row) return emptyOrientationState();
  return rowToState(row);
}

export async function writeOrientation(
  store: PgBrainStore,
  workspaceId: string,
  patchInput: unknown,
): Promise<OrientationState> {
  const parsed = orientationPatchSchema.safeParse(patchInput);
  if (!parsed.success) {
    throw new DomainError(422, "invalid_orientation", "Orientation update was invalid.");
  }
  const patch: OrientationPatch = parsed.data;
  if (Object.keys(patch).length === 0) {
    throw new DomainError(422, "invalid_orientation", "Orientation update was empty.");
  }

  const written = await store.scoped(workspaceId, async (tx) => {
    const existing = await tx<OrientationRow[]>`
      select
        first_login_screen,
        first_login_completed_at,
        track,
        content_screen,
        content_completed_at,
        content_answers,
        outreach_screen,
        outreach_completed_at,
        outreach_answers,
        updated_at
      from fb_orientation
      where founder_id = ${workspaceId}
      for update
    `;
    const current = existing[0] ? rowToState(existing[0]) : emptyOrientationState();
    const next = applyOrientationPatch(current, patch);

    await tx`
      insert into fb_orientation (
        founder_id,
        first_login_screen,
        first_login_completed_at,
        track,
        content_screen,
        content_completed_at,
        content_answers,
        outreach_screen,
        outreach_completed_at,
        outreach_answers,
        updated_at
      ) values (
        ${workspaceId},
        ${next.firstLoginScreen},
        ${next.firstLoginCompletedAt},
        ${next.track},
        ${next.contentScreen},
        ${next.contentCompletedAt},
        ${tx.json(next.contentAnswers as never)},
        ${next.outreachScreen},
        ${next.outreachCompletedAt},
        ${tx.json(next.outreachAnswers as never)},
        ${next.updatedAt}
      )
      on conflict (founder_id) do update set
        first_login_screen = excluded.first_login_screen,
        first_login_completed_at = excluded.first_login_completed_at,
        track = excluded.track,
        content_screen = excluded.content_screen,
        content_completed_at = excluded.content_completed_at,
        content_answers = excluded.content_answers,
        outreach_screen = excluded.outreach_screen,
        outreach_completed_at = excluded.outreach_completed_at,
        outreach_answers = excluded.outreach_answers,
        updated_at = excluded.updated_at
    `;

    const readback = await tx<OrientationRow[]>`
      select
        first_login_screen,
        first_login_completed_at,
        track,
        content_screen,
        content_completed_at,
        content_answers,
        outreach_screen,
        outreach_completed_at,
        outreach_answers,
        updated_at
      from fb_orientation
      where founder_id = ${workspaceId}
    `;
    if (!readback[0]) {
      throw new DomainError(
        503,
        "orientation_verification_pending",
        "Orientation was written but could not be read back yet.",
      );
    }
    return rowToState(readback[0]);
  });

  return written;
}
