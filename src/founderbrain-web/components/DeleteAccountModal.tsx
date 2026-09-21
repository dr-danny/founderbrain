/**
 * Delete-account confirmation (Danny, 2026-09-21): opened from the account chip.
 * States what deletion means, and requires typing the branded phrase
 * "delete my brain" before the destructive call is possible.
 */
import { useEffect, useState } from "react";

export const DELETE_CONFIRM_PHRASE = "delete my brain";

export function DeleteAccountModal({
  email,
  onClose,
  onConfirm,
}: {
  email: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [text, setText] = useState("");
  const confirmed = text.trim().toLowerCase() === DELETE_CONFIRM_PHRASE;

  // Escape backs out; focus lands on the confirm input so typing starts fast.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="restore-modal-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="restore-modal delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
        <p className="entry-kicker delete-kicker">THIS CANNOT BE UNDONE</p>
        <h2 id="delete-modal-title" className="restore-modal-title">
          Delete your FounderBrain?
        </h2>
        <div className="restore-modal-body">
          <p>
            <b>What will happen:</b> your whole workspace ends. Your Brain, every saved version,
            your first output, and your sign-in for {email} are gone, and the account stops
            existing. Nothing was ever published or sent to customers.
          </p>
          <p>
            Backup retention and billing reconciliation are handled by the operator.{" "}
            Your versions cannot be recovered from this app afterwards.
          </p>
          <p>
            Type <b className="delete-phrase">{DELETE_CONFIRM_PHRASE}</b> to confirm.
          </p>
          <input
            className="delete-confirm-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={DELETE_CONFIRM_PHRASE}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            aria-label={`Type ${DELETE_CONFIRM_PHRASE} to confirm deletion`}
            aria-invalid={text.length > 0 && !confirmed}
          />
        </div>
        <div className="restore-modal-actions">
          <button
            type="button"
            className="restore-danger"
            disabled={!confirmed}
            onClick={onConfirm}
          >
            Delete everything
          </button>
          <button type="button" className="atlanta-secondary" onClick={onClose}>
            Keep my Brain
          </button>
        </div>
      </div>
    </div>
  );
}
