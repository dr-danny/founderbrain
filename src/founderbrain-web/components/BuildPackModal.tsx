import { useEffect, useState } from "react";

export function BuildPackModal({
  startedAt,
  done,
  failed,
  message,
  onRetry,
  onClose,
}: {
  startedAt: number;
  done: boolean;
  failed: boolean;
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done || failed) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, [done, failed, startedAt]);
  const elapsed = Math.max(0, now - startedAt);
  const percent = done ? 100 : Math.min(95, Math.round((elapsed / 120_000) * 95));

  return (
    <div className="pack-modal" role="dialog" aria-modal="true" aria-label="Building your pack">
      <div className="pack-card build-card">
        <p className="eyebrow">UPDATE TO V2</p>
        <h2>{failed ? "Your pack is not built yet." : "Building your pack"}</h2>
        {failed ? null : (
          <div className="build-meter" aria-hidden="true">
            <span className={done ? "build-spin done" : "build-spin"} style={{ ["--pct" as string]: `${percent}` }} />
            <strong>{percent}%</strong>
          </div>
        )}
        <p className="build-status" role="status">
          {failed
            ? message || "The last build stopped before it saved. Nothing was sent."
            : percent < 30
              ? "Reading the Brain you already saved."
              : percent < 70
                ? "Writing content and outreach."
                : "Writing the 90 day plan."}
        </p>
        {failed ? (
          <div className="pack-actions" style={{ justifyContent: "center" }}>
            <button type="button" className="typeform-external" onClick={onClose}>
              Close
            </button>
            <button type="button" className="entry-cta" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : (
          <p>Stay on this page. The review screen opens when it is ready.</p>
        )}
      </div>
    </div>
  );
}
