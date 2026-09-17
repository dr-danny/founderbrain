import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import type { FastifyRequest } from "fastify";
import { createAuthenticator, ACCESS_TOKEN_HEADER } from "./auth.ts";
import { bareHttpsOrigin, hexclaveEndpoints, type Config } from "./config.ts";

/**
 * A fixture Hexclave: a local HTTP server that serves the project JWKS at
 * `/api/v1/projects/<id>/.well-known/jwks.json`, and a signer that mints tokens
 * with the claims Hexclave documents (`iss`, `aud`, `sub`, `email`,
 * `email_verified`, `is_anonymous`, `is_restricted`, `exp`). The authenticator is
 * pointed at it as if it were `https://api.hexclave.com`.
 */
const PROJECT = "7f2d1c3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const OTHER_PROJECT = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
let server: Server;
let apiUrl: string;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let hsKeyPair: Awaited<ReturnType<typeof generateKeyPair>>;

before(async () => {
  pair = await generateKeyPair("ES256");
  hsKeyPair = await generateKeyPair("RS256");
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "fixture-key";
  jwk.alg = "ES256";
  jwk.use = "sig";
  const rsJwk = await exportJWK(hsKeyPair.publicKey);
  rsJwk.kid = "fixture-rs-key";
  rsJwk.alg = "RS256";
  rsJwk.use = "sig";
  server = createServer((req, res) => {
    if (req.url !== `/api/v1/projects/${PROJECT}/.well-known/jwks.json`) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    // The RS256 key is in the set on purpose: even a key Hexclave "published" must
    // not be usable with an algorithm we did not allow.
    res.end(JSON.stringify({ keys: [jwk, rsJwk] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("fixture server unavailable");
  apiUrl = `http://127.0.0.1:${a.port}`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

interface TokenOptions {
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  subject?: string | null;
  expires?: string | number;
  alg?: "ES256" | "RS256";
}
async function token(o: TokenOptions = {}): Promise<string> {
  const { issuer } = hexclaveEndpoints(apiUrl, PROJECT);
  const alg = o.alg ?? "ES256";
  const jwt = new SignJWT({
    project_id: PROJECT,
    branch_id: "main",
    role: "authenticated",
    name: "Ada",
    email: "ada@example.test",
    email_verified: true,
    is_anonymous: false,
    is_restricted: false,
    restricted_reason: null,
    ...o.claims,
  })
    .setProtectedHeader({ alg, kid: alg === "ES256" ? "fixture-key" : "fixture-rs-key" })
    .setIssuer(o.issuer ?? issuer)
    .setAudience(o.audience ?? PROJECT)
    .setIssuedAt()
    .setExpirationTime(o.expires ?? "5m");
  if (o.subject !== null) jwt.setSubject(o.subject ?? "fixture-user-id");
  return jwt.sign(alg === "ES256" ? pair.privateKey : hsKeyPair.privateKey);
}
const request = (value: string | undefined, ip = "203.0.113.9") =>
  ({
    headers: value === undefined ? {} : { [ACCESS_TOKEN_HEADER]: value },
    ip,
  }) as unknown as FastifyRequest;

describe("Hexclave authentication", () => {
  const config = {
    HEXCLAVE_PROJECT_ID: PROJECT,
    HEXCLAVE_API_URL: "",
    FOUNDERBRAIN_LOCAL_DEMO: "false",
    NODE_ENV: "test",
  } as Config;
  const auth = () => createAuthenticator({ ...config, HEXCLAVE_API_URL: apiUrl });

  it("accepts a signed regular token and returns a project-scoped opaque subject plus the email", async () => {
    const identity = await auth()(request(await token()));
    assert.equal(identity.subject, `hexclave|${PROJECT}|fixture-user-id`);
    assert.equal(identity.email, "ada@example.test");
    assert.doesNotMatch(
      identity.subject,
      /127\.0\.0\.1/,
      "the API hostname must not be part of the workspace key",
    );
  });

  it("lower-cases the email for display but keys on sub, not email", async () => {
    const identity = await auth()(request(await token({ claims: { email: "Ada@Example.test" } })));
    assert.equal(identity.email, "ada@example.test");
    assert.doesNotMatch(identity.subject, /example\.test/);
  });

  it("refuses a request with no access token header", async () => {
    await assert.rejects(auth()(request(undefined)), { status: 401, code: "sign_in_required" });
  });

  it("refuses garbage, a wrong issuer, a wrong audience and an expired token", async () => {
    await assert.rejects(auth()(request("not-a-token")), { status: 401, code: "invalid_session" });
    await assert.rejects(
      auth()(request(await token({ issuer: hexclaveEndpoints(apiUrl, OTHER_PROJECT).issuer }))),
      { status: 401 },
    );
    await assert.rejects(
      auth()(
        request(await token({ issuer: "https://api.hexclave.com/api/v1/projects/" + PROJECT })),
      ),
      { status: 401 },
    );
    await assert.rejects(auth()(request(await token({ audience: OTHER_PROJECT }))), {
      status: 401,
    });
    await assert.rejects(
      auth()(request(await token({ expires: Math.floor(Date.now() / 1000) - 120 }))),
      { status: 401 },
    );
  });

  it("refuses anonymous and restricted sessions by issuer, by audience and by claim", async () => {
    const origin = new URL(apiUrl).origin;
    await assert.rejects(
      auth()(
        request(
          await token({
            issuer: `${origin}/api/v1/projects-anonymous-users/${PROJECT}`,
            audience: `${PROJECT}:anon`,
            claims: { is_anonymous: true, is_restricted: true },
          }),
        ),
      ),
      { status: 401 },
    );
    await assert.rejects(
      auth()(
        request(
          await token({
            issuer: `${origin}/api/v1/projects-restricted-users/${PROJECT}`,
            audience: `${PROJECT}:restricted`,
            claims: { is_restricted: true, restricted_reason: { type: "email_not_verified" } },
          }),
        ),
      ),
      { status: 401 },
    );
    await assert.rejects(auth()(request(await token({ claims: { is_anonymous: true } }))), {
      status: 401,
    });
    await assert.rejects(auth()(request(await token({ claims: { is_restricted: true } }))), {
      status: 401,
    });
  });

  it("refuses a token with no subject", async () => {
    await assert.rejects(auth()(request(await token({ subject: "" }))), { status: 401 });
    await assert.rejects(auth()(request(await token({ subject: null }))), { status: 401 });
  });

  it("refuses a missing, malformed or unverified email", async () => {
    await assert.rejects(auth()(request(await token({ claims: { email: null } }))), {
      status: 401,
    });
    await assert.rejects(auth()(request(await token({ claims: { email: "not-an-email" } }))), {
      status: 401,
    });
    await assert.rejects(auth()(request(await token({ claims: { email_verified: false } }))), {
      status: 401,
    });
  });

  it("refuses a token signed with an algorithm other than ES256 even if the key is in the JWKS", async () => {
    await assert.rejects(auth()(request(await token({ alg: "RS256" }))), { status: 401 });
  });

  it("ignores a token in the Authorization header; only x-stack-access-token counts", async () => {
    const req = {
      headers: { authorization: "Bearer " + (await token()) },
      ip: "203.0.113.9",
    } as unknown as FastifyRequest;
    await assert.rejects(auth()(req), { status: 401, code: "sign_in_required" });
  });

  it("refuses to start without a project id outside the local demo", () => {
    assert.throws(() =>
      createAuthenticator({ ...config, HEXCLAVE_API_URL: apiUrl, HEXCLAVE_PROJECT_ID: undefined }),
    );
  });

  it("local demo only answers on loopback with the dev header and never in production", async () => {
    const demo = createAuthenticator({ ...config, FOUNDERBRAIN_LOCAL_DEMO: "true" } as Config);
    assert.deepEqual(
      await demo({
        headers: { "x-dev-user": "demo" },
        ip: "127.0.0.1",
      } as unknown as FastifyRequest),
      {
        subject: "local-demo|demo",
        email: "demo@local",
      },
    );
    await assert.rejects(
      demo({ headers: { "x-dev-user": "demo" }, ip: "203.0.113.9" } as unknown as FastifyRequest),
      { status: 403 },
    );
    await assert.rejects(demo({ headers: {}, ip: "127.0.0.1" } as unknown as FastifyRequest), {
      status: 401,
    });
    assert.throws(() =>
      createAuthenticator({
        ...config,
        FOUNDERBRAIN_LOCAL_DEMO: "true",
        NODE_ENV: "production",
      } as Config),
    );
  });
});

describe("Hexclave configuration helpers", () => {
  it("derives the documented issuer and JWKS URL from the API origin and project id", () => {
    const { issuer, jwks } = hexclaveEndpoints("https://api.hexclave.com", PROJECT);
    assert.equal(issuer, `https://api.hexclave.com/api/v1/projects/${PROJECT}`);
    assert.equal(
      jwks.href,
      `https://api.hexclave.com/api/v1/projects/${PROJECT}/.well-known/jwks.json`,
    );
    assert.equal(
      hexclaveEndpoints("https://api.hexclave.com/", PROJECT).issuer,
      issuer,
      "a trailing slash changes nothing",
    );
  });

  it("accepts only a bare HTTPS origin for the API URL", () => {
    assert.equal(bareHttpsOrigin("https://api.hexclave.com"), true);
    assert.equal(bareHttpsOrigin("https://api.hexclave.com/"), true);
    assert.equal(bareHttpsOrigin("https://api.stack-auth.com"), true);
    for (const bad of [
      "http://api.hexclave.com",
      "https://api.hexclave.com/api/v1",
      "https://api.hexclave.com/?x=1",
      "https://user:pw@api.hexclave.com",
      "https://api.hexclave.com/#frag",
      "not a url",
    ]) {
      assert.equal(bareHttpsOrigin(bad), false, bad);
    }
  });
});
