/**
 * VoiceSampleGate: the Voice mission confirm screen with the 10-20 sample
 * capture. Approval stays disabled until at least ten founder-written samples
 * are on file (original intake Paths A/B, Danny 2026-09-19).
 */
import { useCallback, useEffect, useState } from "react";
import { TypeformShell } from "./TypeformShell";

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

  const refresh = useCallback(async () => {
    if (!props.listSamples) return;
    try {
      const result = await props.listSamples();
      setSamples(result.samples);
      setMin(result.min);
      props.shell.onCount(result.samples.length);
    } catch {
      /* the Brain's stored count stays authoritative for the gate */
    } finally {
      setLoaded(true);
    }
  }, [props]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const liveCount = loaded ? samples.length : props.storedCount;
  const enough = liveCount >= min;

  async function submit() {
    if (!props.addSample || !name.trim() || text.trim().length < 40) return;
    try {
      const result = await props.addSample(name, text);
      setSamples((current) => [
        ...current,
        { id: `${Date.now()}`, name: name.trim(), chars: text.trim().length, createdAt: new Date().toISOString() },
      ]);
      setName("");
      setText("");
      setError("");
      shell.onCount(result.count);
      void refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 160));
    }
  }

  async function remove(id: string) {
    if (!props.deleteSample) return;
    try {
      const result = await props.deleteSample(id);
      setSamples((current) => current.filter((s) => s.id !== id));
      shell.onCount(result.count);
      void refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 160));
    }
  }

  return (
    <TypeformShell
      kicker={shell.kicker}
      screen={shell.screen}
      total={shell.total}
      title={shell.title}
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
            disabled={shell.saving || name.trim().length < 2 || text.trim().length < 40}
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
          disabled={shell.saving || (!shell.sectionApproved && !(shell.canApprove && enough))}
          onClick={shell.onApprove}
        >
          {shell.sectionApproved ? "Remove approval" : "Approve mission"}
        </button>
        <button type="button" className="typeform-choice no" disabled={shell.saving} onClick={shell.onAdvance}>
          {shell.sectionApproved ? "Keep as is" : "Not yet"}
        </button>
      </div>
      <div className="mission-save-row">
        <button type="button" className="mission-save" disabled={!shell.changed || shell.saving} onClick={shell.onSave}>
          Save draft
        </button>
        {shell.canRetrySave && !shell.saving ? (
          <button type="button" className="mission-save" onClick={shell.onRetrySave}>
            Retry save
          </button>
        ) : null}
      </div>
    </TypeformShell>
  );
}