import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import postgres from "postgres";

import type { Config } from "./config.ts";
import { DomainError } from "./domain.ts";
import { __gmailTest, migrateGmail } from "./gmail.ts";
import { migrateOpenRouterKeys } from "./openrouter-keys.ts";
import type { OpenRouterManagement } from "./openrouter-management.ts";
import { OPENROUTER_LIFETIME_USD, openRouterKeyName } from "./openrouter-management.ts";
import type { Provider } from "./provider.ts";
import { buildApi } from "./server.ts";
import { PgBrainStore } from "./store.ts";

/**
 * Proves that two authenticated HTTP users get fully separate Gmail
 * connectors through the real `buildApi()` surface: distinct workspace ids,
 * distinct mailboxes, oauth state that cannot be completed across tenants,
 * drafts/settings/status that cannot be read or mutated across tenants, and
 * Postgres row-level security that enforces the same boundary underneath the
 * application code (not just above it).
 */

const databaseUrl = process.env.FB_TEST_DATABASE_URL;
const migrationUrl = process.env.FB_TEST_MIGRATION_DATABASE_URL ?? databaseUrl;
const enabled = Boolean(databaseUrl);
const skip = enabled ? undefined : "Disposable database not configured";
const prefix = `gmail-isolation|${randomUUID()}`;

function requireLoopback(value: string | undefined, name: string): void {
  if (!value) return;
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
    throw new Error(`${name} must point to a loopback disposable database`);
  }
}
requireLoopback(databaseUrl, "FB_TEST_DATABASE_URL");
requireLoopback(migrationUrl, "FB_TEST_MIGRATION_DATABASE_URL");
const nativeCi =
  process.env.GITHUB_ACTIONS === "true" &&
  Boolean(databaseUrl && new URL(databaseUrl).pathname === "/founderbrain_test") &&
  Boolean(migrationUrl && new URL(migrationUrl).pathname === "/founderbrain_test");
if (enabled && process.env.FB_TEST_EMBEDDED !== "true" && !nativeCi) {
  throw new Error(
    "Use the disposable embedded database or GitHub's loopback founderbrain_test database",
  );
}

const config: Config = {
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl ?? "postgres://fb_runtime@127.0.0.1:1/postgres",
  PORT: 8080,
  APP_ORIGIN: "https://founderbrain.example.invalid",
  ORIGIN_SECRET: "test-origin-secret-not-live-000000000000",
  HEXCLAVE_PROJECT_ID: "7f2d1c3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f",
  HEXCLAVE_API_URL: "https://api.hexclave.com",
  FOUNDERBRAIN_LOCAL_DEMO: "false",
  AI_ENABLED: "true",
  ROUTINES_ENABLED: "false",
  OPENROUTER_MANAGEMENT_KEY: "fixture-management-key-not-live",
  AI_MODEL: "anthropic/claude-sonnet-4",
  AI_MODEL_RUNNER: "anthropic/claude-sonnet-4",
  AI_INPUT_USD_PER_MILLION: 1,
  AI_OUTPUT_USD_PER_MILLION: 2,
  AI_WORKSPACE_DAILY_MICROUSD: 1_000_000_000,
  AI_GLOBAL_DAILY_MICROUSD: 1_000_000_000,
  GMAIL_CLIENT_ID: "fixture-client.apps.googleusercontent.com",
  GMAIL_CLIENT_SECRET: "fixture-client-secret-not-live",
};

let store: PgBrainStore;
let api: Awaited<ReturnType<typeof buildApi>>;
const workspaces = new Map<string, string>();

