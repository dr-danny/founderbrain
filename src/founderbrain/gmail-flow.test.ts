import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import postgres from "postgres";

import type { Config } from "./config.ts";
import { DomainError } from "./domain.ts";
import {
  __gmailTest,
  analyzeGmailVoice,
  completeGmailOAuth,
  createGmailDraft,
  disconnectGmail,
  getGmailStatus,
  listGmailDrafts,
  listGmailSent,
  migrateGmail,
  saveGmailDraft,
  sendGmailDraft,
  startGmailOAuth,
  updateGmailSettings,
} from "./gmail.ts";
import { ensureOpenRouterKey, migrateOpenRouterKeys } from "./openrouter-keys.ts";
import type { OpenRouterManagement } from "./openrouter-management.ts";
import { OPENROUTER_LIFETIME_USD, openRouterKeyName } from "./openrouter-management.ts";
import type { Provider } from "./provider.ts";
import { PgBrainStore } from "./store.ts";

const databaseUrl = process.env.FB_TEST_DATABASE_URL;
const migrationUrl = process.env.FB_TEST_MIGRATION_DATABASE_URL ?? databaseUrl;
const enabled = Boolean(databaseUrl);
const skip = enabled ? undefined : "Disposable database not configured";
const prefix = `gmail-flow|${randomUUID()}`;

function requireLoopback(value: string | undefined, name: string): void {
  if (!value) return;
  const parsed = new URL(value);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
    throw new Error(`${name} must point to a loopback disposable database`);
  }
}
requireLoopback(databaseUrl, "FB_TEST_DATABASE_URL");
requireLoopback(migrationUrl, "FB_TEST_MIGRATION_DATABASE_URL");
if (enabled && process.env.FB_TEST_EMBEDDED !== "true") {
  throw new Error("FB_TEST_EMBEDDED=true is required for this disposable test");
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

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

type GoogleMockOptions = {
  email?: string;
  messageIds?: string[];
  sendTimeout?: boolean;
  revokeFails?: boolean;
};

function googleMock(options: GoogleMockOptions = {}) {
  const email = options.email ?? "founder@example.invalid";
  const messageIds = options.messageIds ?? ["sent1", "sent2", "sent3", "sent4", "sent5"];
  const calls = {
    token: 0,
    profile: 0,
    list: 0,
    full: 0,
    metadata: 0,
    save: 0,
    send: 0,
    revoke: 0,
  };
  const savedRaw: string[] = [];
  const sentRaw: string[] = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      calls.token++;
      return json({
        access_token: "fixture-access-token",
        refresh_token: "fixture-refresh-token",
        expires_in: 3600,
        scope:
          "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
      });
    }
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/revoke") {
      calls.revoke++;
      if (options.revokeFails) throw new Error("synthetic revoke failure");
      return new Response(null, { status: 200 });
    }
    if (url.pathname.endsWith("/users/me/profile")) {
      calls.profile++;
      return json({ emailAddress: email });
    }
    if (url.pathname.endsWith("/users/me/messages")) {
      calls.list++;
      return json({ messages: messageIds.map((id) => ({ id })) });
    }
    const messageMatch = url.pathname.match(/\/users\/me\/messages\/([^/]+)$/);
    if (messageMatch) {
      const id = decodeURIComponent(messageMatch[1]!);
      if (url.searchParams.get("format") === "full") {
        calls.full++;
        return json({
          id,
          labelIds: ["SENT"],
          payload: {
            mimeType: "text/plain",
            headers: [{ name: "From", value: `Founder <${email}>` }],
            body: { data: Buffer.from(`Hi team,\n\nStyle sample ${id}.`).toString("base64url") },
          },
        });
      }
      calls.metadata++;
      return json({
        id,
        labelIds: ["SENT"],
        snippet: `Sent snippet ${id}`,
        internalDate: String(Date.now()),
        payload: { headers: [{ name: "Subject", value: `Subject ${id}` }] },
      });
    }
    if (url.pathname.endsWith("/users/me/drafts/send") && method === "POST") {
      calls.send++;
      const body = JSON.parse(String(init?.body)) as { message: { raw: string } };
      sentRaw.push(decodeRaw(body.message.raw));
      if (options.sendTimeout) throw new Error("synthetic timeout");
      return json({ id: `gmail-message-${calls.send}` });
    }
    if (/\/users\/me\/drafts(?:\/[^/]+)?$/.test(url.pathname) && ["POST", "PUT"].includes(method)) {
      calls.save++;
      const body = JSON.parse(String(init?.body)) as { message: { raw: string } };
      savedRaw.push(decodeRaw(body.message.raw));
      return json({ id: "gmail-draft-locked", message: { id: "gmail-draft-message" } });
    }
    throw new Error(`unexpected mocked Google request: ${method} ${url.href}`);
  };
  return { fetchMock, calls, savedRaw, sentRaw, messageIds };
}

