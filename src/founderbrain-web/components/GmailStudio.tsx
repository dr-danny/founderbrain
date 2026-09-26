/**
 * src/founderbrain-web/components/GmailStudio.tsx
 *
 * WHAT THIS IS. The Gmail feature app: connect a Gmail account, learn a writing voice from a
 * small, explicitly-selected batch of sent mail, draft new messages in that voice, and (only
 * when the operator has turned it on and only for allowlisted recipients) let a newly generated
 * message go out automatically. Everything else is manual: this page never reads the inbox,
 * never auto-replies, and never sends anything that was not just generated here.
 *
 * WHY A FULL PAGE, NOT A MODAL. OAuth is a full top-level redirect to Google and back. A modal
 * would lose its state across that redirect. This mounts as its own page (with a "Back to hub"
 * exit) and picks the OAuth callback query back up on mount.
 *
 * VISUAL STYLE. Matches the pack-review studio: dark warm editorial chrome (`--ink` / `--paper`
 * from styles.css plus the pack-review accent `#f4c7a1`), spacious two-column workspaces, equal
 * geometry buttons. See gmail-studio.css.
 */
import { useEffect, useRef, useState } from "react";
import "./gmail-studio.css";

// ---------------------------------------------------------------------------
// Browser-facing data types. The parent's api.ts imports these as types when
// it implements GmailClient against the real HTTP API.
// ---------------------------------------------------------------------------

export interface GmailVoiceProfile {
  tone: string;
  cadence: string;
  greetings: string;
  closings: string;
  dos: string[];
  donts: string[];
  sampleCount: number;
  updatedAt: string;
}

export interface GmailSettings {
  autoSend: boolean;
  allowedRecipients: string[];
  dailyLimit: number;
}

export interface GmailStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  voiceProfile: GmailVoiceProfile | null;
  settings: GmailSettings;
  sentToday: number;
}

export type GmailDraftStatus =
  | "drafting"
  | "draft"
  | "saving"
  | "saved"
  | "sending"
  | "sent"
  | "uncertain"
  | "failed";

export interface GmailDraft {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: GmailDraftStatus;
  gmailDraftId: string | null;
  gmailMessageId: string | null;
  createdAt: string;
  error?: string;
  autoSent?: boolean;
}

export interface SentMail {
  id: string;
  subject: string;
  snippet: string;
  date: string;
}

