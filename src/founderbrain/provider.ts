/**
 * src/founderbrain/provider.ts
 *
 * WHAT THIS IS. The one FounderBrain module that calls a vendor host. Anthropic
 * messages go out from here and nowhere else under src/founderbrain/.
 *
 * WHY IT EXISTS. The money path (reserve, lease, fence, settle) lives in jobs.ts.
 * Keeping the HTTP call in a single file means a second vendor endpoint cannot
 * appear without failing the lint rule that points at this file.
 *
 * WHAT CALLS IT. BrainJobs, via the default `anthropicProvider` or a test double.
 */
import { canonicalize } from "./domain.ts";

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

export const anthropicProvider: Provider = async (body, key) => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: canonicalize(body),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const err = new Error("Provider request failed") as Error & { knownNoCharge?: boolean };
    err.knownNoCharge = KNOWN_NO_CHARGE.has(response.status);
    throw err;
  }
  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = data.content
    ?.filter((x) => x.type === "text")
    .map((x) => x.text ?? "")
    .join("\n")
    .trim();
  if (
    !text ||
    text.length > 12000 ||
    !Number.isInteger(data.usage?.input_tokens) ||
    !Number.isInteger(data.usage?.output_tokens)
  ) {
    throw new Error("Provider response could not be verified");
  }
  return {
    text,
    inputTokens: data.usage!.input_tokens,
    outputTokens: data.usage!.output_tokens,
    requestId: response.headers.get("request-id"),
  };
};
