import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "./domain.ts";
import { higgsfieldCredential } from "./higgsfield.ts";

test("accepts the single API key Higgsfield shows", () => {
  const parsed = higgsfieldCredential({
    apiKey: " Key 12345678-aaaa-bbbb-cccc-1234567890ab:abcdef1234567890 ",
  });
  assert.equal(parsed.credential, "12345678-aaaa-bbbb-cccc-1234567890ab:abcdef1234567890");
  assert.equal(parsed.hint, "…90ab");
});

test("still accepts a previously split key id and secret", () => {
  const parsed = higgsfieldCredential({ keyId: "12345678", keySecret: "abcdef1234567890" });
  assert.equal(parsed.credential, "12345678:abcdef1234567890");
});

test("rejects a key that is not the combined value", () => {
  assert.throws(() => higgsfieldCredential({ apiKey: "only-one-part" }), DomainError);
});
