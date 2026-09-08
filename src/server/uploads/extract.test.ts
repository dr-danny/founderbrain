/**
 * src/server/uploads/extract.test.ts
 *
 * WHAT THIS IS. extract.ts under test, with every fixture built in-process — a small
 * set of XML parts zipped up with fflate, never a committed binary — so the test file
 * itself documents exactly what shape of docx/xlsx/pptx it is proving safe.
 *
 * WHY IT EXISTS. This module is the one place an uploaded stranger's bytes get parsed
 * before a founder ever sees the result, so the tests are weighted towards what it
 * refuses and what it truncates, not just what it can read. A zip bomb, a path escape,
 * a hidden sheet, a slide's speaker notes and a scanned PDF are each a way the naive
 * version of this module would have handed something it should not have. Each gets its
 * own test.
 *
 * WHAT IT CALLS. src/server/uploads/extract.ts only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { ExtractRefused, extractText, type ExtractLimits, type ExtractOutcome, type ExtractResult } from './extract.ts';

/** Unwraps an `extract` outcome, failing loudly if extractText decided to pass the bytes through instead. */
function extractedOf(outcome: ExtractOutcome): ExtractResult {
  assert.equal(outcome.action, 'extract', `expected an extracted result, got action "${outcome.action}"`);
  if (outcome.action !== 'extract') throw new Error('unreachable');
  return outcome.result;
}

/** Unwraps a `passthrough` outcome's extension, failing loudly if extractText decided to extract text instead. */
function passthroughExtOf(outcome: ExtractOutcome): string {
  assert.equal(outcome.action, 'passthrough', `expected a passthrough result, got action "${outcome.action}"`);
  if (outcome.action !== 'passthrough') throw new Error('unreachable');
  return outcome.ext;
}

/** Generous enough that nothing here trips a bound by accident, unless the test says so. */
const LIMITS: ExtractLimits = {
  maxUncompressedBytes: 10_000_000,
  maxEntries: 100,
  maxChars: 100_000,
  maxPages: 50,
  maxRows: 1000,
  timeoutMs: 5_000,
};

function buildDocx(bodyXml: string): Buffer {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${bodyXml}</w:body>` +
    '</w:document>';
  return Buffer.from(zipSync({ 'word/document.xml': strToU8(documentXml) }));
}

const WORKBOOK_RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
  '</Relationships>';

const SHARED_STRINGS =
  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">' +
  '<si><t>Name</t></si><si><t>Ada</t></si></sst>';

function sheetXml(rows: string): string {
  return (
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rows}</sheetData></worksheet>`
  );
}

/** A visible sheet with two shared-string cells, and (optionally) a second, hidden sheet. */
function buildXlsx(opts: { hidden?: boolean; extraRows?: string } = {}): Buffer {
  const workbookXml =
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    '<sheet name="Visible" sheetId="1" r:id="rId1"/>' +
    (opts.hidden ? '<sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/>' : '') +
    '</sheets></workbook>';
  const row1 = '<row r="1"><c r="A1" t="s"><v>0</v></c></row>';
  const row2 = '<row r="2"><c r="A2" t="s"><v>1</v></c></row>';
  const parts: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(WORKBOOK_RELS),
    'xl/sharedStrings.xml': strToU8(SHARED_STRINGS),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(row1 + row2 + (opts.extraRows ?? ''))),
  };
  if (opts.hidden) {
    parts['xl/worksheets/sheet2.xml'] = strToU8(sheetXml(row1));
  }
  return Buffer.from(zipSync(parts));
}

