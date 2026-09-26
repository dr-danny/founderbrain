import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Config } from "./config.ts";
import { __gmailTest, GMAIL_SCOPES, gmailRedirectUri } from "./gmail.ts";

const config = {
  APP_ORIGIN: "https://founderbrain.example/",
  GMAIL_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
  GMAIL_CLIENT_SECRET: "local-test-client-secret",
} as Config & { GMAIL_CLIENT_ID: string };

test("OAuth URL uses official Google endpoint, PKCE S256, exact callback and least Gmail scopes", () => {
  const verifier = "v".repeat(64);
  const url = new URL(__gmailTest.buildAuthorizeUrl(config, "random-state", verifier));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.pathname, "/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("redirect_uri"), "https://founderbrain.example/gmail/callback");
  assert.equal(gmailRedirectUri(config), "https://founderbrain.example/gmail/callback");
  assert.equal(url.searchParams.get("state"), "random-state");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), __gmailTest.pkceChallenge(verifier));
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [...GMAIL_SCOPES]);
  assert.equal(url.searchParams.get("scope")?.includes("mail.google.com"), false);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
});

test("sender extraction is exact and rejects suffix tricks or header injection", () => {
  assert.equal(__gmailTest.senderEmail("Danny <Founder@Example.com>"), "founder@example.com");
  assert.equal(__gmailTest.senderEmail("founder@example.com"), "founder@example.com");
  assert.equal(
    __gmailTest.senderEmail("Founder <founder@example.com.evil>"),
    "founder@example.com.evil",
  );
  assert.notEqual(
    __gmailTest.senderEmail("Founder <founder@example.com.evil>"),
    "founder@example.com",
  );
  assert.equal(__gmailTest.senderEmail("founder@example.com\r\nBcc: victim@example.com"), null);
});

test("MIME extraction ignores attachments and strips quoted replies and signatures", () => {
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "text/plain",
        body: {
          data: Buffer.from(
            "Hi team,\n\nShort update.\n\nOn Friday Alice wrote:\n> secret old thread",
          ).toString("base64url"),
        },
      },
      {
        mimeType: "text/plain",
        filename: "private.txt",
        body: { data: Buffer.from("attachment secret").toString("base64url") },
      },
    ],
  };
  assert.equal(__gmailTest.extractMimeText(payload), "Hi team,\n\nShort update.");
});

test("selected analysis requires SENT and exact connected From address", () => {
  const data = Buffer.from("Hello,\n\nA short note.").toString("base64url");
  const good = {
    id: "m1",
    labelIds: ["SENT"],
    payload: {
      headers: [{ name: "From", value: "Me <me@example.com>" }],
      mimeType: "text/plain",
      body: { data },
    },
  };
  assert.equal(
    __gmailTest.validateSelectedMessages([good], ["m1"], "me@example.com")[0]?.text,
    "Hello,\n\nA short note.",
  );
  assert.throws(() =>
    __gmailTest.validateSelectedMessages(
      [{ ...good, labelIds: ["INBOX"] }],
      ["m1"],
      "me@example.com",
    ),
  );
  assert.throws(() => __gmailTest.validateSelectedMessages([good], ["m1"], "other@example.com"));
});

test("style profile is strict, bounded, and redacts emails, URLs, and numbers", () => {
  const profile = __gmailTest.parseVoiceProfile(
    JSON.stringify({
      tone: "Direct, see founder@example.com and https://example.com",
      cadence: "Usually 3 short lines",
      greetings: "Hi 2026 team",
      closings: "Thanks 100%",
      dos: ["Use 2 concise paragraphs"],
      donts: ["Do not link www.example.com"],
    }),
    5,
    new Date("2026-09-25T00:00:00Z"),
  );
  const styleOnly = JSON.stringify({
    tone: profile.tone,
    cadence: profile.cadence,
    greetings: profile.greetings,
    closings: profile.closings,
    dos: profile.dos,
    donts: profile.donts,
  });
  assert.equal(profile.sampleCount, 5);
  assert.equal(profile.updatedAt, "2026-09-25T00:00:00.000Z");
  assert.doesNotMatch(styleOnly, /founder@example|https?:|www\.|\d/);
  assert.throws(() => __gmailTest.parseVoiceProfile('{"tone":"only"}', 5));
});

