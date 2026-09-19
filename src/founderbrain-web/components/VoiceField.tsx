/**
 * Typeform text field with optional Web Speech dictation.
 */
import { useEffect, useRef, useState } from "react";

<<<<<<< HEAD
const MIC_SETTINGS_URL =
  "chrome://settings/content/siteDetails?site=" +
  encodeURIComponent(window.location.origin);

/** Centered branded ask when the browser blocks the microphone (Danny, 2026-09-18). */
function MicBlockedModal({
  reason,
  onRetry,
  onClose,
}: {
  reason: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="mic-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mic-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mic-modal">
        <div className="mic-modal-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.1A5 5 0 0 0 17 11z"
            />
          </svg>
        </div>
        <h2 id="mic-modal-title">Your microphone is off</h2>
        <p>{reason}</p>
        <ol>
          <li>Click the icon at the left of the address bar.</li>
          <li>Set Microphone to Allow.</li>
          <li>Reload the page, then tap Speak.</li>
        </ol>
        <div className="mic-modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              window.open(MIC_SETTINGS_URL, "_blank");
            }}
          >
            Open browser settings
          </button>
          <button
            type="button"
            className="button primary"
            autoFocus
            onClick={() => {
              onClose();
              onRetry();
            }}
          >
            Try again
          </button>
        </div>
        <button type="button" className="mic-modal-dismiss" onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}

=======
>>>>>>> origin/main
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
<<<<<<< HEAD
  onerror: ((event: { error?: string }) => void) | null;
=======
  onerror: (() => void) | null;
>>>>>>> origin/main
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

<<<<<<< HEAD
/**
 * Real errors must reach the founder. Before 2026-09-18 every recognition
 * failure (blocked mic, no speech, network) reset state silently, so the mic
 * button looked dead. Map the known codes to one plain line each.
 */
function micHint(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone is blocked for this site. Click the icon in the address bar, allow the mic, then tap Speak again.";
    case "no-speech":
      return "No speech heard. Tap Speak and talk."
    case "audio-capture":
      return "No microphone found. Plug one in or type instead."
    case "network":
      return "The speech service is unreachable. Check your connection."
    case "aborted":
      return "";
    default:
      return "Voice input failed. Try again or type instead."
  }
}

=======
>>>>>>> origin/main
function speechEngine(): SpeechRec | null {
  const Speech =
    (window as Window & { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec })
      .SpeechRecognition ||
    (window as Window & { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
  if (!Speech) return null;
  const rec = new Speech();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  return rec;
}

export function VoiceField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  multiline = false,
  onEnter,
<<<<<<< HEAD
  serverTranscribe,
=======
>>>>>>> origin/main
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder: string;
  multiline?: boolean;
  onEnter?: () => void;
<<<<<<< HEAD
  /** Server fallback when Web Speech cannot (blob, seconds) -> transcript. */
  serverTranscribe?: (blob: Blob, seconds: number) => Promise<string>;
}) {
  const [listening, setListening] = useState(false);
  const [serverBusy, setServerBusy] = useState(false);
  const [supported, setSupported] = useState(false);
  const [hint, setHint] = useState("");
  const [blocked, setBlocked] = useState<"" | "blocked" | "no-device">("");
  const recRef = useRef<SpeechRec | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
=======
}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
>>>>>>> origin/main
  const baseRef = useRef(value);
  baseRef.current = value;

  useEffect(() => {
    setSupported(Boolean(speechEngine()));
    return () => recRef.current?.stop();
  }, []);

