import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "./domain.ts";
import { higgsfieldCredential, MODELS } from "./higgsfield.ts";

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

test("prices the documented Soul v2 image model", () => {
  assert.equal(MODELS.image.path, "higgsfield-ai/soul/v2/standard");
  assert.deepEqual(MODELS.image.body("A quiet storefront"), {
    prompt: "A quiet storefront",
    batch_size: 1,
    resolution: "1080p",
    aspect_ratio: "3:4",
    enhance_prompt: true,
  });
});
