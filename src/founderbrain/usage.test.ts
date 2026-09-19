/**
 * Unit tests for metered-usage pricing math. Pure functions only; ledger writes
 * are covered by the storage/API suites against a real database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Config } from "./config.ts";
import { pricedUsageEvent, usageResponse } from "./usage.ts";

function config(overrides: Partial<Config> = {}): Config {
  return {
    AI_ENABLED: "true",
    AI_INPUT_USD_PER_MILLION: 1,
    AI_OUTPUT_USD_PER_MILLION: 5,
    ...overrides,
  } as unknown as Config;
}

describe("metered usage pricing", () => {
  it("defaults to cost plus the 30% hidden buffer", () => {
    const priced = pricedUsageEvent(config(), {
      kind: "ai_tokens",
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      costMicroUsd: 2_000_000,
    });
    // 1M x $1.3/M + 200k x $6.5/M = $1.30 + $1.30 = $2.60
    assert.equal(priced.priceMicroUsd, 2_600_000);
  });

  it("uses PRICE_* overrides when set", () => {
    const priced = pricedUsageEvent(
      config({ PRICE_AI_INPUT_USD_PER_MILLION: 2, PRICE_AI_OUTPUT_USD_PER_MILLION: 10 }),
      {
        kind: "ai_tokens",
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        costMicroUsd: 2_000_000,
      },
    );
    // 1M x $2/M + 200k x $10/M = $2 + $2 = $4
    assert.equal(priced.priceMicroUsd, 4_000_000);
  });

  it("applies PRICE_MARKUP when no overrides", () => {
    const priced = pricedUsageEvent(config({ PRICE_MARKUP: 3 }), {
      kind: "ai_extract",
      inputTokens: 100,
      outputTokens: 100,
      costMicroUsd: 600,
    });
    assert.equal(priced.priceMicroUsd, 1_800);
  });

  it("bills Firecrawl at the documented pay-as-you-go default with the buffer", () => {
    const priced = pricedUsageEvent(config(), {
      kind: "firecrawl_scrape",
      credits: 2,
      costMicroUsd: 5_000,
    });
    // 2 credits x $0.0025 x 1.3 = $0.0065
    assert.equal(priced.priceMicroUsd, 6_500);
  });

  it("honors a Firecrawl price override", () => {
    const priced = pricedUsageEvent(config({ PRICE_FIRECRAWL_USD_PER_CREDIT: 0.01 }), {
      kind: "firecrawl_scrape",
      credits: 1,
      costMicroUsd: 2_500,
    });
    assert.equal(priced.priceMicroUsd, 10_000);
  });

  it("prices voice transcription per second with the buffer", () => {
    // 60s x ($0.02/60) x 1.3 = $0.0004333... -> ceil = 434 microUSD
    const priced = pricedUsageEvent(config({}), {
      kind: "voice_transcribe",
      costMicroUsd: 334,
      meta: { seconds: 60 },
    });
    assert.equal(priced.priceMicroUsd, 434);
  });

  it("responds with founder-facing totals only, buffer hidden", () => {
    const response = usageResponse(config({ PRICE_MARKUP: 2 }), {
      ai: { events: 1, inputTokens: 10, outputTokens: 20, costMicroUsd: 110, priceMicroUsd: 220 },
      firecrawl: { scrapes: 1, credits: 1, costMicroUsd: 2_500, priceMicroUsd: 5_000 },
      voice: { transcribes: 0, costMicroUsd: 0, priceMicroUsd: 0 },
      totalPriceMicroUsd: 5_220,
    });
    assert.equal(response.totalMicroUsd, 5_220);
    assert.equal(response.ai.priceInputUsdPerMillion, 2);
    assert.equal(response.firecrawl.priceUsdPerCredit, 0.005);
    const json = JSON.stringify(response);
    assert.ok(!json.includes("costMicroUsd"));
    assert.ok(!json.includes("markup"));
    assert.ok(!json.includes("costUsdPerCredit"));
    assert.ok(!json.includes("costInputUsdPerMillion"));
  });
});
