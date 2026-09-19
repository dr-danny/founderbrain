/**
 * src/founderbrain/usage.ts
 *
 * WHAT THIS IS. Actual-usage metering for AI tokens and Firecrawl credits,
 * plus the pricing math that turns recorded usage into the final price shown
 * in the GoHighLevel chapter before Connect.
 *
 * WHY IT EXISTS. AI spend was already settled into fb_openrouter_key.spent_microusd,
 * but nothing recorded token counts or Firecrawl scrapes, and nothing surfaced a
 * price to the founder. This ledger records every metered action once, with both
 * cost and price frozen at record time, so rate changes never rewrite history.
 */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";

export type UsageKind = "ai_tokens" | "ai_extract" | "firecrawl_scrape" | "voice_transcribe";

export type UsageEvent = {
  kind: UsageKind;
  inputTokens?: number | null;
  outputTokens?: number | null;
  credits?: number | null;
  costMicroUsd: number;
  jobId?: string | null;
  meta?: Record<string, string | number | boolean | null>;
};

/**
 * Firecrawl bills 1 credit per basic scraped page. Pay-as-you-go on their paid
 * plans is 2,000 credits per $5 (docs.firecrawl.dev/billing), i.e. $0.0025 per
 * credit. FIRECRAWL_USD_PER_CREDIT overrides this if our plan is cheaper.
 */
const DEFAULT_FIRECRAWL_USD_PER_CREDIT = 0.0025;
/** Groq whisper-large-v3-turbo bills $0.04 per hour of audio (console.groq.com/docs/model/whisper-large-v3-turbo).
 *  VOICE_USD_PER_MINUTE overrides. */
const DEFAULT_VOICE_USD_PER_MINUTE = 0.04 / 60;
/** 30% hidden buffer on top of actual cost, baked into the displayed price (Danny, 2026-09-18).
 *  PRICE_MARKUP env overrides. Never shown to the founder; cost fields stay server-side. */
const DEFAULT_PRICE_MARKUP = 1.3;
const MICROI = 1_000_000;

/** Ceil with float-noise guard: 2 credits x $0.0025 must be 6500 microUSD, not 6501. */
export function ceilMicro(value: number): number {
  return Math.ceil(Number(value.toPrecision(12)));
}

function checkedMicroUsd(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new DomainError(503, "usage_invalid", `${name} could not be recorded.`);
  return value;
}

function checkedTokens(value: number | null | undefined, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new DomainError(503, "usage_invalid", `${name} could not be recorded.`);
  return value;
}

/** Cost rate per million AI tokens (microUSD per token), from config. */
function aiRateMicroUsdPerToken(ratePerMillion: number | undefined): number | undefined {
  return ratePerMillion === undefined ? undefined : ratePerMillion;
}

/**
 * Price rate for one AI direction: explicit PRICE_* override, else cost rate
 * x PRICE_MARKUP, else the cost rate itself (break-even).
 */
function priceRatePerMillion(
  priceOverride: number | undefined,
  costRate: number | undefined,
  markup: number,
): number {
  if (priceOverride !== undefined) return priceOverride;
  if (costRate === undefined) return markup;
  return costRate * markup;
}

export function firecrawlCostRateUsdPerCredit(config: Config): number {
  return config.FIRECRAWL_USD_PER_CREDIT ?? DEFAULT_FIRECRAWL_USD_PER_CREDIT;
}

export function voiceCostRateUsdPerMinute(config: Config): number {
  return config.VOICE_USD_PER_MINUTE ?? DEFAULT_VOICE_USD_PER_MINUTE;
}

export function voicePriceRateUsdPerMinute(config: Config): number {
  return config.PRICE_VOICE_USD_PER_MINUTE ?? voiceCostRateUsdPerMinute(config) * (config.PRICE_MARKUP ?? DEFAULT_PRICE_MARKUP);
}

export function firecrawlPriceRateUsdPerCredit(config: Config): number {
  return (
    config.PRICE_FIRECRAWL_USD_PER_CREDIT ??
    firecrawlCostRateUsdPerCredit(config) * (config.PRICE_MARKUP ?? DEFAULT_PRICE_MARKUP)
  );
}

