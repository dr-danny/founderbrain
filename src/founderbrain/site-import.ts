/**
 * Optional website import: Firecrawl scrape, then a short OpenRouter extract into Brain fields.
 */
import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import { firecrawlScrape, openRouterProvider } from "./provider.ts";
<<<<<<< HEAD
import { loadOpenRouterApiKey, recordOpenRouterSpend } from "./openrouter-keys.ts";
import type { PgBrainStore } from "./store.ts";
import { DEFAULT_ORCHESTRATION } from "./openrouter-privacy.ts";
import { recordUsageEvent, ceilMicro } from "./usage.ts";
=======
import { loadOpenRouterApiKey } from "./openrouter-keys.ts";
import type { PgBrainStore } from "./store.ts";
import { DEFAULT_ORCHESTRATION } from "./openrouter-privacy.ts";
>>>>>>> origin/main

export type SiteProposal = {
  identity?: { venture?: string; role?: string; stage?: string; goal?: string };
  customer?: { segment?: string; problem?: string; outcome?: string; workaround?: string; evidence?: string };
  offer?: { description?: string; delivery?: string; outcome?: string; cta?: string; price?: string };
  voice?: { tone?: string; boundaries?: string; sample?: string };
  track?: "b2b" | "b2c";
};

function heading(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
}

function parseProposal(text: string): SiteProposal {
  const json = text.replace(/^```json\s*|\s*```$/g, "").trim();
  const start = json.indexOf("{");
  const end = json.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  const raw = JSON.parse(json.slice(start, end + 1)) as SiteProposal;
  return raw && typeof raw === "object" ? raw : {};
}

export async function importSite(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  url: string,
): Promise<{ proposal: SiteProposal; source: "ai" | "title"; logoUrl: string }> {
  if (!config.FIRECRAWL_API_KEY)
    throw new DomainError(503, "site_import_not_configured", "Website import is not configured yet.");
<<<<<<< HEAD
  let scraped: { markdown: string; title: string; logoUrl: string; creditsUsed: number };
=======
  let scraped: { markdown: string; title: string; logoUrl: string };
>>>>>>> origin/main
  try {
    scraped = await firecrawlScrape(url, config.FIRECRAWL_API_KEY);
  } catch {
    throw new DomainError(502, "site_import_failed", "Could not read that website. We'll ask instead.");
  }
<<<<<<< HEAD
  // Meter the scrape before anything else can fail: the credit was spent.
  await recordUsageEvent(store, workspace, config, {
    kind: "firecrawl_scrape",
    credits: scraped.creditsUsed,
    costMicroUsd: ceilMicro(
      scraped.creditsUsed * (config.FIRECRAWL_USD_PER_CREDIT ?? 0.0025) * 1_000_000,
    ),
    meta: { host: new URL(url).hostname },
  });
=======
>>>>>>> origin/main
  const markdown = scraped.markdown;
  if (config.AI_ENABLED === "true") {
    try {
      const loaded = await loadOpenRouterApiKey(store, workspace);
      const model = config.AI_MODEL_RUNNER ?? config.AI_MODEL ?? DEFAULT_ORCHESTRATION.runner.primary;
      const result = await openRouterProvider(
        {
          model,
          max_tokens: 700,
          system:
            "Extract a founder's business into JSON only. Keys: identity.venture, identity.role, identity.stage (exploring|building|launched|growing), identity.goal, customer.segment, customer.problem, customer.outcome, customer.workaround, customer.evidence, offer.description, offer.delivery, offer.outcome, offer.cta, offer.price, voice.tone, voice.sample, track (b2b|b2c). Omit unknown keys. No markdown.",
          messages: [{ role: "user", content: markdown.slice(0, 12_000) }],
        },
        loaded.apiKey,
      );
<<<<<<< HEAD
      // Meter the extract against the same rates the job path bills at.
      const costMicroUsd = ceilMicro(
        result.inputTokens * (config.AI_INPUT_USD_PER_MILLION ?? 0) +
          result.outputTokens * (config.AI_OUTPUT_USD_PER_MILLION ?? 0),
      );
      await recordUsageEvent(store, workspace, config, {
        kind: "ai_extract",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMicroUsd,
        meta: { model },
      });
      try {
        await recordOpenRouterSpend(store, workspace, costMicroUsd);
      } catch {
        // The AI budget is spent. The scrape and extract are metered; fall back
        // to the title-only path like every other AI-disabled flow.
      }
      const proposal = parseProposal(result.text);
      if (proposal.identity || proposal.customer || proposal.offer)
        return { proposal, source: "ai", logoUrl: scraped.logoUrl };
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === "openrouter_lifetime_limit"
      ) {
        throw new DomainError(
          429,
          "openrouter_lifetime_limit",
          "The lifetime AI budget for this account is spent. Website import still read the page, but the AI extract needs budget.",
        );
      }
=======
      const proposal = parseProposal(result.text);
      if (proposal.identity || proposal.customer || proposal.offer)
        return { proposal, source: "ai", logoUrl: scraped.logoUrl };
    } catch {
>>>>>>> origin/main
      /* fall through to title */
    }
  }
  const name = heading(markdown) || scraped.title;
  if (!name) throw new DomainError(502, "site_import_failed", "Could not read that website. We'll ask instead.");
  return { proposal: { identity: { venture: name } }, source: "title", logoUrl: scraped.logoUrl };
}
