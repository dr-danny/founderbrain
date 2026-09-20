/**
 * src/founderbrain/routines.ts
 *
 * WHAT THIS IS. Scheduled, draft-only digests for the founder, ported from the
 * Launchhouse template's routines (vendored at
 * vendor/launchhouse-founder-template/.claude/routines/). Phase 1, no new
 * integrations:
 *
 *   monday_plan    - weekly (first sweep after Mon 07:00 founder-local,
 *                    idempotent per ISO week): three actions with time
 *                    estimates, what is overdue. AI, founder's own key.
 *   content_top_up - weekly (first sweep after Mon 08:00, idempotent per ISO
 *                    week): the next 10 pieces on the Brain's work, in the
 *                    founder's voice. AI, run through the copy rules; holds go
 *                    under "Worth a look", never silently dropped.
 *   readiness      - daily (>= 08:00, idempotent per day): deterministic
 *                    gate-by-gate gaps from the readiness model and Brain
 *                    flags. No AI. When nothing is missing, writes nothing.
 *
 * Rules carried from the template, all binding on generation:
 *   Draft only. Nothing is published, sent, or marked approved here.
 *   Never invent a number, a result, a customer or a testimonial.
 *   The voice is the founder's. Never the other track's material.
 *   Never promise replies. No em or en dashes. Short sentences.
 */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import postgres from "postgres";

import { DomainError } from "./domain.ts";
import { canonicalize, type Brain, type BrainState } from "../founderbrain-shared/domain.ts";
import { checkCopy } from "./copy-rules.ts";
import { openRouterProvider } from "./provider.ts";
import { loadOpenRouterApiKey } from "./openrouter-keys.ts";
import { recordUsageEvent, ceilMicro } from "./usage.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";

export type RoutineKind = "monday_plan" | "content_top_up" | "readiness";

export type RoutineDraft = {
  id: string;
  kind: RoutineKind;
  periodKey: string;
  title: string;
  body: string;
  status: "pending" | "read" | "dismissed";
  createdAt: string;
};

export type RoutineSettings = {
  timezone: string;
  mondayPlan: boolean;
  contentTopUp: boolean;
  readinessDigest: boolean;
};

export async function migrateRoutines(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./routines.sql", import.meta.url), "utf8"));
    });
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// Scheduling math. Pure and testable: the sweep decides "due" from the
// founder's own timezone, and idempotency comes from UNIQUE(founder_id,
// kind, period_key), never from "did we run".
// ---------------------------------------------------------------------------

/** ISO week key, e.g. 2026-W39, per ISO 8601 (weeks start Monday). */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type LocalNow = { dateKey: string; weekday: number; hour: number; minute: number };

/** Resolve the founder-local wall clock. Unknown or empty timezone returns null (sweep skips). */
export function localNow(timezone: string, at: Date): LocalNow | null {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    if (!get("year") || Number.isNaN(hour) || Number.isNaN(minute)) return null;
    const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      dateKey: `${get("year")}-${get("month")}-${get("day")}`,
      weekday: weekdays[get("weekday") ?? ""] ?? 0,
      hour: hour % 24,
      minute: minute % 60,
    };
  } catch {
    return null;
  }
}

/** The Monday date (YYYY-MM-DD) of the week containing d. */
export function mondayOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (day - 1));
  return t.toISOString().slice(0, 10);
}