/**
 * Both amounts for one event, at the rates in effect now. AI cost uses the
 * configured cost rates (required whenever AI is enabled). AI price uses
 * PRICE_* overrides, else cost x PRICE_MARKUP. Firecrawl mirrors that with
 * per-credit rates.
 */
export function pricedUsageEvent(config: Config, event: UsageEvent): {
  costMicroUsd: number;
  priceMicroUsd: number;
} {
  const markup = config.PRICE_MARKUP ?? DEFAULT_PRICE_MARKUP;
  const costMicroUsd = checkedMicroUsd(Math.ceil(event.costMicroUsd), "AI/Firecrawl cost");
  let priceMicroUsd = costMicroUsd;
  if (event.kind === "firecrawl_scrape") {
    if (event.credits !== undefined && event.credits !== null) {
      priceMicroUsd = ceilMicro(event.credits * firecrawlPriceRateUsdPerCredit(config) * MICROI);
    }
  } else if (event.kind === "voice_transcribe") {
    const seconds = event.meta?.seconds;
    if (typeof seconds === "number" && seconds > 0) {
      priceMicroUsd = ceilMicro((seconds / 60) * voicePriceRateUsdPerMinute(config) * MICROI);
    }
  } else if (event.inputTokens != null || event.outputTokens != null) {
    const inputRate = aiRateMicroUsdPerToken(config.AI_INPUT_USD_PER_MILLION);
    const outputRate = aiRateMicroUsdPerToken(config.AI_OUTPUT_USD_PER_MILLION);
    priceMicroUsd = ceilMicro(
      (event.inputTokens ?? 0) * priceRatePerMillion(config.PRICE_AI_INPUT_USD_PER_MILLION, inputRate, markup) +
        (event.outputTokens ?? 0) *
          priceRatePerMillion(config.PRICE_AI_OUTPUT_USD_PER_MILLION, outputRate, markup),
    );
  }
  return { costMicroUsd, priceMicroUsd: checkedMicroUsd(priceMicroUsd, "AI/Firecrawl price") };
}

export async function migrateUsage(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(await readFile(new URL("./usage.sql", import.meta.url), "utf8"));
    });
  } finally {
    await sql.end();
  }
}

/** Insert one metered event. Same-tx variant used inside the job settle transaction. */
export async function insertUsageEvent(
  tx: postgres.TransactionSql<Record<string, unknown>> | postgres.Sql<Record<string, unknown>>,
  workspace: string,
  event: UsageEvent,
  priced: { costMicroUsd: number; priceMicroUsd: number },
): Promise<void> {
  await tx`
    insert into fb_usage_event
      (id, founder_id, kind, input_tokens, output_tokens, credits, cost_microusd, price_microusd, job_id, meta)
    values (
      ${randomUUID()},
      ${workspace},
      ${event.kind},
      ${checkedTokens(event.inputTokens, "AI input tokens")},
      ${checkedTokens(event.outputTokens, "AI output tokens")},
      ${checkedTokens(event.credits, "Firecrawl credits")},
      ${priced.costMicroUsd},
      ${priced.priceMicroUsd},
      ${event.jobId ?? null},
      ${JSON.stringify(event.meta ?? {})}::jsonb
    )
  `;
}

export async function recordUsageEvent(
  store: PgBrainStore,
  workspace: string,
  config: Config,
  event: UsageEvent,
): Promise<void> {
  const priced = pricedUsageEvent(config, event);
  await store.scoped(workspace, async (tx) => {
    await insertUsageEvent(tx, workspace, event, priced);
  });
}

export type UsageTotals = {
  ai: {
    events: number;
    inputTokens: number;
    outputTokens: number;
    costMicroUsd: number;
    priceMicroUsd: number;
  };
  firecrawl: { scrapes: number; credits: number; costMicroUsd: number; priceMicroUsd: number };
  voice: { transcribes: number; costMicroUsd: number; priceMicroUsd: number };
  totalPriceMicroUsd: number;
};

