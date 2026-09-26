import { test } from "node:test";
import assert from "node:assert/strict";
import { isSlowApiPath } from "./worker.ts";
test("Gmail analysis and provider mutations receive the slow-path timeout", () => {
  for (const path of ["/api/gmail/voice","/api/gmail/sent","/api/gmail/drafts","/api/gmail/oauth/complete","/api/gmail/drafts/id/send","/api/gmail/drafts/id/save"]) assert.equal(isSlowApiPath(path), true, path);
  assert.equal(isSlowApiPath("/api/gmail/status"), false);
});
