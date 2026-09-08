/** @jsxRuntime automatic */
/**
 * src/web/components/Composer.tsx
 *
 * WHAT IT IS
 * The box a founder types into, the paste cap that sits on it, and the attach control that
 * lets them put a document into the same message.
 *
 * WHY IT EXISTS
 * Four failures.
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
 * A FOURTH FAILURE SITS IN THE CONTROL ITSELF, NOT IN WHAT IT SENDS. The first version was a
 * bare file input with a visible label above the box, and the sentence describing which
 * files it takes had nowhere to go but stay on screen, always, crowding the one thing a
 * founder looks at every time they type. It read like an unfinished form rather than part of
 * a chat composer. The fix is the paperclip every chat app already puts in the same place: a
 * small icon inside the message box itself, bottom left, in a strip of its own under the
 * text so a long message can never run underneath it. The border, radius and background that
 * used to belong to the textarea now belong to that outer box instead, and the textarea
 * inside it is borderless, so the paperclip reads as part of the box a founder types into
 * rather than a separate control bolted beside it.
 *
 * Moving the border onto the box is also why `:focus-within` is doing the job the textarea's
 * own focus ring used to do alone: typing lights the whole box, not just the text field
 * inside it, so a keyboard user never loses track of where they are. The paperclip keeps a
 * focus ring of its own on top of that, because "I am typing" and "I am on the attach
 * button" are two different places to be and must not read as the same one.
 *
 * The list of accepted types, and now several other things a founder needs to actually use
 * the feature, moved into a popover that only shows itself when someone is actually looking
 * at the button, whether that is a mouse resting on it or a keyboard tabbing onto it. A
 * mouse and a keyboard both produce a moment of attention right on the control, so hover and
 * focus both open the same popover the same way.
 *
 * Touch has neither. Worse, a tap on the attach button itself does not give anyone a moment
 * to read anything: it commits straight to opening the file chooser, the same way it always
 * did, so there is no safe instant to show a tooltip on that control at all. A second, small
 * control next to it, an information toggle that does nothing but show or hide the popover
 * on a plain tap, is what makes the same information reachable on a phone. It opens on a tap
 * and stays open until it is tapped again, or the founder moves on, because a touchscreen has
 * no hover to lose and a tap that immediately vanished would have told nobody anything.
 *
 * THE POPOVER SAYS MORE THAN THE TYPES NOW, BECAUSE A FOUNDER WHO DOES NOT KNOW WHERE A FILE
 * GOES CANNOT USE THIS PROPERLY. Nothing on screen used to say that an attached file becomes
 * a saved file in the founder's own folder, read by the engine from there, and still there
 * for a later message rather than living only inside the one it was attached to. That is the
 * one sentence in the popover doing real work; the rest, the types, the one at a time limit,
 * the size ceiling once the server has told this component what it is, and the note that a
 * long document may be trimmed, are the same facts a founder would otherwise only discover by
 * getting them wrong once.
 *
 * None of this changes what happens after a file is actually chosen. The five states below,
 * the sentence each one shows, and the rule that Send waits for an upload are exactly what
 * they were, and they are shown next to the box exactly as before: a founder does not have
 * to hover anything to read "Attached: last-newsletter.docx".
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
import type { ChangeEvent, FocusEvent, KeyboardEvent, ReactElement } from "react";
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
 * input's own `accept` attribute, in the check that runs before an unreadable file ever
 * reaches the network, and in the popover sentence a founder reads before they choose one.
 */
export const ACCEPTED_UPLOAD_EXTENSIONS: readonly string[] = [
  ".md",
  ".txt",
  ".csv",
  ".docx",
  ".xlsx",
  ".pptx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
];

