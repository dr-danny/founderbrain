import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import postgres from "postgres";
import { PgBrainStore } from "./store.ts";
import { BrainJobs, type Provider } from "./jobs.ts";
import { buildApi } from "./server.ts";
import { emptyBrain, canonicalize, DomainError, type Brain } from "./domain.ts";
import type { Config } from "./config.ts";
import { migrateJobs } from "./jobs.ts";
import { migrateOpenRouterKeys, ensureOpenRouterKey } from "./openrouter-keys.ts";
import type { OpenRouterManagement } from "./openrouter-management.ts";
import { OPENROUTER_LIFETIME_USD, openRouterKeyName } from "./openrouter-management.ts";

const url = process.env.FB_TEST_DATABASE_URL;
const enabled = !!url;
const skip = enabled ? undefined : "Disposable database not configured";
let store: PgBrainStore;
let jobs: BrainJobs;
let app: Awaited<ReturnType<typeof buildApi>>;
const prefix = "test|" + randomUUID();
const tracked = new Map<string, string>();
let provider: Provider = async (body) => {
  if (body.system.includes("plan one short") || body.system.includes("You plan")) {
    return { text: "- angle: workflow", inputTokens: 10, outputTokens: 5, requestId: "test-think" };
  }
  if (body.system.includes("Verify")) {
    return { text: "PASS", inputTokens: 5, outputTokens: 1, requestId: "test-verify" };
  }
  return {
    text: "Hi [Name], could we learn about your workflow?",
    inputTokens: 100,
    outputTokens: 30,
    requestId: "test-request",
  };
};
let config: Config;
const createdHashes: string[] = [];
const deletedHashes: string[] = [];
const fakeManagement: OpenRouterManagement = {
  async createUserKey(email) {
    const hash = "hash-" + randomUUID();
    createdHashes.push(hash);
    return {
      hash,
      key: "sk-or-v1-fixture-" + hash,
      name: openRouterKeyName(email),
      limit: OPENROUTER_LIFETIME_USD,
      limitReset: null,
      expiresAt: new Date(Date.now() + 30 * 864e5).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  },
  async getKey(hash) {
    return {
      hash,
      name: "fixture",
      disabled: false,
      limit: OPENROUTER_LIFETIME_USD,
      limitRemaining: OPENROUTER_LIFETIME_USD,
      limitReset: null,
      expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
      usage: 0,
    };
  },
  async deleteKey(hash) {
    deletedHashes.push(hash);
  },
};
const full = (): Brain => {
  const b = emptyBrain();
  b.identity = {
    name: "Ada",
    venture: "Northwind",
    role: "Founder",
    stage: "exploring",
    goal: "Find a useful problem",
    approved: true,
  };
  b.customer = {
    segment: "Independent shop owners",
    problem: "Manual appointment follow-ups",
    outcome: "Fewer missed appointments",
    workaround: "unknown",
    evidenceStatus: "hypothesis",
    evidence: "",
    approved: true,
  };
  b.offer = {
    description: "Interview to understand workflows",
    delivery: "A conversation",
    outcome: "Learn what matters",
    cta: "Would you talk with me?",
    price: "",
    approved: true,
  };
  b.voice = {
    tone: "Direct and warm",
    boundaries: "No invented claims",
    sample: "I would like to understand your day.",
    approved: true,
  };
  return b;
};
async function workspace(label: string) {
  const subject = prefix + "|" + label;
  const id = await store.ensureWorkspace(subject);
  tracked.set(subject, id);
  await ensureOpenRouterKey(store, config, id, label + "@example.test", fakeManagement);
  return id;
}
before(async () => {
  if (!url) return;
  process.env.GE_MASTER_KEY ??= randomBytes(32).toString("base64");
  await migrateJobs(url);
  await migrateOpenRouterKeys(url);
  config = {
    NODE_ENV: "production",
    DATABASE_URL: url,
    PORT: 8080,
    APP_ORIGIN: "https://founderbrain.example.test",
    ORIGIN_SECRET: "test-origin-secret-not-a-live-secret-0000",
    HEXCLAVE_PROJECT_ID: "7f2d1c3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f",
    HEXCLAVE_API_URL: "https://api.hexclave.com",
    FOUNDERBRAIN_LOCAL_DEMO: "false",
    AI_ENABLED: "true",
    OPENROUTER_MANAGEMENT_KEY: "fixture-management-key-not-live",
    AI_MODEL: "anthropic/claude-sonnet-4",
    AI_MODEL_RUNNER: "anthropic/claude-sonnet-4",
    AI_MODEL_THINKER: "anthropic/claude-3.5-haiku",
    AI_MODEL_VERIFIER: "anthropic/claude-3.5-haiku",
    AI_INPUT_USD_PER_MILLION: 1,
    AI_OUTPUT_USD_PER_MILLION: 2,
    AI_WORKSPACE_DAILY_MICROUSD: 1000000,
    AI_GLOBAL_DAILY_MICROUSD: 100000000,
  };
  store = new PgBrainStore(url);
  jobs = new BrainJobs(store, config, (...args) => provider(...args));
  app = await buildApi(config, {
    store,
    jobs,
    openRouterManagement: fakeManagement,
    authenticate: async (req) => {
      const user = req.headers["x-test-user"];
      if (typeof user !== "string") throw new DomainError(401, "sign_in_required", "Sign in.");
      return { subject: prefix + "|" + user, email: user + "@example.test" };
    },
  });
});
after(async () => {
  if (!enabled) return;
  for (const [subject, id] of tracked) await store.deleteWorkspace(subject, id).catch(() => {});
  await app?.close();
});
const headers = (user: string) => ({
  "x-test-user": user,
  "x-founderbrain-origin": config.ORIGIN_SECRET!,
  origin: config.APP_ORIGIN,
});
describe("FounderBrain API, durable jobs and failure regressions", () => {
  it(
    "rejects direct origin and unauthenticated API requests; legacy paths absent",
    { skip },
    async () => {
      assert.equal((await app.inject({ url: "/api/brain" })).statusCode, 403);
      assert.equal(
        (
          await app.inject({
            url: "/api/brain",
            headers: { "x-founderbrain-origin": config.ORIGIN_SECRET! },
          })
        ).statusCode,
        401,
      );
      assert.equal((await app.inject({ url: "/auth/owner" })).statusCode, 404);
      assert.equal(
        (
          await app.inject({
            url: "/api/brain",
            headers: { ...headers("a"), origin: "https://evil.example" },
          })
        ).statusCode,
        403,
      );
    },
  );
  it(
    "tells the browser how to reach Hexclave and who is signed in, never the subject and never a secret",
    { skip },
    async () => {
      const cfg = await app.inject({
        url: "/api/config",
        headers: { "x-founderbrain-origin": config.ORIGIN_SECRET! },
      });
      assert.equal(cfg.statusCode, 200);
      assert.deepEqual(cfg.json(), {
        authMode: "hexclave",
        hexclave: {
          projectId: "7f2d1c3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f",
          apiUrl: "https://api.hexclave.com",
          publishableClientKey: null,
        },
        aiEnabled: true,
      });
      assert.doesNotMatch(cfg.body, /ORIGIN_SECRET|ssk_|OPENROUTER|ANTHROPIC/i);
      await workspace("me");
      const me = await app.inject({ url: "/api/me", headers: headers("me") });
      assert.equal(me.statusCode, 200);
      assert.deepEqual(me.json(), { email: "me@example.test" });
      assert.equal(
        (
          await app.inject({
            url: "/api/me",
            headers: { "x-founderbrain-origin": config.ORIGIN_SECRET! },
          })
        ).statusCode,
        401,
      );
    },
  );
  it("provisions OneDay-Founderbrain-{email} keys on first authenticated request", { skip }, async () => {
    const before = createdHashes.length;
    const r = await app.inject({ url: "/api/me", headers: headers("provision") });
    assert.equal(r.statusCode, 200);
    assert.ok(createdHashes.length > before);
    const subject = prefix + "|provision";
    const id = await store.ensureWorkspace(subject);
    tracked.set(subject, id);
    const meta = await store.scoped(
      id,
      (tx) =>
        tx`select key_name, lifetime_limit_usd, expires_at, spent_microusd from fb_openrouter_key`,
    );
    assert.equal(meta[0]?.key_name, "OneDay-Founderbrain-provision@example.test");
    assert.equal(Number(meta[0]?.lifetime_limit_usd), 20);
    assert.equal(Number(meta[0]?.spent_microusd), 0);
    const expires = new Date(meta[0]!.expires_at);
    assert.ok(expires.getTime() > Date.now() + 29 * 864e5);
    assert.ok(expires.getTime() < Date.now() + 31 * 864e5);
  });

  it("authenticates membership and rejects revoked membership", { skip }, async () => {
    const id = await workspace("revoked");
    const subject = prefix + "|revoked";
    await store.scoped(id, async (tx) => {
      await tx`select set_config('app.subject',${subject},true)`;
      await tx`update fb_member set revoked_at=now() where founder_id=${id}`;
    });
    assert.equal(
      (await app.inject({ url: "/api/brain", headers: headers("revoked") })).statusCode,
      403,
    );
  });
  it(
    "performs 100 committed save/readbacks then retrieves through a fresh store",
    { skip },
    async () => {
      const id = await workspace("cycles");
      let b = full();
      let version = 0;
      for (let i = 0; i < 100; i++) {
        b = structuredClone(b);
        b.identity.goal = "Research iteration " + i;
        const s = await store.commit(id, b, version, "cycle-save-" + i);
        version = s.version;
        assert.equal(s.verified, true);
        assert.equal(s.brain.identity.goal, b.identity.goal);
        assert.equal((await store.read(id)).sha, s.sha);
      }
      const reopened = new PgBrainStore(url!);
      try {
        const loaded = await reopened.read(id);
        assert.equal(loaded.version, 100);
        assert.deepEqual(loaded.brain, b);
      } finally {
        await reopened.close();
      }
      const history = await store.history(id);
      assert.equal(history.length, 100);
    },
  );
  it(
    "allows exactly one CAS winner and preserves receipt on lost-response retry",
    { skip },
    async () => {
      const id = await workspace("conflicts");
      const results = await Promise.allSettled([
        store.commit(id, full(), 0, "concurrent-a"),
        store.commit(id, full(), 0, "concurrent-b"),
      ]);
      assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(results.filter((x) => x.status === "rejected").length, 1);
      const winner = results[0]?.status === "fulfilled" ? "concurrent-a" : "concurrent-b";
      await store.commit(id, full(), 1, "subsequent-save");
      const retried = await store.commit(id, full(), 0, winner);
      assert.equal(retried.version, 1);
    },
  );
  it(
    "uses orchestrated OpenRouter payload, persists output, revokes key on delete, and denies cross-tenant IDs",
    { skip },
    async () => {
      const id = await workspace("output");
      const other = await workspace("other");
      await store.commit(id, full(), 0, "output-source");
      let captured = "";
      const beforeDeletes = deletedHashes.length;
      provider = async (body) => {
        if (body.system.includes("plan one short") || body.system.includes("You plan")) {
          return { text: "- angle: appointments", inputTokens: 10, outputTokens: 5, requestId: "t" };
        }
        if (body.system.includes("Verify")) {
          return { text: "PASS", inputTokens: 5, outputTokens: 1, requestId: "v" };
        }
        captured = canonicalize(body);
        return {
          text: "Hi [Name], would you share how you handle appointments?",
          inputTokens: 80,
          outputTokens: 30,
          requestId: "fixture-1",
        };
      };
      const job = await jobs.enqueue(id, 1, "output-job-key");
      assert.equal((await jobs.enqueue(id, 1, "output-job-key")).id, job.id);
      await jobs.tick(id);
      const result = await jobs.read(id, job.id);
      assert.equal(result.status, "completed");
      assert.ok(result.artifact);
      assert.match(captured, /Independent shop owners/);
      assert.equal(
        result.artifact.inputHash.length,
        64,
        "input hash is a sha256 of the pinned orchestration payload",
      );
      await assert.rejects(jobs.read(other, job.id), { status: 404 });
      const accepted = await jobs.accept(
        id,
        result.artifact.id,
        "Reviewed invitation",
        1,
        "accept-output-key",
      );
      assert.equal(accepted.text, "Reviewed invitation");
      assert.ok(accepted.acceptedAt);
      assert.equal(
        (await jobs.accept(id, result.artifact.id, "Reviewed invitation", 1, "accept-output-key"))
          .acceptedAt,
        accepted.acceptedAt,
      );
      const deleted = await app.inject({
        method: "DELETE",
        url: "/api/workspace",
        headers: headers("output"),
        payload: { confirmation: "DELETE" },
      });
      assert.equal(deleted.statusCode, 200, deleted.body);
      assert.ok(deletedHashes.length > beforeDeletes, "OpenRouter key revoked on delete");
      assert.equal(
        (await app.inject({ url: "/api/brain", headers: headers("output") })).statusCode,
        410,
      );
      assert.equal((await store.scoped(id, (tx) => tx`select * from ge_blob`)).length, 0);
    },
  );
  it("rejects stale proposal acceptance without deleting old artifact", { skip }, async () => {
    const id = await workspace("stale");
    await store.commit(id, full(), 0, "stale-source");
    const j = await jobs.enqueue(id, 1, "stale-output-key");
    await jobs.tick(id);
    const artifact = (await jobs.read(id, j.id)).artifact!;
    const b = full();
    b.identity.goal = "Changed";
    await store.commit(id, b, 1, "stale-next-version");
    await assert.rejects(jobs.accept(id, artifact.id, artifact.text, 2, "stale-accept-key"), {
      code: "stale_proposal",
    });
    assert.ok(await jobs.artifact(id));
  });
  it(
    "quarantines ambiguous calls and retains budget reservation through deletion",
    { skip },
    async () => {
      const id = await workspace("uncertain");
      await store.commit(id, full(), 0, "uncertain-source");
      let calls = 0;
      provider = async () => {
        calls++;
        throw new Error("ambiguous fixture timeout");
      };
      const job = await jobs.enqueue(id, 1, "uncertain-job");
      await jobs.tick(id);
      assert.equal((await jobs.read(id, job.id)).status, "uncertain");
      assert.equal(calls, 1);
      await assert.rejects(jobs.enqueue(id, 1, "uncertain-new-key"), { code: "job_active" });
      await store.deleteWorkspace(prefix + "|uncertain", id);
      const rec = await store.scoped(id, (tx) => tx`select * from fb_usage_reconciliation`);
      assert.equal(rec.length, 1);
      assert.equal((await store.scoped(id, (tx) => tx`select * from ge_blob`)).length, 0);
    },
  );
  it(
    "blocks budgets before calling provider and limits queue discovery to worker role",
    { skip },
    async () => {
      const id = await workspace("budget");
      await store.commit(id, full(), 0, "budget-source");
      const small = new BrainJobs(
        store,
        { ...config, AI_WORKSPACE_DAILY_MICROUSD: 1 },
        async () => {
          throw new Error("must not call");
        },
      );
      try {
        await assert.rejects(small.enqueue(id, 1, "budget-job-key"), { code: "budget_limit" });
      } finally {
        await small.close();
      }
      const db = postgres(url!, { max: 1, onnotice: () => {} });
      try {
        assert.equal((await db`select * from fb_job_dispatch`).length, 0);
        assert.equal((await db`select * from fb_budget where scope<>'global'`).length, 0);
      } finally {
        await db.end();
      }
    },
  );
  it(
    "exports exact legacy filename and does not claim compatibility with legacy engines",
    { skip },
    async () => {
      const id = await workspace("export");
      await store.commit(id, full(), 0, "export-source");
      const r = await app.inject({
        url: "/api/export?format=markdown",
        headers: headers("export"),
      });
      assert.equal(r.statusCode, 200);
      assert.match(String(r.headers["content-disposition"]), /founder-brain\.md/);
      assert.match(String(r.headers["cache-control"]), /no-store/);
      assert.match(r.body, /Renderer: 1/);
    },
  );
});
