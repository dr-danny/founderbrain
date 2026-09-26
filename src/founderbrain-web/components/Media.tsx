/**
 * Media for the 30 pieces. Two options:
 *   1. Upload your own photos and clips (stored privately in the media bucket).
 *   2. Make them with Higgsfield using the founder's own key.
 * The provider holds the list and polls Higgsfield jobs until they land in the bucket.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError, type FounderBrainApi } from "../api";
import type { HiggsfieldStatus, MediaItem } from "../types";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type MediaState = {
  items: MediaItem[];
  higgsfield: HiggsfieldStatus;
  loaded: boolean;
  error: string;
  busy: string;
  upload: (files: FileList | File[], pieceN: number | null) => Promise<void>;
  estimate: (kind: "image" | "video", prompt: string, pieceN: number | null) => Promise<{ usd: number; model: string; remainingUsd: number }>;
  generate: (kind: "image" | "video", prompt: string, pieceN: number | null) => Promise<void>;
  assign: (id: string, pieceN: number | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  connect: (keyId: string, keySecret: string) => Promise<void>;
  disconnect: () => Promise<void>;
  openConnect: () => void;
};

const MediaContext = createContext<MediaState | null>(null);
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

function message(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

export function MediaProvider({ api, children }: { api: FounderBrainApi; children: ReactNode }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [higgsfield, setHiggsfield] = useState<HiggsfieldStatus>({ connected: false, hint: null, spentUsd: 0, capUsd: 50 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const polling = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api.media();
      setItems(res.items);
      setHiggsfield(res.higgsfield);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (item: MediaItem) =>
    setItems((current) => {
      const rest = current.filter((x) => x.id !== item.id);
      return [item, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });

  // Poll Higgsfield jobs until they are copied into the bucket.
  const pending = items.filter((x) => x.source === "higgsfield" && x.status === "pending").map((x) => x.id).join(",");
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        for (const id of pending.split(",")) {
          const res = await api.refreshMedia(id);
          replace(res.item);
          if (res.item.status !== "pending") {
            const status = await api.media();
            setHiggsfield(status.higgsfield);
          }
        }
      } catch (err) {
        setError(message(err));
      } finally {
        polling.current = false;
      }
    }, 6000);
    return () => window.clearInterval(timer);
  }, [pending, api]);

  const value = useMemo<MediaState>(
    () => ({
      items,
      higgsfield,
      loaded,
      error,
      busy,
      openConnect: () => setConnectOpen(true),
      async upload(files, pieceN) {
        setError("");
        for (const file of Array.from(files)) {
          setBusy(`Uploading ${file.name}…`);
          try {
            const created = await api.createUpload({ pieceN, filename: file.name, contentType: file.type, size: file.size });
            replace(created.item);
            const put = await fetch(created.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
            if (!put.ok) throw new Error("upload_failed");
            const done = await api.completeUpload(created.item.id);
            replace(done.item);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : `${file.name} did not upload. Try again.`);
          }
        }
        setBusy("");
      },
      estimate: (kind, prompt, pieceN) => api.higgsfieldEstimate(kind, prompt, pieceN),
      async generate(kind, prompt, pieceN) {
        setError("");
        setBusy("Sending to Higgsfield…");
        try {
          const res = await api.higgsfieldGenerate(kind, prompt, pieceN);
          replace(res.item);
          const status = await api.media();
          setHiggsfield(status.higgsfield);
        } catch (err) {
          setError(message(err));
          throw err;
        } finally {
          setBusy("");
        }
      },
      async assign(id, pieceN) {
        try {
          replace((await api.assignMedia(id, pieceN)).item);
        } catch (err) {
          setError(message(err));
        }
      },
      async remove(id) {
        try {
          await api.deleteMedia(id);
          setItems((current) => current.filter((x) => x.id !== id));
        } catch (err) {
          setError(message(err));
        }
      },
      async connect(keyId, keySecret) {
        setHiggsfield(await api.higgsfieldConnect(keyId, keySecret));
      },
      async disconnect() {
        try {
          setHiggsfield(await api.higgsfieldDisconnect());
        } catch (err) {
          setError(message(err));
        }
      },
    }),
    [items, higgsfield, loaded, error, busy, api],
  );

  return (
    <MediaContext.Provider value={value}>
      {children}
      {connectOpen ? <HiggsfieldConnect onClose={() => setConnectOpen(false)} /> : null}
    </MediaContext.Provider>
  );
}

export function useMedia(): MediaState | null {
  return useContext(MediaContext);
}

function Thumb({ item, pieces }: { item: MediaItem; pieces?: number[] }) {
  const media = useMedia()!;
  return (
    <figure className="media-thumb">
      {item.status === "ready" && item.url ? (
        item.kind === "video" ? (
          <video src={item.url} controls preload="metadata" />
        ) : (
          <img src={item.url} alt={item.prompt ?? "Uploaded image"} loading="lazy" />
        )
      ) : (
        <div className="media-placeholder">
          {item.status === "pending" ? (item.source === "higgsfield" ? "Making…" : "Uploading…") : item.error ?? "Did not finish"}
        </div>
      )}
      <figcaption>
        <span>{item.source === "higgsfield" ? `Higgsfield ${item.kind}` : `Your ${item.kind}`}</span>
        {pieces ? (
          <select
            aria-label="Use for piece"
            value={item.pieceN ?? ""}
            onChange={(e) => void media.assign(item.id, e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Not on a piece</option>
            {pieces.map((n) => (
              <option key={n} value={n}>
                Piece {n}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="quiet" onClick={() => void media.remove(item.id)}>
          Remove
        </button>
      </figcaption>
    </figure>
  );
}

/** The two options, above the 30 pieces. */
export function MediaOptions({ pieces }: { pieces: number[] }) {
  const media = useMedia();
  const input = useRef<HTMLInputElement | null>(null);
  if (!media) return null;
  const loose = media.items.filter((x) => x.pieceN === null);
  return (
    <section className="media-options" aria-label="Photos and clips for your pieces">
      <h3>Photos and clips for your pieces</h3>
      <p>Most pieces need a picture or a short clip. Two ways to get them:</p>
      <div className="media-choice-grid">
        <div className="media-choice">
          <strong>1. Upload your own</strong>
          <p>Photos and clips you already have. They are stored privately for your account and only you can see them.</p>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void media.upload(e.target.files, null);
              e.target.value = "";
            }}
          />
          <button type="button" className="entry-cta" onClick={() => input.current?.click()} disabled={Boolean(media.busy)}>
            Choose files
          </button>
          <small>JPG, PNG, WebP, GIF, MP4, MOV, or WebM. Up to 500 MB each.</small>
        </div>
        <div className="media-choice">
          <strong>2. Make them with Higgsfield</strong>
          {media.higgsfield.connected ? (
            <>
              <p>
                Connected with your key {media.higgsfield.hint}. ${media.higgsfield.spentUsd.toFixed(2)} of your $
                {media.higgsfield.capUsd.toFixed(0)} FounderBrain limit used.
              </p>
              <p>Use Generate on any piece below.</p>
              <button type="button" className="typeform-external" onClick={() => void media.disconnect()}>
                Disconnect Higgsfield
              </button>
            </>
          ) : (
            <>
              <p>An AI studio that makes an image or a short video from a description. You use your own Higgsfield account and pay them directly.</p>
              <button type="button" className="entry-cta" onClick={media.openConnect}>
                Connect Higgsfield
              </button>
            </>
          )}
        </div>
      </div>
      {media.busy ? <p className="entry-lede" role="status">{media.busy}</p> : null}
      {media.error ? <p className="entry-error" role="alert">{media.error}</p> : null}
      {loose.length ? (
        <>
          <p className="media-subhead">Not on a piece yet. Pick a piece to attach each one.</p>
          <div className="media-grid">
            {loose.map((item) => (
              <Thumb key={item.id} item={item} pieces={pieces} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Media attached to one piece, with Upload and Generate. */
export function PieceMedia({ n, text }: { n: number; text: string }) {
  const media = useMedia();
  const input = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState(() => `Social media visual for this post: ${text.slice(0, 600)}`);
  const [quote, setQuote] = useState<{ usd: number; model: string; remainingUsd: number } | null>(null);
  const [localError, setLocalError] = useState("");
  const [working, setWorking] = useState(false);
  if (!media) return null;
  const mine = media.items.filter((x) => x.pieceN === n);

  async function price() {
    setLocalError("");
    setQuote(null);
    setWorking(true);
    try {
      setQuote(await media!.estimate(kind, prompt, n));
    } catch (err) {
      setLocalError(message(err));
    } finally {
      setWorking(false);
    }
  }

  async function make() {
    setLocalError("");
    setWorking(true);
    try {
      await media!.generate(kind, prompt, n);
      setOpen(false);
      setQuote(null);
    } catch (err) {
      setLocalError(message(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="piece-media">
      {mine.length ? (
        <div className="media-grid">
          {mine.map((item) => (
            <Thumb key={item.id} item={item} />
          ))}
        </div>
      ) : null}
      <div className="piece-actions">
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void media.upload(e.target.files, n);
            e.target.value = "";
          }}
        />
        <button type="button" className="typeform-external" onClick={() => input.current?.click()} disabled={Boolean(media.busy)}>
          Upload photo or clip
        </button>
        {media.higgsfield.connected ? (
          <button type="button" className="typeform-external" onClick={() => setOpen(!open)}>
            {open ? "Close" : "Generate with Higgsfield"}
          </button>
        ) : (
          <button type="button" className="typeform-external" onClick={media.openConnect}>
            Connect Higgsfield to generate
          </button>
        )}
      </div>
      {open ? (
        <div className="piece-generate">
          <div className="piece-actions" role="radiogroup" aria-label="What to make">
            <button type="button" className={kind === "image" ? "entry-cta" : "typeform-external"} onClick={() => { setKind("image"); setQuote(null); }}>
              Image
            </button>
            <button type="button" className={kind === "video" ? "entry-cta" : "typeform-external"} onClick={() => { setKind("video"); setQuote(null); }}>
              6 second video
            </button>
          </div>
          <textarea
            aria-label={`Describe the ${kind} for piece ${n}`}
            value={prompt}
            maxLength={1500}
            onChange={(e) => {
              setPrompt(e.target.value);
              setQuote(null);
            }}
          />
          {quote ? (
            <p className="entry-lede">
              {quote.model}: about ${quote.usd.toFixed(quote.usd < 0.1 ? 3 : 2)}. ${quote.remainingUsd.toFixed(2)} left of your limit. Higgsfield charges your card.
            </p>
          ) : null}
          <div className="piece-actions">
            {quote ? (
              <button type="button" className="entry-cta" onClick={() => void make()} disabled={working || quote.usd > quote.remainingUsd}>
                {working ? "Sending…" : `Make it for $${quote.usd.toFixed(quote.usd < 0.1 ? 3 : 2)}`}
              </button>
            ) : (
              <button type="button" className="entry-cta" onClick={() => void price()} disabled={working || prompt.trim().length < 3}>
                {working ? "Checking price…" : "Check the price"}
              </button>
            )}
          </div>
          {localError ? <p className="entry-error">{localError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Explains Higgsfield, what it costs, and walks through getting a key.
 *
 * Portaled straight to `document.body` (Danny/bug report, 2026-09-26): this dialog can be
 * opened from deep inside the Content typeform chapter, whose `.entry-panel` ancestor runs a
 * `both`-filled CSS animation (`entry-rise`). A `transform` from that animation never clears,
 * so it permanently becomes the containing block for any `position: fixed` descendant. That
 * blew up `.pack-modal` to the ancestor's scroll height (thousands of px tall) instead of the
 * viewport, leaving founders staring at a dark, empty backdrop with the real card scrolled far
 * out of view. Rendering through a portal keeps `MediaContext` (via React context, which
 * crosses portals normally) while escaping that broken containing block.
 */
function HiggsfieldConnect({ onClose }: { onClose: () => void }) {
  const media = useMedia()!;
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Initial focus lands on "Not now" (never the key fields, to keep a stray paste from
  // landing anywhere but where the founder is looking) and returns to whatever opened the
  // dialog once it closes, so keyboard and screen-reader users never lose their place.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  // Escape closes (unless a save is in flight) and Tab is trapped inside the dialog so
  // background content, which now sits at a broken scroll position, is never reachable.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (saving) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const node = dialogRef.current;
      if (!node) return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !node.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !node.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, saving]);

  async function save() {
    setSaving(true);
    setLocalError("");
    try {
      await media.connect(keyId, keySecret);
      onClose();
    } catch (err) {
      setLocalError(message(err));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="pack-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Connect Higgsfield"
      ref={dialogRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="pack-card higgsfield-card">
        <p className="eyebrow">OPTIONAL · YOUR OWN ACCOUNT</p>
        <h2>Connect Higgsfield</h2>

        <h3>What it is</h3>
        <p>
          Higgsfield is an AI studio that makes images and short videos from a written description. Once it is connected,
          each of your 30 pieces gets a Generate button that makes the picture or clip that piece needs.
        </p>

        <h3>Why use it</h3>
        <p>
          Most pieces land better with a picture or a clip. Your own photos and clips are usually the strongest, so upload
          those first. Use Higgsfield for the pieces where you have nothing to show.
        </p>

        <h3>What it costs</h3>
        <ul>
          <li>You pay Higgsfield directly, on your own account and card. FounderBrain never charges you for it.</li>
          <li>An image costs from under a cent to about 19 cents, depending on the model and size.</li>
          <li>A 6 second video costs about 28 cents at Higgsfield's list price (less while they run discounts).</li>
          <li>You see the exact price before anything is made. FounderBrain stops at $50 in total for your account.</li>
        </ul>

        <h3>How to get your key (about 5 minutes)</h3>
        <ol>
          <li>
            Open{" "}
            <a href="https://open.higgsfield.ai" target="_blank" rel="noopener noreferrer">
              open.higgsfield.ai
            </a>{" "}
            and create an account. This is the developer site. A plan on higgsfield.ai does not count.
          </li>
          <li>Go to Billing, add a card, and add a small balance. Higgsfield's Billing page shows the minimum.</li>
          <li>Go to API keys and create a key. Higgsfield shows a Key ID and a Secret once. Copy both now.</li>
          <li>Paste them below. FounderBrain checks the key with a free price check, then stores it encrypted.</li>
        </ol>

        <label className="pack-label" htmlFor="hf-key-id">Key ID</label>
        <input id="hf-key-id" className="typeform-input" value={keyId} onChange={(e) => setKeyId(e.target.value)} autoComplete="off" spellCheck={false} />
        <label className="pack-label" htmlFor="hf-key-secret">Secret</label>
        <input
          id="hf-key-secret"
          className="typeform-input"
          type="password"
          value={keySecret}
          onChange={(e) => setKeySecret(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="entry-lede">
          Your key is only used for generations you ask for on this screen. Disconnect it here any time, or delete it in
          Higgsfield.
        </p>
        {localError ? <p className="entry-error" role="alert">{localError}</p> : null}
        <div className="pack-actions">
          <button type="button" className="typeform-external" ref={closeButtonRef} onClick={onClose} disabled={saving}>
            Not now
          </button>
          <button type="button" className="entry-cta" onClick={() => void save()} disabled={saving || keyId.trim().length < 8 || keySecret.trim().length < 8}>
            {saving ? "Checking your key…" : "Connect"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
