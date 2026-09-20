/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, FounderBrainApi } from "../api.ts";
import { emptyBrain } from "../types.ts";

const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

async function expectApiError(
  run: () => Promise<unknown>,
  check: (err: ApiError) => void,
): Promise<void> {
  try {
    await run();
    assert.fail("expected ApiError");
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
    check(err);
  }
}

test("maps abort to timeout ApiError", async () => {
  stubFetch((_url, init) => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    init?.signal?.dispatchEvent?.(new Event("abort"));
    return Promise.reject(err);
  });
  // FounderBrainApi treats DOMException AbortError specially; also accept Error named AbortError via network path.
  // Force the AbortError branch by using a DOMException when available.
  stubFetch(() => Promise.reject(new DOMException("The operation was aborted.", "AbortError")));
  await expectApiError(
    () => new FounderBrainApi(async () => "token").me(),
    (err) => {
      assert.equal(err.code, "timeout");
      assert.match(err.message, /timed out/i);
    },
  );
});

test("maps network failure to network ApiError", async () => {
  stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  await expectApiError(
    () => new FounderBrainApi(async () => "token").me(),
    (err) => {
      assert.equal(err.code, "network");
    },
  );
});

test("non-JSON error bodies still become ApiError with status in the fallback", async () => {
  stubFetch(() => Promise.resolve(new Response("<html>nope</html>", { status: 502 })));
  await expectApiError(
    () => new FounderBrainApi(async () => "token").me(),
    (err) => {
      assert.equal(err.status, 502);
      assert.match(err.message, /502/);
    },
  );
});

test("JSON error without message still surfaces status and code", async () => {
  stubFetch(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "crm_oauth_failed" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  await expectApiError(
    () => new FounderBrainApi(async () => "token").me(),
    (err) => {
      assert.equal(err.status, 422);
      assert.equal(err.code, "crm_oauth_failed");
      assert.match(err.message, /422 crm_oauth_failed/);
    },
  );
});

test("401 with a token source becomes session_expired", async () => {
  stubFetch(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "sign_in_required", message: "Sign in." }), {
        status: 401,
      }),
    ),
  );
  await expectApiError(
    () => new FounderBrainApi(async () => "token").me(),
    (err) => {
      assert.equal(err.code, "session_expired");
    },
  );
});

test("missing token before fetch is session_expired", async () => {
  await expectApiError(
    () => new FounderBrainApi(async () => null).me(),
    (err) => {
      assert.equal(err.code, "session_expired");
    },
  );
});

test("propagates verification_pending details for save retry", async () => {
  stubFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ error: "verification_pending", message: "pending", committedVersion: 7 }),
        {
          status: 503,
        },
      ),
    ),
  );
  await expectApiError(
    () => new FounderBrainApi(async () => "token").save(emptyBrain(), 6, "key"),
    (err) => {
      assert.equal(err.code, "verification_pending");
      assert.equal(err.details.committedVersion, 7);
    },
  );
});
