/**
 * Human-readable Brain field compare for conflict dialog and history.
 * Shows changed fields by default; optional full table and raw JSON.
 */
import { useMemo, useState } from "react";
import type { Brain } from "../types";
import { changedCount, diffBrains } from "../lib/brain-diff";

export function BrainDiff({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: Brain;
  right: Brain;
  leftLabel: string;
  rightLabel: string;
}) {
  const rows = useMemo(() => diffBrains(left, right), [left, right]);
  const [showAll, setShowAll] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const visible = showAll ? rows : rows.filter((row) => row.changed);
  const changes = changedCount(rows);

  return (
    <div className="brain-diff">
      <div className="brain-diff-toolbar">
        <p className="muted">
          {changes === 0
            ? "No field differences."
            : `${changes} field${changes === 1 ? "" : "s"} differ.`}
        </p>
        <label className="brain-diff-toggle">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
          />
          Show all fields
        </label>
      </div>
      {visible.length === 0 ? (
        <p className="muted">Toggle “Show all fields” to inspect unchanged values.</p>
      ) : (
        <table className="brain-diff-table">
          <thead>
            <tr>
              <th scope="col">Section</th>
              <th scope="col">Field</th>
              <th scope="col">{leftLabel}</th>
              <th scope="col">{rightLabel}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={`${row.sectionKey}.${row.field}`}
                className={row.changed ? "changed" : undefined}
              >
                <td>{row.section}</td>
                <td>{row.label}</td>
                <td>
                  <span className={row.changed ? "diff-value left" : undefined}>
                    {row.left || "—"}
                  </span>
                </td>
                <td>
                  <span className={row.changed ? "diff-value right" : undefined}>
                    {row.right || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details
        className="brain-diff-raw"
        open={showRaw}
        onToggle={(event) => setShowRaw((event.target as HTMLDetailsElement).open)}
      >
        <summary>Show raw JSON</summary>
        <div className="compare-columns">
          <pre>
            <b>{leftLabel}</b>
            {"\n"}
            {JSON.stringify(left, null, 2)}
          </pre>
          <pre>
            <b>{rightLabel}</b>
            {"\n"}
            {JSON.stringify(right, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  );
}
