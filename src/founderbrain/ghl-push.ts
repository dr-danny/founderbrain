/**
 * src/founderbrain/ghl-push.ts
 *
 * WHAT THIS IS. The Brain -> GoHighLevel push: the founder's Brain fills the
 * pre-built snapshot's custom values (per v3 ghl-values), copy written from
 * their own voice with AI, nothing invented. Founders never build bespoke
 * workflows; the app writes copy into the named snapshot's slots only.
 *
 * Mechanism (from the ops-engine debate): the founder hand-loads the track's
 * snapshot via share link; this module writes location custom values by NAME
 * (create missing, update only empty/PLACEHOLDER, never delete or rename),
 * then proves no slot is blank or placeholder before reporting success.
 */
import { readFile } from "node:fs/promises";

import { DomainError } from "./domain.ts";
import { checkCopy } from "./copy-rules.ts";
import { canonicalize } from "../founderbrain-shared/domain.ts";
import { openRouterProvider } from "./provider.ts";
import { ceilMicro, recordUsageEvent } from "./usage.ts";
import { present, type Brain } from "../founderbrain-shared/domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export type SnapshotName = "B2B" | "B2C" | "Hybrid";

export function snapshotFor(brain: Brain): SnapshotName {
  if (brain.identity.hybrid) return "Hybrid";
  return brain.identity.track === "b2c" ? "B2C" : "B2B";
}

/** The v3 default packs (recommend, never force): a founder can override by pack id. */
export function defaultFirstPack(brain: Brain): string {
  if (brain.identity.track === "b2c")
    return brain.identity.model === "ecommerce" ? "comment_to_dm" : "dm_qualify_book";
  return "lead_follow_up";
}

type ValueEntry = { value: string; key: string; guidance: string };

let valuesCache: Map<string, ValueEntry[]> | null = null;

