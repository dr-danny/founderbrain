/**
 * In-app privacy / data-use / deletion disclosure (#27).
 * Linked from sign-in and the workspace delete zone. House style: short sentences, no em dashes.
 * Consent model: consent is given by using the app; this page is the standing notice.
 */
const EFFECTIVE = "2026-09-19";

export function PrivacyDisclosure({ onBack }: { onBack: () => void }) {
  return (
    <article className="privacy-card" aria-labelledby="privacy-title">
      <p className="eyebrow">PRIVACY AND DATA USE</p>
      <h1 id="privacy-title">The whole disclosure. One page.</h1>
      <p className="meta">
        Effective {EFFECTIVE}. Material changes appear on this page with a new date. Continued use
        after a change means you accept it.
      </p>

      <section>
        <h2>Consent</h2>
        <ul>
          <li>You accept this page by creating a workspace and by using the app. There is no separate signup contract.</li>
          <li>If you cannot accept this page, do not use FounderBrain.</li>
        </ul>
      </section>

      <section>
        <h2>What is stored</h2>
        <ul>
          <li>Your Brain revisions, save receipts, workspace events, and generated artifacts, stored encrypted in private Railway PostgreSQL. Region: the one picked when your environment was provisioned.</li>
          <li>The Cloudflare Worker serves the app and proxies API calls. It stores no Brain content.</li>
          <li>Hexclave holds identity only: your invite email and session. It stores no Brain content.</li>
          <li>No Supabase. No ads. No analytics on Brain content.</li>
        </ul>
      </section>

      <section>
        <h2>What is sent to AI</h2>
        <ul>
          <li><strong>AI training is off.</strong> Every AI call is routed with zero data retention and data collection denied (OpenRouter <code>zdr</code>, <code>data_collection: deny</code>). Your prompts and outputs are not stored by the provider and are never used to train a model.</li>
          <li>Browsing, editing, saving, approving, exporting, and restoring send nothing to any AI provider.</li>
          <li>A provider (OpenRouter) is called only when you click Generate, using the pinned Brain input for that job. Models are limited to a short allowlist reviewed for zero data retention.</li>
          <li>Optional website import sends the address you submit to Firecrawl to read that page. Nothing is read unless you submit a URL.</li>
          <li>Provider calls are metered: token counts and page credits are recorded to compute the price shown before GoHighLevel connect. Metering records are billing records, not Brain content, and are kept while billing requires.</li>
        </ul>
      </section>

      <section>
        <h2>Deletion</h2>
        <ul>
          <li>Delete workspace removes Brain revisions, receipts, events, membership, and related blobs immediately. It is permanent and cannot be undone from the product.</li>
          <li>If a generation was mid-flight at delete time, pseudonymous billing identifiers may remain so an operator can reconcile provider billing. Prompts and outputs are not kept on that path.</li>
          <li>Infrastructure backups run on an operator-defined retention window, then expire automatically.</li>
        </ul>
      </section>

      <section>
        <h2>Your controls</h2>
        <ul>
          <li>Export your Brain at any time. Delete your workspace at any time.</li>
          <li>For a deletion confirmation or the backup window in force for your environment, contact the operator who invited you. Pilot access is invite-only.</li>
        </ul>
      </section>

      <button className="button secondary" type="button" onClick={onBack}>
        Back
      </button>
    </article>
  );
}