/** The Monday date of an ISO week key like 2026-W39. */
export function mondayOfIsoWeek(periodKey: string): string {
  const [, weekStr] = periodKey.split("-W");
  const year = Number(periodKey.slice(0, 4));
  const week = Number(weekStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

export type DueKind = { kind: RoutineKind; periodKey: string };

/**
 * Which routine kinds are due for this founder at `now`. Late is fine: the
 * Monday plan and content top-up fire the first sweep after their Monday
 * hour within the same ISO week. The readiness digest is daily.
 */
export function dueKinds(settings: RoutineSettings, now: Date): DueKind[] {
  const local = localNow(settings.timezone, now);
  if (!local) return [];
  const week = isoWeekKey(now);
  const out: DueKind[] = [];
  if (settings.mondayPlan && local.weekday >= 1 && local.hour >= 7)
    out.push({ kind: "monday_plan", periodKey: week });
  if (settings.contentTopUp && local.weekday >= 1 && local.hour >= 8)
    out.push({ kind: "content_top_up", periodKey: week });
  if (settings.readinessDigest && local.hour >= 8)
    out.push({ kind: "readiness", periodKey: local.dateKey });
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic readiness digest (no AI): gate by gate, this founder's gaps.
// ---------------------------------------------------------------------------

export function readinessGaps(state: BrainState): string[] {
  const brain = state.brain;
  const gap: string[] = [];
  const section = (name: string, ready: boolean) => {
    if (!ready) gap.push(`Mission not locked in yet: ${name}.`);
  };
  section("Identity", state.readiness.identity);
  section("Customer", state.readiness.customer);
  section("Offer", state.readiness.offer);
  section("Voice", state.readiness.voice);
  section("Channels", state.readiness.context);
  if (!state.readiness.output) gap.push("First output not generated and accepted.");
  if (brain.voice.sampleCount < 10)
    gap.push(`Voice samples: ${brain.voice.sampleCount} of 10 on file.`);
  const b2c = brain.identity.track === "b2c";
  if (b2c && brain.context.igAccountType !== "business")
    gap.push("Instagram is not a Business or Creator account yet.");
  if (!b2c && brain.context.domainStatus === "fresh")
    gap.push("Sending domain is fresh: SPF, DKIM and DMARC still to configure.");
  if (brain.customer.evidenceStatus === "hypothesis")
    gap.push("Proof is still a hypothesis: nothing confirms it yet.");
  return gap;
}

function firstGapAction(gaps: string[]): string {
  return gaps[0] ?? "lock in the missions";
}

// ---------------------------------------------------------------------------
// AI generators. The founder's own key, metered, draft-only.
// ---------------------------------------------------------------------------

const BASE_RULES =
  "You draft weekly work for a founder. Draft only: nothing you write is published, sent, or approved. " +
  "Never invent a number, a result, a customer or a testimonial; every figure must be in the Brain, and if one is missing write from observation, method or point of view instead. " +
  "The voice is the founder's: follow the Brain's Voice section. " +
  "Never write the other track's material: B2C copy never mentions Apollo, ICPs, cold email, DKIM or DMARC; B2B copy never mentions hook banks, DM openers or inbound scripts. " +
  "Never offer or describe automating cold DMs. Never promise replies. " +
  "No em dashes or en dashes. Short sentences. Plain words. " +
  "Return strict JSON only.";

function aiCostMicroUsd(config: Config, inputTokens: number, outputTokens: number): number {
  const inRate = (config.AI_INPUT_USD_PER_MILLION ?? 0) / 1_000_000;
  const outRate = (config.AI_OUTPUT_USD_PER_MILLION ?? 0) / 1_000_000;
  return ceilMicro(inputTokens * inRate + outputTokens * outRate);
}

async function runRoutineAi(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  brain: Brain,
  instruction: string,
): Promise<string> {
  const loaded = await (await import("./openrouter-keys.ts")).loadOpenRouterApiKey(store, workspace);
  const result = await openRouterProvider(
    {
      model: config.AI_MODEL_RUNNER ?? config.AI_MODEL ?? "anthropic/claude-haiku-4.5",
      max_tokens: 2000,
      system: BASE_RULES,
      messages: [{ role: "user", content: `BRAIN:\n${JSON.stringify(brain)}\n\nTASK:\n${instruction}` }],
    },
    loaded.apiKey,
  );
  await recordUsageEvent(store, workspace, config, {
    kind: "ai_tokens",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costMicroUsd: aiCostMicroUsd(config, result.inputTokens, result.outputTokens),
    meta: { purpose: "routine" },
  });
  return result.text;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The template's reviewer step: held findings surface at the top, never dropped. */
function worthALook(body: string, brain: Brain): string {
  const findings = checkCopy(body, {
    track: brain.identity.track === "b2c" ? "b2c" : "b2b",
    brainJson: canonicalize(brain),
  }).filter((f) => f.kind === "HOLD");
  if (findings.length === 0) return body;
  const lines = findings.map((f) => `- ${f.reason}`).join("\n");
  return `Worth a look (the draft reviewer flagged these):\n${lines}\n\n${body}`;
}

function titleBody(parsed: Record<string, unknown> | null): { title: string; body: string } | null {
  const title = typeof parsed?.title === "string" ? parsed.title.trim().slice(0, 160) : "";
  const body = typeof parsed?.body === "string" ? parsed.body.trim().slice(0, 8000) : "";
  if (!title || !body) return null;
  return { title, body };
}

async function generateMondayPlan(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  brain: Brain,
  monday: string,
): Promise<{ title: string; body: string }> {
  const text = await runRoutineAi(
    config,
    store,
    workspace,
    brain,
    `Write this founder's plan for the week starting Monday ${monday}. ` +
      `Return strict JSON: {"title": "<one line>", "body": "<the plan>"}. ` +
      `The body holds, in this order: three actions for this week, each with a rough time estimate, chosen from what the Brain shows is missing or unproven; ` +
      `what is overdue, named from the Brain's flags and unfilled sections; one closing line with the single most important thing to do today. Under 30 lines.`,
  );
  const draft = titleBody(parseJsonObject(text));
  if (!draft)
    throw new DomainError(502, "routine_failed", "The weekly plan draft failed. It will retry next sweep.");
  return { title: draft.title, body: worthALook(draft.body, brain) };
}

async function generateContentTopUp(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  brain: Brain,
): Promise<{ title: string; body: string }> {
  const b2c = brain.identity.track === "b2c";
  const text = await runRoutineAi(
    config,
    store,
    workspace,
    brain,
    `Draft the next 10 content pieces for this ${b2c ? "B2C" : "B2B"} founder. ` +
      `Return strict JSON: {"title": "<one line>", "body": "<the pieces>"}. ` +
      (b2c
        ? `Formats: story post, teach post, demo, question to the audience. Mix them. `
        : `Formats: story post, teach post, proof or case note, question to the audience. Mix them. `) +
      `Number the pieces 1 to 10, each with its format labelled, one short piece each, on the founder's actual work from the Brain. ` +
      `Never repeat an angle twice. Never invent proof. Where proof is thin, write from point of view and observation.`,
  );
  const draft = titleBody(parseJsonObject(text));
  if (!draft)
    throw new DomainError(502, "routine_failed", "The content draft could not be generated. It will retry next sweep.");
  return { title: draft.title, body: worthALook(draft.body, brain) };
}

// ---------------------------------------------------------------------------
// Founder-facing API
// ---------------------------------------------------------------------------

export async function getRoutineSettings(store: PgBrainStore, workspace: string): Promise<RoutineSettings> {
  const rows = await store.scoped(workspace, async (tx) =>
    tx<{ timezone: string; monday_plan: boolean; content_top_up: boolean; readiness_digest: boolean }[]>`
      select timezone, monday_plan, content_top_up, readiness_digest from fb_routine_state
      where founder_id = ${workspace}
    `,
  );
  const row = rows[0];
  return {
    timezone: row?.timezone ?? "",
    mondayPlan: row?.monday_plan ?? true,
    contentTopUp: row?.content_top_up ?? true,
    readinessDigest: row?.readiness_digest ?? true,
  };
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateRoutineSettings(
  store: PgBrainStore,
  workspace: string,
  patch: { timezone?: string; mondayPlan?: boolean; contentTopUp?: boolean; readinessDigest?: boolean },
): Promise<RoutineSettings> {
  if (patch.timezone !== undefined && patch.timezone !== "" && !validTimezone(patch.timezone))
    throw new DomainError(422, "invalid_timezone", "That timezone is not valid.");
  await store.scoped(workspace, async (tx) => {
    await tx`
      insert into fb_routine_state (founder_id, timezone, monday_plan, content_top_up, readiness_digest)
      values (${workspace}, ${patch.timezone ?? ""}, ${patch.mondayPlan ?? true}, ${patch.contentTopUp ?? true}, ${patch.readinessDigest ?? true})
      on conflict (founder_id) do update set
        timezone = coalesce(nullif(excluded.timezone, ''), fb_routine_state.timezone),
        monday_plan = coalesce(excluded.monday_plan, fb_routine_state.monday_plan),
        content_top_up = coalesce(excluded.content_top_up, fb_routine_state.content_top_up),
        readiness_digest = coalesce(excluded.readiness_digest, fb_routine_state.readiness_digest),
        updated_at = now()
    `;
  });
  return getRoutineSettings(store, workspace);
}

export async function listRoutineDrafts(store: PgBrainStore, workspace: string): Promise<RoutineDraft[]> {
  const rows = await store.scoped(workspace, async (tx) =>
    tx<{ id: string; kind: RoutineKind; period_key: string; title: string; body: string; status: RoutineDraft["status"]; created_at: string }[]>`
      select id, kind, period_key, title, body, status, created_at from fb_routine_draft
      where founder_id = ${workspace} and status <> 'dismissed'
      order by created_at desc
      limit 30
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    periodKey: r.period_key,
    title: r.title,
    body: r.body,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function setRoutineDraftStatus(
  store: PgBrainStore,
  workspace: string,
  id: string,
  status: "read" | "dismissed",
): Promise<void> {
  await store.scoped(workspace, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update fb_routine_draft set status = ${status}, updated_at = now()
      where id = ${id} and founder_id = ${workspace}
      returning id
    `;
    if (!rows.length) throw new DomainError(404, "draft_not_found", "That draft is gone.");
  });
}

// ---------------------------------------------------------------------------
// The sweep: worker-side, cross-workspace, idempotent, bounded.
// ---------------------------------------------------------------------------

export type RoutineSweepResult = { scanned: number; generated: number };

/** Build one draft. Returns null when nothing is owed (green readiness). */
export async function buildDraft(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  kind: RoutineKind,
  state: BrainState,
): Promise<{ title: string; body: string; meta: Record<string, string | number> } | null> {
  if (kind === "readiness") {
    const gaps = readinessGaps(state);
    if (gaps.length === 0) return null;
    const monday = mondayOf(new Date());
    const body =
      "Not done yet, gate by gate:\n" +
      gaps.map((g) => `- ${g}`).join("\n") +
      `\n\nThe single most important thing today: ${firstGapAction(gaps)}`;
    return { title: `Ready? ${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"} left`, body, meta: { monday, gaps: gaps.length } };
  }
  const brain = state.brain;
  if (kind === "monday_plan") {
    const draft = await generateMondayPlan(config, store, workspace, brain, mondayOf(new Date()));
    return { ...draft, meta: { monday: mondayOf(new Date()) } };
  }
  const draft = await generateContentTopUp(config, store, workspace, brain);
  return { ...draft, meta: { monday: mondayOf(new Date()) } };
}

export async function sweepOnce(store: PgBrainStore, config: Config, limit = 4): Promise<RoutineSweepResult> {
  const dispatcher = postgres(config.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const states = await dispatcher<
      { founder_id: string; timezone: string; monday_plan: boolean; content_top_up: boolean; readiness_digest: boolean }[]
    >`
      select founder_id, timezone, monday_plan, content_top_up, readiness_digest
      from fb_routine_state where timezone <> ''
    `;
    const now = new Date();
    let generated = 0;
    let scanned = 0;
    for (const state of states) {
      if (generated >= limit) break;
      scanned += 1;
      const settings: RoutineSettings = {
        timezone: state.timezone,
        mondayPlan: state.monday_plan,
        contentTopUp: state.content_top_up,
        readinessDigest: state.readiness_digest,
      };
      for (const due of dueKinds(settings, new Date())) {
        if (generated >= limit) break;
        const existing = await dispatcher<{ id: string }[]>`
          select id from fb_routine_draft
          where founder_id = ${state.founder_id} and kind = ${due.kind} and period_key = ${due.periodKey}
        `;
        if (existing.length) continue;
        let brainState;
        try {
          brainState = await store.read(state.founder_id);
        } catch {
          continue;
        }
        const draft = await buildDraft(config, store, state.founder_id, due.kind, brainState);
        if (!draft) continue;
        const inserted = await dispatcher<{ id: string }[]>`
          insert into fb_routine_draft (id, founder_id, kind, period_key, title, body, meta)
          values (${randomUUID()}, ${state.founder_id}, ${due.kind}, ${due.periodKey}, ${draft.title}, ${draft.body}, ${JSON.stringify(draft.meta)}::jsonb)
          on conflict (founder_id, kind, period_key) do nothing
          returning id
        `;
        if (inserted.length) generated += 1;
      }
    }
    return { scanned, generated };
  } finally {
    await dispatcher.end({ timeout: 5 });
  }
}
