/**
 * Media for the 30 pieces. Two options:
 *   1. Upload your own photos and clips (stored privately in the media bucket).
 *   2. Make them with Higgsfield using the founder's own key.
 * The provider holds the list and polls Higgsfield jobs until they land in the bucket.
 *
 * The library shows each file on its own: still uploading, saved, or not confirmed.
 * Saved files can be attached to a specific post.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError, type FounderBrainApi } from "../api";
import { videoLengthError } from "../lib/video-length";
import type { HiggsfieldStatus, MediaItem } from "../types";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type MediaPost = { n: number; text: string };

type UploadJob = {
  key: string;
  name: string;
  size: number;
  pct: number;
  phase: "waiting" | "uploading" | "saving" | "failed";
  pieceN: number | null;
  error?: string;
  itemId?: string;
};

type MediaState = {
  items: MediaItem[];
  jobs: UploadJob[];
  names: Record<string, string>;
  higgsfield: HiggsfieldStatus;
  loaded: boolean;
  error: string;
  upload: (files: FileList | File[], pieceN: number | null) => Promise<void>;
  estimate: (kind: "image" | "video", prompt: string, pieceN: number | null) => Promise<{ usd: number; model: string; remainingUsd: number }>;
  generate: (kind: "image" | "video", prompt: string, pieceN: number | null) => Promise<void>;
  assign: (id: string, pieceN: number | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
  confirmUpload: (id: string) => Promise<void>;
  dismissJob: (key: string) => void;
  connect: (apiKey: string) => Promise<void>;
  disconnect: () => Promise<void>;
  openConnect: () => void;
};

const MediaContext = createContext<MediaState | null>(null);
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm";
const STALE_MS = 2 * 60 * 1000;

function message(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function snippet(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 90 ? `${line.slice(0, 90)}...` : line;
}

function fileLabel(item: MediaItem, names: Record<string, string>): string {
  return item.name || names[item.id] || (item.source === "higgsfield" ? `Higgsfield ${item.kind}` : `Uploaded ${item.kind}`);
}

type Tone = "saved" | "uploading" | "stuck" | "failed" | "making";

function statusOf(item: MediaItem): { label: string; tone: Tone } {
  if (item.status === "ready") return { label: "Saved", tone: "saved" };
  if (item.status === "failed") return { label: item.error ? "Didn't finish" : "Didn't finish", tone: "failed" };
  if (item.source === "higgsfield") return { label: "Making", tone: "making" };
  const age = Date.now() - new Date(item.createdAt).getTime();
  if (age > STALE_MS) return { label: "Not confirmed", tone: "stuck" };
  return { label: "Still uploading", tone: "uploading" };
}

function readVideoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const finish = (result: number | Error) => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(new Error("unreadable"));
    video.src = url;
  });
}

async function rejectLongVideo(file: File): Promise<string | null> {
  if (!file.type.startsWith("video/")) return null;
  try {
    return videoLengthError(file.name, await readVideoDuration(file));
  } catch {
    return `${file.name}: Could not read the length of this video. Trim it to 6 seconds or less and try again.`;
  }
}

function putFile(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("upload_failed"));
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.send(file);
  });
}

export function MediaProvider({ api, children }: { api: FounderBrainApi; children: ReactNode }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [higgsfield, setHiggsfield] = useState<HiggsfieldStatus>({ connected: false, hint: null, spentUsd: 0, capUsd: 50 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const polling = useRef(false);
  const chain = useRef(Promise.resolve());
  const triedConfirm = useRef(new Set<string>());

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

  const replace = useCallback((item: MediaItem) => {
    setItems((current) => {
      const rest = current.filter((x) => x.id !== item.id);
      return [item, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  const patchJob = useCallback((key: string, patch: Partial<UploadJob>) => {
    setJobs((current) => current.map((job) => (job.key === key ? { ...job, ...patch } : job)));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const active = new Set(jobs.map((job) => job.itemId).filter(Boolean));
    for (const item of items) {
      if (item.source !== "upload" || item.status !== "pending") continue;
      if (active.has(item.id) || triedConfirm.current.has(item.id)) continue;
      if (Date.now() - new Date(item.createdAt).getTime() < STALE_MS) continue;
      triedConfirm.current.add(item.id);
      void api.completeUpload(item.id).then((res) => replace(res.item)).catch(() => undefined);
    }
  }, [api, items, jobs, loaded, replace]);

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
  }, [pending, api, replace]);

  const value = useMemo<MediaState>(
    () => ({
      items,
      jobs,
      names,
      higgsfield,
      loaded,
      error,
      openConnect: () => setConnectOpen(true),
      upload(files, pieceN) {
        const batch = Array.from(files);
        if (!batch.length) return Promise.resolve();
        setError("");
        const run = chain.current.then(async () => {
          const accepted: File[] = [];
          const problems: string[] = [];
          for (const file of batch) {
            const problem = await rejectLongVideo(file);
            if (problem) problems.push(problem);
            else accepted.push(file);
          }
          if (problems.length) setError(problems.join(" "));
          if (!accepted.length) return;
          const created = accepted.map((file) => ({
            key: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            pct: 0,
            phase: "waiting" as const,
            pieceN,
          }));
          setJobs((current) => [...created, ...current]);
          for (let i = 0; i < accepted.length; i++) {
            const file = accepted[i]!;
            const job = created[i]!;
            patchJob(job.key, { phase: "uploading", pct: 0 });
            try {
              const started = await api.createUpload({
                pieceN,
                filename: file.name,
                contentType: file.type,
                size: file.size,
              });
              replace(started.item);
              setNames((current) => ({ ...current, [started.item.id]: file.name }));
              patchJob(job.key, { itemId: started.item.id });
              await putFile(started.uploadUrl, file, (pct) => patchJob(job.key, { pct }));
              patchJob(job.key, { phase: "saving", pct: 100 });
              const done = await api.completeUpload(started.item.id);
              replace(done.item);
              setJobs((current) => current.filter((row) => row.key !== job.key));
            } catch (err) {
              patchJob(job.key, {
                phase: "failed",
                error: err instanceof ApiError ? err.message : `${file.name} did not upload. Try again.`,
              });
              setError(err instanceof ApiError ? err.message : `${file.name} did not upload. Try again.`);
            }
          }
        });
        chain.current = run.catch(() => undefined);
        return run;
      },
      estimate: (kind, prompt, pieceN) => api.higgsfieldEstimate(kind, prompt, pieceN),
      async generate(kind, prompt, pieceN) {
        setError("");
        try {
          const res = await api.higgsfieldGenerate(kind, prompt, pieceN);
          replace(res.item);
          const status = await api.media();
          setHiggsfield(status.higgsfield);
        } catch (err) {
          setError(message(err));
          throw err;
        }
      },
      async assign(id, pieceN) {
        try {
          replace((await api.assignMedia(id, pieceN)).item);
        } catch (err) {
          setError(message(err));
          throw err;
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
      async confirmUpload(id) {
        try {
          replace((await api.completeUpload(id)).item);
        } catch (err) {
          setError(message(err));
        }
      },
      dismissJob(key) {
        setJobs((current) => current.filter((job) => job.key !== key));
      },
      async connect(apiKey) {
        setHiggsfield(await api.higgsfieldConnect(apiKey));
      },
      async disconnect() {
        try {
          setHiggsfield(await api.higgsfieldDisconnect());
        } catch (err) {
          setError(message(err));
        }
      },
    }),
    [api, error, higgsfield, items, jobs, loaded, names, patchJob, replace],
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

function Preview({ item }: { item: MediaItem }) {
  const [show, setShow] = useState(false);
  if (item.status === "ready" && item.url && show) {
    return item.kind === "video" ? (
      <video src={item.url} controls autoPlay preload="metadata" />
    ) : (
      <img src={item.url} alt="" />
    );
  }
  if (item.status === "ready" && item.url) {
    return (
      <button type="button" className="media-placeholder" onClick={() => setShow(true)}>
        {item.kind === "video" ? "Play" : "Show"}
      </button>
    );
  }
  const status = statusOf(item);
  return <div className="media-placeholder">{status.label}</div>;
}

function FileRow({
  item,
  posts,
  onAttach,
}: {
  item: MediaItem;
  posts: MediaPost[];
  onAttach: (item: MediaItem) => void;
}) {
  const media = useMedia()!;
  const status = statusOf(item);
  const post = posts.find((row) => row.n === item.pieceN);
  return (
    <article className="media-row">
      <Preview item={item} />
      <div className="media-row-body">
        <p className="media-row-title">{fileLabel(item, media.names)}</p>
        <p className="media-row-meta">
          {formatSize(item.sizeBytes)}
          {formatSize(item.sizeBytes) ? " · " : ""}
          {item.kind}
          {post ? ` · Piece ${post.n}` : item.pieceN ? ` · Piece ${item.pieceN}` : " · Not on a piece"}
        </p>
        <div className="media-row-actions">
          <span className={`media-pill ${status.tone}`}>{status.label}</span>
          {item.status === "ready" ? (
            <button type="button" className="typeform-external" onClick={() => onAttach(item)}>
              {item.pieceN ? `On piece ${item.pieceN}` : "Not on a piece"}
            </button>
          ) : null}
          {item.source === "upload" && item.status === "pending" ? (
            <button type="button" className="typeform-external" onClick={() => void media.confirmUpload(item.id)}>
              Check save
            </button>
          ) : null}
          <button type="button" className="quiet" onClick={() => void media.remove(item.id)}>
            Remove
          </button>
        </div>
      </div>
    </article>
  );
}

function JobRow({ job }: { job: UploadJob }) {
  const media = useMedia()!;
  const label =
    job.phase === "waiting" ? "Waiting" : job.phase === "saving" ? "Saving" : job.phase === "failed" ? "Didn't finish" : `Uploading ${job.pct}%`;
  const tone = job.phase === "failed" ? "failed" : "uploading";
  return (
    <article className="media-row">
      <div className="media-placeholder">{job.phase === "failed" ? "Failed" : `${job.pct || 0}%`}</div>
      <div className="media-row-body">
        <p className="media-row-title">{job.name}</p>
        <p className="media-row-meta">
          {formatSize(job.size)}
          {job.pieceN ? ` · Post ${job.pieceN}` : " · Not on a post yet"}
        </p>
        {job.phase === "uploading" || job.phase === "saving" ? (
          <div className="media-progress" aria-hidden="true">
            <span style={{ width: `${job.phase === "saving" ? 100 : job.pct}%` }} />
          </div>
        ) : null}
        <div className="media-row-actions">
          <span className={`media-pill ${tone}`}>{label}</span>
          {job.phase === "failed" ? (
            <button type="button" className="quiet" onClick={() => media.dismissJob(job.key)}>
              Dismiss
            </button>
          ) : null}
        </div>
        {job.error ? <p className="entry-error">{job.error}</p> : null}
      </div>
    </article>
  );
}

function AttachDialog({
  item,
  posts,
  onClose,
  onKept,
}: {
  item: MediaItem;
  posts: MediaPost[];
  onClose: () => void;
  onKept?: () => void;
}) {
  const media = useMedia()!;
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const needle = query.trim().toLowerCase();
  const shown = posts.filter((post) => {
    if (!needle) return true;
    return String(post.n).includes(needle) || post.text.toLowerCase().includes(needle);
  });

  async function choose(pieceN: number | null) {
    if (pieceN === null) {
      if (onKept) {
        onKept();
        return;
      }
      if (item.pieceN === null) {
        onClose();
        return;
      }
    }
    setSaving(true);
    try {
      await media.assign(item.id, pieceN);
      onClose();
    } catch {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="pack-modal" role="dialog" aria-modal="true" aria-label="Choose a piece" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div className="pack-card">
        <p className="eyebrow">SAVED FILE</p>
        <h2>Choose a piece</h2>
        <p>{fileLabel(item, media.names)}</p>
        <input
          className="typeform-input media-search"
          value={query}
          placeholder="Search pieces"
          aria-label="Search pieces"
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
        <div className="media-post-list">
          <button type="button" className={item.pieceN ? "media-post-pick" : "media-post-pick current"} disabled={saving} onClick={() => void choose(null)}>
            Not on a piece
            <small>{onKept ? "Keep this file off a piece and show the next one." : "Leave it off a piece."}</small>
          </button>
          {posts.length ? shown.map((post) => (
            <button
              key={post.n}
              type="button"
              className={item.pieceN === post.n ? "media-post-pick current" : "media-post-pick"}
              disabled={saving}
              onClick={() => void choose(post.n)}
            >
              Piece {post.n}
              <small>{snippet(post.text) || "No text yet"}</small>
            </button>
          )) : (
            <p className="media-row-meta">No pieces yet. Keep this file off a piece, or generate the 30 first.</p>
          )}
        </div>
        <div className="pack-actions">
          <button type="button" className="typeform-external" onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PickSavedDialog({
  n,
  files,
  onClose,
}: {
  n: number;
  files: MediaItem[];
  onClose: () => void;
}) {
  const media = useMedia()!;
  const [saving, setSaving] = useState(false);

  async function choose(id: string) {
    setSaving(true);
    try {
      await media.assign(id, n);
      onClose();
    } catch {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="pack-modal" role="dialog" aria-modal="true" aria-label={`Attach a saved file to post ${n}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div className="pack-card">
        <p className="eyebrow">POST {n}</p>
        <h2>Attach a saved file</h2>
        {files.length ? (
          <div className="media-post-list">
            {files.map((file) => (
              <button key={file.id} type="button" className="media-post-pick" disabled={saving} onClick={() => void choose(file.id)}>
                {fileLabel(file, media.names)}
                <small>{formatSize(file.sizeBytes) || file.kind} · Saved, not on a post</small>
              </button>
            ))}
          </div>
        ) : (
          <p>Every saved file is already on a post, or nothing has finished uploading yet.</p>
        )}
        <div className="pack-actions">
          <button type="button" className="typeform-external" onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function LooseStepper({ posts }: { posts: MediaPost[] }) {
  const media = useMedia()!;
  const loose = media.items.filter((item) => item.status === "ready" && item.pieceN === null);
  const [cursor, setCursor] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [attach, setAttach] = useState<MediaItem | null>(null);
  const [note, setNote] = useState("");
  const queue = loose.filter((item) => !skipped.includes(item.id));
  const place = queue.length ? Math.min(cursor, queue.length - 1) : 0;
  const item = queue[place];

  if (!loose.length) {
    return <p className="media-row-meta">No files waiting. Upload a photo, or a clip of 6 seconds or less.</p>;
  }
  if (!item) {
    return <p className="media-row-meta">Those files stay off a piece. Upload another, or move through the pieces below.</p>;
  }

  return (
    <div className="media-step">
      <p className="media-subhead">File {place + 1} of {queue.length}. One file at a time, so the page does not load every clip.</p>
      {note ? <p className="entry-lede" role="status">{note}</p> : null}
      <article className="media-row">
        <Preview item={item} />
        <div className="media-row-body">
          <p className="media-row-title">{fileLabel(item, media.names)}</p>
          <p className="media-row-meta">{[formatSize(item.sizeBytes), item.kind, "Not on a piece"].filter(Boolean).join(" · ")}</p>
          <div className="media-row-actions">
            <button type="button" className="entry-cta" onClick={() => setAttach(item)}>
              Not on a piece
            </button>
            <button type="button" className="quiet" onClick={() => void media.remove(item.id)}>
              Remove
            </button>
          </div>
        </div>
      </article>
      <div className="piece-actions">
        <button type="button" className="typeform-external" disabled={place === 0} onClick={() => { setNote(""); setCursor(place - 1); }}>
          Previous file
        </button>
        <button type="button" className="typeform-external" disabled={place >= queue.length - 1} onClick={() => { setNote(""); setCursor(place + 1); }}>
          Next file
        </button>
      </div>
      {attach ? (
        <AttachDialog
          item={attach}
          posts={posts}
          onClose={() => setAttach(null)}
          onKept={() => {
            const id = attach.id;
            setSkipped((current) => (current.includes(id) ? current : [...current, id]));
            setNote("Kept off a piece.");
            setAttach(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function MediaOptions({ posts }: { posts: MediaPost[] }) {
  const media = useMedia();
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  if (!media) return null;

  const activeIds = new Set(media.jobs.filter((job) => job.phase !== "failed").map((job) => job.itemId).filter(Boolean));
  const visible = media.items.filter((item) => !activeIds.has(item.id));
  const uploading = visible.filter((item) => item.status !== "ready");
  const saved = visible.filter((item) => item.status === "ready");
  const loose = saved.filter((item) => item.pieceN === null);

  return (
    <section className="media-options" aria-label="Photos and clips for your posts">
      <h3>Photos and clips</h3>
      <p>Each file is saved on its own. Saved files can be attached to a post. Uploads that are still moving stay marked until they finish.</p>
      <div className="media-counts" aria-live="polite">
        <span className="media-count"><strong>{saved.length}</strong> saved</span>
        <span className="media-count"><strong>{media.jobs.length + uploading.length}</strong> still uploading</span>
        <span className="media-count"><strong>{loose.length}</strong> not on a piece</span>
      </div>
      <div className="media-choice-grid">
        <div className="media-choice">
          <strong>Upload your own</strong>
          <p>Photos and clips you already have. Private to this account.</p>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void media.upload(event.target.files, null);
              event.target.value = "";
            }}
          />
          <button type="button" className="entry-cta" onClick={() => input.current?.click()}>
            Choose files
          </button>
          <small>JPG, PNG, WebP, GIF, MP4, MOV, or WebM. Videos can be up to 6 seconds. Up to 500 MB each.</small>
        </div>
        <div className="media-choice">
          <strong>Make them with Higgsfield</strong>
          {media.higgsfield.connected ? (
            <>
              <p>
                Connected with your key {media.higgsfield.hint}. ${media.higgsfield.spentUsd.toFixed(2)} of your $
                {media.higgsfield.capUsd.toFixed(0)} FounderBrain limit used.
              </p>
              <button type="button" className="typeform-external" onClick={() => void media.disconnect()}>
                Disconnect Higgsfield
              </button>
            </>
          ) : (
            <>
              <p>Use your own Higgsfield account. You pay them directly.</p>
              <button type="button" className="entry-cta" onClick={media.openConnect}>
                Connect Higgsfield
              </button>
            </>
          )}
        </div>
      </div>
      <div
        className={over ? "media-drop over" : "media-drop"}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (event.dataTransfer.files.length) void media.upload(event.dataTransfer.files, null);
        }}
      >
        Drop one photo, or a clip of 6 seconds or less. Each file is saved on its own.
      </div>
      {media.error ? <p className="entry-error" role="alert">{media.error}</p> : null}
      {media.jobs.length ? (
        <div className="media-library">
          {media.jobs.map((job) => (
            <JobRow key={job.key} job={job} />
          ))}
        </div>
      ) : null}
      <LooseStepper posts={posts} />
    </section>
  );
}

export function PieceMedia({ n, text, posts }: { n: number; text: string; posts: MediaPost[] }) {
  const media = useMedia();
  const input = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  const [attach, setAttach] = useState<MediaItem | null>(null);
  const [kind, setKind] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState(() => `Social media visual for this post: ${text.slice(0, 600)}`);
  const [quote, setQuote] = useState<{ usd: number; model: string; remainingUsd: number } | null>(null);
  const [localError, setLocalError] = useState("");
  const [working, setWorking] = useState(false);
  if (!media) return null;
  const mine = media.items.filter((item) => item.pieceN === n);
  const loose = media.items.filter((item) => item.status === "ready" && item.pieceN === null);
  const here = media.jobs.filter((job) => job.pieceN === n);

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
      {here.length || mine.length ? (
        <div className="media-library piece-attached">
          {here.map((job) => (
            <JobRow key={job.key} job={job} />
          ))}
          {mine.map((item) => (
            <FileRow key={item.id} item={item} posts={posts} onAttach={setAttach} />
          ))}
        </div>
      ) : (
        <p className="media-row-meta">No file on this post yet.</p>
      )}
      <div className="piece-actions">
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(event) => {
            if (event.target.files?.length) void media.upload(event.target.files, n);
            event.target.value = "";
          }}
        />
        <button type="button" className="typeform-external" onClick={() => input.current?.click()}>
          Upload to this post
        </button>
        <button type="button" className="typeform-external" onClick={() => setPick(true)}>
          Attach a saved file
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
            aria-label={`Describe the ${kind} for post ${n}`}
            value={prompt}
            maxLength={1500}
            onChange={(event) => {
              setPrompt(event.target.value);
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
                {working ? "Sending..." : `Make it for $${quote.usd.toFixed(quote.usd < 0.1 ? 3 : 2)}`}
              </button>
            ) : (
              <button type="button" className="entry-cta" onClick={() => void price()} disabled={working || prompt.trim().length < 3}>
                {working ? "Checking price..." : "Check the price"}
              </button>
            )}
          </div>
          {localError ? <p className="entry-error">{localError}</p> : null}
        </div>
      ) : null}
      {pick ? <PickSavedDialog n={n} files={loose} onClose={() => setPick(false)} /> : null}
      {attach ? <AttachDialog item={attach} posts={posts} onClose={() => setAttach(null)} /> : null}
    </div>
  );
}

function HiggsfieldConnect({ onClose }: { onClose: () => void }) {
  const media = useMedia()!;
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

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
      await media.connect(apiKey);
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
          <li>Go to API keys and create a key. Higgsfield shows one API key, once. Copy that whole key.</li>
          <li>Paste it below. FounderBrain checks it with a free price check, then stores it encrypted.</li>
        </ol>
        <label className="pack-label" htmlFor="hf-api-key">API key</label>
        <input
          id="hf-api-key"
          className="typeform-input"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the API key Higgsfield shows"
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
          <button type="button" className="entry-cta" onClick={() => void save()} disabled={saving || !apiKey.includes(":") || apiKey.trim().length < 17}>
            {saving ? "Checking your key..." : "Connect"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
