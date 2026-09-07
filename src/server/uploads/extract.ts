/**
 * src/server/uploads/extract.ts
 *
 * WHAT THIS IS. The one function that turns an uploaded document's bytes into plain
 * Markdown text: `extractText({ filename, bytes, limits })`. It is pure — a Buffer in,
 * a string out or a typed refusal thrown. No filesystem, no network, no database, no
 * knowledge of founders, sessions or storage. Where the bytes came from and where the
 * text goes next is entirely somebody else's job.
 *
 * WHY IT EXISTS. A founder will paste a résumé, a pitch deck, a spreadsheet of leads
 * into the chat, and the model needs the words, not the file. Every format below is
 * also a way to attack the process reading it: a docx/xlsx/pptx is a zip, and a zip
 * with a small declared size on disk can unpack to gigabytes in memory (a "zip bomb"),
 * or can name an internal part `../../etc/passwd` for a careless unzip implementation
 * to write outside its own folder. A spreadsheet can hide a sheet the founder never
 * scrolled to, and a slide deck can carry speaker notes the founder wrote for
 * themselves, never meaning either to be read by anyone else. A giant PDF can hold a
 * request open until somebody notices. None of that is hypothetical for a function
 * that runs on whatever bytes a stranger uploads, so this file is built to refuse all
 * of it: refuse rather than sanitise, refuse loudly with a plain sentence, and never
 * let a parser's own crash become an unhandled stack trace.
 *
 * WHAT CALLS IT. The upload route (somebody else's file), which reads the bytes off
 * the request, decides the limits, and owns whatever provenance header goes in front
 * of the returned text. This module adds no header of its own.
 *
 * READS  nothing but the `bytes` and `limits` it is handed.
 * WRITES nothing. It has no side effects; calling it twice on the same input produces
 *        the same result (aside from the wall clock racing `limits.timeoutMs`).
 *
 * DEPENDENCIES DELIBERATELY NOT USED. The npm `xlsx` package (a known prototype
 * pollution advisory in the npm-published build) and `exceljs` (pulls a vulnerable
 * uuid transitively) are not installed. xlsx and pptx are both zipped XML under the
 * hood, so this file reads them with `fflate` directly — one dependency already used
 * for zip safety, doing double duty, and no XML parser dependency beyond it either:
 * the XML read out of a spreadsheet or slide deck is regular and narrow enough
 * (sharedStrings, worksheets, slide text runs) that a few targeted regular
 * expressions are less risk than a general purpose XML parser with its own history of
 * entity-expansion attacks.
 */

import { unzipSync, strFromU8, type UnzipFileInfo } from 'fflate';
import * as mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** The kinds of file this module knows how to turn into text. Used for both dispatch and the unknown-extension refusal message. */
const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.csv', '.docx', '.xlsx', '.pptx', '.pdf'] as const;

/** Why extractText refused. Each one pairs with a founderText sentence at the throw site, never a generic one. */
export type ExtractRefusalReason =
  | 'unsupported-extension'
  | 'invalid-utf8'
  | 'zip-too-many-entries'
  | 'zip-too-large'
  | 'zip-path-escape'
  | 'zip-corrupt'
  | 'scanned-pdf'
  | 'timeout'
  | 'parse-failed';

/**
 * Thrown instead of returning text whenever a document cannot, or must not, be read.
 * Follows the shape of PathRefused in storage/paths.ts: a machine-readable reason next
 * to a sentence a founder — not an engineer — can act on without seeing a stack trace.
 */
export class ExtractRefused extends Error {
  readonly reason: ExtractRefusalReason;
  readonly founderText: string;

  constructor(reason: ExtractRefusalReason, founderText: string, options?: { cause?: unknown }) {
    super(`${reason}: ${founderText}`, options);
    this.name = 'ExtractRefused';
    this.reason = reason;
    this.founderText = founderText;
  }
}

