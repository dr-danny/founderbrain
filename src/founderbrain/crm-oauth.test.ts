import assert from "node:assert/strict";
import test from "node:test";
import { authorizeUrl, CRM_SCOPES, readOauthState, signOauthState } from "./crm-oauth.ts";
import type { Config } from "./config.ts";

test("oauth state round-trips the subject and rejects a truncated token", () => {
  const secret = "x".repeat(32);
  const state = signOauthState(secret, "hexclave|proj|user-1", 1_000_000);
  assert.deepEqual(readOauthState(secret, state, 1_000_000), { sub: "hexclave|proj|user-1" });
  assert.throws(() => readOauthState(secret, state.slice(0, 12), 1_000_000));
  assert.throws(() => readOauthState(secret, state, 1_000_000 + 16 * 60 * 1000));
});

test("authorize URL uses the SPA callback and never contains ghl in the redirect", () => {
  const config = {
    APP_ORIGIN: "https://oneday-founderbrain.marfi.online",
    HIGHLEVEL_CLIENT_ID: "client-id-example",
    HIGHLEVEL_VERSION_ID: "version-id-example",
  } as Config;
  const url = new URL(authorizeUrl(config, "state-token"));
  assert.equal(url.origin, "https://marketplace.gohighlevel.com");
  assert.equal(url.searchParams.get("redirect_uri"), "https://oneday-founderbrain.marfi.online/oauth/callback");
  assert.equal(url.searchParams.get("redirect_uri")?.includes("ghl"), false);
  assert.equal(url.searchParams.get("client_id"), "client-id-example");
  assert.equal(url.searchParams.get("scope"), CRM_SCOPES.join(" "));
  assert.equal(url.searchParams.get("state"), "state-token");
});
