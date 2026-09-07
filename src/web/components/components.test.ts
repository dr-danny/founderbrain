/// <reference types="node" />
/**
 * src/web/components/components.test.ts
 *
 * WHAT IT IS
 * The tests for the small pieces every screen is built out of.
 *
 * WHY IT EXISTS
 * Three properties in here are promises this app makes to a non-technical founder, and each
 * one is a single component away from being broken by accident.
 *
 * Nothing waits without saying what it is waiting for. `Working` takes the sentence as a
 * required prop, so a spinner with no explanation will not compile, and this test only has
 * to prove the sentence reaches the screen.
 *
 * Stopping keeps what was written, and the button says so before it is pressed. The reason
 * founders do not press stop is that they expect to lose the answer.
 *
 * A founder's own file cannot become markup. The markdown reader produces data, never HTML,
 * and this is the test that proves the whole path from a file to the screen escapes.
 *
 * WHAT IT READS AND WRITES. Nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { markup, screenText } from "../test-fixtures.ts";
import type { FileRow, Result, UploadedDocument } from "../lib/api.ts";
import { parseMarkdown } from "../lib/markdown.ts";
import { Working } from "./Working.tsx";
import { QueuedNotice } from "./QueuedNotice.tsx";
import { StopButton } from "./StopButton.tsx";
import { FileList, STATUS_WORDS } from "./FileList.tsx";
import { MarkdownView } from "./MarkdownView.tsx";
import { StepProgress } from "./StepProgress.tsx";
import {
  ACCEPTED_EXTENSIONS_LINE,
  ACCEPTED_UPLOAD_EXTENSIONS,
  ATTACH_HINT,
  ATTACH_INFO_LABEL,
  ATTACH_LABEL,
  ATTACH_STORAGE_NOTE,
  ATTACH_TRIM_NOTE,
  Composer,
  TRUNCATED_NOTE,
  TRY_AGAIN,
  WRONG_FILE_TYPE,
  attachedLine,
  canSend,
  hasAcceptedExtension,
  maxAttachSizeLine,
  uploadingLine,
} from "./Composer.tsx";
import type { UploadState } from "./Composer.tsx";
import { checkProseText } from "../../server/rules/prose.ts";

const noop = (): void => undefined;

/** An upload call the render only tests need but never expect to resolve. */
const noopUpload = (): Promise<Result<UploadedDocument>> => new Promise(() => undefined);

test("waiting always says what it is waiting for", () => {
  const text = screenText(createElement(Working, { what: "Reading your Founder Brain." }));
  assert.ok(text.includes("Reading your Founder Brain."));
  // Screen readers are told as well, because the dots say nothing to them at all.
  assert.ok(markup(createElement(Working, { what: "x" })).includes('role="status"'));
});

test("a queued founder is given a place and told their place is held", () => {
  const text = screenText(createElement(QueuedNotice, { position: 7 }));
  assert.ok(text.includes("7th in line"));
  assert.ok(text.includes("place is held"));
});

test("the stop button says what stopping does before it is pressed", () => {
  const text = screenText(createElement(StopButton, { stopping: false, onStop: noop }));
  assert.ok(text.includes("Stop"));
  assert.ok(text.includes("What is already written stays."));
});

test("a stop in flight says so rather than vanishing", () => {
  const html = markup(createElement(StopButton, { stopping: true, onStop: noop }));
  assert.ok(html.includes("Stopping"));
  assert.ok(html.includes("disabled"));
});

const ROWS: readonly FileRow[] = [
  {
    name: "founder-brain.md",
    gateLabel: "gate A",
    status: "ok",
    sizeBytes: 4184,
    changedAt: "2026-09-12T09:00:00Z",
    kind: "markdown",
    track: "both",
  },
  {
    name: "content-30.md",
    gateLabel: "gate B",
    status: "missing",
    sizeBytes: 0,
    changedAt: null,
    kind: "markdown",
    track: "both",
  },
];

test("a file a founder has made can be downloaded from its own row", () => {
  const html = markup(createElement(FileList, { rows: ROWS, timezone: "America/New_York", emptyMessage: "none" }));
  assert.ok(html.includes('href="/api/files/founder-brain.md/download"'));
});

