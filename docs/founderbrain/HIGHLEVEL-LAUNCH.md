# HighLevel installation and opening FounderBrain

FounderBrain runs at https://oneday-founderbrain.marfi.online/. The HighLevel Marketplace app authorizes the connector; an Installed badge is not proof that the signed-in FounderBrain workspace completed OAuth.

## Founder path

1. Open FounderBrain and sign in with the existing account.
2. Open Connect GoHighLevel, choose the intended subaccount, and authorize installation.
3. Return to FounderBrain and check the verified subaccount name. Do not infer connection success from the Marketplace badge.

If a founder installs directly from the Marketplace and returns without the state created inside FounderBrain, `/oauth/callback` shows a public recovery page with **Open FounderBrain**. It never exchanges an incomplete callback, skips state checks, or changes an existing connection. The malformed callback query and fragment are removed from the address bar before rendering.

`/highlevel` is a public launch page for external website/help links. It renders without API availability or authentication. Query parameters and fragments are discarded. Neither public page inspects private account state or claims connection success. Both use a fixed, same-origin, top-level link to `/`.

`main.tsx` classifies and strips `/oauth/callback`'s query and fragment from the address bar before anything else mounts, for every shape: malformed, a valid authorization code, and a valid denial alike. This is not only cosmetic. The Hexclave identity SDK is constructed later, inside the app's state hook, and also reads the current URL on init; an `error`+`state` pair meant for GoHighLevel's Connect step previously read to it as its own hosted-sign-in denial and hijacked the boot before the app's own callback handling ever ran. A valid classification is kept only in page memory (an in-memory value handed to the app as a prop, then to its state hook as a parameter) and consumed once the existing authenticated gate (a real session, the one-shot handling guard, and the `/oauth/callback` path marker) allows it. The value is never re-read from the URL, logged, or persisted to storage.

Valid authorization and denial callbacks still run through the existing authenticated flow, calling the same completion endpoint the same way. Server-side user binding, expiration, one-time state consumption, and connection-generation checks are unchanged.

## Marketplace settings

When authenticated to the FounderBrain developer listing, make the externally opened website/help destination point to `https://oneday-founderbrain.marfi.online/highlevel` wherever the Marketplace actually supports that link. Include the standalone-website explanation and instructions above in the listing/support content. Do not claim these settings are saved without observing the dashboard confirmation.

Keep the existing OAuth redirect URI `https://oneday-founderbrain.marfi.online/oauth/callback`. Do not change the client, scopes, installation audience, or redirect URI to add a launcher.

This patch does **not** embed the private app in HighLevel. All pages retain `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Do not configure `/highlevel` as an iframe Custom Page: that needs a separately reviewed, tightly scoped framing policy. Do not remove the private app's frame protection as a shortcut.

## Release checks

- Run `npm run lint`, `npm run fb:build`, and `npm run fb:test` on Node 22. In the restricted sandbox, set `ESBUILD_BINARY_PATH="$PWD/node_modules/esbuild-wasm/bin/esbuild"`.
- Run the existing `scripts/founderbrain-browser-test.py` browser suite, including public-launch, malformed-callback, valid-callback (authorization and denial, each asserting the completion endpoint is called exactly once), the pre-boot query/fragment strip, the signed-out boot showing no Hexclave-SDK-hijack error text, and mobile regressions. Use disposable fixtures only, never a real provider.
- Verify CI with native PostgreSQL; database-gated skips are not full integration verification.
- Follow the existing explicit merge/deploy gate. Main merges also redeploy Railway, even for a frontend-only change: check queued/running generation jobs first.
- Build the exact merged tree, recheck the active Cloudflare version, upload with `--keep-vars`, and explicitly promote the reviewed version. Do not change routes, DNS, secrets, or unrelated staged Railway changes.
- Verify the served asset bytes, `/highlevel`, malformed `/oauth/callback`, and the fixed home link after deployment. No real installation, disconnect, customer-data write, generation, or paid provider call is required as a release test.
