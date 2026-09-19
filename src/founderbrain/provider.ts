/**
 * src/founderbrain/provider.ts
 *
 * WHAT THIS IS. The one FounderBrain module that calls a vendor inference host.
 * OpenRouter chat completions go out from here and nowhere else under
 * src/founderbrain/ (Management API lives in openrouter-management.ts).
 *
 * WHY IT EXISTS. The money path (reserve, lease, fence, settle) lives in jobs.ts.
 * Keeping the HTTP call in a single file means a second inference endpoint cannot
 * appear without failing the lint rule that points at this file.
 *
 * WHAT CALLS IT. BrainJobs / orchestrateInvitation, via `openRouterProvider` or a
 * test double.
 */
import { canonicalize } from "./domain.ts";
import {
  assertPrivacyEligibleModel,
  OPENROUTER_PRIVACY_PROVIDER,
} from "./openrouter-privacy.ts";

export interface ProviderCall {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user"; content: string }>;
}

export interface ProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  requestId: string | null;
}

export type Provider = (body: ProviderCall, key: string) => Promise<ProviderResult>;

const KNOWN_NO_CHARGE = new Set([400, 401, 403, 404, 413, 422, 429]);

export const openRouterProvider: Provider = async (body, key) => {
  assertPrivacyEligibleModel(body.model);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://founderbrain.app",
      "X-OpenRouter-Title": "FounderBrain",
    },
    body: canonicalize({
      model: body.model,
      max_tokens: body.max_tokens,
      messages: [{ role: "system", content: body.system }, ...body.messages],
      provider: OPENROUTER_PRIVACY_PROVIDER,
      // Refuse provider-side prompt publication / public ranking opt-in.
      stream: false,
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const err = new Error("Provider request failed") as Error & { knownNoCharge?: boolean };
    err.knownNoCharge = KNOWN_NO_CHARGE.has(response.status);
    throw err;
  }
  const data = (await response.json()) as {
    id?: string;
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = data.choices?.[0]?.message?.content;
  const text =
    typeof raw === "string"
      ? raw.trim()
      : Array.isArray(raw)
        ? raw
            .map((part) => (typeof part === "object" && part && "text" in part ? part.text ?? "" : ""))
            .join("\n")
            .trim()
        : "";
  const inputTokens = data.usage?.prompt_tokens;
  const outputTokens = data.usage?.completion_tokens;
  if (
    !text ||
    text.length > 12000 ||
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens)
  ) {
    throw new Error("Provider response could not be verified");
  }
  return {
    text,
    inputTokens: inputTokens!,
    outputTokens: outputTokens!,
    requestId: data.id ?? response.headers.get("x-request-id"),
  };
};

/** @deprecated Use openRouterProvider. Kept as an alias for older test imports. */
export const anthropicProvider = openRouterProvider;

function pickFavicon(
  meta: { favicon?: string; logo?: string; ogImage?: string; image?: string; "og:image"?: string },
  pageUrl: string,
): string {
  for (const candidate of [meta.favicon, meta.logo]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const abs = new URL(candidate.trim(), pageUrl).href;
      if (abs.startsWith("https://")) return abs;
    } catch {
      /* skip */
    }
  }
  try {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(pageUrl).hostname)}&sz=128`;
  } catch {
    return "";
  }
}

export async function firecrawlScrape(
  url: string,
  key: string,
): Promise<{ markdown: string; title: string; logoUrl: string }> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: {
      markdown?: string;
      metadata?: {
        title?: string;
        ogImage?: string;
        favicon?: string;
        image?: string;
        logo?: string;
        "og:image"?: string;
      };
    };
  };
  const markdown = json.data?.markdown?.trim() ?? "";
  const meta = json.data?.metadata ?? {};
  const title = meta.title?.trim() ?? "";
  const logoUrl = [meta.ogImage, meta["og:image"], meta.logo, meta.image, meta.favicon]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find((value) => value.startsWith("https://")) ?? "";
  if (!response.ok || (!markdown && !title))
    throw new Error("firecrawl_failed");
  return {
    markdown: [title ? `# ${title}` : "", markdown].filter(Boolean).join("\n\n").slice(0, 20_000),
    title,
    logoUrl,
  };
}
