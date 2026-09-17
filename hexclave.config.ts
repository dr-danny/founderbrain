import { defineHexclaveConfig } from "@hexclave/js";

/**
 * hexclave.config.ts
 *
 * Declarative configuration for the FounderBrain Hexclave project. This is the source of
 * truth for how sign-in behaves; push it with `npx @hexclave/cli config push --cloud-project-id "$HEXCLAVE_PROJECT_ID"
 * --config-file hexclave.config.ts` after pulling and diffing, never blind. Locally, `npx @hexclave/cli dev
 * --config-file hexclave.config.ts -- <command>` runs a local dashboard that syncs to it.
 *
 * WHAT THIS SAYS
 *   - One-time code by email is the only way in. No passwords, no passkeys, no OAuth. A
 *     pilot founder has nothing to lose or reuse, and there is no "forgot password" flow.
 *   - Sign-up is off. Invite-only means the operator creates the user (dashboard, or
 *     `npx @hexclave/cli exec --cloud-project-id "$HEXCLAVE_PROJECT_ID"` with
 *     `createUser({ primaryEmail, primaryEmailVerified: true, primaryEmailAuthEnabled: true, otpAuthEnabled: true })`).
 *     An email with no user cannot create one from the sign-in page.
 *   - Only the authentication app. No teams, RBAC, payments, API keys or analytics. Each of
 *     those is a product decision that should be made on purpose, not inherited.
 *
 * WHAT IS NOT HERE, ON PURPOSE
 *   Trusted domains (the app hostname the hosted page may redirect back to) are
 *   environment-specific and live in the dashboard per environment. Add the approved
 *   staging and production origins there when #15 binds them.
 */
export const config = defineHexclaveConfig({
  auth: {
    allowSignUp: false,
    otp: { allowSignIn: true },
    password: { allowSignIn: false },
    passkey: { allowSignIn: false },
  },
  apps: {
    installed: {
      authentication: { enabled: true },
    },
  },
});
