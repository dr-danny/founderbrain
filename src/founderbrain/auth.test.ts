import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { FastifyRequest } from 'fastify';
import { createAuthenticator, ACCESS_JWT_HEADER } from './auth.ts';
import { validAccessTeamDomain, type Config } from './config.ts';

/**
 * A fixture Cloudflare Access: a local HTTP server that serves a JWKS at
 * `/cdn-cgi/access/certs`, and a signer that mints application tokens with the
 * same claims Access documents (`aud`, `email`, `sub`, `type`, `iss`, `exp`).
 * The authenticator is pointed at it as if it were `https://<team>.cloudflareaccess.com`.
 */
let server: Server;
let teamDomain: string;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
const AUD = 'a'.repeat(64);

before(async () => {
  pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'fixture-key';
  jwk.alg = 'RS256';
  server = createServer((req, res) => {
    if (req.url !== '/cdn-cgi/access/certs') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk], public_cert: { kid: 'fixture-key', cert: 'fixture' } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('fixture server unavailable');
  teamDomain = `http://127.0.0.1:${a.port}`;
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
  alg?: 'RS256' | 'none';
}
async function token(o: TokenOptions = {}): Promise<string> {
  const jwt = new SignJWT({ email: 'ada@example.test', type: 'app', ...o.claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
    .setIssuer(o.issuer ?? teamDomain)
    .setAudience(o.audience ?? AUD)
    .setIssuedAt()
    .setExpirationTime(o.expires ?? '5m');
  if (o.subject !== null) jwt.setSubject(o.subject ?? 'fixture-user-id');
  return jwt.sign(pair.privateKey);
}
const request = (value: string | undefined, ip = '203.0.113.9') =>
  ({ headers: value === undefined ? {} : { [ACCESS_JWT_HEADER]: value }, ip }) as unknown as FastifyRequest;

describe('Cloudflare Access authentication', () => {
  const config = { CF_ACCESS_TEAM_DOMAIN: '', CF_ACCESS_AUD: AUD, FOUNDERBRAIN_LOCAL_DEMO: 'false', NODE_ENV: 'test' } as Config;
  const auth = () => createAuthenticator({ ...config, CF_ACCESS_TEAM_DOMAIN: teamDomain });

  it('accepts a signed application token and returns an opaque subject plus the email', async () => {
    const identity = await auth()(request(await token()));
    assert.equal(identity.subject, teamDomain + '|fixture-user-id');
    assert.equal(identity.email, 'ada@example.test');
  });

  it('lower-cases the email for display but keys on sub, not email', async () => {
    const identity = await auth()(request(await token({ claims: { email: 'Ada@Example.test' } })));
    assert.equal(identity.email, 'ada@example.test');
    assert.doesNotMatch(identity.subject, /example\.test/);
  });

  it('refuses a request with no Access header', async () => {
    await assert.rejects(auth()(request(undefined)), { status: 401, code: 'sign_in_required' });
  });

  it('refuses garbage, a wrong issuer, a wrong audience and an expired token', async () => {
    await assert.rejects(auth()(request('not-a-token')), { status: 401, code: 'invalid_session' });
    await assert.rejects(auth()(request(await token({ issuer: 'https://other.cloudflareaccess.com' }))), { status: 401 });
    await assert.rejects(auth()(request(await token({ audience: 'b'.repeat(64) }))), { status: 401 });
    await assert.rejects(auth()(request(await token({ expires: Math.floor(Date.now() / 1000) - 120 }))), { status: 401 });
  });

  it('refuses a service token (empty sub) and an org session token', async () => {
    await assert.rejects(auth()(request(await token({ subject: '' }))), { status: 401 });
    await assert.rejects(auth()(request(await token({ subject: null }))), { status: 401 });
    await assert.rejects(auth()(request(await token({ claims: { type: 'org' } }))), { status: 401 });
  });

  it('refuses a token without a verified email claim', async () => {
    await assert.rejects(auth()(request(await token({ claims: { email: undefined } }))), { status: 401 });
    await assert.rejects(auth()(request(await token({ claims: { email: 'not-an-email' } }))), { status: 401 });
  });

  it('ignores a token in the Authorization header; only the Access header counts', async () => {
    const req = { headers: { authorization: 'Bearer ' + (await token()) }, ip: '203.0.113.9' } as unknown as FastifyRequest;
    await assert.rejects(auth()(req), { status: 401, code: 'sign_in_required' });
  });

  it('local demo only answers on loopback with the dev header and never in production', async () => {
    const demo = createAuthenticator({ ...config, FOUNDERBRAIN_LOCAL_DEMO: 'true' } as Config);
    assert.deepEqual(await demo({ headers: { 'x-dev-user': 'demo' }, ip: '127.0.0.1' } as unknown as FastifyRequest), {
      subject: 'local-demo|demo',
      email: 'demo@local',
    });
    await assert.rejects(demo({ headers: { 'x-dev-user': 'demo' }, ip: '203.0.113.9' } as unknown as FastifyRequest), { status: 403 });
    await assert.rejects(demo({ headers: {}, ip: '127.0.0.1' } as unknown as FastifyRequest), { status: 401 });
    assert.throws(() => createAuthenticator({ ...config, FOUNDERBRAIN_LOCAL_DEMO: 'true', NODE_ENV: 'production' } as Config));
  });
});

describe('Access team domain validation', () => {
  it('accepts only https://<team>.cloudflareaccess.com with nothing after the host', () => {
    assert.equal(validAccessTeamDomain('https://founderbrain.cloudflareaccess.com'), true);
    assert.equal(validAccessTeamDomain('https://founderbrain.cloudflareaccess.com/'), true);
    for (const bad of [
      'http://founderbrain.cloudflareaccess.com',
      'https://cloudflareaccess.com',
      'https://founderbrain.cloudflareaccess.com/cdn-cgi',
      'https://founderbrain.cloudflareaccess.com/?x=1',
      'https://user:pw@founderbrain.cloudflareaccess.com',
      'https://founderbrain.example.com',
      'not a url',
    ]) {
      assert.equal(validAccessTeamDomain(bad), false, bad);
    }
  });
});