const fakeManagement: OpenRouterManagement = {
  async createUserKey(email) {
    const hash = `hash-${randomUUID()}`;
    return {
      hash,
      key: `sk-or-v1-fixture-${hash}`,
      name: openRouterKeyName(email),
      limit: OPENROUTER_LIFETIME_USD,
      limitReset: null,
      expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
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
  async deleteKey() {},
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** One isolated, minimal Google mock per mailbox. Never shared state across mailboxes. */
type GoogleMockOptions = { email: string; messageIds?: string[] };
function googleMock(options: GoogleMockOptions) {
  const email = options.email;
  const messageIds = options.messageIds ?? ["m1", "m2", "m3", "m4", "m5"];
  const calls = { token: 0, profile: 0, full: 0, save: 0, send: 0, revoke: 0 };
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      calls.token++;
      return json({
        access_token: `fixture-access-${email}`,
        refresh_token: `fixture-refresh-${email}`,
        expires_in: 3600,
        scope:
          "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
      });
    }
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke") {
      calls.revoke++;
      return new Response(null, { status: 200 });
    }
    if (url.pathname.endsWith("/users/me/profile")) {
      calls.profile++;
      return json({ emailAddress: email });
    }
    const messageMatch = url.pathname.match(/\/users\/me\/messages\/([^/]+)$/);
    if (messageMatch) {
      calls.full++;
      const id = decodeURIComponent(messageMatch[1]!);
      return json({
        id,
        labelIds: ["SENT"],
        payload: {
          mimeType: "text/plain",
          headers: [{ name: "From", value: `Owner <${email}>` }],
          body: { data: Buffer.from(`Hi,\n\nSample body for ${id}.`).toString("base64url") },
        },
      });
    }
    if (url.pathname.endsWith("/users/me/drafts/send") && method === "POST") {
      calls.send++;
      return json({ id: `gmail-message-${email}-${calls.send}` });
    }
    if (/\/users\/me\/drafts(?:\/[^/]+)?$/.test(url.pathname) && ["POST", "PUT"].includes(method)) {
      calls.save++;
      return json({ id: `gmail-draft-${email}`, message: { id: `gmail-draft-message-${email}` } });
    }
    throw new Error(`unexpected mocked Google request for ${email}: ${method} ${url.href}`);
  };
  return { fetchMock, calls, messageIds, email };
}

const standardProvider: Provider = async (body) => {
  if (body.system.startsWith("Analyze only writing style")) {
    return {
      text: JSON.stringify({
        tone: "Direct and warm",
        cadence: "Short paragraphs",
        greetings: "Hi",
        closings: "Thanks",
        dos: ["Be concise"],
        donts: ["Do not invent facts"],
      }),
      inputTokens: 10,
      outputTokens: 5,
      requestId: "fixture-profile",
    };
  }
  return {
    text: JSON.stringify({ subject: "Local subject", body: "Exact local body" }),
    inputTokens: 10,
    outputTokens: 5,
    requestId: "fixture-draft",
  };
};

function headersFor(user: string): Record<string, string> {
  return {
    "x-test-user": user,
    "x-founderbrain-origin": config.ORIGIN_SECRET!,
    origin: config.APP_ORIGIN,
  };
}

async function subjectWorkspace(user: string): Promise<string> {
  const subject = `${prefix}|${user}`;
  const id = await store.ensureWorkspace(subject);
  workspaces.set(subject, id);
  return id;
}

before(async () => {
  if (!enabled) return;
  process.env.GE_MASTER_KEY = randomBytes(32).toString("base64");
  await migrateOpenRouterKeys(migrationUrl!);
  await migrateGmail(migrationUrl!);
  store = new PgBrainStore(databaseUrl!);
  api = await buildApi(config, {
    store,
    logger: false,
    openRouterManagement: fakeManagement,
    authenticate: async (req) => {
      const user = req.headers["x-test-user"];
      if (typeof user !== "string")
        throw new DomainError(401, "sign_in_required", "Sign in to continue.");
      return { subject: `${prefix}|${user}`, email: `${user}@example.invalid` };
    },
  });
});

after(async () => {
  __gmailTest.setFetch(null);
  __gmailTest.setAIProvider(null);
  await api?.close();
  await store?.close();
  if (!enabled || !migrationUrl) return;
  const admin = postgres(migrationUrl, { max: 1, onnotice: () => {} });
  try {
    const ids = [...workspaces.values()];
    if (ids.length) {
      await admin`delete from fb_member where founder_id in ${admin(ids)}`;
      await admin`delete from fb_user where founder_id in ${admin(ids)}`;
      await admin`delete from founder where id in ${admin(ids)}`;
    }
  } finally {
    await admin.end();
  }
});

