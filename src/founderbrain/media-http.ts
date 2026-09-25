/**
 * src/founderbrain/media-http.ts
 *
 * WHAT THIS IS. The only FounderBrain module that talks to Higgsfield and the R2
 * media bucket over the network (listed next to provider.ts in eslint's fetch rule).
 * Each helper pins where it may go:
 *   - higgsfieldFetch: api.higgsfield.ai only, with the founder's own key.
 *   - r2Fetch: presigned URLs on the R2 S3 endpoint only.
 *   - fetchGeneratedFile: the https output URL Higgsfield returned for a finished job.
 */
import { DomainError } from "./domain.ts";

const HIGGSFIELD = "https://api.higgsfield.ai";

async function withTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, redirect: "error", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function higgsfieldFetch(
  auth: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  timeoutMs = 20_000,
): Promise<Response> {
  if (!/^[a-z0-9./_-]+$/i.test(path)) throw new DomainError(422, "invalid_request", "Unknown Higgsfield request.");
  try {
    return await withTimeout(
      `${HIGGSFIELD}/${path}`,
      {
        method: init.method,
        headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      timeoutMs,
    );
  } catch {
    throw new DomainError(503, "higgsfield_unreachable", "Higgsfield did not answer. Try again in a moment.");
  }
}

export async function r2Fetch(presignedUrl: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const host = new URL(presignedUrl).host;
  if (!host.endsWith(".r2.cloudflarestorage.com"))
    throw new DomainError(500, "media_host", "Media storage is misconfigured.");
  try {
    return await withTimeout(presignedUrl, init, timeoutMs);
  } catch {
    throw new DomainError(503, "media_unreachable", "Media storage did not answer. Try again.");
  }
}

export async function fetchGeneratedFile(url: string, timeoutMs = 40_000): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new DomainError(502, "higgsfield_output", "Higgsfield returned an unusable file address.");
  try {
    // Output URLs are plain CDN links; follow at most the CDN's own redirect.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(parsed.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    throw new DomainError(503, "higgsfield_output", "The finished file could not be downloaded yet. It will retry.");
  }
}
