# Gmail voice and drafts

## Boundaries

This optional connector is separate from FounderBrain login and GoHighLevel. It supports a Gmail-enabled Google account, including a different account from the user's FounderBrain login. Gmail read/compose OAuth is broad at Google's permission layer; the server limits analysis to explicitly selected SENT messages from that connected address. Source email bodies are transient, never stored as source documents. Voice profiles, connection tokens, settings and generated bodies use the existing encrypted per-founder blob store and tenant RLS.

Automatic sending is **off by default**. A founder must explicitly consent, configure exact recipient addresses and a daily cap (1–20). Only a new draft generation can trigger auto-send; the connector does not watch the inbox, auto-reply, schedule campaigns or drain a queue. Manual sending requires preview confirmation. Ambiguous provider mutations never auto-retry. Disconnecting deletes local connector data and attempts Google revocation; previously saved Gmail drafts and sent mail remain in Gmail.

## Operator setup

1. In a Google Cloud project controlled by the operator, enable the Gmail API.
2. Configure Google Auth branding, support/contact information and audience. Public home: `https://oneday-founderbrain.marfi.online/`. Public privacy disclosure: `https://oneday-founderbrain.marfi.online/privacy`.
3. Create an OAuth **Web application** client with the exact redirect URI `https://oneday-founderbrain.marfi.online/gmail/callback`. This is separate from the existing GHL `/oauth/callback`, which must stay unchanged.
4. Configure `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` as protected Railway **API service** variables. Never commit or log these credentials. Existing `APP_ORIGIN` must match the origin above; retain `GE_MASTER_KEY` and the existing encrypted workspace setup.
5. Request `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.compose`. Compose covers draft management and sending; no unrestricted `mail.google.com` scope or delete permission is used.
6. While the consent app is in Testing, explicitly add only authorized Gmail-enabled test accounts. Do not assume the user's Workspace address has Gmail enabled. External testing refresh tokens can expire after seven days.
7. Run `npm run fb:migrate` with the admin database URL, then deploy the API and static/edge build using the existing deployment path. Do not add Cloudflare routes or change DNS. Gmail SQL must ship with the server build.
8. In FounderBrain, open **Gmail voice & drafts** and connect the desired account. Review Google's grants, select 5–20 sent messages, separately consent to AI analysis, then generate a local draft. Save it to Gmail Drafts and inspect the exact recipient/content before any explicitly authorized test send.

## Public rollout gate

`gmail.readonly` and `gmail.compose` are restricted scopes. Google OAuth verification is required for general distribution; server-side storage/transmission of restricted data can require a security assessment. Operator setup alone is **not** proof of Google approval. Do not claim public verification until Google confirms it. The privacy disclosure commits Google data to user-directed features, not advertising or generalized model training; AI requests use the project's privacy-routing restrictions.

References:
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/terms/api-services-user-data-policy
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/gmail/api/guides/drafts

## Verification checklist

- [ ] OAuth state is single-use, tenant-bound and expired/replay attempts fail; PKCE token exchange succeeds.
- [ ] Only selected SENT messages authored by the connected account are analyzed; inbox IDs fail; attachments and quoted chains are excluded.
- [ ] No raw message content appears in DB rows or logs; profile/draft payloads are encrypted.
- [ ] Local draft generation and editing work without sending; save is explicit and idempotent.
- [ ] Manual send matches the preview; external edits to a Gmail draft cannot change the sent recipient/content.
- [ ] Auto-send stays off until confirmed; only allowlisted fresh generations qualify under the same consent/policy; caps are atomic.
- [ ] Concurrent/repeated sends cannot duplicate a send; ambiguous failures remain blocked.
- [ ] Account switching and disconnect cannot reuse the previous mailbox's style, drafts or sending permission.
- [ ] Disconnect clears local data and reports remote revoke outcome; account deletion cascades all connector rows.
- [ ] Desktop/mobile usability, unsaved edits, callback error states and public privacy page verified.

Unit/mocked checks do not replace a real-account OAuth and save/send test. Keep the connector marked unverified until that test is completed with explicit authorization for the destination and message.
