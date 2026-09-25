/**
 * Unit tests for OpenRouter privacy allowlist, key naming/expiry, lifetime
 * gates, and thinker/runner/verifier orchestration.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_KEY_NAME_PREFIX,
  OPENROUTER_KEY_TTL_DAYS,
  OPENROUTER_LIFETIME_USD,
  createOpenRouterManagement,
  openRouterKeyExpiresAt,
  openRouterKeyName,
} from "./openrouter-management.ts";
import {
  assertPrivacyEligibleModel,
  isPrivacyEligibleModel,
  resolveOrchestration,
} from "./openrouter-privacy.ts";
import {
  assertProvisionedKeyContract,
  keyIsUsable,
  type StoredOpenRouterKey,
} from "./openrouter-keys.ts";
import { orchestrateInvitation } from "./orchestrate.ts";
import type { Provider } from "./provider.ts";
import { DomainError } from "./domain.ts";

describe("openrouter privacy allowlist", () => {
  it("accepts reviewed models and rejects unknowns", () => {
    assert.equal(isPrivacyEligibleModel("anthropic/claude-sonnet-4"), true);
    assert.equal(isPrivacyEligibleModel("evil/train-on-me"), false);
    assert.throws(() => assertPrivacyEligibleModel("evil/train-on-me"));
  });

  it("resolves role defaults and rejects non-allowlisted overrides", () => {
    const roles = resolveOrchestration({});
    assert.equal(roles.thinker.primary, "anthropic/claude-haiku-4.5");
    assert.equal(roles.runner.primary, "anthropic/claude-sonnet-4");
    assert.equal(roles.verifier.primary, "anthropic/claude-haiku-4.5");
    assert.throws(() => resolveOrchestration({ runner: "not-allowed/model" }));
  });
});

describe("openrouter key naming and expiry", () => {
  it("names keys OneDay-Founderbrain-{email}", () => {
    assert.equal(
      openRouterKeyName("Ada@Example.TEST"),
      `${OPENROUTER_KEY_NAME_PREFIX}ada@example.test`,
    );
    assert.equal(OPENROUTER_LIFETIME_USD, 20);
    assert.equal(OPENROUTER_KEY_TTL_DAYS, 30);
  });

  it("sets 30-day expiry with second precision", () => {
    const now = new Date("2026-09-18T12:00:00.123Z");
    const expires = openRouterKeyExpiresAt(now);
    assert.equal(expires, "2026-10-18T12:00:00Z");
    assert.match(expires, /T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("openrouter key workspace placement", () => {
  const WORKSPACE_ID = "f0c76c1c-eae8-4e6c-8e71-b9df533302db";

  async function captureCreateBody(workspaceId?: string): Promise<Record<string, unknown>> {
    const realFetch = globalThis.fetch;
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (init?.method === "POST") {
        sent = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            key: "sk-or-v1-fixture",
            data: {
              hash: "hash",
              name: sent.name,
              limit: OPENROUTER_LIFETIME_USD,
              limit_reset: null,
              expires_at: sent.expires_at,
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected request: ${href}`);
    }) as typeof globalThis.fetch;
    try {
      const client = createOpenRouterManagement("fixture-management-key-not-live", workspaceId);
      await client.createUserKey("ada@example.test");
    } finally {
      globalThis.fetch = realFetch;
    }
    return sent;
  }

  it("sends workspace_id so keys land outside the Default workspace", async () => {
    const body = await captureCreateBody(WORKSPACE_ID);
    assert.equal(body.workspace_id, WORKSPACE_ID);
    assert.equal(body.limit, OPENROUTER_LIFETIME_USD);
    assert.equal(body.limit_reset, null);
  });

  it("omits workspace_id entirely when none is configured", async () => {
    const body = await captureCreateBody(undefined);
    assert.equal("workspace_id" in body, false);
  });
});

describe("openrouter lifetime and expiry gates", () => {
  const base = (): StoredOpenRouterKey => ({
    founderId: "WS",
    keyHash: "hash",
    keyName: "OneDay-Founderbrain-a@example.test",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    lifetimeLimitUsd: 20,
    spentMicroUsd: 0,
    revokedAt: null,
  });

  it("blocks expired, revoked, and lifetime-exhausted keys", () => {
    assert.throws(
      () => keyIsUsable({ ...base(), expiresAt: new Date("2020-01-01T00:00:00Z") }),
      (e: DomainError) => e.code === "openrouter_key_expired",
    );
    assert.throws(
      () => keyIsUsable({ ...base(), revokedAt: new Date() }),
      (e: DomainError) => e.code === "openrouter_key_revoked",
    );
    assert.throws(
      () => keyIsUsable({ ...base(), spentMicroUsd: 20_000_000 }),
      (e: DomainError) => e.code === "openrouter_lifetime_limit",
    );
    keyIsUsable(base());
  });
});

describe("provisioned key contract (getKey verification)", () => {
  const expiresAt = openRouterKeyExpiresAt(new Date("2026-09-18T12:00:00Z"));

  it("accepts a live key with $20 limit, no reset, enabled, matching expiry", () => {
    assertProvisionedKeyContract(
      {
        limit: OPENROUTER_LIFETIME_USD,
        limitReset: null,
        disabled: false,
        expiresAt,
      },
      expiresAt,
    );
  });

  it("rejects disabled, wrong limit, reset policy, or missing expiry", () => {
    assert.throws(
      () =>
        assertProvisionedKeyContract({
          limit: OPENROUTER_LIFETIME_USD,
          limitReset: null,
          disabled: true,
          expiresAt,
        }),
      (e: DomainError) => e.code === "openrouter_provision_failed",
    );
    assert.throws(
      () =>
        assertProvisionedKeyContract({
          limit: 50,
          limitReset: null,
          disabled: false,
          expiresAt,
        }),
      (e: DomainError) => e.code === "openrouter_provision_failed",
    );
    assert.throws(
      () =>
        assertProvisionedKeyContract({
          limit: OPENROUTER_LIFETIME_USD,
          limitReset: "monthly",
          disabled: false,
          expiresAt,
        }),
      (e: DomainError) => e.code === "openrouter_provision_failed",
    );
    assert.throws(
      () =>
        assertProvisionedKeyContract({
          limit: OPENROUTER_LIFETIME_USD,
          limitReset: null,
          disabled: false,
          expiresAt: null,
        }),
      (e: DomainError) => e.code === "openrouter_provision_failed",
    );
  });
});

describe("invitation orchestration", () => {
  it("runs thinker → runner → verifier and returns the draft on PASS", async () => {
    const calls: string[] = [];
    const provider: Provider = async (body) => {
      calls.push(body.system.slice(0, 24));
      if (body.system.includes("plan one short") || body.system.includes("Aggregate the Founder Brain")) {
        return {
          text: "- angle: workflow\n- tone: warm",
          inputTokens: 10,
          outputTokens: 5,
          requestId: "t1",
        };
      }
      if (body.system.includes("Verify")) {
        return { text: "PASS", inputTokens: 8, outputTokens: 1, requestId: "v1" };
      }
      return {
        text: "Hi [Name], could we talk about your appointment follow-ups?",
        inputTokens: 20,
        outputTokens: 15,
        requestId: "r1",
      };
    };
    const roles = resolveOrchestration({});
    const beforeRoles: string[] = [];
    const afterRequestIds: string[][] = [];
    const result = await orchestrateInvitation(
      {
        roles,
        system: "Write one short invitation.",
        userContent: '{"identity":{"name":"Ada"}}',
        reservedMicroUsd: 1_000_000,
        inputRate: 1,
        outputRate: 2,
      },
      "sk-test",
      provider,
      {
        beforeRole: async (role) => {
          beforeRoles.push(role);
        },
        afterRole: async (progress) => {
          afterRequestIds.push([...progress.requestIds]);
        },
      },
    );
    assert.match(result.text, /appointment follow-ups/);
    assert.equal(result.roleUsage.length, 3);
    assert.deepEqual(
      result.roleUsage.map((u) => u.role),
      ["thinker", "runner", "verifier"],
    );
    assert.deepEqual(result.requestIds, ["t1", "r1", "v1"]);
    assert.deepEqual(beforeRoles, ["thinker", "runner", "verifier"]);
    assert.equal(afterRequestIds.length, 3);
    assert.deepEqual(afterRequestIds[2], ["t1", "r1", "v1"]);
    assert.equal(calls.length, 3);
  });

  it("rewrites once when verifier fails and budget remains", async () => {
    let verifyCount = 0;
    let runnerCount = 0;
    const provider: Provider = async (body) => {
      if (body.system.includes("plan one short") || body.system.includes("Aggregate the Founder Brain")) {
        return { text: "notes", inputTokens: 5, outputTokens: 2, requestId: "t" };
      }
      if (body.system.includes("Verify")) {
        verifyCount += 1;
        return { text: "FAIL: invented urgency", inputTokens: 5, outputTokens: 2, requestId: "v" };
      }
      runnerCount += 1;
      return {
        text: runnerCount === 1 ? "Urgent!!! buy now" : "Hi [Name], may we learn your workflow?",
        inputTokens: 10,
        outputTokens: 8,
        requestId: "r" + runnerCount,
      };
    };
    const result = await orchestrateInvitation(
      {
        roles: resolveOrchestration({}),
        system: "Write one short invitation.",
        userContent: "{}",
        reservedMicroUsd: 1_000_000,
        inputRate: 1,
        outputRate: 1,
      },
      "sk-test",
      provider,
    );
    assert.equal(verifyCount, 1);
    assert.equal(runnerCount, 2);
    assert.match(result.text, /workflow/);
    assert.deepEqual(result.requestIds, ["t", "r1", "v", "r2"]);
  });
});
