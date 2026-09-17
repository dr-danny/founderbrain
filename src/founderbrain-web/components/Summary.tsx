/**
 * Customer working summary shown beside the Customer mission fields.
 * Deterministic preview only — not evidence or verification.
 */
import type { Brain } from "../types";

export function Summary({ customer }: { customer: Brain["customer"] }) {
  if (!customer.segment && !customer.problem && !customer.outcome) return null;
  return (
    <aside className="summary">
      <p className="eyebrow">WORKING SUMMARY</p>
      <dl>
        <dt>Customer</dt>
        <dd>{customer.segment || "Not set"}</dd>
        <dt>Problem</dt>
        <dd>{customer.problem || "Not set"}</dd>
        {customer.outcome && (
          <>
            <dt>Desired outcome</dt>
            <dd>{customer.outcome}</dd>
          </>
        )}
        {customer.workaround && (
          <>
            <dt>Current workaround</dt>
            <dd>{customer.workaround}</dd>
          </>
        )}
      </dl>
      <small>This is a deterministic preview, not evidence or verification.</small>
    </aside>
  );
}