/** The caps a caller must set. There is no default; a limit picked in this file could not be tuned per caller. */
export interface ExtractLimits {
  /** Total uncompressed bytes a zip based document (docx/xlsx/pptx) may expand to. Refused, not truncated — this is the zip bomb defence. */
  readonly maxUncompressedBytes: number;
  /** Internal parts a zip based document may contain. Refused, not truncated, for the same reason. */
  readonly maxEntries: number;
  /** Characters of output text. Truncated, with a note appended, never refused. */
  readonly maxChars: number;
  /** Pages read out of a PDF before the rest are silently dropped (with a warning). */
  readonly maxPages: number;
  /** Rows read per spreadsheet sheet before the rest are dropped (with a warning). */
  readonly maxRows: number;
  /** Wall clock budget for the whole call. Exceeding it is a refusal, not a truncation, because a hung parser must not hold a request open. */
  readonly timeoutMs: number;
}

/** What extractText returns on success. */
export interface ExtractResult {
  readonly text: string;
  readonly kind: 'markdown' | 'text' | 'csv' | 'docx' | 'xlsx' | 'pptx' | 'pdf';
  /** Plain sentences about content that was dropped on purpose: a hidden sheet, speaker notes, pages past the cap. Empty when nothing was dropped. */
  readonly warnings: readonly string[];
  /** True when maxChars, maxPages or maxRows cut the output short. False for everything else, including an empty document. */
  readonly truncated: boolean;
}

/**
 * Turn an uploaded document's bytes into Markdown (or, for .txt/.csv, plain text
 * carried through unchanged). Dispatches on the filename's extension, lower-cased;
 * everything else about the file — its declared MIME type, whatever a founder named
 * it — is not trusted for anything past that one decision.
 */
export async function extractText(args: {
  readonly filename: string;
  readonly bytes: Buffer;
  readonly limits: ExtractLimits;
}): Promise<ExtractResult> {
  const { filename, bytes, limits } = args;
  const ext = extensionOf(filename);

  switch (ext) {
    case '.md':
      return withTimeout(extractPlainText(bytes, 'markdown', limits), limits.timeoutMs);
    case '.txt':
      return withTimeout(extractPlainText(bytes, 'text', limits), limits.timeoutMs);
    case '.csv':
      return withTimeout(extractPlainText(bytes, 'csv', limits), limits.timeoutMs);
    case '.docx':
      return withTimeout(extractDocx(bytes, limits), limits.timeoutMs);
    case '.xlsx':
      return withTimeout(extractXlsx(bytes, limits), limits.timeoutMs);
    case '.pptx':
      return withTimeout(extractPptx(bytes, limits), limits.timeoutMs);
    case '.pdf':
      return withTimeout(extractPdf(bytes, limits), limits.timeoutMs);
    default:
      throw new ExtractRefused(
        'unsupported-extension',
        `We can only read ${SUPPORTED_EXTENSIONS.join(', ')} files right now, and "${filename}" is not one of those.`,
      );
  }
}

/** The filename's extension, lower-cased, dot included. '' when there isn't one. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return '';
  return filename.slice(dot).toLowerCase();
}

/**
 * Runs `promise` under a wall clock budget. A parser that never settles — a crafted
 * file built to make one loop forever — must not hold a founder's request open, so
 * exceeding the budget is a refusal like any other, not a hang the caller has to
 * notice on its own.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ExtractRefused(
          'timeout',
          'This file took too long to read, so we stopped rather than leave the request hanging. Try a smaller or simpler file.',
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decodes bytes as UTF-8, refusing rather than substituting replacement characters.
 * A file that isn't valid UTF-8 is not the plain text document its extension claims,
 * and silently mangling it into one hides that from everyone downstream.
 */
function decodeStrictUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (err) {
    throw new ExtractRefused(
      'invalid-utf8',
      'This file is not valid UTF-8 text, so we could not read it safely. Re-save it as plain UTF-8 text and try again.',
      { cause: err },
    );
  }
}