<<<<<<< HEAD
  // Long pre-filled answers must be visible without scrolling (Danny, 2026-09-19):
  // textareas grow to fit their content, single-line inputs shrink their font.
  useEffect(() => {
    const el = areaRef.current ?? inputRef.current;
    if (!el || typeof window === "undefined") return;
    if (el instanceof HTMLTextAreaElement) {
      const maxHeight = Math.round(window.innerHeight * 0.42);
      el.style.height = "auto";
      const fitted = Math.min(el.scrollHeight, maxHeight);
      el.style.height = `${fitted}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
      return;
    }
    el.style.fontSize = "";
    const base = parseFloat(getComputedStyle(el).fontSize);
    let probe = el.scrollWidth;
    if (probe > el.clientWidth && base > 0) {
      const next = Math.max(20, Math.floor(base * (el.clientWidth / probe)));
      el.style.fontSize = `${next}px`;
      probe = el.scrollWidth;
      if (probe > el.clientWidth) {
        el.style.fontSize = `${Math.max(20, Math.floor(next * (el.clientWidth / probe)))}px`;
      }
    }
  }, [value, multiline]);

  function stop() {
    recRef.current?.stop();
    recRef.current = null;
    if (recorderRef.current) {
      try {
        recorderRef.current.stop();
      } catch {
        /* onstop handles the rest */
      }
    } else {
      setListening(false);
    }
  }

  // Server transcription: the fallback for browsers whose Web Speech service
  // is unavailable (Aside's Chromium fails `error:network`). Records once,
  // sends the blob, appends the returned text.
  async function beginServerRecording() {
    if (!serverTranscribe) {
      setHint(micHint("network"));
      return;
    }
    setHint("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setListening(false);
        const seconds = (Date.now() - startedAt) / 1000;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        setServerBusy(true);
        try {
          const text = (await serverTranscribe(blob, seconds)).trim();
          if (text) {
            const frozen = baseRef.current.trim();
            onChange(`${frozen ? `${frozen} ` : ""}${text}`.slice(0, maxLength));
          } else {
            setHint(micHint("no-speech"));
          }
        } catch {
          setHint("Transcription failed. Try again or type instead.");
        } finally {
          setServerBusy(false);
        }
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start(250);
      setListening(true);
    } catch {
      recorderRef.current = null;
      setListening(false);
      setBlocked("blocked");
    }
=======
  function stop() {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
>>>>>>> origin/main
  }

  function start() {
    const rec = speechEngine();
<<<<<<< HEAD

    if (!rec) {
      void beginServerRecording();
      return;
    }
    recRef.current?.stop();
    recRef.current = rec;
    setHint("");
=======
    if (!rec) return;
    recRef.current?.stop();
    recRef.current = rec;
>>>>>>> origin/main
    const frozen = baseRef.current.trim();
    rec.onresult = (event) => {
      let spoken = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        spoken += event.results[i]![0]!.transcript;
      }
      const next = `${frozen ? `${frozen} ` : ""}${spoken.trim()}`.slice(0, maxLength);
      onChange(next);
    };
<<<<<<< HEAD
    rec.onerror = (event) => {
      stop();
      const code = event?.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        setHint("");
        setBlocked("blocked");
      } else if (code === "audio-capture") {
        setHint("");
        setBlocked("no-device");
      } else if ((code === "network" || code === "aborted") && serverTranscribe) {
        // This browser has no working speech service; fall back to the server.
        void beginServerRecording();
      } else {
        setHint(micHint(code));
      }
    };
=======
    rec.onerror = () => stop();
>>>>>>> origin/main
    rec.onend = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
<<<<<<< HEAD
      setHint(micHint("not-allowed"));
=======
>>>>>>> origin/main
    }
  }

  return (
    <label className="typeform-name">
      <span className="visually-hidden">{label}</span>
      {multiline ? (
        <textarea
<<<<<<< HEAD
          ref={areaRef}
=======
>>>>>>> origin/main
          value={value}
          rows={3}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
        />
      ) : (
        <input
<<<<<<< HEAD
          ref={inputRef}
=======
>>>>>>> origin/main
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && onEnter) {
              event.preventDefault();
              onEnter();
            }
          }}
<<<<<<< HEAD
          onFocus={(event) => {
            // Focus drops the caret at the end and scrolls long pre-filled text to its tail.
            // Keep the caret where it is (typing still appends) but show the start.
            const el = event.currentTarget;
            window.requestAnimationFrame(() => {
              if (el.scrollWidth > el.clientWidth) el.scrollLeft = 0;
            });
          }}
=======
>>>>>>> origin/main
        />
      )}
      {supported ? (
        <button
          className={listening ? "voice-mic on" : "voice-mic"}
          type="button"
          aria-pressed={listening}
<<<<<<< HEAD
          disabled={serverBusy}
=======
>>>>>>> origin/main
          aria-label={listening ? "Stop listening" : "Speak"}
          onClick={() => (listening ? stop() : start())}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.1A5 5 0 0 0 17 11z"
            />
          </svg>
        </button>
      ) : null}
<<<<<<< HEAD
      {hint || serverBusy ? (
        <span className="voice-hint" role="status" aria-live="polite">
          {serverBusy ? "Transcribing…" : hint}
        </span>
      ) : null}
      {blocked ? (
        <MicBlockedModal
          reason={
            blocked === "no-device"
              ? "No microphone is plugged in or available to this browser."
              : "Your browser is blocking the microphone for this site, so Speak stays silent."
          }
          onRetry={() => {
            setBlocked("");
            start();
          }}
          onClose={() => setBlocked("")}
        />
      ) : null}
=======
>>>>>>> origin/main
    </label>
  );
}
