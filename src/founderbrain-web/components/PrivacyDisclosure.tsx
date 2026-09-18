/**
 * In-app privacy / data-use / deletion disclosure (#27).
 * Linked from sign-in and the workspace delete zone. House style: short sentences, no em dashes.
 */
export function PrivacyDisclosure({ onBack }: { onBack: () => void }) {
  return (
    <article className="privacy-card" aria-labelledby="privacy-title">
      <p className="eyebrow">PRIVACY AND DATA USE</p>
      <h1 id="privacy-title">What FounderBrain stores, and what deletion does.</h1>
      <p className="lede">
        Doubt first: this page is the product disclosure. Operator backup windows may still be
        refined when escrow is rehearsed.
      </p>

      <section>
        <h2>What is stored</h2>
        <p>
          Your Brain revisions, save receipts, workspace events, and any generated invitation
          artifact are stored encrypted in private Railway Postgres for the environment you use.
          The exact cloud region is the one chosen when that environment was provisioned.
        </p>
        <p>
          The Cloudflare Worker serves the app and proxies API calls. It does not keep Brain
          content. Hexclave holds identity for sign-in (invite email and session). It does not hold
          Brain content. Supabase is not used.
        </p>
      </section>

      <section>
        <h2>What is sent to AI</h2>
        <p>
          Nothing is sent to an AI provider when you browse, edit, save, approve, export, or
          restore. A provider call happens only when you explicitly click Generate, and only if AI
          is enabled for that environment. The call uses the pinned Brain input for that job.
        </p>
      </section>

      <section>
        <h2>Deletion</h2>
        <p>
          Delete workspace removes your Brain revisions, receipts, events, membership, and related
          blobs immediately. It cannot be undone from the product.
        </p>
        <p>
          If a generation was mid-flight or uncertain at delete time, only pseudonymous accounting
          identifiers and reserved amounts may remain so an operator can reconcile provider billing.
          Prompts and outputs are not kept on that path.
        </p>
        <p>
          Infrastructure database backups are retained for an operator-defined window, then expire.
          That window is recorded when backups and key escrow are configured. Billing reconciliation
          records are separate from your Brain content.
        </p>
      </section>

      <section>
        <h2>Questions</h2>
        <p>
          Pilot access is invite-only. Ask the operator who invited you if you need a deletion
          confirmation or a copy of the backup retention window for your environment.
        </p>
      </section>

      <button className="button secondary" type="button" onClick={onBack}>
        Back
      </button>
    </article>
  );
}
