import assert from "node:assert/strict";
import test from "node:test";
import {
  handleDecision,
  imageMedia,
  instagramAuthorizeUrl,
  INSTAGRAM_SCOPE,
  readInstagramState,
  readShortToken,
  signInstagramState,
  stripAuthCode,
} from "./instagram.ts";
import type { Config } from "./config.ts";

test("Instagram authorize URL asks only for read access and hides Facebook login", () => {
  const config = {
    APP_ORIGIN: "https://oneday-founderbrain.marfi.online/",
    INSTAGRAM_APP_ID: "990602627938098",
  } as Config;
  const url = new URL(instagramAuthorizeUrl(config, "state-token"));
  assert.equal(url.origin, "https://www.instagram.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), INSTAGRAM_SCOPE);
  assert.equal(url.searchParams.get("scope")?.includes("content_publish"), false);
  assert.equal(url.searchParams.get("enable_fb_login"), "false");
  assert.equal(url.searchParams.get("force_reauth"), "true");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://oneday-founderbrain.marfi.online/instagram/callback",
  );
});

test("Instagram state is not a GoHighLevel state", () => {
  const secret = "x".repeat(32);
  const state = signInstagramState(secret, "hexclave|proj|user-1", 1_000_000);
  assert.deepEqual(readInstagramState(secret, state, 1_000_000), { sub: "hexclave|proj|user-1" });
  const payload = state.split(".")[0]!;
  const tampered = Buffer.from(JSON.stringify({ sub: "hexclave|proj|user-1", exp: 1_900_000 })).toString(
    "base64url",
  );
  assert.throws(() => readInstagramState(secret, `${tampered}.${state.split(".")[1]}`, 1_000_000));
  assert.equal(payload.length > 0, true);
});

test("short token must be the documented read permission and nothing else", () => {
  assert.deepEqual(
    readShortToken({
      data: [{ access_token: "short", user_id: "1020", permissions: "instagram_business_basic" }],
    }),
    { accessToken: "short", userId: "1020" },
  );
  assert.throws(() =>
    readShortToken({
      data: [
        {
          access_token: "short",
          user_id: "1020",
          permissions: "instagram_business_basic,instagram_business_content_publish",
        },
      ],
    }),
  );
});

test("authorization code drops the Meta hash suffix", () => {
  assert.equal(stripAuthCode("abc#_"), "abc");
  assert.equal(stripAuthCode("abc"), "abc");
});

test("a typed handle is not overwritten by the connected username", () => {
  assert.equal(handleDecision(undefined, "geauxride"), "fill");
  assert.equal(handleDecision("@GeauxRide", "geauxride"), "same");
  assert.equal(handleDecision("other", "geauxride"), "keep");
});

test("pull keeps photos and leaves videos on Instagram", () => {
  assert.deepEqual(
    imageMedia([
      { id: "1", media_type: "IMAGE", media_url: "https://cdn.example/1.jpg" },
      { id: "2", media_type: "VIDEO", media_url: "https://cdn.example/2.mp4" },
      { id: "3", media_type: "IMAGE", media_url: "http://cdn.example/3.jpg" },
      { id: "4", media_type: "CAROUSEL_ALBUM", media_url: "https://cdn.example/4.jpg" },
    ]),
    [{ id: "1", url: "https://cdn.example/1.jpg" }],
  );
});
