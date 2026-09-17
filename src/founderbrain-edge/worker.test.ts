import assert from "node:assert/strict";
import test from "node:test";
import { createFounderBrainWorker, type FounderBrainEdgeEnv } from "./worker.js";

const baseEnv = (): FounderBrainEdgeEnv => ({ API_ORIGIN: "https://founderbrain-api.up.railway.app", ORIGIN_SECRET: "test-origin-secret", ASSETS: { async fetch() { return new Response("asset"); } } });
const ACCESS = { "Cf-Access-Jwt-Assertion": "signed-by-access" };

test("proxies only a fixed API origin, forwards the Access JWT and allowlisted headers, drops the rest, no-store", async () => {
  let seen: { url?: string; headers?: Headers; method?: string } = {};
  const worker = createFounderBrainWorker(async (input, init) => { seen = { url: String(input), headers: new Headers(init?.headers), method: init?.method }; return new Response(JSON.stringify({ ok: true }), { headers: { "Cache-Control": "public, max-age=999", "X-From-Upstream": "yes" } }); });
  const request = new Request("https://app.example.test/api/brain?version=4", { method: "PUT", headers: { ...ACCESS, Authorization: "Bearer stale-token", "Content-Type": "application/json", "X-FounderBrain-Origin": "attacker", "X-Forwarded-Host": "attacker.test", "X-Request-Id": "req-7", Cookie: "CF_Authorization=browser-cookie" }, body: "{}" });
  const result = await worker.fetch(request, baseEnv());
  assert.equal(seen.url, "https://founderbrain-api.up.railway.app/api/brain?version=4"); assert.equal(seen.method, "PUT");
  assert.equal(seen.headers?.get("cf-access-jwt-assertion"), "signed-by-access");
  assert.equal(seen.headers?.get("x-founderbrain-origin"), "test-origin-secret");
  assert.equal(seen.headers?.get("authorization"), null, "nothing reads Authorization any more, so it does not cross");
  assert.equal(seen.headers?.get("cookie"), null, "the Access cookie stays in the browser; the header is what the API verifies");
  assert.equal(seen.headers?.get("x-forwarded-host"), null);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.match(result.headers.get("content-security-policy") ?? "", /connect-src 'self'$/);
});
test("refuses /api without the Access header before touching the origin", async () => {
  const worker = createFounderBrainWorker(async () => { throw new Error("API must not be called"); });
  const result = await worker.fetch(new Request("https://app.example.test/api/brain"), baseEnv());
  assert.equal(result.status, 401); assert.equal((await result.json() as { error: string }).error, "sign_in_required");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});
test("never follows an API redirect", async () => {
  const worker = createFounderBrainWorker(async () => new Response(null, { status: 302, headers: { Location: "https://evil.example" } }));
  const result = await worker.fetch(new Request("https://app.example.test/api/brain", { headers: ACCESS }), baseEnv());
  assert.equal(result.status, 502); assert.equal((await result.json() as { error: string }).error, "upstream_redirect");
});
test("returns a bounded timeout when the fixed origin does not answer", async () => {
  const worker = createFounderBrainWorker(async (_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))), { timeoutMs: 1 });
  const result = await worker.fetch(new Request("https://app.example.test/api/brain", { headers: ACCESS }), baseEnv());
  assert.equal(result.status, 504); assert.equal((await result.json() as { error: string }).error, "gateway_timeout");
});
test("fails closed when origin configuration is missing, unsafe, or not a bare origin", async () => {
  const worker = createFounderBrainWorker(async () => new Response("unexpected"));
  const missing = await worker.fetch(new Request("https://app.example.test/api/brain", { headers: ACCESS }), { ASSETS: baseEnv().ASSETS });
  assert.equal(missing.status, 503);
  for (const origin of ["http://evil.example", "https://user:pass@api.example", "https://api.example/prefix", "https://api.example/?query=1", "https://api.example/#hash"]) {
    const rejected = await worker.fetch(new Request("https://app.example.test/api/brain", { headers: ACCESS }), { ...baseEnv(), API_ORIGIN: origin });
    assert.equal(rejected.status, 503, origin);
  }
});
test("permits local HTTP only through an explicit injected test option", async () => {
  const request = new Request("https://app.example.test/api/brain", { headers: ACCESS });
  const worker = createFounderBrainWorker(async () => new Response("ok"), { allowInsecureApiOrigin: true });
  const result = await worker.fetch(request, { ...baseEnv(), API_ORIGIN: "http://127.0.0.1:8787" });
  assert.equal(result.status, 200);
});
test("serves SPA fallback through assets and does not proxy non-api paths", async () => {
  const assets: string[] = []; const worker = createFounderBrainWorker(async () => { throw new Error("API should not be used"); });
  const result = await worker.fetch(new Request("https://app.example.test/mission/customer", { headers: { Accept: "text/html" } }), { ...baseEnv(), ASSETS: { async fetch(request) { assets.push(new URL(request.url).pathname); return assets.length === 1 ? new Response("missing", { status: 404 }) : new Response("<html>app</html>", { headers: { "Content-Type": "text/html" } }); } } });
  assert.equal(result.status, 200); assert.deepEqual(assets, ["/mission/customer", "/index.html"]); assert.equal(result.headers.get("x-frame-options"), "DENY");
});
