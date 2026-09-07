/** @jsxRuntime automatic */
/**
 * src/web/components/Composer.tsx
 *
 * WHAT IT IS
 * The box a founder types into, the paste cap that sits on it, and the attach control that
 * lets them put a document into the same message.
 *
 * WHY IT EXISTS
 * Three failures.
 *
 * The first is the context window, and it is not hypothetical. The Founder Brain asks for
 * ten to twenty samples of anything the founder has written. Twenty newsletters pasted into
 * a chat box is a real message of two hundred kilobytes, and it either blows the window or
 * gets compacted away in the middle of the interview. Section 4 calls the fix a product
 * fix: cap the paste, offer to save it as a file, and let the engine read the file with the
 * Read tool. The sample then becomes the founder's own downloadable property under rule 4,
 * and it can be re read later instead of being hoped about.
 *
 * The attach control below is the built version of that same idea, for the founder who
 * already has the file rather than a paste. A one page brief, a spreadsheet of contacts, a
 * slide deck: none of that belongs typed into a chat box either, and now it does not have to
 * be pasted at all. It becomes a file the same way, through the same door.
 *
 * THE SECOND FAILURE IS NEW, AND IT IS WHY UPLOADING MUST FINISH BEFORE SENDING CAN START.
 * The engine builds the list of files it can see when a turn opens, once, from what is
 * already stored. A file still uploading when that turn opens is a file the engine has never
 * heard of, however confidently the message names it. So Send stays off for the whole time a
 * file is in flight, not only while the message itself is being posted. The alternative, a
 * message racing an upload to the server, is a founder telling the engine to read a file that
 * is not there yet, and the failure would look exactly like the engine ignoring them.
 *
 * The third is a founder pressing send twice. The box is disabled while a send is in
 * flight and Enter is only a send when the text is not empty, so the double send that
 * produces two turns in a queue cannot start here. The server holds the real guard, a
 * unique index on the client message id.
 *
 * Enter sends and shift with Enter makes a new line, which is what every chat box a founder
 * has used already does. The hint under the box says so, because it is the one keyboard
 * rule this app has. An upload in flight does not add a second rule: Send simply does
 * nothing while one is running, the same way it already does nothing on an empty box.
 *
 * WHAT CALLS IT
 * The Thread screen.
 *
 * WHAT IT READS AND WRITES
 * Nothing itself. It calls back with text, with text to save as a file, or with a file to
 * upload, and it renders whatever that last call answers with. The network call and the
 * decision of what the answer means both belong to the caller, in lib/api.ts.
 */

import { useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactElement } from "react";
import type { Result, UploadedDocument } from "../lib/api.ts";

/**
 * Roughly fifty kilobytes, counted in characters.
 *
 * A character is not a byte, and the difference does not matter here: this is a threshold
 * for "this is an article, not a sentence", and no founder is within a factor of two of it
 * by accident.
 */
export const PASTE_CAP_CHARS = 50000;

export const PASTE_CAP_TITLE = "That is a lot of writing for a message";
export const PASTE_CAP_LINES: readonly string[] = [
  "Long pieces of writing work better as a file. We save it with your work, the engine reads it from there, and you can download it like everything else.",
  "Short messages are still the fastest way to answer a question.",
];

/**
 * What the attach control accepts. Written out here so it appears exactly once: on the
 * input's own `accept` attribute, and in the check that runs before an unreadable file ever
 * reaches the network.
 */
export const ACCEPTED_UPLOAD_EXTENSIONS: readonly string[] = [
  ".md",
  ".txt",
  ".csv",
  ".docx",
  ".xlsx",
  ".pptx",
  ".pdf",
];

/** True when the file's own name ends in something the server can read. */
export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export const ATTACH_LABEL = "Attach a file";
export const ATTACH_HINT = "Word, Excel, PowerPoint, PDF, plain text or CSV, one at a time.";
export const WRONG_FILE_TYPE = "That kind of file cannot be read yet. Send a Word, Excel, PowerPoint, PDF, text or CSV file instead.";
export const REMOVE_ATTACHMENT = "Remove";
export const TRY_AGAIN = "Try again";

/** What a founder reads while the file is on its way up, and Send is off because of it. */
export function uploadingLine(fileName: string): string {
  return `Sending ${fileName}. Send stays off until this finishes, so the engine is never told about a file before it is actually there.`;
}

export function attachedLine(name: string): string {
  return `Attached: ${name}. It will be sent with your next message.`;
}

/** `truncated` on the server's answer becomes this, plainly, rather than staying a boolean. */
export const TRUNCATED_NOTE =
  "This file was long, so only the first part of it was kept and the rest was cut.";

/** One attempt at attaching a file, and what the founder reads at each stage of it. */
export type UploadState =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading"; readonly fileName: string }
  | { readonly kind: "attached"; readonly doc: UploadedDocument }
  | { readonly kind: "failed"; readonly fileName: string; readonly text: string }
  | { readonly kind: "rejected"; readonly fileName: string };

/**
 * Whether pressing Send, or Enter, is allowed to do anything right now.
 *
 * Exported and used by the button's own `disabled` attribute as well as by `send` itself,
 * so there is exactly one place that decides this rather than two that have to agree. The
 * upload check is the load bearing one: `kind === "uploading"` is the only state that blocks
 * Send on account of the attachment, because it is the only state where the server does not
 * yet have the file a message is about to name. A failed or rejected attempt leaves the
 * composer exactly as usable as if nothing had been attached at all.
 */