/** Parse the vendored v3 values.md into section -> [{value name, key, guidance}]. */
export async function loadValueCatalog(force = false): Promise<Map<string, ValueEntry[]>> {
  if (valuesCache && !force) return valuesCache;
  const md = await readFile(
    new URL("../../vendor/growth-engine/plugins/growth-engine/skills/ghl-values/references/values.md", import.meta.url),
    "utf8",
  );
  const sections = new Map<string, ValueEntry[]>();
  let current: string | null = null;
  for (const raw of md.split("\n")) {
    const heading = raw.match(/^##\s+(.+?)\s*(\(\d+\))?$/);
    if (heading) {
      current = (heading[1]?.trim() ?? "").replace(/\s*\(\d+\)$/, "").trim();
      if (current && !sections.has(current)) sections.set(current, []);
      continue;
    }
    const row = raw.match(/^\|\s*(.+?)\s*\|\s*`([a-z0-9_]+)`\s*\|/);
    if (row && current) {
      const bucket = sections.get(current);
      const guidance = raw.split("|")[raw.split("|").length - 2]?.trim() ?? "";
      if (bucket && row[2]) bucket.push({ value: row[1]?.trim() ?? "", key: row[2], guidance });
    }
  }
  if (sections.size === 0) throw new DomainError(503, "voice_not_configured", "Value catalog is missing.");
  valuesCache = sections;
  return sections;
}

/** Verify loop budget (#76): GHL list reads can lag writes; 3 tries x 2s is plenty. */
const VERIFY_ATTEMPTS = 3;
const VERIFY_RETRY_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const SECTION_BY_PACK: Record<string, string> = {
  lead_follow_up: "B2B Lead follow-up",
  discovery_booking: "B2B Discovery booking",
  proposal_chase: "B2B Proposal chase",
  comment_to_dm: "B2C Comment to DM",
  dm_qualify_book: "B2C DM qualify and book",
  review_request: "B2C Review request",
};

/** Which catalog sections the founder's snapshot needs. Essentials always; the first pack's copy first. */
export function sectionsForPush(brain: Brain, firstPack: string): { gname: string; guidance: string; key: string }[] {
  const catalog = valuesCache;
  if (!catalog) throw new DomainError(503, "voice_not_configured", "Value catalog is missing.");
  const snapshot = snapshotFor(brain);
  const essentials = snapshot === "B2B" ? "B2B Essentials" : "B2C Essentials";
  const packSection = SECTION_BY_PACK[firstPack];
  if (!packSection)
    throw new DomainError(422, "unknown_pack", "That first pack is not in the library. Pick from the six.");
  const wanted = [essentials, packSection].filter(Boolean) as string[];
  const out: { gname: string; guidance: string; key: string }[] = [];
  for (const section of wanted) {
    for (const entry of catalog.get(section) ?? []) {
      out.push({ gname: entry.value, guidance: entry.guidance, key: entry.key });
    }
  }
  if (out.length === 0)
    throw new DomainError(422, "unknown_pack", "That first pack is not in the library. Pick from the six.");
  return out;
}

/** Copy generation: the founder's own voice, no invented numbers or claims. */
async function generateCopy(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  brain: Brain,
  wanted: { gname: string; guidance: string; key: string }[],
): Promise<{ copy: Map<string, string>; held: Array<{ name: string; code: string; reason: string }> }> {
  const catalogText = wanted.map((w) => `- ${w.gname} (key: ${w.key}): ${w.guidance}`).join("\n");
  const { loadOpenRouterApiKey, recordOpenRouterSpend } = await import("./openrouter-keys.ts");
  const loaded = await loadOpenRouterApiKey(store, workspace);
  const result = await openRouterProvider(
    {
      model: config.AI_MODEL_RUNNER ?? config.AI_MODEL ?? "anthropic/claude-haiku-4.5",
      max_tokens: 4000,
      system:
        "You write GoHighLevel workflow copy for a founder, using ONLY their Brain. " +
        "For every requested value, write the copy the value's own guidance describes, in the founder's captured voice. " +
        "Return strict JSON: { \"<key>\": \"<copy>\" } for every requested key, nothing else. " +
        "Never invent numbers, results, customer names, prices, or claims that are not in the Brain; where the Brain lacks something the copy needs, keep the copy generic and honest instead of inventing. " +
        "Never promise replies: nothing guarantees or promises that anyone replies, because replies depend on the list, the offer and the timing. " +
        "Never write Instagram DM automation into the copy: no bots, blasts, or automated cold DMs. Automated sending is only for replying to people who wrote first. " +
        "Never write the other track's material: B2C copy never mentions Apollo, ICPs, cold email, DKIM or DMARC; B2B copy never mentions hook banks, DM openers or inbound scripts. " +
        "Never write PLACEHOLDER or merge-field code. Match the track. Respect the voice boundaries.",
      messages: [{ role: "user", content: `BRAIN:\n${JSON.stringify(brain)}\n\nREQUESTED VALUES:\n${catalogText}` }],
    },
    loaded.apiKey,
  );
  const inputRate = config.AI_INPUT_USD_PER_MILLION ?? 0;
  const outputRate = config.AI_OUTPUT_USD_PER_MILLION ?? 0;
  const costMicroUsd = ceilMicro(result.inputTokens * inputRate + result.outputTokens * outputRate);
  await recordUsageEvent(store, workspace, config, {
    kind: "ai_tokens",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costMicroUsd,
    meta: { purpose: "ghl_push" },
  });
  if (costMicroUsd > 0) {
    await recordOpenRouterSpend(store, workspace, costMicroUsd, { allowOverLifetime: true });
  }
  const start = result.text.indexOf("{");
  const end = result.text.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new DomainError(422, "copy_failed", "The copy could not be generated. Try again.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new DomainError(422, "copy_failed", "The copy could not be generated. Try again.");
  }
  const out = new Map<string, string>();
  // Reviewer hardening, ported from the template's rules engine: values that
  // promise replies, automate cold DMs, use the other track's method, or state
  // a number the Brain does not confirm are held out of the push and reported.
  const held: Array<{ name: string; code: string; reason: string }> = [];
  const track = brain.identity.track === "b2c" ? "b2c" : "b2b";
  const brainJson = canonicalize(brain);
  for (const w of wanted) {
    const value = parsed[w.key];
    if (typeof value === "string" && value.trim() && !/PLACEHOLDER/i.test(value)) {
      const trimmed = value.trim().slice(0, 4000);
      const finding = checkCopy(trimmed, { track, brainJson }).find((f) => f.kind === "HOLD");
      if (finding) {
        held.push({ name: w.gname, code: finding.code, reason: finding.reason });
        continue;
      }
      out.set(w.gname, trimmed);
    }
  }
  if (out.size === 0 && held.length === 0)
    throw new DomainError(422, "copy_failed", "The copy could not be generated. Try again.");
  return { copy: out, held };
}

type GhlValue = { id: string; name: string; value?: string };

async function ghlFetch(
  accessToken: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Response> {
  // eslint-disable-next-line no-restricted-globals -- CRM egress to the LeadConnector API, same class as crm-oauth's HTTP calls.
  return fetch(`${GHL_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
}

function isUnfilled(value: string | undefined): boolean {
  if (!value || !value.trim()) return true;
  return /PLACEHOLDER/i.test(value) || /\[[^\]]+\]/.test(value) || /\{\{[^}]+\}\}/.test(value);
}

export async function pushGhlValues(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  brain: Brain,
  firstPack: string,
): Promise<{ snapshot: SnapshotName; firstPack: string; pushed: string[]; skipped: string[]; proven: boolean; clinicPaste: string[]; held: Array<{ name: string; code: string; reason: string }> }> {
  const connection = await (await import("./crm-oauth.ts")).readConnection(store, workspace, config);
  if (!connection)
    throw new DomainError(409, "crm_not_connected", "Connect GoHighLevel before pushing copy.");
  const wanted = sectionsForPush(brain, firstPack);
  // Booking links are the founder's own URLs, pasted at the clinic. AI never
  // writes a link: it would invent one.
  const linkKeys = wanted.filter((w) => /_link$/.test(w.key)).map((w) => w.gname);
  const copyWanted = wanted.filter((w) => !/_link$/.test(w.key));
  const { copy, held } = await generateCopy(config, store, workspace, brain, copyWanted);

  const listResponse = await ghlFetch(connection.accessToken, `/locations/${connection.locationId}/customValues`);
  if (!listResponse.ok)
    throw new DomainError(422, "ghl_push_failed", "GoHighLevel did not answer the values list. Try again.");
  const listJson = (await listResponse.json()) as { customValues?: GhlValue[] };
  const existing = new Map((listJson.customValues ?? []).map((v) => [v.name, v]));

  const pushed: string[] = [];
  const skipped: string[] = [];
  for (const w of wanted) {
    const value = copy.get(w.gname);
    if (!value) continue;
    const current = existing.get(w.gname);
    // The founder's own words win: never overwrite a filled value.
    if (current && !isUnfilled(current.value)) {
      skipped.push(w.gname);
      continue;
    }
    if (current) {
      const updated = await ghlFetch(connection.accessToken, `/locations/${connection.locationId}/customValues/${current.id}`, { method: "PUT", body: { value } });
      if (!updated.ok) throw new DomainError(422, "ghl_push_failed", `GoHighLevel refused "${w.gname}". Try again.`);
      pushed.push(w.gname);
    } else {
      const created = await ghlFetch(connection.accessToken, `/locations/${connection.locationId}/customValues`, { method: "POST", body: { name: w.gname, value } });
      if (!created.ok) throw new DomainError(422, "ghl_push_failed", `GoHighLevel refused "${w.gname}". Try again.`);
      pushed.push(w.gname);
    }
  }
  if (pushed.length === 0 && skipped.length === wanted.length)
    return { snapshot: snapshotFor(brain), firstPack, pushed, skipped, proven: true, clinicPaste: linkKeys, held };

  // Prove it: nothing we claim to have written may still read empty or placeholder.
  // GHL's customValues list read can lag the writes by a few seconds (#76): the first
  // verify after a fresh location's first push came back without the new values even
  // though every write returned ok. Read back a few times before declaring failure.
  let proven = false;
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS && !proven; attempt++) {
    if (attempt > 0) await sleep(VERIFY_RETRY_MS);
    const verify = await ghlFetch(connection.accessToken, `/locations/${connection.locationId}/customValues`);
    if (!verify.ok)
      throw new DomainError(422, "ghl_push_failed", "Could not verify the push. Check GoHighLevel and retry.");
    const verifyJson = (await verify.json()) as { customValues?: GhlValue[] };
    const verifyMap = new Map((verifyJson.customValues ?? []).map((v) => [v.name, v.value]));
    proven = [...copy.entries()].every(([gname]) => {
      const value = verifyMap.get(gname);
      return value !== undefined && !isUnfilled(value);
    });
  }
  if (!proven) {
    const wrote = pushed.length > 0;
    throw new DomainError(
      422,
      "ghl_push_failed",
      wrote
        ? "The copy is in GoHighLevel but the read-back check could not confirm it. Open the values list to confirm, or retry."
        : "The push did not stick. Nothing was published. Check the snapshot names match the values list.",
    );
  }
  return { snapshot: snapshotFor(brain), firstPack, pushed, skipped, proven, clinicPaste: linkKeys, held };
}

/** Export helper for tests: is this Brain ready to push (all five missions approved)? */
export function brainReadyForPush(brain: Brain): boolean {
  const sections = [brain.identity, brain.customer, brain.offer, brain.voice, brain.context];
  return sections.every((s) => s.approved) && present(brain.context.channelsActive, brain.context.customersNow, brain.context.target90);
}
