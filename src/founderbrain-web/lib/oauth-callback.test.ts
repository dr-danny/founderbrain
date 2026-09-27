/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { classifyOauthCallback } from "./oauth-callback.ts";

test("valid code+state classifies as code", () => {
  assert.deepEqual(classifyOauthCallback("?code=abc123&state=xyz789"), {
    kind: "code",
    code: "abc123",
    state: "xyz789",
  });
});

test("extra unrelated params do not change a valid code+state classification", () => {
  assert.deepEqual(classifyOauthCallback("?foo=bar&code=abc123&state=xyz789&utm_source=x"), {
    kind: "code",
    code: "abc123",
    state: "xyz789",
  });
});

test("legitimate error+state classifies as error with the given reason", () => {
  assert.deepEqual(classifyOauthCallback("?error=access_denied&state=xyz789"), {
    kind: "error",
    error: "access_denied",
    state: "xyz789",
  });
  assert.deepEqual(classifyOauthCallback("?error=user_cancelled&state=xyz789"), {
    kind: "error",
    error: "user_cancelled",
    state: "xyz789",
  });
});

test("blank error value with a valid state still classifies as a legitimate denial", () => {
  assert.deepEqual(classifyOauthCallback("?error=&state=xyz789"), {
    kind: "error",
    error: "access_denied",
    state: "xyz789",
  });
});

test("error present alongside code is ambiguous and invalid, not resolved in favor of either", () => {
  assert.deepEqual(classifyOauthCallback("?error=access_denied&code=abc123&state=xyz789"), {
    kind: "invalid",
  });
});

test("a duplicated code alongside an error is invalid, same as any code+error combination", () => {
  assert.deepEqual(
    classifyOauthCallback("?error=access_denied&code=abc123&code=def456&state=xyz789"),
    { kind: "invalid" },
  );
});

test("missing state is invalid even with a valid code", () => {
  assert.deepEqual(classifyOauthCallback("?code=abc123"), { kind: "invalid" });
});

test("missing state is invalid even with a valid error", () => {
  assert.deepEqual(classifyOauthCallback("?error=access_denied"), { kind: "invalid" });
});

test("missing code and missing error, with only state, is invalid", () => {
  assert.deepEqual(classifyOauthCallback("?state=xyz789"), { kind: "invalid" });
});

test("no query string at all is invalid", () => {
  assert.deepEqual(classifyOauthCallback(""), { kind: "invalid" });
});

test("blank code value is invalid, not treated as missing-but-fine", () => {
  assert.deepEqual(classifyOauthCallback("?code=&state=xyz789"), { kind: "invalid" });
});

test("blank state value is invalid", () => {
  assert.deepEqual(classifyOauthCallback("?code=abc123&state="), { kind: "invalid" });
});

test("whitespace-only state is invalid", () => {
  assert.deepEqual(classifyOauthCallback("?code=abc123&state=%20%20%20"), { kind: "invalid" });
});

test("duplicated code is invalid rather than silently taking the first value", () => {
  assert.deepEqual(classifyOauthCallback("?code=abc123&code=def456&state=xyz789"), {
    kind: "invalid",
  });
});

test("duplicated state is invalid rather than silently taking the first value", () => {
  assert.deepEqual(classifyOauthCallback("?code=abc123&state=xyz789&state=other"), {
    kind: "invalid",
  });
});

test("duplicated error is invalid rather than silently taking the first value", () => {
  assert.deepEqual(classifyOauthCallback("?error=a&error=b&state=xyz789"), { kind: "invalid" });
});

test("malformed / truncated query text does not throw and classifies as invalid", () => {
  assert.deepEqual(classifyOauthCallback("?code&state"), { kind: "invalid" });
  assert.deepEqual(classifyOauthCallback("???not=a=query"), { kind: "invalid" });
});

test("code and state retain their exact decoded values for server validation", () => {
  assert.deepEqual(classifyOauthCallback("?code=%20abc123%20&state=%20xyz789%20"), {
    kind: "code", code: " abc123 ", state: " xyz789 ",
  });
});
