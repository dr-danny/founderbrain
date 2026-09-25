import { useEffect, useState } from "react";

export function BuildPackModal({
  startedAt,
  done,
  error,
  onRetry,
}: {
  startedAt: number;
  done: boolean;
  error: string;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, [done]);
  const elapsed = Math.max(0, now - startedAt);
  const percent = done ? 100 : Math.min(95, Math.round((elapsed / 180_000) * 95));

  return (
    <div className="pack-modal" role="dialog" aria-modal="true" aria-label="Building your pack">
      <div className="pack-card build-card">
        <p className="eyebrow">UPDATE TO V2</p>
        <h2>{error && !done ? "The build did not finish." : "Building your pack"}</h2>
        <div className="build-meter" aria-hidden="true">
          <span className={done ? "build-spin done" : "build-spin"} style={{ ["--pct" as string]: `${percent}` }} />
          <strong>{percent}%</strong>
        </div>
        <p className="build-status" role="status">
          {error && !done
            ? error
            : percent < 30
              ? "Reading the Brain you already saved."
              : percent < 70
                ? "Writing content and outreach."
                : "Writing the 90 day plan."}
        </p>
        {error && !done ? (
          <button type="button" className="entry-cta" onClick={onRetry}>
            Try again
          </button>
        ) : (
          <p>Stay on this page. The review screen opens when it is ready.</p>
        )}
      </div>
    </div>
  );
}
