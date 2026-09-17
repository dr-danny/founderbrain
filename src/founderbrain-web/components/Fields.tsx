/**
 * Shared Field / Text inputs for mission forms.
 * Centralizes required-field attention styling so MissionForm stays declarative.
 */
import { fieldNeedsAttention } from "../types";

export function Text({
  id,
  label,
  value,
  onChange,
  hint,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
}) {
  const attention = required && fieldNeedsAttention(value);
  return (
    <div className={attention ? "field needs-attention" : "field"}>
      <label htmlFor={id}>
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </label>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {attention && (
        <small className="field-hint" id={`${id}-req`}>
          Required — empty and placeholders like “tbd” do not count.
        </small>
      )}
      <textarea
        aria-describedby={
          [hint ? `${id}-hint` : "", attention ? `${id}-req` : ""].filter(Boolean).join(" ") ||
          undefined
        }
        id={id}
        value={value}
        required={required}
        maxLength={2000}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function Field({
  id,
  label,
  value,
  onChange,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const attention = required && fieldNeedsAttention(value);
  return (
    <div className={attention ? "field needs-attention" : "field"}>
      <label htmlFor={id}>
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </label>
      {attention && (
        <small className="field-hint" id={`${id}-req`}>
          Required — empty and placeholders like “tbd” do not count.
        </small>
      )}
      <input
        aria-describedby={attention ? `${id}-req` : undefined}
        id={id}
        value={value}
        required={required}
        maxLength={2000}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