/** Caps `text` to `limits.maxChars`, appending a plain note and setting `truncated` when it does. Never throws — a long document is truncated, not refused. */
function capChars(
  text: string,
  kind: ExtractResult['kind'],
  limits: ExtractLimits,
  warnings: readonly string[],
): ExtractResult {
  if (text.length <= limits.maxChars) {
    return { text, kind, warnings, truncated: false };
  }
  const cut = text.slice(0, limits.maxChars);
  const note = `\n\n[cut short: this document was longer than the ${limits.maxChars.toLocaleString()} character limit we read, so the rest was not included]`;
  return { text: cut + note, kind, warnings, truncated: true };
}

async function extractPlainText(
  bytes: Buffer,
  kind: 'markdown' | 'text' | 'csv',
  limits: ExtractLimits,
): Promise<ExtractResult> {
  const text = decodeStrictUtf8(bytes);
  return capChars(text, kind, limits, []);
}

/**
 * Finishes building a result for a format that can be cut short two different ways:
 * a structural cap (pages, rows) reached before the whole document was read, and the
 * maxChars cap reached after. Both must set `truncated` and both must leave a plain
 * sentence at the end of the text saying so — `cutNotes` carries the structural ones,
 * `capChars` (called last, so it always has the final word on where the text ends)
 * carries the character one.
 */
function finalize(
  sections: readonly string[],
  kind: ExtractResult['kind'],
  limits: ExtractLimits,
  warnings: readonly string[],
  cutNotes: readonly string[],
): ExtractResult {
  const body = sections.join('\n\n');
  const withCutNotes = cutNotes.length > 0 ? `${body}\n\n${cutNotes.map((n) => `[${n}]`).join('\n')}` : body;
  const capped = capChars(withCutNotes, kind, limits, warnings);
  return cutNotes.length > 0 ? { ...capped, truncated: true } : capped;
}

// ---------------------------------------------------------------------------------
// Zip safety, shared by docx, xlsx and pptx. All three formats are a zip archive of
// XML parts, and all three attacks are the same regardless of which one is uploaded:
// too many internal parts, too many uncompressed bytes once expanded, or a part name
// built to walk out of the archive. This is checked from the zip's own central
// directory metadata (name, declared compressed and uncompressed size) BEFORE any
// bytes are inflated, so a bomb is refused for the cost of reading its table of
// contents, not for the cost of expanding it.
// ---------------------------------------------------------------------------------

/**
 * Scans every entry in a zip archive, refusing on the first sign of a zip bomb or a
 * path escape, and inflates only the entries `want` asks for. `want` is consulted
 * once per entry, with only the metadata (name, declared sizes) fflate reads out of
 * the central directory — inflating an entry happens only after `want` says yes, and
 * only after this entry's declared size has already been folded into the running
 * total below. A caller that always returns false gets a pure metadata scan: every
 * bound below is still enforced, and nothing is ever inflated. That is exactly what
 * extractDocx uses this for, because mammoth does its own unzipping and this function
 * exists to prove the archive is safe before mammoth ever sees it.
 */
function boundedUnzip(
  bytes: Buffer,
  limits: ExtractLimits,
  want: (name: string) => boolean,
): Record<string, Uint8Array> {
  let entryCount = 0;
  let totalOriginal = 0;
  try {
    return unzipSync(bytes, {
      filter(file: UnzipFileInfo): boolean {
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          throw new ExtractRefused(
            'zip-too-many-entries',
            `This file contains more than ${limits.maxEntries} internal parts, more than we will open. It may be built to exhaust memory rather than to be a real document.`,
          );
        }
        if (file.name.includes('..') || file.name.startsWith('/')) {
          throw new ExtractRefused(
            'zip-path-escape',
            'This file names an internal part in a way that tries to escape its own folder, so we refused to open it.',
          );
        }
        totalOriginal += file.originalSize;
        if (totalOriginal > limits.maxUncompressedBytes) {
          throw new ExtractRefused(
            'zip-too-large',
            `This file expands to more than the ${limits.maxUncompressedBytes.toLocaleString()} byte limit we allow once unpacked, so we refused to open it (this is what a "zip bomb" looks like from the outside).`,
          );
        }
        return want(file.name);
      },
    });
  } catch (err) {
    if (err instanceof ExtractRefused) throw err;
    throw new ExtractRefused(
      'zip-corrupt',
      'This file does not look like a valid Word, Excel or PowerPoint document, so we could not open it.',
      { cause: err },
    );
  }
}

