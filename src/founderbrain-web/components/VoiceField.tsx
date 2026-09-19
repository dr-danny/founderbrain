/**
 * Typeform text field with optional Web Speech dictation.
 */
import { useEffect, useRef, useState } from "react";

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder: string;
  multiline?: boolean;
  onEnter?: () => void;
}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const baseRef = useRef(value);
  baseRef.current = value;

  useEffect(() => {
    setSupported(Boolean(speechEngine()));
    return () => recRef.current?.stop();
  }, []);

  function stop() {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }

  function start() {
    const rec = speechEngine();
    if (!rec) return;
    recRef.current?.stop();
    recRef.current = rec;
    const frozen = baseRef.current.trim();
    rec.onresult = (event) => {
      let spoken = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        spoken += event.results[i]![0]!.transcript;
      }
      const next = `${frozen ? `${frozen} ` : ""}${spoken.trim()}`.slice(0, maxLength);
      onChange(next);
    };
    rec.onerror = () => stop();
    rec.onend = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  return (
    <label className="typeform-name">
      <span className="visually-hidden">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          rows={3}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
        />
      ) : (
        <input
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
        />
      )}
      {supported ? (
        <button
          className={listening ? "voice-mic on" : "voice-mic"}
          type="button"
          aria-pressed={listening}
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
    </label>
  );
}
