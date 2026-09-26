/**
 * Question index (Danny, 2026-09-26): every mission screen can expose a
 * "Questions" jump list so founders can see everything a section asks,
 * which ones are still missing, and hop straight to any of them.
 *
 * Shared contract: TypeformShell takes a `questionIndex` prop built from
 * `QuestionIndexConfig` below, and stays the single owner of open/show-all
 * state so it can also gate its own global Enter-key and auto-focus effects
 * while this dialog is open. This component renders the trigger button plus
 * the modal itself and is otherwise presentational.
 */
import { useEffect, useRef } from "react";
import "../question-index.css";

export type QuestionIndexItem = {
  id: string;
  title: string;
  answered: boolean;
  required: boolean;
  detail?: string;
  group?: string;
};

export type QuestionIndexConfig = {
  title: string;
  items: QuestionIndexItem[];
  onJump: (id: string) => void;
  /** Bump this number to request the modal open in missing-only mode. */
  request?: number;
};

/** Count of required-but-unanswered questions, used for the trigger badge. */
export function countRequiredMissing(items: QuestionIndexItem[]): number {
  return items.filter((item) => item.required && !item.answered).length;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M4 10.5 8 14.5 16 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M5 5 15 15M15 5 5 15"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Small list icon for the always-visible trigger button. */
export function QuestionListIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M4 5.5h12M4 10h12M4 14.5h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function groupItems(items: QuestionIndexItem[]): Array<[string, QuestionIndexItem[]]> {
  const order: string[] = [];
  const groups = new Map<string, QuestionIndexItem[]>();
  for (const item of items) {
    const key = item.group ?? "";
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }
  return order.map((key) => [key, groups.get(key)!]);
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function QuestionIndexModal({
  config,
  open,
  showAll,
  onShowAllChange,
  onClose,
}: {
  config: QuestionIndexConfig;
  open: boolean;
  showAll: boolean;
  onShowAllChange: (value: boolean) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus trap + restore + scroll lock, all scoped to the open lifetime.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const getFocusable = () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    const toFocus = getFocusable()[0] ?? dialogRef.current;
    toFocus?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture phase so this wins over any other global keydown listeners
    // (e.g. the shell's Enter-to-continue handler) while the dialog is open.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const handleJump = (id: string) => {
    config.onJump(id);
    onClose();
  };

  const missing = config.items.filter((item) => item.required && !item.answered);
  const optional = config.items.filter((item) => !item.required && !item.answered);
  const answered = config.items.filter((item) => item.answered);

  const sections = showAll
    ? [
        { key: "missing", heading: "Missing required answers", items: missing },
        { key: "optional", heading: "Optional unanswered", items: optional },
        { key: "answered", heading: "Answered", items: answered },
      ]
    : [{ key: "missing", heading: "Missing required answers", items: missing }];

  return (
    <div
      className="question-index-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="question-index-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-index-title"
        tabIndex={-1}
      >
        <header className="question-index-header">
          <h2 id="question-index-title">{config.title}</h2>
          <button
            type="button"
            className="question-index-close"
            onClick={onClose}
            aria-label="Close question index"
          >
            <CrossIcon />
          </button>
        </header>
        <label className="question-index-toggle">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => onShowAllChange(event.target.checked)}
          />
          Show all questions
        </label>
        <div className="question-index-body">
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <section key={section.key} className="question-index-section">
                <h3>{section.heading}</h3>
                {groupItems(section.items).map(([group, groupedItems]) => (
                  <div key={group || `${section.key}-ungrouped`} className="question-index-group">
                    {group ? <p className="question-index-group-label">{group}</p> : null}
                    <ul className="question-index-list">
                      {groupedItems.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={
                              item.answered
                                ? "question-index-item answered"
                                : "question-index-item missing"
                            }
                            aria-label={`${item.title}. ${item.answered ? "Answered" : item.required ? "Required, not answered" : "Optional, not answered"}${item.detail ? `. ${item.detail}` : ""}`}
                            onClick={() => handleJump(item.id)}
                          >
                            <span className="question-index-status">
                              {item.answered ? <CheckIcon /> : <CrossIcon />}
                            </span>
                            <span className="question-index-text">
                              <span className="question-index-title-text">{item.title}</span>
                              {item.detail ? (
                                <span className="question-index-detail">{item.detail}</span>
                              ) : null}
                            </span>
                            <span className="question-index-label-text">
                              {item.answered
                                ? "Answered"
                                : item.required
                                  ? "Required, not answered"
                                  : "Optional, not answered"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ),
          )}
          {!showAll && missing.length === 0 ? (
            <p className="question-index-empty">All required questions here are answered.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