async function extractDocx(bytes: Buffer, limits: ExtractLimits): Promise<ExtractResult> {
  // Prove the archive is safe — entries, size, names — before handing the raw bytes
  // to mammoth, which unzips again on its own and has no bound of its own to lean on.
  boundedUnzip(bytes, limits, () => false);

  let result;
  try {
    result = await mammoth.convertToMarkdown({ buffer: bytes });
  } catch (err) {
    if (err instanceof ExtractRefused) throw err;
    throw new ExtractRefused(
      'parse-failed',
      'This .docx file could not be read. It may be corrupted, or saved by something other than Word.',
      { cause: err },
    );
  }
  return capChars(result.value, 'docx', limits, []);
}

// ---------------------------------------------------------------------------------
// A handful of tiny, purpose-built XML readers. Not a general XML parser: they read
// exactly the tags this file goes looking for (rows, cells, shared strings, text
// runs), in the plain non-nested form real xlsx/pptx documents use them in, and
// nothing else. A general parser would be the safer long-term choice if this file's
// scope grew; for the fixed, narrow shapes read here it is also the larger attack
// surface, for no format this file actually needs to support.
// ---------------------------------------------------------------------------------

interface XmlTag {
  readonly attrs: string;
  readonly inner: string;
}

/** Every top-level occurrence of `<tag ...>...</tag>` or self-closing `<tag .../>` in `xml`, in document order. */
function* iterTags(xml: string, tag: string): Generator<XmlTag> {
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    yield { attrs: match[1] ?? '', inner: match[2] ?? '' };
  }
}

function firstTag(xml: string, tag: string): XmlTag | undefined {
  for (const found of iterTags(xml, tag)) return found;
  return undefined;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_whole, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_whole, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&'); // last: must not re-decode entities produced by the replacements above
}

function parseAttrs(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([-:\w.]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrs)) !== null) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) out[name] = decodeXmlEntities(value);
  }
  return out;
}

// ---------------------------------------------------------------------------------
// xlsx. A workbook names its sheets, in tab order, in xl/workbook.xml, each with a
// relationship id and (for a hidden sheet) a state attribute; xl/_rels/workbook.xml.rels
// resolves that relationship id to the worksheet's actual path; xl/sharedStrings.xml
// holds the text strings every worksheet cell refers to by index rather than
// repeating inline. All three are read before any worksheet, because a worksheet's
// cells cannot be turned back into words without them.
// ---------------------------------------------------------------------------------

interface SheetMeta {
  readonly name: string;
  readonly relId: string;
  readonly hidden: boolean;
}

function parseWorkbookSheets(xml: string): SheetMeta[] {
  const out: SheetMeta[] = [];
  for (const tag of iterTags(xml, 'sheet')) {
    const attrs = parseAttrs(tag.attrs);
    const state = attrs.state ?? 'visible';
    out.push({
      name: attrs.name ?? 'Sheet',
      relId: attrs['r:id'] ?? '',
      hidden: state === 'hidden' || state === 'veryHidden',
    });
  }
  return out;
}

/** xl/_rels/workbook.xml.rels: relationship id -> target path, relative to the xl/ folder. */
function parseWorkbookRels(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of iterTags(xml, 'Relationship')) {
    const attrs = parseAttrs(tag.attrs);
    if (attrs.Id !== undefined && attrs.Target !== undefined) out[attrs.Id] = attrs.Target;
  }
  return out;
}

/** A relationship Target is relative to the folder holding the part that referenced it (xl/, for workbook.xml.rels). */
function resolveXlTarget(target: string): string {
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of iterTags(xml, 'si')) {
    let text = '';
    for (const t of iterTags(si.inner, 't')) text += decodeXmlEntities(t.inner);
    out.push(text);
  }
  return out;
}