export interface GmailClient {
  gmailStatus(): Promise<GmailStatus>;
  gmailStart(): Promise<{ url: string }>;
  gmailComplete(input: { code: string; state: string }): Promise<GmailStatus>;
  gmailDisconnect(): Promise<{ disconnected: boolean; revoked: boolean }>;
  gmailSent(pageToken?: string): Promise<{ messages: SentMail[]; nextPageToken?: string }>;
  gmailAnalyze(input: { messageIds: string[]; consent: true }): Promise<GmailStatus>;
  gmailDrafts(): Promise<{ drafts: GmailDraft[] }>;
  gmailCreateDraft(input: {
    requestId: string;
    recipient: string;
    brief: string;
    subject?: string;
    autoSend?: boolean;
  }): Promise<GmailDraft>;
  gmailUpdateDraft(input: { id: string; subject: string; body: string }): Promise<GmailDraft>;
  gmailSaveDraft(input: { id: string }): Promise<GmailDraft>;
  gmailSendDraft(input: { id: string }): Promise<GmailDraft>;
  gmailSettings(input: {
    autoSend: boolean;
    allowedRecipients: string[];
    dailyLimit: number;
    confirmed: boolean;
  }): Promise<GmailStatus>;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_VOICE_SAMPLES = 5;
const MAX_VOICE_SAMPLES = 20;
const MAX_ALLOWED_RECIPIENTS = 20;

const BUSY_DRAFT_STATUSES: GmailDraftStatus[] = ["drafting", "saving", "sending"];

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Something went wrong. Please try again.";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function payloadKey(recipient: string, subject: string, brief: string): string {
  return JSON.stringify([recipient.trim().toLowerCase(), subject.trim(), brief.trim()]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Tab = "learn" | "draft" | "sending";

export function GmailStudio({ api, onBack }: { api: GmailClient; onBack: () => void }) {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [callbackNotice, setCallbackNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("learn");
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null);

  const [unsaved, setUnsaved] = useState(false);
  function canLeave() { return !unsaved || window.confirm("Discard your unsaved Gmail edits?"); }
  const callbackHandled = useRef(false);
  const callbackPromise = useRef<Promise<GmailStatus> | null>(null);

  const refreshStatus = async () => {
    setStatusError(null);
    try {
      const next = await api.gmailStatus();
      setStatus(next);
      return next;
    } catch (error) {
      setStatusError(errorMessage(error));
      return null;
    }
  };

  // Handle the OAuth redirect back from Google exactly once, scrub the query
  // immediately so a refresh never replays `code`, then complete sign-in.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!callbackHandled.current) {
        callbackHandled.current = true;
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");
        const oauthError = params.get("error");
        const hadCallback = Boolean(code || state || oauthError);
        if (hadCallback) {
          window.history.replaceState(null, "", "/");
        }
        if (oauthError) {
          setCallbackNotice(`Google declined the connection request (${oauthError}).`);
        } else if (code && state) {
          callbackPromise.current = api.gmailComplete({ code, state });
        }
      }
      if (callbackPromise.current) {
        try {
          const next = await callbackPromise.current;
          if (!cancelled) { setStatus(next); setCallbackNotice(next.connected ? "Gmail connected." : null); }
        } catch (error) {
          if (!cancelled) setCallbackNotice(errorMessage(error));
        }
      }
      setStatusLoading(true);
      await refreshStatus();
      if (!cancelled) setStatusLoading(false);
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConnect() {
    if (connecting) return;
    setConnecting(true);
    setStatusError(null);
    try {
      const { url } = await api.gmailStart();
      window.location.href = url;
    } catch (error) {
      setStatusError(errorMessage(error));
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    setDisconnectNotice(null);
    try {
      const result = await api.gmailDisconnect();
      setDisconnectConfirm(false);
      if (result.revoked) {
        setDisconnectNotice("Disconnected. Google access was revoked.");
      } else {
        setDisconnectNotice(
          "Disconnected locally, but Google did not confirm the revoke. Open Google Account " +
            "permissions to remove FounderBrain's access yourself.",
        );
      }
      await refreshStatus();
    } catch (error) {
      setDisconnectNotice(errorMessage(error));
    } finally {
      setDisconnecting(false);
    }
  }

  const busy = statusLoading || connecting || disconnecting;

  return (
    <div className="gmail-studio">
      <header className="gmail-studio-header">
        <button type="button" className="gmail-back" onClick={() => { if (canLeave()) onBack(); }}>
          ← Back to hub
        </button>
        <div className="gmail-studio-title">
          <p className="eyebrow">GMAIL STUDIO</p>
          <h1>Write email in your own voice.</h1>
        </div>
        {status?.connected ? (
          <div className="gmail-connection-pill" role="status">
            <span className="gmail-dot" aria-hidden="true" />
            <span>{status.email ?? "Connected"}</span>
          </div>
        ) : null}
      </header>

      {callbackNotice ? (
        <p className="gmail-notice" role="status">
          {callbackNotice}
        </p>
      ) : null}
      {statusError ? (
        <p className="gmail-alert" role="alert">
          {statusError}
        </p>
      ) : null}
      {disconnectNotice ? (
        <p className="gmail-notice" role="status">
          {disconnectNotice}
        </p>
      ) : null}

      {statusLoading && !status ? (
        <p className="gmail-loading" role="status">
          Loading Gmail Studio…
        </p>
      ) : !status || !status.configured ? (
        <section className="gmail-panel gmail-not-configured">
          <h2>Gmail isn't set up on this server yet.</h2>
          <p>
            An operator needs to configure Gmail OAuth credentials for this workspace before
            anyone can connect an account here. There is no demo data to show in the meantime.
          </p>
          <button type="button" className="button secondary" onClick={onBack}>
            Back to hub
          </button>
        </section>
      ) : !status.connected ? (
        <ConnectPanel busy={busy} onConnect={handleConnect} />
      ) : (
        <>
          <nav className="gmail-tabs" role="tablist" aria-label="Gmail studio sections">
            {(
              [
                ["learn", "Learn voice"],
                ["draft", "Draft messages"],
                ["sending", "Sending controls"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`gmail-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`gmail-panel-${key}`}
                onClick={() => { if (key === tab || canLeave()) setTab(key); }}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="gmail-tab-panels">
            {tab === "learn" ? (
              <LearnVoicePanel api={api} status={status} onStatus={setStatus} />
            ) : null}
            {tab === "draft" ? <DraftMessagesPanel api={api} status={status} onDirtyChange={setUnsaved} onStatus={setStatus} /> : null}
            {tab === "sending" ? (
              <SendingControlsPanel api={api} status={status} onStatus={setStatus} onDirtyChange={setUnsaved} />
            ) : null}
          </div>

          <footer className="gmail-disconnect-zone">
            {disconnectConfirm ? (
              <div className="gmail-confirm" role="alertdialog" aria-label="Confirm disconnect">
                <p>Disconnect this Gmail account? You can reconnect any time.</p>
                <button type="button" onClick={() => setDisconnectConfirm(false)} disabled={disconnecting}>
                  Keep connected
                </button>
                <button type="button" className="gmail-danger" onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="button secondary"
                disabled={disconnecting}
                onClick={() => { if (canLeave()) setDisconnectConfirm(true); }}
              >
                Disconnect Gmail
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect (disconnected) panel
// ---------------------------------------------------------------------------

function ConnectPanel({ busy, onConnect }: { busy: boolean; onConnect: () => void }) {
  return (
    <section className="gmail-panel gmail-connect">
      <h2>Connect your Gmail account.</h2>
      <p>Google grants Gmail read and compose access for these features:</p>
      <ul className="gmail-scope-list">
        <li>
          <strong>Read Gmail messages.</strong> Google’s permission covers your mailbox; FounderBrain restricts its use to sent mail. Voice analysis uses only the small batch you select.
        </li>
        <li>
          <strong>Create drafts.</strong> Used to save messages generated here into your Gmail
          drafts, when you ask.
        </li>
        <li>
          <strong>Send mail.</strong> Used only when you click Send, or (if you later turn it on
          yourself) for newly generated messages to an explicit allowlist. Sending is off by
          default.
        </li>
      </ul>
      <p className="gmail-fineprint">
        This page never reads your inbox and never replies automatically. It only ever acts on
        messages generated on this page.
      </p>
      <button type="button" className="button primary" disabled={busy} onClick={onConnect}>
        {busy ? "Opening Google…" : "Connect Gmail"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Learn voice
// ---------------------------------------------------------------------------

function LearnVoicePanel({
  api,
  status,
  onStatus,
}: {
  api: GmailClient;
  status: GmailStatus;
  onStatus: (s: GmailStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<SentMail[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [consent, setConsent] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  async function startSelection() {
    setOpen(true);
    setLoadError(null);
    setAnalyzeError(null);
    setMessages([]);
    setSelected(new Set());
    setConsent(false);
    setExhausted(false);
    setLoading(true);
    try {
      const first = await api.gmailSent();
      setMessages(first.messages);
      setNextPageToken(first.nextPageToken);
      if (!first.nextPageToken) setExhausted(true);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextPageToken || loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const page = await api.gmailSent(nextPageToken);
      setMessages((prev) => [...prev, ...page.messages]);
      setNextPageToken(page.nextPageToken);
      if (!page.nextPageToken) setExhausted(true);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_VOICE_SAMPLES) next.add(id);
      return next;
    });
  }

  const insufficientSent = exhausted && messages.length < MIN_VOICE_SAMPLES;
  const canAnalyze =
    consent && selected.size >= MIN_VOICE_SAMPLES && selected.size <= MAX_VOICE_SAMPLES && !analyzing;

  async function analyze() {
    if (!canAnalyze || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const next = await api.gmailAnalyze({ messageIds: Array.from(selected), consent: true });
      onStatus(next);
      setOpen(false);
    } catch (error) {
      setAnalyzeError(errorMessage(error));
    } finally {
      setAnalyzing(false);
    }
  }

  const profile = status.voiceProfile;

  return (
    <section className="gmail-panel gmail-learn" id="gmail-panel-learn" role="tabpanel" aria-labelledby="gmail-tab-learn">
      {profile ? (
        <div className="gmail-voice-summary">
          <h2>Your current voice profile</h2>
          <dl>
            <div>
              <dt>Tone</dt>
              <dd>{profile.tone}</dd>
            </div>
            <div>
              <dt>Cadence</dt>
              <dd>{profile.cadence}</dd>
            </div>
            <div>
              <dt>Greetings</dt>
              <dd>{profile.greetings}</dd>
            </div>
            <div>
              <dt>Closings</dt>
              <dd>{profile.closings}</dd>
            </div>
          </dl>
          <div className="gmail-voice-lists">
            <div>
              <p>Does</p>
              <ul>
                {profile.dos.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
            <div>
              <p>Avoids</p>
              <ul>
                {profile.donts.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="gmail-fineprint">
            Built from {profile.sampleCount} email{profile.sampleCount === 1 ? "" : "s"} you selected ·
            last updated {formatDate(profile.updatedAt)}. This stores a style summary instead of retaining the source emails.
          </p>
        </div>
      ) : (
        <div className="gmail-voice-summary gmail-voice-empty">
          <h2>No voice profile yet</h2>
          <p>
            Select a small batch of your own sent emails and FounderBrain will learn the shape of
            how you write: tone, cadence, how you open and close a message. It extracts writing style,
            not a factual knowledge base, and does not store the source emails.
          </p>
        </div>
      )}

      {!open ? (
        <button type="button" className="button primary" onClick={startSelection}>
          {profile ? "Update voice profile" : "Learn my voice"}
        </button>
      ) : (
        <div className="gmail-selection">
          <div className="gmail-selection-header">
            <h3>Choose 5 to 20 sent emails</h3>
            <span className="gmail-selection-count" aria-live="polite">
              {selected.size} selected
            </span>
          </div>
          <p className="gmail-fineprint">
            Only subject, snippet, and date are shown here. Attachments are excluded; recognizable
            quoted replies and signatures are filtered. Full email bodies are never retained; only the
            selected messages you confirm below are sent to our AI provider, once, to analyze
            writing style.
          </p>
          {loadError ? (
            <p className="gmail-alert" role="alert">
              {loadError}
            </p>
          ) : null}
          {loading && messages.length === 0 ? (
            <p role="status">Loading your sent mail…</p>
          ) : insufficientSent ? (
            <p className="gmail-alert" role="alert">
              Only {messages.length} sent email{messages.length === 1 ? "" : "s"} found. You need at
              least {MIN_VOICE_SAMPLES} to build a voice profile.
            </p>
          ) : (
            <ul className="gmail-message-list">
              {messages.map((m) => {
                const checked = selected.has(m.id);
                const disabled = !checked && selected.size >= MAX_VOICE_SAMPLES;
                return (
                  <li key={m.id}>
                    <label className={disabled ? "gmail-message-disabled" : undefined}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(m.id)}
                      />
                      <span className="gmail-message-subject">{m.subject || "(no subject)"}</span>
                      <span className="gmail-message-snippet">{m.snippet}</span>
                      <span className="gmail-message-date">{formatDate(m.date)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {nextPageToken ? (
            <button type="button" className="button secondary" disabled={loading} onClick={loadMore}>
              {loading ? "Loading…" : "Load more"}
            </button>
          ) : null}

          <label className="gmail-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            Send only these selected emails to our AI provider to analyze writing style.
          </label>

          {analyzeError ? (
            <p className="gmail-alert" role="alert">
              {analyzeError}
            </p>
          ) : null}

          <div className="gmail-selection-actions">
            <button type="button" className="button secondary" disabled={analyzing} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="button primary" disabled={!canAnalyze} onClick={analyze}>
              {analyzing ? "Analyzing…" : `Analyze ${selected.size} email${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Draft messages
// ---------------------------------------------------------------------------

function DraftMessagesPanel({ api, status, onDirtyChange, onStatus }: { api: GmailClient; status: GmailStatus; onDirtyChange: (dirty: boolean) => void; onStatus: (status: GmailStatus) => void }) {
  const [drafts, setDrafts] = useState<GmailDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [brief, setBrief] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const requestRef = useRef<{ key: string; id: string } | null>(null);

  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [savingLocal, setSavingLocal] = useState(false);
  const [savingGmail, setSavingGmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await api.gmailDrafts();
        if (cancelled) return;
        setDrafts(result.drafts);
        const first = result.drafts[0];
        if (first && !selectedId) setSelectedId(first.id);
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = drafts.find((d) => d.id === selectedId) ?? null;

  useEffect(() => {
    setEditSubject(selected?.subject ?? "");
    setEditBody(selected?.body ?? "");
    setConfirmSend(false);
    setActionError(null);
  }, [selectedId]);

  const dirty = Boolean(selected) && (editSubject !== selected!.subject || editBody !== selected!.body);

  useEffect(() => {
    onDirtyChange(dirty);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { onDirtyChange(false); window.removeEventListener("beforeunload", warn); };
  }, [dirty, onDirtyChange]);
  const recipientValid = EMAIL_RE.test(recipient.trim());
  const allowlisted = status.settings.allowedRecipients
    .map((r) => r.trim().toLowerCase())
    .includes(recipient.trim().toLowerCase());
  const showAutoSend = status.settings.autoSend && recipientValid && allowlisted;

  function updateDraftInList(next: GmailDraft) {
    setDrafts((prev) => {
      const exists = prev.some((d) => d.id === next.id);
      return exists ? prev.map((d) => (d.id === next.id ? next : d)) : [next, ...prev];
    });
    setSelectedId(next.id);
    setEditSubject(next.subject);
    setEditBody(next.body);
  }

  async function generate() {
    if (generating || !recipientValid || brief.trim().length < 10 || dirty || !status.voiceProfile) return;
    const key = payloadKey(recipient, subject, brief);
    if (!requestRef.current || requestRef.current.key !== key) {
      requestRef.current = { key, id: crypto.randomUUID() };
    }
    const requestId = requestRef.current.id;
    setGenerating(true);
    setGenerateError(null);
    try {
      const draft = await api.gmailCreateDraft({
        requestId,
        recipient: recipient.trim(),
        brief: brief.trim(),
        subject: subject.trim() || undefined,
        autoSend: showAutoSend,
      });
      updateDraftInList(draft);
      void api.gmailStatus().then(onStatus).catch(() => {});
      requestRef.current = null;
      setRecipient("");
      setSubject("");
      setBrief("");
    } catch (error) {
      // Keep the requestId and the form contents so an identical retry reuses it.
      setGenerateError(errorMessage(error));
    } finally {
      setGenerating(false);
    }
  }

  async function saveChanges() {
    if (!selected || savingLocal || !dirty) return;
    setSavingLocal(true);
    setActionError(null);
    try {
      const next = await api.gmailUpdateDraft({ id: selected.id, subject: editSubject, body: editBody });
      updateDraftInList(next);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSavingLocal(false);
    }
  }

  async function saveToGmail() {
    if (!selected || savingGmail || dirty) return;
    setSavingGmail(true);
    setActionError(null);
    try {
      const next = await api.gmailSaveDraft({ id: selected.id });
      updateDraftInList(next);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSavingGmail(false);
    }
  }

  async function confirmAndSend() {
    if (!selected || sending || dirty) return;
    setSending(true);
    setActionError(null);
    try {
      const next = await api.gmailSendDraft({ id: selected.id });
      updateDraftInList(next);
      setConfirmSend(false);
      void api.gmailStatus().then(onStatus).catch(() => {});
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  const isBusyStatus = selected ? BUSY_DRAFT_STATUSES.includes(selected.status) : false;
  const isUncertain = selected?.status === "uncertain";
  const isSent = selected?.status === "sent";
  const actionBusy = savingLocal || savingGmail || sending;
  const canEdit = Boolean(selected) && !isBusyStatus && !isSent && !isUncertain && !actionBusy;
  const canSaveToGmail = Boolean(selected) && !dirty && !isBusyStatus && !isSent && !isUncertain && !actionBusy;
  const canSend = Boolean(selected) && !dirty && !isBusyStatus && !isSent && !isUncertain && !actionBusy;

  return (
    <section className="gmail-panel gmail-draft-panel" id="gmail-panel-draft" role="tabpanel" aria-labelledby="gmail-tab-draft">
      <div className="gmail-draft-layout">
        <aside className="gmail-draft-list" aria-label="Drafts">
          <form
            className="gmail-generate-form"
            onSubmit={(e) => {
              e.preventDefault();
              void generate();
            }}
          >
            <h3>New draft</h3>
            {!status.voiceProfile ? <p className="gmail-notice">Learn your voice from selected sent emails first.</p> : null}
            <label>
              Recipient
              <input
                type="email"
                required
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="name@example.com"
              />
            </label>
            {recipient.trim() && !recipientValid ? (
              <p className="gmail-field-error">Enter a full email address.</p>
            ) : null}
            <label>
              Subject <span className="gmail-optional">(optional)</span>
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label>
              Instructions
              <textarea
                required
                minLength={10}
                maxLength={6000}
                rows={5}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="What should this email say?"
              />
            </label>
            {generateError ? (
              <p className="gmail-alert" role="alert">
                {generateError}
              </p>
            ) : null}
            {status.settings.autoSend && recipientValid && !allowlisted ? (
              <p className="gmail-fineprint">
                Auto-send is on, but this recipient isn't on the allowlist, so this will be a
                draft only.
              </p>
            ) : null}
            <button
              type="submit"
              className={showAutoSend ? "button gmail-danger" : "button primary"}
              disabled={generating || !recipientValid || brief.trim().length < 10 || dirty || actionBusy || !status.voiceProfile}
            >
              {generating
                ? "Generating…"
                : showAutoSend
                  ? "Generate and auto-send"
                  : "Generate draft"}
            </button>
            {showAutoSend ? (
              <p className="gmail-warning" role="alert">
                This recipient is allowlisted and auto-send is on. This message may go out
                immediately with no further review.
              </p>
            ) : null}
          </form>

          <div className="gmail-draft-index">
            <h3>Drafts</h3>
            <button type="button" disabled={dirty || actionBusy || generating} onClick={async () => {
              try {
                const result = await api.gmailDrafts(); setDrafts(result.drafts);
                const current = result.drafts.find(item => item.id === selectedId);
                if(current) { setEditSubject(current.subject); setEditBody(current.body); }
                setLoadError(null);
              } catch(error) { setLoadError(errorMessage(error)); }
            }}>Refresh drafts</button>
            {loading ? <p role="status">Loading drafts…</p> : null}
            {loadError ? (
              <p className="gmail-alert" role="alert">
                {loadError}
              </p>
            ) : null}
            {!loading && !drafts.length ? <p className="gmail-fineprint">No drafts yet.</p> : null}
            <ul>
              {drafts.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    aria-current={selectedId === d.id ? "page" : undefined}
                    disabled={actionBusy}
                    onClick={() => { if (!dirty || window.confirm("Discard your unsaved edits?")) setSelectedId(d.id); }}
                  >
                    <span className="gmail-draft-recipient">{d.recipient}</span>
                    <span className="gmail-draft-subject">{d.subject || "(no subject)"}</span>
                    <span className={`gmail-status-badge gmail-status-${d.status}`}>
                      {d.status}
                      {d.autoSent ? " · auto" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section className="gmail-draft-editor" aria-label="Draft editor">
          {!selected ? (
            <p className="gmail-empty-state">Select a draft, or generate a new one, to edit it here.</p>
          ) : (
            <>
              <header className="gmail-editor-heading">
                <div>
                  <p className="gmail-fineprint">To {selected.recipient}</p>
                  <span className={`gmail-status-badge gmail-status-${selected.status}`}>{selected.status}</span>
                </div>
                <p className="gmail-fineprint">Created {formatDate(selected.createdAt)}</p>
              </header>

              {isUncertain ? (
                <p className="gmail-alert" role="alert">
                  This operation is uncertain: FounderBrain could not verify the result.
                  Check your Gmail Sent folder or Drafts directly before
                  doing anything else here. This draft cannot be retried from this page.
                </p>
              ) : null}
              {selected.error ? (
                <p className="gmail-alert" role="alert">
                  {selected.error}
                </p>
              ) : null}

              <label className="gmail-editor-field">
                Subject
                <input
                  type="text"
                  value={editSubject}
                  disabled={!canEdit}
                  onChange={(e) => setEditSubject(e.target.value)}
                />
              </label>
              <label className="gmail-editor-field gmail-editor-body">
                Body
                <textarea
                  rows={16}
                  value={editBody}
                  disabled={!canEdit}
                  onChange={(e) => setEditBody(e.target.value)}
                />
              </label>

              {actionError ? (
                <p className="gmail-alert" role="alert">
                  {actionError}
                </p>
              ) : null}

              {dirty ? (
                <p className="gmail-notice" role="status">
                  Unsaved edits. Save changes before saving to Gmail drafts or sending.
                </p>
              ) : null}

              {confirmSend ? (
                <div className="gmail-send-preview" role="alertdialog" aria-label="Confirm send">
                  <h3>Confirm before sending</h3>
                  <dl>
                    <div>
                      <dt>To</dt>
                      <dd>{selected.recipient}</dd>
                    </div>
                    <div>
                      <dt>Subject</dt>
                      <dd>{editSubject || "(no subject)"}</dd>
                    </div>
                  </dl>
                  <pre className="gmail-send-preview-body">{editBody}</pre>
                  <div className="gmail-editor-actions">
                    <button type="button" disabled={sending} onClick={() => setConfirmSend(false)}>
                      Cancel
                    </button>
                    <button type="button" className="gmail-danger" disabled={sending} onClick={confirmAndSend}>
                      {sending ? "Sending…" : "Confirm and send"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="gmail-editor-actions">
                  <button type="button" disabled={!canEdit || !dirty || savingLocal} onClick={saveChanges}>
                    {savingLocal ? "Saving…" : "Save changes"}
                  </button>
                  <button type="button" disabled={!canSaveToGmail} onClick={saveToGmail}>
                    {savingGmail ? "Saving…" : "Save to Gmail drafts"}
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={!canSend}
                    onClick={() => setConfirmSend(true)}
                  >
                    Send now
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sending controls
// ---------------------------------------------------------------------------

function SendingControlsPanel({
  api,
  status,
  onStatus,
  onDirtyChange,
}: {
  api: GmailClient;
  status: GmailStatus;
  onStatus: (s: GmailStatus) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [autoSend, setAutoSend] = useState(status.settings.autoSend);
  const [recipients, setRecipients] = useState<string[]>(status.settings.allowedRecipients);
  const [newRecipient, setNewRecipient] = useState("");
  const [dailyLimit, setDailyLimit] = useState(status.settings.dailyLimit);
  const [confirmTurnOn, setConfirmTurnOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    autoSend !== status.settings.autoSend ||
    dailyLimit !== status.settings.dailyLimit ||
    recipients.length !== status.settings.allowedRecipients.length ||
    recipients.some((r, i) => r !== status.settings.allowedRecipients[i]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const needsConfirmation = autoSend && !confirmTurnOn;

  function addRecipient() {
    const value = newRecipient.trim().toLowerCase();
    if (!value || !EMAIL_RE.test(value)) return;
    if (recipients.includes(value)) return;
    if (recipients.length >= MAX_ALLOWED_RECIPIENTS) return;
    setRecipients((prev) => [...prev, value]);
    setNewRecipient("");
  }

  function removeRecipient(value: string) {
    setRecipients((prev) => prev.filter((r) => r !== value));
  }

  async function save() {
    if (saving || !dirty || needsConfirmation) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const next = await api.gmailSettings({
        autoSend,
        allowedRecipients: recipients,
        dailyLimit,
        confirmed: autoSend ? confirmTurnOn : false,
      });
      onStatus(next);
      setAutoSend(next.settings.autoSend);
      setRecipients(next.settings.allowedRecipients);
      setDailyLimit(next.settings.dailyLimit);
      setConfirmTurnOn(false);
      setSaved(true);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="gmail-panel gmail-sending" id="gmail-panel-sending" role="tabpanel" aria-labelledby="gmail-tab-sending">
      <p className="gmail-fineprint">
        This page never watches your inbox and never auto-replies. Automatic sending, if you turn
        it on, only applies to newly generated messages on this page, and only to the exact email
        addresses you allowlist below.
      </p>

      <div className="gmail-quota">
        <span>
          Daily send slots used (UTC): {status.sentToday} / {status.settings.dailyLimit}
        </span>
      </div>

      <label className="gmail-autosend-toggle">
        <input type="checkbox" checked={autoSend} disabled={saving} onChange={(e) => { setAutoSend(e.target.checked); setConfirmTurnOn(false); }} />
        Allow automatic sending for newly generated, allowlisted messages
      </label>

      {autoSend && dirty ? (
        <div className="gmail-warning-block" role="alert">
          <p>
            Turning this on means messages generated on this page, to an allowlisted recipient,
            can be sent by FounderBrain without you reviewing them first.
          </p>
          <label>
            <input type="checkbox" checked={confirmTurnOn} onChange={(e) => setConfirmTurnOn(e.target.checked)} />
            I understand and want to allow automatic sending.
          </label>
        </div>
      ) : null}

      <fieldset disabled={saving}>
        <legend>Allowed recipients (up to {MAX_ALLOWED_RECIPIENTS})</legend>
        <div className="gmail-recipient-input">
          <input
            type="email"
            value={newRecipient}
            placeholder="name@example.com"
            onChange={(e) => setNewRecipient(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRecipient();
              }
            }}
          />
          <button type="button" onClick={addRecipient} disabled={recipients.length >= MAX_ALLOWED_RECIPIENTS}>
            Add
          </button>
        </div>
        {recipients.length === 0 ? (
          <p className="gmail-fineprint">No allowlisted recipients yet. Auto-send cannot fire without one.</p>
        ) : (
          <ul className="gmail-recipient-chips">
            {recipients.map((r) => (
              <li key={r}>
                <span>{r}</span>
                <button type="button" aria-label={`Remove ${r}`} onClick={() => removeRecipient(r)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <label className="gmail-daily-limit">
        Daily send cap
        <input
          type="number"
          min={1}
          max={20}
          value={dailyLimit}
          disabled={saving}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value)) setDailyLimit(Math.min(20, Math.max(1, Math.round(value))));
          }}
        />
      </label>

      {saveError ? (
        <p className="gmail-alert" role="alert">
          {saveError}
        </p>
      ) : null}
      {saved && !dirty ? (
        <p className="gmail-notice" role="status">
          Settings saved.
        </p>
      ) : null}

      <button
        type="button"
        className="button primary"
        disabled={!dirty || saving || needsConfirmation || (autoSend && recipients.length === 0)}
        onClick={save}
      >
        {saving ? "Saving…" : "Save sending controls"}
      </button>
    </section>
  );
}