test("a file that does not exist yet offers nothing to download, and says so", () => {
  const text = screenText(createElement(FileList, { rows: ROWS, timezone: "America/New_York", emptyMessage: "none" }));
  assert.ok(text.includes("Nothing to download yet"));
  assert.ok(!markup(createElement(FileList, { rows: [ROWS[1] as FileRow], timezone: null, emptyMessage: "none" })).includes("/download"));
});

test("a file is named as the thing they made, with the file name still shown underneath", () => {
  const text = screenText(createElement(FileList, { rows: ROWS, timezone: "America/New_York", emptyMessage: "none" }));
  assert.ok(text.includes("Your Founder Brain"));
  assert.ok(text.includes("founder-brain.md"));
});

test("the status of a file is a phrase, never a word out of a schema", () => {
  const text = screenText(createElement(FileList, { rows: ROWS, timezone: "America/New_York", emptyMessage: "none" }));
  assert.ok(text.includes(STATUS_WORDS.ok));
  assert.ok(text.includes(STATUS_WORDS.missing));
  assert.ok(!text.includes(" missing "), "the schema word itself must not reach the screen");
});

test("an empty list explains itself rather than showing nothing", () => {
  const text = screenText(
    createElement(FileList, { rows: [], timezone: null, emptyMessage: "You have not made anything yet." }),
  );
  assert.ok(text.includes("You have not made anything yet."));
});

test("markup inside a founder's own file is shown as text and never rendered", () => {
  const nasty = '<script>alert("x")</script>\n\n<img src=x onerror="alert(1)">';
  const html = markup(createElement(MarkdownView, { blocks: parseMarkdown(nasty) }));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"), "it is still visible to the founder, as text");
});

test("a link with a scheme we do not trust stays as text", () => {
  const html = markup(createElement(MarkdownView, { blocks: parseMarkdown("[click](javascript:alert(1))") }));
  assert.ok(!html.includes("<a "));
  const good = markup(createElement(MarkdownView, { blocks: parseMarkdown("[feed](https://example.com/f.xml)") }));
  assert.ok(good.includes('href="https://example.com/f.xml"'));
  assert.ok(good.includes('rel="noreferrer noopener"'));
});

test("the step counter is announced to a screen reader as well as drawn", () => {
  const html = markup(createElement(StepProgress, { step: 3 }));
  assert.ok(html.includes('role="progressbar"'));
  assert.ok(html.includes('aria-valuenow="3"'));
  assert.ok(html.includes('aria-valuemax="6"'));
  assert.ok(screenText(createElement(StepProgress, { step: 3 })).includes("Step 3 of 6"));
});

test("the composer says which key sends, because that is the one keyboard rule here", () => {
  const text = screenText(
    createElement(Composer, {
      disabled: false,
      placeholder: "Type your answer",
      onSend: noop,
      onSaveAsFile: noop,
      onUpload: noopUpload,
    }),
  );
  assert.ok(text.includes("Enter sends. Shift and Enter starts a new line."));
});

test("the composer is shut while an answer is arriving, so nobody sends twice", () => {
  const html = markup(
    createElement(Composer, {
      disabled: true,
      placeholder: "Waiting",
      onSend: noop,
      onSaveAsFile: noop,
      onUpload: noopUpload,
    }),
  );
  assert.ok(html.includes("disabled"));
});

// -----------------------------------------------------------------------------------------
// The attach control
//
// A found file blocking Send while it uploads is the one rule the header comment on
// Composer.tsx calls load bearing: the engine builds its file list when a turn opens, so a
// message must never reach the server before the file it names does. `canSend` is the one
// function that decides this, used by both the button's own `disabled` attribute and by
// `send` itself, so it is tested directly here rather than through a click nothing in this
// harness can simulate. Static markup has no event loop, so the render tests below can only
// prove the idle state; the state machine itself is proven against the pure function it
// shares with the component.
// -----------------------------------------------------------------------------------------
test("every extension the attach control offers is accepted, and nothing else is", () => {
  for (const ext of ACCEPTED_UPLOAD_EXTENSIONS) {
    assert.ok(hasAcceptedExtension(`sample${ext}`), `${ext} should be accepted`);
    assert.ok(hasAcceptedExtension(`SAMPLE${ext.toUpperCase()}`), `${ext} should be accepted in any case`);
  }
  for (const bad of [".exe", ".zip", ".png", ".mp4", ""]) {
    assert.ok(!hasAcceptedExtension(`sample${bad}`), `${bad || "no extension"} should be refused`);
  }
});