/** One worksheet's cell values, row by row, up to `maxRows`. */
function parseWorksheetRows(
  xml: string,
  sharedStrings: readonly string[],
  maxRows: number,
): { readonly rows: string[][]; readonly truncated: boolean } {
  const rows: string[][] = [];
  let truncated = false;
  for (const row of iterTags(xml, 'row')) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const cells: string[] = [];
    for (const cell of iterTags(row.inner, 'c')) {
      const attrs = parseAttrs(cell.attrs);
      cells.push(cellText(attrs.t, cell.inner, sharedStrings));
    }
    rows.push(cells);
  }
  return { rows, truncated };
}

function cellText(type: string | undefined, inner: string, sharedStrings: readonly string[]): string {
  if (type === 'inlineStr') {
    const is = firstTag(inner, 'is');
    const t = is ? firstTag(is.inner, 't') : undefined;
    return t ? decodeXmlEntities(t.inner) : '';
  }
  const v = firstTag(inner, 'v');
  const raw = v ? decodeXmlEntities(v.inner) : '';
  if (type === 's') {
    const index = Number(raw);
    return Number.isInteger(index) ? (sharedStrings[index] ?? '') : '';
  }
  return raw;
}

function escapeTableCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderSheetMarkdown(name: string, rows: readonly (readonly string[])[]): string {
  const heading = `## ${name}`;
  const [firstRow, ...restRows] = rows;
  if (!firstRow) return `${heading}\n\n(empty sheet)`;
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const pad = (r: readonly string[]) =>
    Array.from({ length: width }, (_unused, i) => escapeTableCell(r[i] ?? ''));
  const lines = [
    `| ${pad(firstRow).join(' | ')} |`,
    `| ${pad(firstRow)
      .map(() => '---')
      .join(' | ')} |`,
    ...restRows.map((r) => `| ${pad(r).join(' | ')} |`),
  ];
  return `${heading}\n\n${lines.join('\n')}`;
}

async function extractXlsx(bytes: Buffer, limits: ExtractLimits): Promise<ExtractResult> {
  const entries = boundedUnzip(
    bytes,
    limits,
    (name) =>
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  );

  const workbookXmlBytes = entries['xl/workbook.xml'];
  if (!workbookXmlBytes) {
    throw new ExtractRefused(
      'zip-corrupt',
      'This .xlsx file has no workbook definition, so we could not tell what sheets it has.',
    );
  }
  const relsXmlBytes = entries['xl/_rels/workbook.xml.rels'];
  const sharedStringsBytes = entries['xl/sharedStrings.xml'];

  const sheets = parseWorkbookSheets(strFromU8(workbookXmlBytes));
  const rels = relsXmlBytes ? parseWorkbookRels(strFromU8(relsXmlBytes)) : {};
  const sharedStrings = sharedStringsBytes ? parseSharedStrings(strFromU8(sharedStringsBytes)) : [];

  const warnings: string[] = [];
  const cutNotes: string[] = [];
  const sections: string[] = [];
  let hiddenCount = 0;

  for (const sheet of sheets) {
    if (sheet.hidden) {
      hiddenCount += 1;
      continue;
    }
    const target = rels[sheet.relId];
    const sheetXmlBytes = target ? entries[resolveXlTarget(target)] : undefined;
    if (!sheetXmlBytes) continue; // the sheet is declared but its worksheet part did not come through the bounded scan
    const { rows, truncated } = parseWorksheetRows(strFromU8(sheetXmlBytes), sharedStrings, limits.maxRows);
    sections.push(renderSheetMarkdown(sheet.name, rows));
    if (truncated) {
      const note = `sheet "${sheet.name}" was cut off after ${limits.maxRows} rows`;
      warnings.push(note);
      cutNotes.push(note);
    }
  }

  if (hiddenCount > 0) {
    warnings.push(
      `${hiddenCount} hidden sheet${hiddenCount === 1 ? ' was' : 's were'} skipped, because a founder cannot see a hidden sheet either`,
    );
  }

  return finalize(sections, 'xlsx', limits, warnings, cutNotes);
}

