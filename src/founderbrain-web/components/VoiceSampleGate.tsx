/**
 * VoiceSampleGate: the Voice mission confirm screen with the 10-20 sample
 * capture. Approval stays disabled until at least ten founder-written samples
 * are on file (original intake Paths A/B, Danny 2026-09-19).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TypeformShell } from "./TypeformShell";
import type { QuestionIndexConfig } from "./QuestionIndexModal";

type Sample = { id: string; name: string; chars: number; createdAt: string };

export function VoiceSampleGate(props: {
  shell: {
    kicker: string;
    screen: number;
    total: number;
    sectionApproved: boolean;
    canApprove: boolean;
    title: string;
    onBack: () => void;
    onAdvance: () => void;
    saving: boolean;
    onApprove: () => void;
    onSave: () => void;
    canRetrySave: boolean;
    onRetrySave: () => void;
    changed: boolean;
    onCount: (n: number) => void;
    /** Optional jump-to-index config for the progress strip; passed through to the shell. */
    questionIndex?: QuestionIndexConfig;
    /** Founder-facing position text; passed through to the shell. */
    progressText?: string;
    /** Approval is missing requirements: open the question index instead of leaving an unexplained disabled button. */
    onReviewMissing: () => void;
  };
  listSamples?: () => Promise<{ samples: Sample[]; min: number }>;
  addSample?: (name: string, text: string) => Promise<{ count: number }>;
  deleteSample?: (id: string) => Promise<{ count: number }>;
  storedCount: number;
}) {
  const shell = props.shell;
  const [samples, setSamples] = useState<Sample[]>([]);
  const [min, setMin] = useState(10);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [mutating, setMutating] = useState(false);

  // Stable refs so the fetch effect below never has to depend on the `props`
  // object identity (a fresh literal on every parent render). Without this,
  // `refresh` was recreated each render and the effect re-ran forever
  // (the voice-refresh loop).
  const listSamplesRef = useRef(props.listSamples);
  listSamplesRef.current = props.listSamples;
  const onCountRef = useRef(shell.onCount);
  onCountRef.current = shell.onCount;

  // Only report a count change when it actually differs from the last count
  // the gate reported (starting from the Brain's stored count), so a refresh
  // that returns the same number never re-triggers patchBrain and clears
  // approval underneath the founder.
  const lastReportedCountRef = useRef(props.storedCount);
  lastReportedCountRef.current = props.storedCount;
  const savingRef = useRef(shell.saving);
  savingRef.current = shell.saving;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const reportCount = useCallback((count: number) => {
    if (!mountedRef.current || savingRef.current || count === lastReportedCountRef.current) return;
    lastReportedCountRef.current = count;
    onCountRef.current(count);
  }, []);

  // Guards against a slow, stale request overwriting a newer one (or an
  // unmounted screen) once it finally resolves.
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const list = listSamplesRef.current;
    if (!list) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setListLoading(true);
    try {
      const result = await list();
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setSamples(result.samples);
      setMin(result.min);
      setLoaded(true);
      setLoadError("");
      reportCount(result.samples.length);
    } catch (e) {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      // A failed load is not the same as zero samples: keep whatever list we
      // already had (including the stored count fallback below) and surface
      // a clear retry path instead of silently trusting "0".
      setLoadError(String(e instanceof Error ? e.message : e).slice(0, 160) || "Could not load samples.");
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) setListLoading(false);
    }
  }, [reportCount]);

  // Mount-only: `refresh` is stable (refs above), so this fires once per
  // screen visit rather than looping on every parent re-render.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Once we have ever loaded the real list, it is authoritative. Until then
  // (or while a load has failed and we have nothing yet) fall back to the
  // Brain's last-saved count so the copy below never flashes "0 of 10".
  const liveCount = loaded ? samples.length : props.storedCount;
  const enough = liveCount >= min;
  const missingRequirements = !shell.sectionApproved && !(shell.canApprove && enough);
  const busy = shell.saving || mutating;

  // If a list response landed while a save was in flight, reconcile once it
  // finishes instead of losing the changed count. Equal counts remain no-ops.
  useEffect(() => {
    if (loaded && !shell.saving && !listLoading && !mutating) reportCount(samples.length);
  }, [loaded, shell.saving, samples.length, props.storedCount, listLoading, mutating, reportCount]);

  async function submit() {
    if (!props.addSample || !name.trim() || text.trim().length < 40 || mutating) return;
    setMutating(true);
    try {
      const result = await props.addSample(name, text);
      if (!mountedRef.current) return;
      setName("");
      setText("");
      setError("");
      reportCount(result.count);
      // Don't fabricate a row with a made-up id/char count: refresh from the
      // server so the list (and any real id needed to delete it later) stays
      // authoritative.
      await refresh();
    } catch (e) {
      if (mountedRef.current) setError(String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      if (mountedRef.current) setMutating(false);
    }
  }

  async function remove(id: string) {
    if (!props.deleteSample || mutating) return;
    setMutating(true);
    try {
      const result = await props.deleteSample(id);
      if (!mountedRef.current) return;
      setError("");
      reportCount(result.count);
      await refresh();
    } catch (e) {
      if (mountedRef.current) setError(String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      if (mountedRef.current) setMutating(false);
    }
  }

  return (
    <TypeformShell
      kicker={shell.kicker}
      screen={shell.screen}
      total={shell.total}
      title={shell.title}
      progressText={shell.progressText}
      questionIndex={shell.questionIndex ? {
        ...shell.questionIndex,
        onJump: (id) => {
          if (mutating || shell.saving) return;
          if ((name.trim() || text.trim()) && id !== "voice:sampleCount") {
            setError("Add this writing sample, or clear its name and text, before opening another question. Your draft is still here.");
            return;
          }
          shell.questionIndex?.onJump(id);
        },
      } : undefined}
      hideContinue={!shell.sectionApproved}
      continueLabel={shell.sectionApproved ? "Next: First output" : "Continue"}
      showBack
      onBack={shell.onBack}
      onContinue={shell.onAdvance}
      saving={shell.saving}
    >
      <p className="entry-lede typeform-lede">
        Drop in ten to twenty pieces you wrote in your own voice: posts, emails, newsletters, long messages. Paste one at a time, or upload a file. {liveCount} of {min} on file. This is the sample everything downstream reads.
      </p>
      <div className="mission-choices voice-sample-form">
        <label className="field" htmlFor="voice-sample-name">
          <span>Sample name</span>
          <input
            id="voice-sample-name"
            value={name}
            maxLength={120}
            placeholder="e.g. LinkedIn post March"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field" htmlFor="voice-sample-text">
          <span>Paste the piece</span>
          <textarea
            id="voice-sample-text"
            value={text}
            rows={5}
            maxLength={20000}
            placeholder="Paste at least a paragraph; longer pieces are better"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="mission-save-row">
          <button
            type="button"
            className="mission-save"
            disabled={busy || name.trim().length < 2 || text.trim().length < 40}
            onClick={() => void submit()}
          >
            Add sample
          </button>
          <label className="mission-save voice-upload" style={{ cursor: "pointer" }}>
            Upload file
            <input
              type="file"
              accept=".txt,.md,.markdown,text/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void file.text().then((t) => {
                  setName(file.name.replace(/\.[a-z]+$/i, "").slice(0, 120));
                  setText(t.slice(0, 20000));
                  setError("");
                });
              }}
            />
          </label>
        </div>
        {error ? (
          <p className="entry-error" role="alert">
            {error}
          </p>
        ) : null}
        {loadError ? (
          <p className="entry-error" role="alert">
            {loadError}{" "}
            <button type="button" className="mission-save" disabled={listLoading} onClick={() => void refresh()}>
              {listLoading ? "Retrying…" : "Retry load"}
            </button>
          </p>
        ) : null}
      </div>
      {samples.length > 0 ? (
        <ul className="voice-sample-list" style={{ listStyle: "none", margin: "0.8rem 0 0", padding: 0 }}>
          {samples.slice(0, 8).map((sample) => (
            <li
              key={sample.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.35rem 0",
                color: "var(--paper-muted)",
                fontSize: "0.9rem",
                borderBottom: "1px solid rgba(247,239,230,0.12)",
              }}
            >
              <span>
                {sample.name} · {sample.chars.toLocaleString()} chars
              </span>
              <button
                type="button"
                className="mission-save"
                aria-label={`Remove ${sample.name}`}
                disabled={busy}
                onClick={() => void remove(sample.id)}
              >
                Remove
              </button>
            </li>
          ))}
          {samples.length > 8 ? <li style={{ color: "var(--paper-muted)" }}>…and {samples.length - 8} more</li> : null}
        </ul>
      ) : null}
      {!enough || !shell.canApprove ? (
        <p className="entry-lede typeform-lede">
          {enough
            ? "Approval also needs the tone, boundaries and sample filled."
            : `Approval opens at ${min} samples. You can keep going with a draft.`}
        </p>
      ) : null}
      <div className="typeform-choices mission-choices">
        <button
          type="button"
          className="typeform-choice yes"
          disabled={busy || listLoading || Boolean(loadError)}
          aria-describedby={missingRequirements ? "voice-approve-missing" : undefined}
          onClick={() => {
            if (missingRequirements) {
              shell.onReviewMissing();
              return;
            }
            shell.onApprove();
          }}
        >
          {shell.sectionApproved ? "Remove approval" : "Approve mission"}
        </button>
        <button type="button" className="typeform-choice no" disabled={busy} onClick={shell.onAdvance}>
          {shell.sectionApproved ? "Keep as is" : "Not yet"}
        </button>
      </div>
      {missingRequirements ? (
        <p id="voice-approve-missing" className="entry-lede typeform-lede">
          Some requirements are still missing. Tap Approve mission to see what is left.
        </p>
      ) : null}
      <div className="mission-save-row">
        <button type="button" className="mission-save" disabled={!shell.changed || busy} onClick={shell.onSave}>
          Save draft
        </button>
        {shell.canRetrySave && !busy ? (
          <button type="button" className="mission-save" onClick={shell.onRetrySave}>
            Retry save
          </button>
        ) : null}
      </div>
    </TypeformShell>
  );
}