type UsageRow = {
  kind: string;
  events: string | number;
  input_tokens: string | number | null;
  output_tokens: string | number | null;
  credits: string | number | null;
  cost_microusd: string | number;
  price_microusd: string | number;
};

function rowNumbers(row: UsageRow) {
  return {
    events: Number(row.events),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    credits: Number(row.credits ?? 0),
    costMicroUsd: Number(row.cost_microusd ?? 0),
    priceMicroUsd: Number(row.price_microusd ?? 0),
  };
}

export async function usageTotals(store: PgBrainStore, workspace: string): Promise<UsageTotals> {
  const rows = await store.scoped(workspace, async (tx) => {
    return await tx<UsageRow[]>`
      select kind,
        count(*) as events,
        sum(input_tokens) as input_tokens,
        sum(output_tokens) as output_tokens,
        sum(credits) as credits,
        sum(cost_microusd) as cost_microusd,
        sum(price_microusd) as price_microusd
      from fb_usage_event
      where founder_id = ${workspace}
      group by kind
    `;
  });
  const ai = { events: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, priceMicroUsd: 0 };
  const firecrawl = { scrapes: 0, credits: 0, costMicroUsd: 0, priceMicroUsd: 0 };
  const voice = { transcribes: 0, costMicroUsd: 0, priceMicroUsd: 0 };
  for (const row of rows) {
    const n = rowNumbers(row);
    if (row.kind === "firecrawl_scrape") {
      firecrawl.scrapes += n.events;
      firecrawl.credits += n.credits;
      firecrawl.costMicroUsd += n.costMicroUsd;
      firecrawl.priceMicroUsd += n.priceMicroUsd;
    } else if (row.kind === "voice_transcribe") {
      voice.transcribes += n.events;
      voice.costMicroUsd += n.costMicroUsd;
      voice.priceMicroUsd += n.priceMicroUsd;
    } else {
      ai.events += n.events;
      ai.inputTokens += n.inputTokens;
      ai.outputTokens += n.outputTokens;
      ai.costMicroUsd += n.costMicroUsd;
      ai.priceMicroUsd += n.priceMicroUsd;
    }
  }
  return {
    ai,
    firecrawl,
    voice,
    totalPriceMicroUsd: ai.priceMicroUsd + firecrawl.priceMicroUsd + voice.priceMicroUsd,
  };
}

/** API payload for GET /api/usage: totals plus the rates that produced the price. */
export function usageResponse(config: Config, totals: UsageTotals) {
  const markup = config.PRICE_MARKUP ?? DEFAULT_PRICE_MARKUP;
  const costIn = config.AI_INPUT_USD_PER_MILLION;
  const costOut = config.AI_OUTPUT_USD_PER_MILLION;
  // Founder-facing only: cost and markup stay server-side. The buffer is baked
  // into priceMicroUsd at record time, so the browser never sees the spread.
  return {
    ai: {
      events: totals.ai.events,
      inputTokens: totals.ai.inputTokens,
      outputTokens: totals.ai.outputTokens,
      priceMicroUsd: totals.ai.priceMicroUsd,
      priceInputUsdPerMillion:
        costIn === undefined && config.PRICE_AI_INPUT_USD_PER_MILLION === undefined
          ? null
          : priceRatePerMillion(config.PRICE_AI_INPUT_USD_PER_MILLION, costIn, markup),
      priceOutputUsdPerMillion:
        costOut === undefined && config.PRICE_AI_OUTPUT_USD_PER_MILLION === undefined
          ? null
          : priceRatePerMillion(config.PRICE_AI_OUTPUT_USD_PER_MILLION, costOut, markup),
    },
    firecrawl: {
      scrapes: totals.firecrawl.scrapes,
      credits: totals.firecrawl.credits,
      priceMicroUsd: totals.firecrawl.priceMicroUsd,
      priceUsdPerCredit: firecrawlPriceRateUsdPerCredit(config),
    },
    voice: {
      transcribes: totals.voice.transcribes,
      priceMicroUsd: totals.voice.priceMicroUsd,
      priceUsdPerMinute: voicePriceRateUsdPerMinute(config),
    },
    totalMicroUsd: totals.totalPriceMicroUsd,
  };
}