const standardProvider =
  (calls?: { count: number }): Provider =>
  async (body) => {
    if (calls) calls.count++;
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

async function workspace(label: string): Promise<string> {
  const subject = `${prefix}|${label}`;
  const id = await store.ensureWorkspace(subject);
  workspaces.set(subject, id);
  await ensureOpenRouterKey(store, config, id, `${label}@example.invalid`, fakeManagement);
  return id;
}

async function connect(workspaceId: string, mock: ReturnType<typeof googleMock>): Promise<void> {
  __gmailTest.setFetch(mock.fetchMock);
  const started = await startGmailOAuth(config, store, workspaceId);
  const state = new URL(started.url).searchParams.get("state");
  assert.ok(state);
  await completeGmailOAuth(config, store, workspaceId, { code: "fixture-code", state });
}

async function connectAndAnalyze(
  workspaceId: string,
  mock: ReturnType<typeof googleMock>,
): Promise<void> {
  __gmailTest.setAIProvider(standardProvider());
  await connect(workspaceId, mock);
  await analyzeGmailVoice(config, store, workspaceId, {
    messageIds: mock.messageIds,
    consent: true,
  });
}

function domainCode(error: unknown): string | undefined {
  return error instanceof DomainError ? error.code : undefined;
}

before(async () => {
  if (!enabled) return;
  process.env.GE_MASTER_KEY = randomBytes(32).toString("base64");
  await migrateOpenRouterKeys(migrationUrl!);
  await migrateGmail(migrationUrl!);
  store = new PgBrainStore(databaseUrl!);
});

after(async () => {
  __gmailTest.setFetch(null);
  __gmailTest.setAIProvider(null);
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

describe("Gmail exported flows against disposable PostgreSQL", { skip }, () => {
  it("completes single-use OAuth, lists selected SENT mail, records consent, and keeps secrets encrypted", async () => {
    const id = await workspace("oauth-analysis");
    const mock = googleMock({ email: "voice@example.invalid" });
    __gmailTest.setFetch(mock.fetchMock);
    __gmailTest.setAIProvider(standardProvider());

    const started = await startGmailOAuth(config, store, id);
    const state = new URL(started.url).searchParams.get("state");
    assert.ok(state);
    const oauthRows = await store.scoped(
      id,
      (tx) =>
        tx`select state_hash, verifier_blob_sha from fb_gmail_oauth_state where founder_id=${id}`,
    );
    assert.equal(oauthRows.length, 1);
    assert.notEqual(oauthRows[0]?.state_hash, state);

    const connected = await completeGmailOAuth(config, store, id, {
      code: "fixture-code",
      state,
    });
    assert.equal(connected.email, "voice@example.invalid");
    await assert.rejects(
      completeGmailOAuth(config, store, id, { code: "fixture-code", state }),
      (error) => domainCode(error) === "gmail_oauth_state",
    );
    assert.equal(mock.calls.token, 1, "a replay must not reach the token endpoint");

    const sent = await listGmailSent(config, store, id, {});
    assert.deepEqual(
      sent.messages.map((message) => message.id),
      mock.messageIds,
    );
    const analyzed = await analyzeGmailVoice(config, store, id, {
      messageIds: mock.messageIds,
      consent: true,
    });
    assert.equal(analyzed.voiceProfile?.sampleCount, 5);
    const persisted = await store.scoped(
      id,
      (tx) => tx`
      select c.token_blob_sha, encode(b.ciphertext,'hex') as ciphertext,
        v.profile_blob_sha, s.selected_sent_analysis_at
      from fb_gmail_connection c
      join ge_blob b on b.founder_id=c.founder_id and b.sha=c.token_blob_sha
      join fb_gmail_voice v on v.founder_id=c.founder_id
      join fb_gmail_consent s on s.founder_id=c.founder_id
      where c.founder_id=${id}
    `,
    );
    assert.ok(persisted[0]?.selected_sent_analysis_at);
    assert.doesNotMatch(
      JSON.stringify(persisted),
      /fixture-access-token|fixture-refresh-token|voice@example\.invalid|Direct and warm/,
    );
  });

  it("generates locally without sending when stored auto-send is enabled but the request does not opt in", async () => {
    const id = await workspace("local-only");
    const mock = googleMock();
    await connectAndAnalyze(id, mock);
    await updateGmailSettings(config, store, id, {
      autoSend: true,
      allowedRecipients: ["allowed@example.invalid"],
      dailyLimit: 3,
      confirmed: true,
    });
    const draft = await createGmailDraft(config, store, id, {
      requestId: randomUUID(),
      recipient: "allowed@example.invalid",
      brief: "Ask for a short conversation.",
    });
    assert.equal(draft.status, "draft");
    assert.equal(mock.calls.save, 0);
    assert.equal(mock.calls.send, 0);
  });

  it("saves and sends idempotently using the exact encrypted local recipient and payload", async () => {
    const id = await workspace("idempotent-send");
    const mock = googleMock();
    await connectAndAnalyze(id, mock);
    const recipient = "locked-recipient@example.invalid";
    const draft = await createGmailDraft(config, store, id, {
      requestId: randomUUID(),
      recipient,
      brief: "Send the exact locally generated note.",
    });
    const saved = await saveGmailDraft(config, store, id, { id: draft.id });
    assert.equal(saved.status, "saved");
    const sent = await sendGmailDraft(config, store, id, { id: draft.id });
    const repeated = await sendGmailDraft(config, store, id, { id: draft.id });
    assert.equal(sent.status, "sent");
    assert.equal(repeated.status, "sent");
    assert.equal(mock.calls.save, 1);
    assert.equal(mock.calls.send, 1);
    assert.match(mock.sentRaw[0] ?? "", new RegExp(`^To: ${recipient}\\r\\n`));
    assert.match(mock.sentRaw[0] ?? "", /RXhhY3QgbG9jYWwgYm9keQ==/);
    assert.doesNotMatch(mock.sentRaw[0] ?? "", /other-recipient/);
  });

  it("does not auto-send when policy is revoked while AI generation is paused", async () => {
    const id = await workspace("policy-race");
    const mock = googleMock();
    await connectAndAnalyze(id, mock);
    await updateGmailSettings(config, store, id, {
      autoSend: true,
      allowedRecipients: ["race@example.invalid"],
      dailyLimit: 3,
      confirmed: true,
    });
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
    const releasePromise = new Promise<void>((resolve) => (release = resolve));
    __gmailTest.setAIProvider(async () => {
      entered();
      await releasePromise;
      return {
        text: JSON.stringify({ subject: "Race", body: "Policy must still authorize sending." }),
        inputTokens: 10,
        outputTokens: 5,
        requestId: "fixture-paused",
      };
    });
    const pending = createGmailDraft(config, store, id, {
      requestId: randomUUID(),
      recipient: "race@example.invalid",
      brief: "Pause while policy changes.",
      autoSend: true,
    });
    await enteredPromise;
    await updateGmailSettings(config, store, id, {
      autoSend: false,
      allowedRecipients: [],
      dailyLimit: 3,
      confirmed: false,
    });
    release();
    const result = await pending;
    assert.equal(result.status, "saved");
    assert.equal(mock.calls.save, 1);
    assert.equal(mock.calls.send, 0);
  });

  it("enforces the daily cap before an extra Google send", async () => {
    const id = await workspace("daily-cap");
    const mock = googleMock();
    await connectAndAnalyze(id, mock);
    await updateGmailSettings(config, store, id, {
      autoSend: false,
      allowedRecipients: [],
      dailyLimit: 1,
      confirmed: false,
    });
    const first = await createGmailDraft(config, store, id, {
      requestId: randomUUID(),
      recipient: "first@example.invalid",
      brief: "First capped message.",
    });
    const second = await createGmailDraft(config, store, id, {
      requestId: randomUUID(),
      recipient: "second@example.invalid",
      brief: "Second capped message.",
    });
    assert.equal((await sendGmailDraft(config, store, id, { id: first.id })).status, "sent");
    await assert.rejects(
      sendGmailDraft(config, store, id, { id: second.id }),
      (error) => domainCode(error) === "gmail_daily_limit",
    );
    assert.equal(mock.calls.send, 1);
  });

  it("marks an uncertain Google timeout and never retries it", async () => {
    const id = await workspace("uncertain-send");
    const mock = googleMock({ sendTimeout: true });
    await connectAndAnalyze(id, mock);
    const draft = await createGmailDraft(config, store, id, {
      requestId: randomUUID(),
      recipient: "timeout@example.invalid",
      brief: "This synthetic send times out.",
    });
    const uncertain = await sendGmailDraft(config, store, id, { id: draft.id });
    const repeated = await sendGmailDraft(config, store, id, { id: draft.id });
    assert.equal(uncertain.status, "uncertain");
    assert.equal(repeated.status, "uncertain");
    assert.equal(mock.calls.send, 1);
  });

  it("removes all local Gmail authority even when remote revoke fails", async () => {
    const id = await workspace("disconnect");
    const mock = googleMock({ revokeFails: true });
    await connectAndAnalyze(id, mock);
    await updateGmailSettings(config, store, id, {
      autoSend: true,
      allowedRecipients: ["cleanup@example.invalid"],
      dailyLimit: 2,
      confirmed: true,
    });
    await createGmailDraft(config, store, id, {
      requestId: randomUUID(),
      recipient: "cleanup@example.invalid",
      brief: "Disposable local content.",
    });
    const result = await disconnectGmail(config, store, id);
    assert.deepEqual(result, { disconnected: true, revoked: false });
    const status = await getGmailStatus(config, store, id);
    assert.equal(status.connected, false);
    assert.equal(status.voiceProfile, null);
    assert.equal(status.settings.autoSend, false);
    assert.deepEqual(await listGmailDrafts(config, store, id), { drafts: [] });
    const rows = await store.scoped(
      id,
      (tx) => tx`
      select
        (select count(*) from fb_gmail_connection where founder_id=${id}) as connections,
        (select count(*) from fb_gmail_voice where founder_id=${id}) as voices,
        (select count(*) from fb_gmail_settings where founder_id=${id}) as settings,
        (select count(*) from fb_gmail_consent where founder_id=${id}) as consents,
        (select count(*) from fb_gmail_draft where founder_id=${id}) as drafts
    `,
    );
    assert.deepEqual(
      Object.fromEntries(Object.entries(rows[0]!).map(([key, value]) => [key, Number(value)])),
      { connections: 0, voices: 0, settings: 0, consents: 0, drafts: 0 },
    );
  });

  it("denies the worker role access to Gmail tables", async () => {
    const admin = postgres(migrationUrl!, { max: 1, onnotice: () => {} });
    try {
      await admin`set role fb_worker`;
      assert.equal((await admin`select current_user`)[0]?.current_user, "fb_worker");
      await assert.rejects(
        admin`select * from fb_gmail_connection limit 1`,
        (error: unknown) => (error as { code?: string }).code === "42501",
      );
    } finally {
      await admin`reset role`.catch(() => {});
      await admin.end();
    }
  });

  it("denies AI budget before invoking the mocked provider", async () => {
    const id = await workspace("budget-first");
    const mock = googleMock();
    await connectAndAnalyze(id, mock);
    const calls = { count: 0 };
    __gmailTest.setAIProvider(standardProvider(calls));
    const deniedConfig: Config = {
      ...config,
      AI_WORKSPACE_DAILY_MICROUSD: 1,
      AI_GLOBAL_DAILY_MICROUSD: 1,
    };
    await assert.rejects(
      createGmailDraft(deniedConfig, store, id, {
        requestId: randomUUID(),
        recipient: "budget@example.invalid",
        brief: "The budget gate must run first.",
      }),
      (error) => domainCode(error) === "budget_limit",
    );
    assert.equal(calls.count, 0);
  });
});