test("the attach button's name survives going icon only, and its popover rides along even though nothing has hovered it yet", () => {
  // Static markup has no event loop, so "hover" cannot be simulated here. What this proves
  // instead is the property a screen reader depends on: the popover's words, and the
  // paperclip's own name, are already in the document the moment the composer renders, not
  // injected only once something is hovered or focused. ATTACH_LABEL is never drawn on
  // screen now that the button lives inside the box as a bare icon, so its only appearance
  // is the visually hidden span carrying its accessible name; screenText finds it there
  // because it reads text nodes, not the CSS that clips them out of sight. That CSS is a
  // different layer, and styles.css is not read by this test.
  const text = screenText(
    createElement(Composer, {
      disabled: false,
      placeholder: "Type your answer",
      onSend: noop,
      onSaveAsFile: noop,
      onUpload: noopUpload,
    }),
  );
  assert.ok(text.includes(ATTACH_LABEL), "an icon only button still needs a name a screen reader can read");
  assert.ok(text.includes(ATTACH_HINT));
  assert.ok(text.includes(ACCEPTED_EXTENSIONS_LINE), "the popover should list every accepted extension");
});

test("the attach control lives inside the message box, in a strip under the text, not beside Send", () => {
  const html = markup(
    createElement(Composer, {
      disabled: false,
      placeholder: "Type your answer",
      onSend: noop,
      onSaveAsFile: noop,
      onUpload: noopUpload,
    }),
  );
  const boxAt = html.indexOf('class="composer-box"');
  const textareaAt = html.indexOf('id="composer-text"', boxAt);
  const stripAt = html.indexOf('class="composer-attach-strip"', boxAt);
  const attachAt = html.indexOf("composer-attach-button", boxAt);
  const rowAt = html.indexOf('class="composer-row"');
  const sendAt = html.indexOf(">Send<");
  assert.ok(boxAt > -1, "the message box should exist");
  assert.ok(
    textareaAt > boxAt && stripAt > textareaAt,
    "the text comes first inside the box, the attach strip second, so a long message grows the box rather than running under the paperclip",
  );
  assert.ok(
    attachAt > stripAt && attachAt < rowAt,
    "the paperclip belongs to the strip inside the box, not to the row Send lives in",
  );
  assert.ok(sendAt > rowAt, "Send stays exactly where it was, in its own row below the box");
});

test("the file input is hidden from view but not from a keyboard or a screen reader", () => {
  const html = markup(
    createElement(Composer, {
      disabled: false,
      placeholder: "Type your answer",
      onSend: noop,
      onSaveAsFile: noop,
      onUpload: noopUpload,
    }),
  );
  // `display:none` and `visibility:hidden` both take an element out of the accessibility
  // tree; a class that only clips it out of view does not, so the input is styled off
  // screen with a class rather than either of those.
  assert.ok(!html.includes("display:none") && !html.includes("display: none"));
  assert.ok(!html.includes("visibility:hidden") && !html.includes("visibility: hidden"));
  assert.ok(html.includes('class="composer-attach-input visually-hidden"'));
  assert.ok(html.includes('type="file"'));
});

test("the popover is associated with the attach control so a screen reader announces it, and reads as a description rather than a dialog", () => {
  const html = markup(
    createElement(Composer, {
      disabled: false,
      placeholder: "Type your answer",
      onSend: noop,
      onSaveAsFile: noop,
      onUpload: noopUpload,
    }),
  );
  assert.ok(html.includes('id="composer-attach-popover"'));
  assert.ok(html.includes('aria-describedby="composer-attach-popover"'));
  assert.ok(html.includes('role="tooltip"'), "a tooltip describes the control next to it; it must not read as a dialog with its own task");
  assert.ok(html.includes(ATTACH_INFO_LABEL), "a touchscreen has no hover, so a labelled toggle must open the same popover on a tap");
});

