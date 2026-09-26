import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApi } from "./server.ts";
import type { PgBrainStore } from "./store.ts";
import type { Config } from "./config.ts";
import { mutationKey, MUTATION_PATHS } from "./rate-limit.ts";

const config: Config = {
  NODE_ENV: "test", DATABASE_URL: "postgres://unused", PORT: 8080,
  APP_ORIGIN: "http://localhost:8080", FOUNDERBRAIN_LOCAL_DEMO: "true",
  AI_ENABLED: "false", ROUTINES_ENABLED: "false", HEXCLAVE_API_URL: "https://api.hexclave.com",
};

test("Gmail API rejects missing consent, malformed recipients and unsafe limits before providers", async () => {
  const store = { ensureWorkspace: async () => "test-workspace" } as unknown as PgBrainStore;
  const api = await buildApi(config, { store, authenticate: async () => ({subject: "test-subject", email: "test@example.invalid"}), logger: false });
  try {
    for (const request of [
      { method: "POST" as const, url: "/api/gmail/voice", payload: {messageIds: ["1","2","3","4","5"],consent: false} },
      { method: "POST" as const, url: "/api/gmail/voice", payload: {messageIds: ["1"],consent: true} },
      { method: "POST" as const, url: "/api/gmail/drafts", payload: {requestId: "bad",recipient: "x\r\nBcc: other@example.invalid",brief: "Test request, never sent."} },
      { method: "POST" as const, url: "/api/gmail/drafts/ef81b2ea-65f6-4ab1-9f70-0d17c7f5f61b/send", payload: {confirmed: false} },
      { method: "PUT" as const, url: "/api/gmail/settings", payload: {autoSend: true,allowedRecipients: [],dailyLimit: 100,confirmed: true} },
    ]) {
      const response = await api.inject(request);
      assert.equal(response.statusCode, 422, request.url + " " + response.body);
    }
  } finally { await api.close(); }
});

test("Gmail mutation limits normalize draft paths", () => {
  for (const [method,path] of [["POST","/api/gmail/drafts/one/send"],["POST","/api/gmail/drafts/two/save"],["PUT","/api/gmail/drafts/three"],["POST","/api/gmail/voice"],["POST","/api/gmail/oauth/start"]]) {
    assert.ok(MUTATION_PATHS.has(mutationKey(method!,path!)));
  }
});