// ---------------------------------------------------------------------------------
// pptx. Slide text lives in ppt/slides/slideN.xml as <a:t> runs; a slide's own speaker
// notes, when present, live in a *separate* part, ppt/notesSlides/notesSlideN.xml, and
// are skipped by design — a founder's notes to themselves are not something an upload
// should hand to a model without them choosing to. Slide order is taken from the
// numeric suffix on each part's filename, which is how every simple pptx writer lays
// them out; a deck that reorders slides purely through the relationship/presentation
// part without renumbering the files would defeat this, and is out of scope here.
// ---------------------------------------------------------------------------------

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const NOTES_RE = /^ppt\/notesSlides\/notesSlide\d+\.xml$/;

function slideNumber(name: string): number {
  const match = SLIDE_RE.exec(name);
  return match?.[1] ? Number(match[1]) : 0;
}

function extractSlideText(xml: string): string {
  const runs: string[] = [];
  for (const t of iterTags(xml, 'a:t')) runs.push(decodeXmlEntities(t.inner));
  return runs.join(' ').trim();
}

async function extractPptx(bytes: Buffer, limits: ExtractLimits): Promise<ExtractResult> {
  const entries = boundedUnzip(bytes, limits, (name) => SLIDE_RE.test(name) || NOTES_RE.test(name));

  const slideNames = Object.keys(entries)
    .filter((name) => SLIDE_RE.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const notesCount = Object.keys(entries).filter((name) => NOTES_RE.test(name)).length;

  const warnings: string[] = [];
  if (notesCount > 0) {
    warnings.push(
      `speaker notes on ${notesCount} slide${notesCount === 1 ? '' : 's'} were skipped, because a founder's own notes must not silently reach a model`,
    );
  }

  const sections = slideNames.map((name) => {
    const slideBytes = entries[name];
    const text = slideBytes ? extractSlideText(strFromU8(slideBytes)) : '';
    return `## Slide ${slideNumber(name)}\n\n${text || '(no text on this slide)'}`;
  });

  return finalize(sections, 'pptx', limits, warnings, []);
}

// ---------------------------------------------------------------------------------
// pdf. pdfjs-dist's text layer only — this module has no renderer and never asks for
// one, so an image-only ("scanned") PDF yields no text from any page, which is
// refused with a sentence saying so rather than returned as an empty document.
// ---------------------------------------------------------------------------------

function loadPdf(data: Uint8Array) {
  // verbosity 0 (VerbosityLevel.ERRORS) — this module only reads text, never renders,
  // so pdfjs's routine warnings about missing font/glyph metrics are noise, not signal.
  return getDocument({ data, verbosity: 0 });
}

async function extractPdf(bytes: Buffer, limits: ExtractLimits): Promise<ExtractResult> {
  // pdfjs refuses a Node Buffer outright ("provide binary data as Uint8Array"), so a
  // plain Uint8Array view over the same memory is handed over instead — no copy.
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const task = loadPdf(data);
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    throw new ExtractRefused(
      'parse-failed',
      'This .pdf file could not be read. It may be corrupted or password protected.',
      { cause: err },
    );
  }
  try {
    const pageCount = Math.min(doc.numPages, limits.maxPages);
    const pagesTruncated = doc.numPages > limits.maxPages;
    const sections: string[] = [];
    let sawText = false;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .trim();
        if (text.length > 0) sawText = true;
        sections.push(`## Page ${pageNumber}\n\n${text || '(no text on this page)'}`);
      } finally {
        page.cleanup();
      }
    }

    if (!sawText) {
      throw new ExtractRefused(
        'scanned-pdf',
        'This looks like a scanned document made of page images rather than text, and we can only read text, not pictures. A version with a text layer, or a re-keyed copy, would work instead.',
      );
    }

    const cutNotes = pagesTruncated
      ? [`only the first ${limits.maxPages} of ${doc.numPages} pages were read; the rest were cut off`]
      : [];
    return finalize(sections, 'pdf', limits, cutNotes, cutNotes);
  } finally {
    await task.destroy();
  }
}