/** True when the file's own name ends in something the server can read. */
export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** "a, b or c", built from a list rather than typed out, so it can never say more or less than the list does. */
function joinWithOr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  const last = items[items.length - 1] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${last}`;
}

/**
 * The sentence the popover reads out. Built from `ACCEPTED_UPLOAD_EXTENSIONS` rather than
 * written out a second time, so the day that list changes, this sentence changes with it
 * instead of quietly going stale next to `hasAcceptedExtension`.
 */
export const ACCEPTED_EXTENSIONS_LINE = joinWithOr(ACCEPTED_UPLOAD_EXTENSIONS);

/**
 * The paperclip is icon-only now that it sits inside the message box, so this is never shown
 * on screen. It is read only, as a visually hidden span under the icon, because icon-only
 * must never mean unnamed.
 */
export const ATTACH_LABEL = "Attach a file";
export const ATTACH_INFO_LABEL = "What files can I attach";
export const ATTACH_HINT = "One file at a time.";

/**
 * The one line in the popover that is not a rule so much as an explanation. A founder who
 * does not know a file becomes their own, saved, rereadable document has no way to guess it,
 * and everything else the popover says is only useful once this one is understood.
 */
export const ATTACH_STORAGE_NOTE =
  "It is saved as a file in your own folder. The engine reads it from there, so it stays available to later messages, not only this one.";

export const ATTACH_TRIM_NOTE = "A very long document may be trimmed. You will be told if that happens.";

export const WRONG_FILE_TYPE = "That kind of file cannot be read yet. Send a Word, Excel, PowerPoint, PDF, text, CSV, or image file instead.";
export const REMOVE_ATTACHMENT = "Remove";
export const TRY_AGAIN = "Try again";

/**
 * The largest file the server will take, spelled out in megabytes for a human. Bytes are
 * never shown; nobody thinks in them. Null before the server has said, and the popover
 * simply leaves the line out rather than showing a number it does not have yet.
 */
export function maxAttachSizeLine(maxBytes: number | null): string | null {
  if (maxBytes === null) return null;
  const megabytes = maxBytes / (1024 * 1024);
  const rounded = megabytes >= 10 ? Math.round(megabytes) : Math.round(megabytes * 10) / 10;
  return `Up to ${rounded} MB.`;
}

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
  maxAttachmentBytes = null,
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
  /**
   * The server's own ceiling on an upload, in bytes, or null before the caller knows it.
   * Optional, and defaulted to null, so a caller that has not wired this up yet renders a
   * popover simply missing one line rather than failing to render at all.
   */
  readonly maxAttachmentBytes?: number | null;
}): ReactElement {
  const [text, setText] = useState("");
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  // Two reasons the popover can be open, kept apart on purpose. `hoverOpen` is the transient
  // one: a mouse resting on the button, or a keyboard tabbed onto it, and it goes away the
  // instant that stops being true. `pinnedOpen` is the one a tap on the information toggle
  // sets, and it stays true until something explicit closes it, because a touch has no
  // "still resting on it" to lose. The popover shows for either reason.
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const tooLong = text.length > PASTE_CAP_CHARS;
  const uploading = upload.kind === "uploading";
  // Suppressed outright while a file is on its way up, not merely left to whatever hoverOpen
  // and pinnedOpen already hold. Clicking Attach focuses the hidden input before the file
  // dialog opens, and focus lands back on that same input the moment the dialog closes and
  // the file is chosen; without this gate the popover would reopen right on top of the
  // "Sending X..." status line, which is the one sentence explaining why Send just went off.
  const hintOpen = !uploading && (hoverOpen || pinnedOpen);
  const sizeLine = maxAttachSizeLine(maxAttachmentBytes);

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
    // Closed here, explicitly, rather than left to whatever blur eventually fires once the
    // input goes disabled. Focus returning from the file picker is what put it here in the
    // first place, and nothing about that return should reopen it.
    setHoverOpen(false);
    setPinnedOpen(false);
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

  const closePopoverIfFocusLeft = (event: FocusEvent<HTMLDivElement>): void => {
    // React reports blur before it reports where focus landed, so the popover would flash
    // shut and reopen on every hand off between the file input and the information toggle
    // without this check: close only when focus actually left the whole control, not when
    // it moved from one part of it to another.
    const next = event.relatedTarget;
    if (next !== null && event.currentTarget.contains(next)) return;
    setHoverOpen(false);
    setPinnedOpen(false);
  };

  const onAttachKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      setHoverOpen(false);
      setPinnedOpen(false);
    }
  };

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
        THE PASTE CAP AND THE ATTACH STATUS LIVE SIDE BY SIDE, ON PURPOSE. One is for
        writing that turned out too long to be a message. The other is for a founder who
        already has the file. Neither replaces the other, so both can be doing something at
        once: a founder can be told their paste is too long while a document from an earlier
        attempt still sits attached above the box.
      */}
      {upload.kind === "idle" ? null : (
        <div className="composer-attach-status-area">
          {upload.kind === "uploading" ? (
            <p className="composer-attach-status" role="status" aria-live="polite">
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
      )}

      <label className="composer-label" htmlFor="composer-text">
        Your message
      </label>
      {/*
        THE BOX ITSELF NOW CARRIES THE BORDER, RADIUS AND BACKGROUND THAT USED TO BELONG TO
        THE TEXTAREA. The textarea inside is borderless and transparent, and the attach strip
        sits below it as a second row in a column layout, not laid over the text with padding:
        a flex column reserves its own space for the strip so a long message grows the box
        instead of ever running underneath the paperclip. `position: relative` lives here
        rather than on `.composer-attach`, so the popover, positioned against this box, opens
        above the whole thing and never over text still being typed inside it.
      */}
      <div className="composer-box">
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
        <div className="composer-attach-strip">
          {/*
            THE ATTACH BUTTON, THE INFORMATION TOGGLE THAT STANDS IN FOR IT ON A TOUCHSCREEN,
            AND THE POPOVER THEY BOTH OPEN. The real `<input type="file">` is visually hidden
            rather than `display:none`, because `display:none` takes it out of the
            accessibility tree entirely: a screen reader, and a keyboard tabbing by, would
            find nothing here at all. Visually hidden keeps it exactly where a keyboard and a
            screen reader can still reach it, under a label styled to look like the button a
            sighted founder clicks. The label is icon only now that it lives inside the box,
            so its accessible name moves into a visually hidden span rather than disappearing
            with the visible word.
          */}
          <div
            className="composer-attach"
            onMouseEnter={() => setHoverOpen(true)}
            onMouseLeave={() => {
              setHoverOpen(false);
              setPinnedOpen(false);
            }}
            onBlur={closePopoverIfFocusLeft}
            onKeyDown={onAttachKeyDown}
          >
            <input
              id="composer-attach-input"
              className="composer-attach-input visually-hidden"
              type="file"
              accept={ACCEPTED_UPLOAD_EXTENSIONS.join(",")}
              disabled={disabled || uploading}
              onChange={onFileChosen}
              onFocus={() => setHoverOpen(true)}
              aria-describedby="composer-attach-popover"
            />
            <label
              htmlFor="composer-attach-input"
              className={`composer-attach-button${disabled || uploading ? " is-disabled" : ""}`}
            >
              <span className="composer-attach-icon" aria-hidden="true">
                {"\u{1F4CE}"}
              </span>
              <span className="visually-hidden">{ATTACH_LABEL}</span>
            </label>
            <button
              type="button"
              className="composer-attach-info"
              aria-expanded={pinnedOpen}
              aria-controls="composer-attach-popover"
              disabled={uploading}
              onFocus={() => setHoverOpen(true)}
              onClick={() => setPinnedOpen((open) => !open)}
            >
              <span aria-hidden="true">?</span>
              <span className="visually-hidden">{ATTACH_INFO_LABEL}</span>
            </button>
            {/*
              `role="tooltip"` rather than a dialog: this is a description of the control
              next to it, not a task with its own focusable content, so nothing inside it
              should ever trap focus or take a keypress. It stays in the document at all
              times, hidden only with opacity, so `aria-describedby` on the file input keeps
              working whether or not a founder has ever hovered or tapped anything. The list
              is short lines rather than a paragraph, in the order a founder would actually
              ask the questions: what does it take, how many at once, how big, what happens
              to it, and what happens if it is long.
            */}
            <div
              id="composer-attach-popover"
              role="tooltip"
              className={`composer-attach-popover${hintOpen ? " is-open" : ""}`}
            >
              <ul className="composer-attach-popover-list">
                <li>{`Files ending in ${ACCEPTED_EXTENSIONS_LINE}.`}</li>
                <li>{ATTACH_HINT}</li>
                {sizeLine === null ? null : <li>{sizeLine}</li>}
                <li>{ATTACH_STORAGE_NOTE}</li>
                <li>{ATTACH_TRIM_NOTE}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div className="composer-row">
        <span className="composer-hint">Enter sends. Shift and Enter starts a new line.</span>
        <button type="button" className="button" onClick={send} disabled={!canSend(text, disabled, upload)}>
          Send
        </button>
      </div>
    </div>
  );
}