test("draft payload bounds and header-injection checks are enforced", () => {
  assert.throws(() => __gmailTest.normalizeSubject("hello\nBcc: victim@example.com"));
  assert.throws(() => __gmailTest.normalizeBody("x".repeat(20_001)));
  assert.throws(() => __gmailTest.normalizeEmail("a@example.com\r\nBcc:b@example.com"));
  const payload = {
    id: "id",
    recipient: "person@example.com",
    subject: "Local subject",
    body: "Exact local body",
  };
  const request = __gmailTest.gmailSendRequest("gmail-draft-1", payload);
  assert.equal(request.id, "gmail-draft-1");
  const raw = Buffer.from(request.message.raw, "base64url").toString("utf8");
  assert.match(raw, /^To: person@example\.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(raw, /Content-Type: text\/plain/);
  assert.match(raw, new RegExp(Buffer.from("Exact local body").toString("base64")));
  assert.doesNotMatch(JSON.stringify(request), /external edit/i);
});

test("disconnect epoch fences stale OAuth completion, mailbox replacement, and refresh", () => {
  assert.equal(__gmailTest.oauthCompletionAllowed(7, 7, false), true);
  assert.equal(__gmailTest.oauthCompletionAllowed(7, 8, false), false);
  assert.equal(__gmailTest.oauthCompletionAllowed(7, 7, true), false);
  assert.equal(__gmailTest.refreshFenceAllows(2, 0, 2, 0), true);
  assert.equal(__gmailTest.refreshFenceAllows(2, 0, 2, 1), false);
  assert.equal(__gmailTest.refreshFenceAllows(2, 1, 3, 1), false);
});

test("auto-send policy is captured before generation and revoked by concurrent settings change", async () => {
  let policy = {
    settings: { autoSend: true, allowedRecipients: ["allowed@example.com"], dailyLimit: 3 },
    revision: 11,
    consentRevision: 11,
    confirmed: true,
  };
  const captured = __gmailTest.captureAutoSendPolicy(policy, "allowed@example.com");
  assert.deepEqual(captured, { eligible: true, policyRevision: 11 });

  const generation = Promise.resolve().then(() => "generated");
  policy = {
    settings: { autoSend: true, allowedRecipients: ["other@example.com"], dailyLimit: 3 },
    revision: 12,
    consentRevision: 12,
    confirmed: true,
  };
  await generation;
  assert.equal(__gmailTest.autoSendStillAuthorized(captured, policy, "allowed@example.com"), false);
  assert.equal(
    __gmailTest.autoSendStillAuthorized(
      captured,
      {
        settings: { autoSend: true, allowedRecipients: ["allowed@example.com"], dailyLimit: 3 },
        revision: 11,
        consentRevision: 11,
        confirmed: true,
      },
      "allowed@example.com",
    ),
    true,
  );
});

test("schema enforces tenant RLS, encrypted blob references, idempotency and send counters", async () => {
  const sql = await readFile("src/founderbrain/gmail.sql", "utf8");
  for (const table of [
    "guard",
    "connection",
    "oauth_state",
    "voice",
    "settings",
    "consent",
    "draft",
    "send_day",
    "audit",
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE fb_gmail_${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(sql, /UNIQUE \(founder_id, request_id\)/i);
  assert.match(sql, /payload_blob_sha char\(64\) NOT NULL/i);
  assert.match(sql, /token_blob_sha char\(64\) NOT NULL/i);
  assert.match(sql, /profile_blob_sha char\(64\) NOT NULL/i);
  assert.match(sql, /CHECK \(sent_count >= 0\)/i);
  assert.match(sql, /connection_epoch bigint/i);
  assert.match(sql, /policy_revision bigint/i);
  assert.match(sql, /auto_send_eligible boolean/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fb_gmail_audit/i);
  assert.match(sql, /to_regrole\('fb_runtime'\) IS NOT NULL/i);
  assert.match(sql, /to_regrole\('fb_worker'\) IS NOT NULL/i);
  assert.doesNotMatch(sql, /recipient text|subject text|body text|token text/i);
});

test("PGlite policy revision and disconnect epoch state reject stale work", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role fb_runtime; create role fb_worker;
      create table founder(id text primary key);
      create table ge_blob(
        founder_id text not null references founder(id) on delete cascade,
        sha char(64) not null,
        ciphertext bytea,
        nonce bytea,
        size_bytes bigint,
        primary key(founder_id,sha)
      );
    `);
    await db.exec(await readFile("src/founderbrain/gmail.sql", "utf8"));
    await db.exec(await readFile("src/founderbrain/gmail.sql", "utf8"));
    const privileges = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('fb_worker','fb_gmail_connection','SELECT') as allowed",
    );
    assert.equal(privileges.rows[0]?.allowed, false);
    await db.exec(
      `select set_config('app.founder_id','f1',false); insert into founder(id) values ('f1');`,
    );
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    await db.query(`insert into ge_blob(founder_id,sha) values ('f1',$1),('f1',$2)`, [a, b]);
    await db.query(
      `insert into fb_gmail_settings(founder_id,settings_blob_sha,policy_revision) values ('f1',$1,4)`,
      [a],
    );
    await db.exec(`
      insert into fb_gmail_consent(founder_id,auto_send_confirmed_at,auto_send_policy_revision)
      values ('f1',now(),4);
      insert into fb_gmail_draft(
        id,founder_id,request_id,request_hash,payload_blob_sha,status,
        auto_send_eligible,auto_send_policy_revision
      ) values (
        '11111111-1111-4111-8111-111111111111','f1','11111111-1111-4111-8111-111111111111',
        '${"c".repeat(64)}',$$${b}$$,'saved',true,4
      );
      insert into fb_gmail_guard(founder_id,connection_epoch) values ('f1',9);
    `);
    await db.exec(`
      update fb_gmail_settings set policy_revision=5 where founder_id='f1';
      update fb_gmail_consent set auto_send_policy_revision=5 where founder_id='f1';
      update fb_gmail_guard set connection_epoch=10 where founder_id='f1';
    `);
    const gate = await db.query<{
      auto_allowed: boolean;
      oauth_allowed: boolean;
    }>(`
      select
        (d.auto_send_eligible and d.auto_send_policy_revision=s.policy_revision
          and c.auto_send_policy_revision=s.policy_revision) as auto_allowed,
        (9=g.connection_epoch) as oauth_allowed
      from fb_gmail_draft d
      join fb_gmail_settings s using(founder_id)
      join fb_gmail_consent c using(founder_id)
      join fb_gmail_guard g using(founder_id)
      where d.founder_id='f1'
    `);
    assert.deepEqual(gate.rows[0], { auto_allowed: false, oauth_allowed: false });
  } finally {
    await db.close();
  }
});

test("Google responses reject malformed structures, wrong content types and oversized bodies", async () => {
  try {
    __gmailTest.setFetch(async (_url, init) => {
      assert.equal(init?.redirect, "error");
      return new Response(JSON.stringify({ messages: "not an array" }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    await assert.rejects(
      __gmailTest.googleApi("local-test-token", "/users/me/messages?maxResults=20"),
    );
    __gmailTest.setFetch(
      async () =>
        new Response(JSON.stringify({ id: 123 }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    await assert.rejects(
      __gmailTest.googleApi("local-test-token", "/users/me/drafts/send", { method: "POST" }),
    );
    __gmailTest.setFetch(
      async () => new Response('{"ok":true}', { headers: { "Content-Type": "text/html" } }),
    );
    await assert.rejects(
      __gmailTest.fixedFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {}),
    );
    __gmailTest.setFetch(
      async () =>
        new Response("x".repeat(100), { headers: { "Content-Type": "application/json" } }),
    );
    await assert.rejects(
      __gmailTest.fixedFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {}, 20),
    );
  } finally {
    __gmailTest.setFetch(null);
  }
});
