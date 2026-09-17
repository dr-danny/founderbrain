import assert from "node:assert/strict";
import test from "node:test";
import { createFounderBrainWorker, type FounderBrainEdgeEnv } from "./worker.js";

const baseEnv = (): FounderBrainEdgeEnv => ({ API_ORIGIN: "https://founderbrain-api.up.railway.app", ORIGIN_SECRET: "test-origin-secret", HEXCLAVE_API_URL: "https://api.hexclave.com", ASSETS: { async fetch() { return new Response("asset"); } } });
const TOKEN = { "x-stack-access-token": "signed-by-hexclave" };

test("proxies only a fixed API origin, forwards the Hexclave token and allowlisted headers, drops the rest, no-store", async () => {
  let seen: { url?: string; headers?: Headers; method?: string } = {};
  const worker = createFounderBrainWorker(async (input, init) => { seen = { url: String(input), headers: new Headers(init?.headers), method: init?.method }; return new Response(JSON.stringify({ ok: true }), { headers: { "Cache-Control": "public, max-age=999", "X-From-Upstream": "yes" } }); });
  const request = new Request("https://app.example.test/api/brain?version=4", { method: "PUT", headers: { ...TOKEN, Authorization: "Bearer stale-token", "Content-Type": "application/json", "X-FounderBrain-Origin": "attacker", "X-Forwarded-Host": "attacker.test", "X-Request-Id": "req-7", Cookie: "stack-refresh-token=browser-cookie" }, body: "{}" });
  const result = await worker.fetch(request, baseEnv());
  assert.equal(seen.url, "https://founderbrain-api.up.railway.app/api/brain?version=4"); assert.equal(seen.method, "PUT");
  assert.equal(seen.headers?.get("x-stack-access-token"), "signed-by-hexclave");
  assert.equal(seen.headers?.get("x-founderbrain-origin"), "test-origin-secret");
  assert.equal(seen.headers?.get("authorization"), null, "nothing reads Authorization, so it does not cross");
  assert.equal(seen.headers?.get("cookie"), null, "the Hexclave refresh cookie stays in the browser; the access token header is what the API verifies");
  assert.equal(seen.headers?.get("x-forwarded-host"), null);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.match(result.headers.get("content-security-policy") ?? "", /connect-src 'self' https:\/\/api\.hexclave\.com$/);
});
test("refuses /api without the token header before touching the origin, except /api/config which the browser needs first", async () => {
  let called = 0;
  const worker = createFounderBrainWorker(async () => { called += 1; return new Response(JSON.stringify({ authMode: "hexclave" }), { headers: { "Content-Type": "application/json" } }); });
  const refused = await worker.fetch(new Request("https://app.example.test/api/brain"), baseEnv());
  assert.equal(refused.status, 401); assert.equal((await refused.json() as { error: string }).error, "sign_in_required");
  assert.equal(refused.headers.get("cache-control"), "private, no-store");
  assert.equal(called, 0, "the origin must not be called for an unauthenticated data request");
  const config = await worker.fetch(new Request("https://app.example.test/api/config"), baseEnv());
  assert.equal(config.status, 200); assert.equal(called, 1);
  const configLike = await worker.fetch(new Request("https://app.example.test/api/config/../brain"), baseEnv());
  assert.equal(configLike.status, 401, "URL normalisation happens before the check, so this is /api/brain");
});
test("CSP only widens connect-src for a valid HTTPS Hexclave origin; otherwise it stays 'self'", async () => {
  const worker = createFounderBrainWorker(async () => new Response("ok"));
  for (const bad of [undefined, "", "http://api.hexclave.com", "https://api.hexclave.com/api/v1", "https://api.hexclave.com/?x=1", "not a url"]) {
    const result = await worker.fetch(new Request("https://app.example.test/", { headers: { Accept: "text/html" } }), { ...baseEnv(), HEXCLAVE_API_URL: bad });
    assert.match(result.headers.get("content-security-policy") ?? "", /connect-src 'self'$/, String(bad));
  }
  const ok = await worker.fetch(new Request("https://app.example.test/", { headers: { Accept: "text/html" } }), { ...baseEnv(), HEXCLAVE_API_URL: "https://api.hexclave.com/" });
  assert.match(ok.headers.get("content-security-policy") ?? "", /connect-src 'self' https:\/\/api\.hexclave\.com$/);
});
test("never follows an API redirect", async () => {
  const worker = createFounderBrainWorker(async () => new Response(null, { status: 302, headers: { Location: "https://evil.example" } }));
  const result = await worker.fetch(new Request("https://app.example.test/api/brain", { headers: TOKEN }), baseEnv());
  assert.equal(result.status, 502); assert.equal((await result.json() as { error: string }).error, "upstream_redirect");
});
test("returns a bounded timeout when the fixed origin does not answer", async () => {
  const worker = createFounderBrainWorker(async (_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))), { timeoutMs: 1 });
  const result = await worker.fetch(new Request("https://app.example.test/api/brain", { headers: TOKEN }), baseEnv());
  assert.equal(result.status, 504); assert.equal((await result.json() as { error: string }).error, "gateway_timeout");
});
test("fails closed when origin configuration is missing, unsafe, or not a bare origin", async () => {
  const worker = createFounderBrainWorker(async () => new Response("unexpected"));
  const missing = await worker.fetch(new Request("https://app.example.test/api/brain", { headers: TOKEN }), { ASSETS: baseEnv().ASSETS });
  assert.equal(missing.status, 503);
  for (const origin of ["http://evil.example", "https://user:pass@api.example", "https://api.example/prefix", "https://api.example/?query=1", "https://api.example/#hash"]) {
    const rejected = await worker.fetch(new Request("https://app.example.test/api/brain", { headers: TOKEN }), { ...baseEnv(), API_ORIGIN: origin });
    assert.equal(rejected.status, 503, origin);
  }
});
test("permits local HTTP only through an explicit injected test option", async () => {
  const request = new Request("https://app.example.test/api/brain", { headers: TOKEN });
  const worker = createFounderBrainWorker(async () => new Response("ok"), { allowInsecureApiOrigin: true });
  const result = await worker.fetch(request, { ...baseEnv(), API_ORIGIN: "http://127.0.0.1:8787" });
  assert.equal(result.status, 200);
});
test("serves SPA fallback through assets and does not proxy non-api paths", async () => {
  const assets: string[] = []; const worker = createFounderBrainWorker(async () => { throw new Error("API should not be used"); });
  const result = await worker.fetch(new Request("https://app.example.test/mission/customer", { headers: { Accept: "text/html" } }), { ...baseEnv(), ASSETS: { async fetch(request) { assets.push(new URL(request.url).pathname); return assets.length === 1 ? new Response("missing", { status: 404 }) : new Response("<html>app</html>", { headers: { "Content-Type": "text/html" } }); } } });
  assert.equal(result.status, 200); assert.deepEqual(assets, ["/mission/customer", "/index.html"]); assert.equal(result.headers.get("x-frame-options"), "DENY");
});