export function canSend(text: string, disabled: boolean, upload: UploadState): boolean {
  if (text.trim() === "" || disabled) return false;
  if (text.length > PASTE_CAP_CHARS) return false;
  if (upload.kind === "uploading") return false;
  return true;
}

export function Composer({
  disabled,
  placeholder,
  onSend,
  onSaveAsFile,
  onUpload,
}: {
  readonly disabled: boolean;
  readonly placeholder: string;
  /**
   * `attachedName` is the stored name of the file this message is about, or null when there
   * is none. Naming it here rather than folding it into `text` keeps the composer out of the
   * business of deciding what sentence tells the engine which file is meant; that is the
   * Thread screen's job, next to the rest of what a message becomes on its way to the server.
   */
  readonly onSend: (text: string, attachedName: string | null) => void;
  readonly onSaveAsFile: (text: string) => void;
  /** Uploads one file and answers with its stored name, or with the server's own sentence. */
  readonly onUpload: (file: File) => Promise<Result<UploadedDocument>>;
}): ReactElement {
  const [text, setText] = useState("");
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  const tooLong = text.length > PASTE_CAP_CHARS;
  const uploading = upload.kind === "uploading";

  const send = (): void => {
    // An upload in flight blocks Send exactly the way an empty box already does: nothing
    // happens, the keystroke that tried is swallowed, and there is nothing to undo.
    if (!canSend(text, disabled, upload)) return;
    const attachedName = upload.kind === "attached" ? upload.doc.name : null;
    setText("");
    setUpload({ kind: "idle" });
    onSend(text.trim(), attachedName);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    // Cleared immediately, so choosing the same file a second time after a failure still
    // fires a change event.
    event.target.value = "";
    if (file === undefined) return;
    if (!hasAcceptedExtension(file.name)) {
      setUpload({ kind: "rejected", fileName: file.name });
      return;
    }
    setUpload({ kind: "uploading", fileName: file.name });
    void onUpload(file).then((result) => {
      setUpload(
        result.ok
          ? { kind: "attached", doc: result.value }
          : { kind: "failed", fileName: file.name, text: result.problem.text },
      );
    });
  };

  const clearAttachment = (): void => setUpload({ kind: "idle" });

  return (
    <div className="composer">
      {tooLong ? (
        <div className="composer-cap">
          <p className="composer-cap-title">{PASTE_CAP_TITLE}</p>
          {PASTE_CAP_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <button
            type="button"
            className="button"
            onClick={() => {
              onSaveAsFile(text);
              setText("");
            }}
          >
            Save it as a file
          </button>
        </div>
      ) : null}

      {/*
        THE PASTE CAP AND THE ATTACH CONTROL LIVE SIDE BY SIDE, ON PURPOSE. One is for
        writing that turned out too long to be a message. The other is for a founder who
        already has the file. Neither replaces the other, so both can be doing something at
        once: a founder can be told their paste is too long while a document from an earlier
        attempt still sits attached above the box.
      */}
      <div className="composer-attach">
        <label className="composer-attach-label" htmlFor="composer-attach-input">
          {ATTACH_LABEL}
        </label>
        <input
          id="composer-attach-input"
          className="composer-attach-input"
          type="file"
          accept={ACCEPTED_UPLOAD_EXTENSIONS.join(",")}
          disabled={disabled || uploading}
          onChange={onFileChosen}
        />
        <span className="composer-attach-hint">{ATTACH_HINT}</span>

        {upload.kind === "uploading" ? (
          <p className="composer-attach-status" role="status">
            {uploadingLine(upload.fileName)}
          </p>
        ) : null}

        {upload.kind === "attached" ? (
          <div className="composer-attach-done">
            <p>{attachedLine(upload.doc.name)}</p>
            {upload.doc.warnings.map((warning) => (
              <p key={warning} className="composer-attach-warning">
                {warning}
              </p>
            ))}
            {upload.doc.truncated ? <p className="composer-attach-warning">{TRUNCATED_NOTE}</p> : null}
            <button type="button" className="button button-quiet" onClick={clearAttachment}>
              {REMOVE_ATTACHMENT}
            </button>
          </div>
        ) : null}

        {upload.kind === "failed" ? (
          <div className="composer-attach-failed">
            <p>{upload.text}</p>
            <button type="button" className="button button-quiet" onClick={clearAttachment}>
              {TRY_AGAIN}
            </button>
          </div>
        ) : null}

        {upload.kind === "rejected" ? (
          <div className="composer-attach-failed">
            <p>{WRONG_FILE_TYPE}</p>
            <button type="button" className="button button-quiet" onClick={clearAttachment}>
              {TRY_AGAIN}
            </button>
          </div>
        ) : null}
      </div>

      <label className="composer-label" htmlFor="composer-text">
        Your message
      </label>
      <textarea
        id="composer-text"
        className="composer-text"
        value={text}
        placeholder={placeholder}
        rows={3}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer-row">
        <span className="composer-hint">Enter sends. Shift and Enter starts a new line.</span>
        <button type="button" className="button" onClick={send} disabled={!canSend(text, disabled, upload)}>
          Send
        </button>
      </div>
    </div>
  );
}
