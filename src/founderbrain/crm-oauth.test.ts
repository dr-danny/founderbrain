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


test("provider identity uses the workspace location id and fails closed to nameUnavailable", async () => {
  const { statusForConnectionUnlocked } = await import("./crm-oauth.ts");
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response("provider unavailable", { status: 503 });
    };
    const status = await statusForConnectionUnlocked({
      accessToken: "fixture-token",
      locationId: "real-location-id",
      connectionId: "11111111-1111-4111-8111-111111111111",
    });
    assert.deepEqual(status, {
      connected: true,
      locationId: "real-location-id",
      locationName: null,
      connectionId: "11111111-1111-4111-8111-111111111111",
      nameUnavailable: true,
    });
    assert.deepEqual(calls, ["https://services.leadconnectorhq.com/locations/real-location-id"]);
  } finally {
    globalThis.fetch = original;
  }
});


test("provider identity rejects a location name returned for another location id", async () => {
  const { statusForConnectionUnlocked } = await import("./crm-oauth.ts");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      location: { id: "another-location", name: "Wrong Account" },
    }), { status: 200, headers: { "content-type": "application/json" } });
    const status = await statusForConnectionUnlocked({
      accessToken: "fixture-token",
      locationId: "real-location-id",
      connectionId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(status.locationId, "real-location-id");
    assert.equal(status.locationName, null);
    assert.equal(status.nameUnavailable, true);
  } finally {
    globalThis.fetch = original;
  }
});