function slideXml(text: string): string {
  return (
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    `<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  );
}

const NOTES_SLIDE_XML =
  '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  '<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Remember to mention pricing</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>';

function buildPptx(opts: { slideTexts: string[]; withNotes?: boolean }): Buffer {
  const parts: Record<string, Uint8Array> = {};
  opts.slideTexts.forEach((text, i) => {
    parts[`ppt/slides/slide${i + 1}.xml`] = strToU8(slideXml(text));
  });
  if (opts.withNotes) {
    parts['ppt/notesSlides/notesSlide1.xml'] = strToU8(NOTES_SLIDE_XML);
  }
  return Buffer.from(zipSync(parts));
}

async function refusalOf(promise: Promise<unknown>): Promise<ExtractRefused> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof ExtractRefused, `expected an ExtractRefused, got ${String(err)}`);
    return err;
  }
  throw new Error('expected extractText to refuse, but it resolved');
}

describe('extractText: plain text formats', () => {
  it('reads a .md file as markdown', async () => {
    const outcome = await extractText({
      filename: 'notes.md',
      bytes: Buffer.from('# Hello\n\nWorld', 'utf8'),
      limits: LIMITS,
    });
    const result = extractedOf(outcome);
    assert.equal(result.kind, 'markdown');
    assert.equal(result.text, '# Hello\n\nWorld');
    assert.equal(result.truncated, false);
    assert.deepEqual(result.warnings, []);
  });

  it('reads a .txt file as text', async () => {
    const outcome = await extractText({
      filename: 'notes.txt',
      bytes: Buffer.from('plain text', 'utf8'),
      limits: LIMITS,
    });
    const result = extractedOf(outcome);
    assert.equal(result.kind, 'text');
    assert.equal(result.text, 'plain text');
  });

  it('reads a .csv file unchanged', async () => {
    const outcome = await extractText({
      filename: 'leads.csv',
      bytes: Buffer.from('name,email\nAda,ada@example.com', 'utf8'),
      limits: LIMITS,
    });
    const result = extractedOf(outcome);
    assert.equal(result.kind, 'csv');
    assert.equal(result.text, 'name,email\nAda,ada@example.com');
  });

  it('falls back to windows-1252 for a .txt file with Word smart quotes, instead of refusing it', async () => {
    // 0x93/0x94 are the left and right curly double quotes and 0x96 an en dash in
    // windows-1252 — invalid as UTF-8, but exactly the bytes Word on Windows writes for
    // "smart quotes" in a plain .txt save. This used to be refused as invalid-utf8; a
    // founder's real writing sample must not be turned away for it.
    const bytes = Buffer.from([
      0x93, 0x53, 0x6d, 0x61, 0x72, 0x74, 0x94, 0x20, 0x96, 0x20, 0x51, 0x75, 0x6f, 0x74, 0x65, 0x73,
    ]);
    const result = extractedOf(await extractText({ filename: 'memo.txt', bytes, limits: LIMITS }));
    assert.equal(result.text, '“Smart” – Quotes');
  });

  it('refuses an unknown extension, naming the supported kinds', async () => {
    const refused = await refusalOf(
      extractText({ filename: 'archive.rar', bytes: Buffer.from('whatever'), limits: LIMITS }),
    );
    assert.equal(refused.reason, 'unsupported-extension');
    assert.match(refused.founderText, /\.docx/);
    assert.match(refused.founderText, /\.pdf/);
    assert.match(refused.founderText, /\.png/);
  });

  it('truncates at maxChars and appends a note, without throwing', async () => {
    const result = extractedOf(
      await extractText({
        filename: 'long.txt',
        bytes: Buffer.from('abcdefghij', 'utf8'),
        limits: { ...LIMITS, maxChars: 4 },
      }),
    );
    assert.equal(result.truncated, true);
    assert.ok(result.text.startsWith('abcd'));
    assert.match(result.text, /cut short/);
  });
});

describe('extractText: .docx', () => {
  it('converts a minimal docx to markdown', async () => {
    const bytes = buildDocx('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
    const result = extractedOf(await extractText({ filename: 'letter.docx', bytes, limits: LIMITS }));
    assert.equal(result.kind, 'docx');
    assert.match(result.text, /Hello world/);
  });

  it('refuses a docx whose declared uncompressed size exceeds the bound', async () => {
    // A zip entry can declare almost any uncompressed size in its local header
    // regardless of what it actually contains; fflate's central-directory scan reads
    // that declared size before ever inflating, which is exactly what is under test.
    const bytes = Buffer.from(
      zipSync({ 'word/document.xml': strToU8('<w:document/>') }, { level: 0 }),
    );
    patchDeclaredSize(bytes, 'word/document.xml', 50_000_000);
    const refused = await refusalOf(
      extractText({ filename: 'bomb.docx', bytes, limits: { ...LIMITS, maxUncompressedBytes: 1_000_000 } }),
    );
    assert.equal(refused.reason, 'zip-too-large');
  });

  it('refuses a zip with more entries than maxEntries', async () => {
    const parts: Record<string, Uint8Array> = {};
    for (let i = 0; i < 10; i += 1) parts[`part${i}.xml`] = strToU8('<x/>');
    const bytes = Buffer.from(zipSync(parts));
    const refused = await refusalOf(
      extractText({ filename: 'many.docx', bytes, limits: { ...LIMITS, maxEntries: 5 } }),
    );
    assert.equal(refused.reason, 'zip-too-many-entries');
  });

  it("refuses a zip entry named to escape the archive ('../escape.xml')", async () => {
    const bytes = Buffer.from(zipSync({ '../escape.xml': strToU8('<x/>') }));
    const refused = await refusalOf(extractText({ filename: 'evil.docx', bytes, limits: LIMITS }));
    assert.equal(refused.reason, 'zip-path-escape');
  });
});

describe('extractText: .xlsx', () => {
  it('renders a visible sheet as a markdown pipe table', async () => {
    const bytes = buildXlsx();
    const result = extractedOf(await extractText({ filename: 'leads.xlsx', bytes, limits: LIMITS }));
    assert.equal(result.kind, 'xlsx');
    assert.match(result.text, /## Visible/);
    assert.match(result.text, /\| Name \|/);
    assert.match(result.text, /\| Ada \|/);
  });

  it('skips a hidden sheet and warns how many were skipped', async () => {
    const bytes = buildXlsx({ hidden: true });
    const result = extractedOf(await extractText({ filename: 'leads.xlsx', bytes, limits: LIMITS }));
    assert.doesNotMatch(result.text, /Hidden/);
    assert.ok(result.warnings.some((w) => /1 hidden sheet/.test(w)));
  });

  it('truncates a sheet at maxRows and marks the result truncated', async () => {
    const extraRows = Array.from(
      { length: 10 },
      (_unused, i) => `<row r="${i + 3}"><c r="A${i + 3}" t="s"><v>1</v></c></row>`,
    ).join('');
    const bytes = buildXlsx({ extraRows });
    const result = extractedOf(
      await extractText({ filename: 'leads.xlsx', bytes, limits: { ...LIMITS, maxRows: 2 } }),
    );
    assert.equal(result.truncated, true);
    assert.ok(result.warnings.some((w) => /cut off after 2 rows/.test(w)));
    assert.match(result.text, /cut off/);
  });
});

describe('extractText: .pptx', () => {
  it('renders one markdown section per slide, in order', async () => {
    const bytes = buildPptx({ slideTexts: ['First slide', 'Second slide'] });
    const result = extractedOf(await extractText({ filename: 'deck.pptx', bytes, limits: LIMITS }));
    assert.equal(result.kind, 'pptx');
    const firstAt = result.text.indexOf('First slide');
    const secondAt = result.text.indexOf('Second slide');
    assert.ok(firstAt >= 0 && secondAt > firstAt);
    assert.match(result.text, /## Slide 1/);
    assert.match(result.text, /## Slide 2/);
  });

  it('skips speaker notes and warns they were skipped', async () => {
    const bytes = buildPptx({ slideTexts: ['Only slide'], withNotes: true });
    const result = extractedOf(await extractText({ filename: 'deck.pptx', bytes, limits: LIMITS }));
    assert.doesNotMatch(result.text, /pricing/);
    assert.ok(result.warnings.some((w) => /speaker notes/.test(w)));
  });
});

describe('extractText: .pdf', () => {
  it('reads the text layer of a real PDF page', async () => {
    const bytes = buildTextPdf('Hello world');
    const result = extractedOf(await extractText({ filename: 'memo.pdf', bytes, limits: LIMITS }));
    assert.equal(result.kind, 'pdf');
    assert.match(result.text, /Hello world/);
    assert.match(result.text, /## Page 1/);
    assert.equal(result.truncated, false);
  });

  it('passes a PDF with no extractable text through as raw bytes, rather than refusing it', async () => {
    // A syntactically valid, single blank page: a real page dictionary with an empty
    // content stream and no font resources, which is what pdfjs sees for a page that
    // is really just a raster image while still opening as a well-formed PDF. Building
    // a minimal PDF by hand (rather than pulling in a scanner/rasteriser dependency)
    // keeps this fixture in-process, at the cost of only proving the "well-formed but
    // textless" branch and not "PDF that actually embeds a page image".
    const bytes = buildBlankPdf();
    const ext = passthroughExtOf(await extractText({ filename: 'scan.pdf', bytes, limits: LIMITS }));
    assert.equal(ext, '.pdf');
  });
});

describe('extractText: images (passthrough)', () => {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const JPEG_SIGNATURE = [0xff, 0xd8, 0xff, 0xe0];
  const GIF_SIGNATURE = Buffer.from('GIF89a', 'ascii');
  const WEBP_SIGNATURE = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
  ]);
  const PADDING = Buffer.from('rest of the file does not matter to the sniff', 'ascii');

  it('passes a real PNG through untouched, under its own extension', async () => {
    const bytes = Buffer.concat([Buffer.from(PNG_SIGNATURE), PADDING]);
    const ext = passthroughExtOf(await extractText({ filename: 'logo.png', bytes, limits: LIMITS }));
    assert.equal(ext, '.png');
  });

  it('passes a real JPEG through under .jpg or .jpeg, matching whichever the founder used', async () => {
    const bytes = Buffer.concat([Buffer.from(JPEG_SIGNATURE), PADDING]);
    assert.equal(passthroughExtOf(await extractText({ filename: 'photo.jpg', bytes, limits: LIMITS })), '.jpg');
    assert.equal(passthroughExtOf(await extractText({ filename: 'photo.jpeg', bytes, limits: LIMITS })), '.jpeg');
  });

  it('passes a real GIF and a real WebP through under their own extensions', async () => {
    const gifExt = passthroughExtOf(
      await extractText({ filename: 'chart.gif', bytes: Buffer.concat([GIF_SIGNATURE, PADDING]), limits: LIMITS }),
    );
    assert.equal(gifExt, '.gif');
    const webpExt = passthroughExtOf(
      await extractText({ filename: 'banner.webp', bytes: Buffer.concat([WEBP_SIGNATURE, PADDING]), limits: LIMITS }),
    );
    assert.equal(webpExt, '.webp');
  });

  it('refuses an image whose bytes do not match its claimed extension', async () => {
    // Real PNG bytes, uploaded under a .gif name — the sniff must go by the bytes, not
    // by trusting whatever the extension already claims.
    const bytes = Buffer.concat([Buffer.from(PNG_SIGNATURE), PADDING]);
    const refused = await refusalOf(extractText({ filename: 'not-really.gif', bytes, limits: LIMITS }));
    assert.equal(refused.reason, 'image-signature-mismatch');
  });

  it('refuses a HEIC photo renamed to .jpg, caught by its magic bytes rather than its extension', async () => {
    // The ISO-BMFF `ftyp` box: a 4 byte size (arbitrary, not read by the sniff), then the
    // ASCII box name "ftyp", then a 4 byte brand — "heic" is one of the common brands an
    // iPhone actually writes. This is exactly what "Photos.app > Duplicate > rename to
    // .jpg" produces: a file that looks like a JPEG by name and nothing else.
    const bytes = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypheic', 'ascii'),
      PADDING,
    ]);
    const refused = await refusalOf(extractText({ filename: 'IMG_4213.jpg', bytes, limits: LIMITS }));
    assert.equal(refused.reason, 'heic-unsupported');
    assert.match(refused.founderText, /HEIC/);
    assert.match(refused.founderText, /Most Compatible|email/i);
  });

  it('refuses a file honestly named .heic before ever reading its bytes', async () => {
    const refused = await refusalOf(
      extractText({ filename: 'IMG_4213.heic', bytes: Buffer.from('whatever'), limits: LIMITS }),
    );
    assert.equal(refused.reason, 'heic-unsupported');
    assert.match(refused.founderText, /HEIC/);
  });
});

/** A single-page PDF with a real content stream drawing `text` in the base-14 Helvetica font — no embedded font data needed. */
function buildTextPdf(text: string): Buffer {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const contentStream = `BT /F1 24 Tf 72 700 Td (${escaped}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  return assemblePdf(objects);
}

/**
 * A hand-assembled, syntactically valid single-page PDF with an empty content stream:
 * no text, no image, just enough object structure for pdfjs to open it and report zero
 * text on the one page. Good enough to exercise the "no text anywhere" refusal; not a
 * stand-in for a real scanned document (which pdfjs would also read as textless, by
 * the same code path).
 */
function buildBlankPdf(): Buffer {
  return assemblePdf([
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ]);
}

/** Wraps a list of already-formatted `N 0 obj ... endobj` bodies in a minimal single-revision PDF: header, xref table, trailer. */
function assemblePdf(objects: readonly string[]): Buffer {
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * Rewrites the uncompressed-size field of one stored (uncompressed, level 0) zip
 * entry's local file header and matching central-directory record, so the archive
 * declares a huge original size while its actual bytes stay tiny. This is what lets
 * the "refuses a zip bomb" test prove the bound is read from metadata rather than by
 * fully inflating the entry — an entry this small could not otherwise exceed any
 * realistic byte limit.
 */
function patchDeclaredSize(zipBytes: Buffer, entryName: string, declaredSize: number): void {
  const nameBytes = Buffer.from(entryName, 'utf8');
  let patchedAny = false;
  for (let i = 0; i + 4 <= zipBytes.length; i += 1) {
    const sig = zipBytes.readUInt32LE(i);
    // Local file header (0x04034b50): uncompressed size is at offset 22, name length at 26.
    if (sig === 0x04034b50) {
      const nameLen = zipBytes.readUInt16LE(i + 26);
      if (zipBytes.subarray(i + 30, i + 30 + nameLen).equals(nameBytes)) {
        zipBytes.writeUInt32LE(declaredSize, i + 22);
        patchedAny = true;
      }
    }
    // Central directory header (0x02014b50): uncompressed size is at offset 24, name length at 28.
    if (sig === 0x02014b50) {
      const nameLen = zipBytes.readUInt16LE(i + 28);
      if (zipBytes.subarray(i + 46, i + 46 + nameLen).equals(nameBytes)) {
        zipBytes.writeUInt32LE(declaredSize, i + 24);
        patchedAny = true;
      }
    }
  }
  assert.ok(patchedAny, `did not find zip headers for ${entryName} to patch`);
}
