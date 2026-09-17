/**
 * src/founderbrain-edge/worker.ts
 *
 * FounderBrain's deliberately small edge gateway. It serves the built app from the
 * ASSETS binding and proxies `/api/*` to one fixed Railway origin. It never chooses
 * an upstream from a request.
 *
 * SIGN-IN IS NOT HERE. Cloudflare Access sits in front of this Worker. By the time
 * a request arrives, Access has already shown the login page, sent the one-time
 * PIN, checked the email against the Allow policy, and attached a signed JWT as
 * `Cf-Access-Jwt-Assertion`. This Worker forwards that header to the API, which
 * verifies the signature itself. A request to `/api/*` with no Access header is
 * refused at the edge, because if Access is not in front of us something is
 * misconfigured and the safe answer is no.
 */
export interface AssetFetcher { fetch(request: Request): Promise<Response>; }
export interface FounderBrainEdgeEnv {
  ASSETS?: AssetFetcher;
  /** Exact HTTPS origin of the Railway API. Nothing after the host. */
  API_ORIGIN?: string;
  /** Shared with the API. Proves a request came through this Worker. */
  ORIGIN_SECRET?: string;
}
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const API_PREFIX = "/api";
const REQUEST_TIMEOUT_MS = 10_000;
/** The header Cloudflare Access adds to every authenticated request. */
export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
/** Request headers that may cross from the browser to the API. Everything else is dropped. */
const FORWARDED_HEADERS = [ACCESS_JWT_HEADER, "content-type", "accept", "origin", "x-request-id"] as const;

function validOrigin(value: string | undefined, allowInsecure = false): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const permittedProtocol = parsed.protocol === "https:" || (allowInsecure && parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"));
    return permittedProtocol && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === "/" ? parsed : null;
  } catch { return null; }
}
function securityHeaders(headers: Headers): Headers {
  const result = new Headers(headers);
  result.set("X-Content-Type-Options", "nosniff"); result.set("X-Frame-Options", "DENY"); result.set("Referrer-Policy", "no-referrer");
  result.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  result.set("Cross-Origin-Opener-Policy", "same-origin"); result.set("Cross-Origin-Resource-Policy", "same-origin");
  // connect-src is same-origin only. The Access login page lives on Cloudflare's own
  // hostname and is reached by a full navigation, never by a fetch from this app.
  result.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'");
  return result;
}
function response(body: BodyInit | null, status: number): Response { return new Response(body, { status, headers: securityHeaders(new Headers({ "Content-Type": "application/json", "Cache-Control": "private, no-store" })) }); }
function isApi(pathname: string): boolean { return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`); }
function gatewayHeaders(request: Request, secret: string): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  headers.set("X-FounderBrain-Origin", secret);
  return headers;
}

export function createFounderBrainWorker(fetchImpl: FetchLike = fetch, options: { timeoutMs?: number; allowInsecureApiOrigin?: boolean } = {}) {
  return {
    async fetch(request: Request, env: FounderBrainEdgeEnv): Promise<Response> {
      const inbound = new URL(request.url);
      if (isApi(inbound.pathname)) return proxyApi(request, env, fetchImpl, inbound, options.timeoutMs ?? REQUEST_TIMEOUT_MS, options.allowInsecureApiOrigin === true);
      return serveAsset(request, env);
    },
  };
}
async function proxyApi(request: Request, env: FounderBrainEdgeEnv, fetchImpl: FetchLike, inbound: URL, timeoutMs: number, allowInsecureApiOrigin: boolean): Promise<Response> {
  const origin = validOrigin(env.API_ORIGIN, allowInsecureApiOrigin);
  if (!origin || !env.ORIGIN_SECRET) return response(JSON.stringify({ error: "gateway_unavailable", message: "FounderBrain gateway is not configured." }), 503);
  if (!request.headers.get(ACCESS_JWT_HEADER)) return response(JSON.stringify({ error: "sign_in_required", message: "Sign in to continue." }), 401);
  const target = new URL(`${inbound.pathname}${inbound.search}`, origin);
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit = { method: request.method, headers: gatewayHeaders(request, env.ORIGIN_SECRET), redirect: "manual", signal: controller.signal };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    const upstream = await fetchImpl(target, init);
    if (upstream.status >= 300 && upstream.status < 400) return response(JSON.stringify({ error: "upstream_redirect", message: "The API returned an unsupported redirect." }), 502);
    const headers = securityHeaders(upstream.headers); headers.set("Cache-Control", "private, no-store");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  } catch (error) {
    const timedOut = controller.signal.aborted; const message = timedOut ? "FounderBrain API timed out." : "FounderBrain API is unavailable.";
    return response(JSON.stringify({ error: timedOut ? "gateway_timeout" : "gateway_unavailable", message }), timedOut ? 504 : 502);
  } finally { clearTimeout(timeout); }
}
async function serveAsset(request: Request, env: FounderBrainEdgeEnv): Promise<Response> {
  if (!env.ASSETS) return new Response("FounderBrain assets are unavailable.", { status: 503, headers: securityHeaders(new Headers({ "Content-Type": "text/plain" })) });
  let asset = await env.ASSETS.fetch(request);
  if (asset.status === 404 && (request.method === "GET" || request.method === "HEAD") && request.headers.get("accept")?.includes("text/html")) {
    const index = new URL("/index.html", request.url); asset = await env.ASSETS.fetch(new Request(index, { method: request.method, headers: request.headers }));
  }
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers: securityHeaders(asset.headers) });
}

export default createFounderBrainWorker();
