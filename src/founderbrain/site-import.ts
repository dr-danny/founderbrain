/**
 * Optional website import: Firecrawl scrape, then a short OpenRouter extract into Brain fields.
 */
import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import { firecrawlScrape, openRouterProvider } from "./provider.ts";
import { loadOpenRouterApiKey } from "./openrouter-keys.ts";
import type { PgBrainStore } from "./store.ts";
import { DEFAULT_ORCHESTRATION } from "./openrouter-privacy.ts";

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
): Promise<{ proposal: SiteProposal; source: "ai" | "title" }> {
  if (!config.FIRECRAWL_API_KEY)
    throw new DomainError(503, "site_import_not_configured", "Website import is not configured yet.");
  let markdown = "";
  try {
    markdown = await firecrawlScrape(url, config.FIRECRAWL_API_KEY);
  } catch {
    throw new DomainError(502, "site_import_failed", "Could not read that website. We'll ask instead.");
  }
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
      const proposal = parseProposal(result.text);
      if (proposal.identity || proposal.customer || proposal.offer) return { proposal, source: "ai" };
    } catch {
      /* fall through to title */
    }
  }
  const name = heading(markdown);
  if (!name) throw new DomainError(502, "site_import_failed", "Could not read that website. We'll ask instead.");
  return { proposal: { identity: { venture: name } }, source: "title" };
}