test("the popover explains what happens to an attached file, not only what it accepts", () => {
  // A founder who does not know an attached file becomes their own saved document, still
  // readable in a later message, cannot use the feature properly; nothing else on screen
  // says this, so it has to be here.
  const text = screenText(
    createElement(Composer, {
      disabled: false,
      placeholder: "Type your answer",
      onSend: noop,
      onSaveAsFile: noop,
      onUpload: noopUpload,
    }),
  );
  assert.ok(text.includes(ATTACH_STORAGE_NOTE));
  assert.ok(text.includes(ATTACH_TRIM_NOTE));
});

test("the size limit line only appears once the server has actually said what it is", () => {
  assert.equal(maxAttachSizeLine(null), null, "nothing should be shown before the limit is known");
  assert.equal(maxAttachSizeLine(20 * 1024 * 1024), "Up to 20 MB.");
  assert.equal(maxAttachSizeLine(2.5 * 1024 * 1024), "Up to 2.5 MB.", "bytes are never shown; a founder thinks in megabytes");

  const withoutLimit = screenText(
    createElement(Composer, {
      disabled: false,
      placeholder: "Type your answer",
      onSend: noop,
      onSaveAsFile: noop,
      onUpload: noopUpload,
    }),
  );
  assert.ok(!withoutLimit.includes("MB"), "a null limit means the line is left out, not shown as a blank or a zero");

  const withLimit = screenText(
    createElement(Composer, {
      disabled: false,
      placeholder: "Type your answer",
      onSend: noop,
      onSaveAsFile: noop,
      onUpload: noopUpload,
      maxAttachmentBytes: 25 * 1024 * 1024,
    }),
  );
  assert.ok(withLimit.includes("Up to 25 MB."));
});

test("Send is blocked for exactly as long as a file is uploading, and for no other reason", () => {
  const idle: UploadState = { kind: "idle" };
  const uploading: UploadState = { kind: "uploading", fileName: "notes.docx" };
  const attached: UploadState = {
    kind: "attached",
    doc: { name: "notes.docx", sizeBytes: 100, chars: 50, warnings: [], truncated: false },
  };
  const failed: UploadState = { kind: "failed", fileName: "notes.docx", text: "We could not read that file." };
  const rejected: UploadState = { kind: "rejected", fileName: "notes.exe" };

  assert.equal(canSend("Hello", false, idle), true);
  assert.equal(canSend("Hello", false, uploading), false, "an upload in flight must block Send");
  // A failed or rejected attempt, or one that finished, leaves the composer exactly as
  // usable as if nothing had ever been attached: this is what "a failed upload leaves the
  // composer usable" actually means, and the guard has to say so for every state but one.
  assert.equal(canSend("Hello", false, attached), true);
  assert.equal(canSend("Hello", false, failed), true, "a failed upload must not lock the box");
  assert.equal(canSend("Hello", false, rejected), true, "a rejected file must not lock the box");
  // The ordinary reasons still apply on top of all of this.
  assert.equal(canSend("", false, idle), false);
  assert.equal(canSend("Hello", true, idle), false);
});

test("the sentence during an upload names the file and says why Send is off", () => {
  const line = uploadingLine("last-newsletter.docx");
  assert.ok(line.includes("last-newsletter.docx"));
  assert.ok(line.toLowerCase().includes("send"));
});

test("the sentence after a successful attach names the stored file", () => {
  assert.ok(attachedLine("last-newsletter.docx").includes("last-newsletter.docx"));
});

test("a founder is told plainly when a file was cut short, not left to read a boolean", () => {
  assert.ok(TRUNCATED_NOTE.toLowerCase().includes("cut"));
});

test("every sentence the attach control can show passes the house style rules", () => {
  const strings = [
    ATTACH_LABEL,
    ATTACH_HINT,
    ATTACH_INFO_LABEL,
    ATTACH_STORAGE_NOTE,
    ATTACH_TRIM_NOTE,
    `Files ending in ${ACCEPTED_EXTENSIONS_LINE}.`,
    maxAttachSizeLine(20 * 1024 * 1024) ?? "",
    WRONG_FILE_TYPE,
    TRY_AGAIN,
    TRUNCATED_NOTE,
    uploadingLine("last-newsletter.docx"),
    attachedLine("last-newsletter.docx"),
  ];
  for (const text of strings) {
    const result = checkProseText("composer attach copy", text);
    assert.equal(result.ok, true, `"${text}": ${result.violations.map((v) => v.code).join(", ")}`);
  }
});