describe("Two authenticated HTTP users get isolated Gmail connectors", { skip }, () => {
  let idAlice: string;
  let idBob: string;
  const mockAlice = googleMock({ email: "alice-mailbox@example.invalid" });
  const mockBob = googleMock({ email: "bob-mailbox@example.invalid" });
  let draftAliceId: string;
  let draftBobId: string;

  it("maps distinct authenticated subjects to distinct workspace ids, and the same subject to the same id", async () => {
    idAlice = await subjectWorkspace("alice");
    idBob = await subjectWorkspace("bob");
    assert.notEqual(idAlice, idBob);
    assert.equal(await subjectWorkspace("alice"), idAlice);
  });

  it("rejects a Gmail OAuth completion attempted under a different tenant's session", async () => {
    __gmailTest.setFetch(mockAlice.fetchMock);
    const started = await api.inject({
      method: "POST",
      url: "/api/gmail/oauth/start",
      headers: headersFor("alice"),
    });
    assert.equal(started.statusCode, 200);
    const state = new URL(started.json().url).searchParams.get("state");
    assert.ok(state);

    // Bob has never seen this state, and RLS scopes the state row to Alice's
    // founder_id, so Bob's completion attempt must fail as if the state never
    // existed, without ever touching Google's token endpoint.
    const stolen = await api.inject({
      method: "POST",
      url: "/api/gmail/oauth/complete",
      headers: headersFor("bob"),
      payload: { code: "fixture-code", state },
    });
    assert.equal(stolen.statusCode, 400);
    assert.equal(stolen.json().error, "gmail_oauth_state");
    assert.equal(mockAlice.calls.token, 0, "a cross-tenant replay must never reach Google");

    // The legitimate owner can still complete it.
    const completed = await api.inject({
      method: "POST",
      url: "/api/gmail/oauth/complete",
      headers: headersFor("alice"),
      payload: { code: "fixture-code", state },
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().email, mockAlice.email);
    assert.equal(mockAlice.calls.token, 1);
  });

  it("connects Bob to a different mailbox without disturbing Alice's connection", async () => {
    __gmailTest.setFetch(mockBob.fetchMock);
    const started = await api.inject({
      method: "POST",
      url: "/api/gmail/oauth/start",
      headers: headersFor("bob"),
    });
    assert.equal(started.statusCode, 200);
    const state = new URL(started.json().url).searchParams.get("state");
    const completed = await api.inject({
      method: "POST",
      url: "/api/gmail/oauth/complete",
      headers: headersFor("bob"),
      payload: { code: "fixture-code", state },
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().email, mockBob.email);
    assert.notEqual(completed.json().email, mockAlice.email);

    // Re-reading each status through their own session still shows their own
    // mailbox, never the other tenant's.
    __gmailTest.setFetch(async () => {
      throw new Error("Unexpected Google call in isolation-only assertion");
    });
    const aliceStatus = await api.inject({
      method: "GET",
      url: "/api/gmail/status",
      headers: headersFor("alice"),
    });
    const bobStatus = await api.inject({
      method: "GET",
      url: "/api/gmail/status",
      headers: headersFor("bob"),
    });
    assert.equal(aliceStatus.json().email, mockAlice.email);
    assert.equal(bobStatus.json().email, mockBob.email);
  });

  it("scopes OAuth state and encrypted tokens under fb_runtime RLS so each founder sees only its own row", async () => {
    const admin = postgres(migrationUrl!, { max: 1, onnotice: () => {} });
    try {
      await admin`set role fb_runtime`;
      const asAlice = await admin.begin(async (tx) => {
        await tx`select set_config('app.founder_id', ${idAlice}, true)`;
        return tx`select founder_id from fb_gmail_connection`;
      });
      assert.deepEqual(
        asAlice.map((r) => r.founder_id),
        [idAlice],
      );
      const asBob = await admin.begin(async (tx) => {
        await tx`select set_config('app.founder_id', ${idBob}, true)`;
        return tx`select founder_id from fb_gmail_connection`;
      });
      assert.deepEqual(
        asBob.map((r) => r.founder_id),
        [idBob],
      );
      // No leftover oauth state visible under either tenant after completion.
      const statesAlice = await admin.begin(async (tx) => {
        await tx`select set_config('app.founder_id', ${idAlice}, true)`;
        return tx`select 1 from fb_gmail_oauth_state`;
      });
      const statesBob = await admin.begin(async (tx) => {
        await tx`select set_config('app.founder_id', ${idBob}, true)`;
        return tx`select 1 from fb_gmail_oauth_state`;
      });
      assert.equal(statesAlice.length, 0);
      assert.equal(statesBob.length, 0);
    } finally {
      await admin`reset role`.catch(() => {});
      await admin.end();
    }
  });

  it("keeps voice analysis, drafts, settings and caps independent per tenant", async () => {
    __gmailTest.setFetch(mockAlice.fetchMock);
    __gmailTest.setAIProvider(standardProvider);
    const aliceVoice = await api.inject({
      method: "POST",
      url: "/api/gmail/voice",
      headers: headersFor("alice"),
      payload: { messageIds: mockAlice.messageIds, consent: true },
    });
    assert.equal(aliceVoice.statusCode, 200, aliceVoice.body);

    __gmailTest.setFetch(mockBob.fetchMock);
    const bobVoice = await api.inject({
      method: "POST",
      url: "/api/gmail/voice",
      headers: headersFor("bob"),
      payload: { messageIds: mockBob.messageIds, consent: true },
    });
    assert.equal(bobVoice.statusCode, 200, bobVoice.body);

    // Independent settings and daily caps: Alice keeps auto-send off with a
    // tight cap; Bob turns auto-send on with his own allowlist and a wider cap.
    __gmailTest.setFetch(async () => {
      throw new Error("Unexpected Google call in isolation-only assertion");
    });
    const aliceSettings = await api.inject({
      method: "PUT",
      url: "/api/gmail/settings",
      headers: headersFor("alice"),
      payload: { autoSend: false, allowedRecipients: [], dailyLimit: 1, confirmed: false },
    });
    assert.equal(aliceSettings.statusCode, 200, aliceSettings.body);
    const bobSettings = await api.inject({
      method: "PUT",
      url: "/api/gmail/settings",
      headers: headersFor("bob"),
      payload: {
        autoSend: true,
        allowedRecipients: ["bob-allowed@example.invalid"],
        dailyLimit: 7,
        confirmed: true,
      },
    });
    assert.equal(bobSettings.statusCode, 200, bobSettings.body);
    assert.deepEqual(aliceSettings.json().settings, {
      autoSend: false,
      allowedRecipients: [],
      dailyLimit: 1,
    });
    assert.deepEqual(bobSettings.json().settings, {
      autoSend: true,
      allowedRecipients: ["bob-allowed@example.invalid"],
      dailyLimit: 7,
    });

    // Create one draft per tenant.
    __gmailTest.setFetch(mockAlice.fetchMock);
    const aliceDraft = await api.inject({
      method: "POST",
      url: "/api/gmail/drafts",
      headers: headersFor("alice"),
      payload: {
        requestId: randomUUID(),
        recipient: "alice-recipient@example.invalid",
        brief: "Ask about the roadmap next quarter.",
      },
    });
    assert.equal(aliceDraft.statusCode, 200, aliceDraft.body);
    draftAliceId = aliceDraft.json().id;

    __gmailTest.setFetch(mockBob.fetchMock);
    const bobDraft = await api.inject({
      method: "POST",
      url: "/api/gmail/drafts",
      headers: headersFor("bob"),
      payload: {
        requestId: randomUUID(),
        recipient: "bob-recipient@example.invalid",
        brief: "Ask about the pricing update.",
      },
    });
    assert.equal(bobDraft.statusCode, 200, bobDraft.body);
    draftBobId = bobDraft.json().id;
    assert.notEqual(draftAliceId, draftBobId);
    __gmailTest.setFetch(async () => {
      throw new Error("Unexpected Google call in isolation-only assertion");
    });

    // Each tenant's draft list contains only its own draft.
    const aliceList = await api.inject({
      method: "GET",
      url: "/api/gmail/drafts",
      headers: headersFor("alice"),
    });
    const bobList = await api.inject({
      method: "GET",
      url: "/api/gmail/drafts",
      headers: headersFor("bob"),
    });
    assert.deepEqual(
      aliceList.json().drafts.map((d: { id: string }) => d.id),
      [draftAliceId],
    );
    assert.deepEqual(
      bobList.json().drafts.map((d: { id: string }) => d.id),
      [draftBobId],
    );
  });

  it("returns 404 gmail_draft_missing when a tenant reaches across for another tenant's draft id", async () => {
    const crossReads = [
      {
        method: "PUT" as const,
        url: `/api/gmail/drafts/${draftBobId}`,
        headers: headersFor("alice"),
        payload: { subject: "Hijack", body: "Hijacked body content here." },
      },
      {
        method: "POST" as const,
        url: `/api/gmail/drafts/${draftBobId}/save`,
        headers: headersFor("alice"),
        payload: {},
      },
      {
        method: "POST" as const,
        url: `/api/gmail/drafts/${draftBobId}/send`,
        headers: headersFor("alice"),
        payload: { confirmed: true },
      },
      {
        method: "PUT" as const,
        url: `/api/gmail/drafts/${draftAliceId}`,
        headers: headersFor("bob"),
        payload: { subject: "Hijack", body: "Hijacked body content here." },
      },
      {
        method: "POST" as const,
        url: `/api/gmail/drafts/${draftAliceId}/save`,
        headers: headersFor("bob"),
        payload: {},
      },
      {
        method: "POST" as const,
        url: `/api/gmail/drafts/${draftAliceId}/send`,
        headers: headersFor("bob"),
        payload: { confirmed: true },
      },
    ];
    for (const request of crossReads) {
      const response = await api.inject(request);
      assert.equal(response.statusCode, 404, `${request.method} ${request.url}: ${response.body}`);
      assert.equal(response.json().error, "gmail_draft_missing");
    }
    assert.equal(mockAlice.calls.save, 0, "cross-tenant save must never reach Google");
    assert.equal(mockAlice.calls.send, 0, "cross-tenant send must never reach Google");
    assert.equal(mockBob.calls.save, 0, "cross-tenant save must never reach Google");
    assert.equal(mockBob.calls.send, 0, "cross-tenant send must never reach Google");
  });

  it("disconnecting Alice leaves Bob's connector, profile, drafts and settings fully intact", async () => {
    __gmailTest.setFetch(mockAlice.fetchMock);
    const disconnected = await api.inject({
      method: "DELETE",
      url: "/api/gmail",
      headers: headersFor("alice"),
    });
    assert.equal(disconnected.statusCode, 200, disconnected.body);
    assert.equal(disconnected.json().disconnected, true);

    const aliceStatus = await api.inject({
      method: "GET",
      url: "/api/gmail/status",
      headers: headersFor("alice"),
    });
    assert.equal(aliceStatus.json().connected, false);
    assert.equal(aliceStatus.json().email, null);
    assert.equal(aliceStatus.json().voiceProfile, null);
    assert.deepEqual(aliceStatus.json().settings, {
      autoSend: false,
      allowedRecipients: [],
      dailyLimit: 5,
    });
    const aliceDrafts = await api.inject({
      method: "GET",
      url: "/api/gmail/drafts",
      headers: headersFor("alice"),
    });
    assert.deepEqual(aliceDrafts.json().drafts, []);

    // Bob is completely untouched: same mailbox, same draft, same settings.
    const bobStatus = await api.inject({
      method: "GET",
      url: "/api/gmail/status",
      headers: headersFor("bob"),
    });
    assert.equal(bobStatus.json().connected, true);
    assert.equal(bobStatus.json().email, mockBob.email);
    assert.ok(bobStatus.json().voiceProfile);
    assert.deepEqual(bobStatus.json().settings, {
      autoSend: true,
      allowedRecipients: ["bob-allowed@example.invalid"],
      dailyLimit: 7,
    });
    const bobDrafts = await api.inject({
      method: "GET",
      url: "/api/gmail/drafts",
      headers: headersFor("bob"),
    });
    assert.deepEqual(
      bobDrafts.json().drafts.map((d: { id: string }) => d.id),
      [draftBobId],
    );

    // And at the storage layer, Alice's connector row is gone while Bob's remains,
    // proven again under RLS rather than trusting the API's own bookkeeping.
    const admin = postgres(migrationUrl!, { max: 1, onnotice: () => {} });
    try {
      await admin`set role fb_runtime`;
      const rowsAlice = await admin.begin(async (tx) => {
        await tx`select set_config('app.founder_id', ${idAlice}, true)`;
        return tx`select
          (select count(*) from fb_gmail_connection) as connections,
          (select count(*) from fb_gmail_draft) as drafts,
          (select count(*) from fb_gmail_settings) as settings`;
      });
      assert.deepEqual(
        Object.fromEntries(Object.entries(rowsAlice[0]!).map(([k, v]) => [k, Number(v)])),
        { connections: 0, drafts: 0, settings: 0 },
      );
      const rowsBob = await admin.begin(async (tx) => {
        await tx`select set_config('app.founder_id', ${idBob}, true)`;
        return tx`select
          (select count(*) from fb_gmail_connection) as connections,
          (select count(*) from fb_gmail_draft) as drafts,
          (select count(*) from fb_gmail_settings) as settings`;
      });
      assert.deepEqual(
        Object.fromEntries(Object.entries(rowsBob[0]!).map(([k, v]) => [k, Number(v)])),
        { connections: 1, drafts: 1, settings: 1 },
      );
    } finally {
      await admin`reset role`.catch(() => {});
      await admin.end();
    }
  });
});
