/**
 * Northstar RV-N2 — dependency-free minimal .xlsx roster reader.
 *
 * XLSX is a ZIP container; this module parses the central directory,
 * inflates the worksheet and (optionally) sharedStrings entries with
 * node:zlib.inflateRawSync, and walks the first worksheet to extract
 * rows keyed by the header row.
 *
 * Scope: inline strings + shared strings + numeric cells (rendered as
 * strings). We deliberately do not support every XLSX cell type — correctness
 * over completeness. Anything we cannot parse is a structured failure, never
 * a guess and never a thrown exception.
 */
import { inflateRawSync } from 'node:zlib';
import { tableRowsToDrafts } from './programmeTable.ts';
import type { ProgrammeTravellerDraft } from '../contracts/programmeIntake.ts';

export type XlsxRosterResult =
  | { ok: true; drafts: ProgrammeTravellerDraft[]; unresolvedStatements: string[] }
  | { ok: false; reason: string };

// ----- ZIP -----------------------------------------------------------------

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
}

function findEocd(buf: Buffer): { offset: number } | undefined {
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return { offset: i };
  }
  return undefined;
}

function readCentralDirectory(buf: Buffer): { entries: ZipEntry[]; error?: string } {
  const eocd = findEocd(buf);
  if (!eocd) return { entries: [], error: 'eocd not found' };
  const o = eocd.offset;
  const total = buf.readUInt16LE(o + 10);
  const cdSize = buf.readUInt32LE(o + 12);
  const cdOffset = buf.readUInt32LE(o + 16);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return { entries, error: 'bad central dir signature' };
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    // Read local header to find data start.
    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      return { entries, error: 'bad local header signature' };
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    entries.push({ name, method, compressedSize, uncompressedSize, dataStart });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.length !== total) return { entries, error: 'central dir count mismatch' };
  if (p !== cdOffset + cdSize) return { entries, error: 'central dir size mismatch' };
  return { entries };
}

function inflate(buf: Buffer, entry: ZipEntry): Buffer {
  const slice = buf.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  if (entry.method === 0) return slice;
  if (entry.method === 8) return inflateRawSync(slice);
  throw new Error(`unsupported zip method ${entry.method}`);
}

// ----- XML -----------------------------------------------------------------

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function parseXml(input: string): XmlNode | undefined {
  // Find the root element (skip declarations).
  // eslint-disable-next-line no-useless-escape
  const rootMatch = /<([\w:.\-]+)([^>]*?)>([\s\S]*?)<\/\1>|<([\w:.\-]+)([^>]*?)\/>/.exec(input);
  if (!rootMatch) return undefined;
  const rootName = rootMatch[1] ?? rootMatch[4];
  const rootAttrs = rootMatch[2] ?? rootMatch[5] ?? '';
  const rootBody = rootMatch[3] ?? '';
  return parseNode(rootName!, rootAttrs, rootBody);
}

function extractAttrs(headerText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Walk the opening tag characters, never crossing a '>' so we never reach
  // children or sibling tags.
  let i = 0;
  const len = headerText.length;
  while (i < len) {
    while (i < len && /\s/.test(headerText[i]!)) i += 1;
    if (i >= len) break;
    const nameStart = i;
    while (i < len && /[\w:.-]/.test(headerText[i]!)) i += 1;
    if (i === nameStart) break;
    const name = headerText.slice(nameStart, i);
    while (i < len && /\s/.test(headerText[i]!)) i += 1;
    if (headerText[i] !== '=') {
      attrs[name] = '';
      continue;
    }
    i += 1;
    while (i < len && /\s/.test(headerText[i]!)) i += 1;
    const quote = headerText[i];
    if (quote !== '"' && quote !== "'") {
      attrs[name] = '';
      continue;
    }
    i += 1;
    const valStart = i;
    while (i < len && headerText[i] !== quote) i += 1;
    attrs[name] = headerText.slice(valStart, i);
    if (i < len) i += 1;
  }
  return attrs;
}

function parseNode(name: string, headerAttrs: string, body: string): XmlNode {
  const attrs = extractAttrs(headerAttrs);
  const children: XmlNode[] = [];
  let text = '';
  let cursor = 0;
  const re = /<([?!/]?)([\w:.-]+)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const start = match.index;
    text += body.slice(cursor, start);
    const lead = match[1]!;
    const tag = match[2]!;
    const attrsText = match[3] ?? '';
    const selfClose = match[4] === '/';
    if (lead === '/') {
      // Stray closing tag (parent's); skip.
      cursor = start + match[0].length;
      continue;
    }
    if (lead === '!' || lead === '?') {
      cursor = start + match[0].length;
      continue;
    }
    if (selfClose) {
      children.push(parseNode(tag, attrsText, ''));
      cursor = start + match[0].length;
      continue;
    }
    const openEnd = start + match[0].length;
    const close = `</${tag}>`;
    const closeIdx = body.indexOf(close, openEnd);
    if (closeIdx < 0) {
      // Unterminated: stop walking this node.
      cursor = body.length;
      break;
    }
    const inner = body.slice(openEnd, closeIdx);
    children.push(parseNode(tag, attrsText, inner));
    cursor = closeIdx + close.length;
    re.lastIndex = cursor;
  }
  text += body.slice(cursor);
  return { name, attrs, children, text: text.trim() };
}


// ----- Worksheet walking ---------------------------------------------------

function colToIndex(ref: string): number {
  // A=0, B=1, ... Z=25, AA=26
  let n = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const code = ref.charCodeAt(i) - 64;
    if (code < 1 || code > 26) return -1;
    n = n * 26 + code;
  }
  return n - 1;
}

function parseCellRef(ref: string): { col: number; row: number } | undefined {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return undefined;
  return { col: colToIndex(m[1]!), row: Number(m[2]) };
}

function extractSharedStrings(xml: string): string[] {
  const root = parseXml(xml);
  if (!root) return [];
  const out: string[] = [];
  for (const si of root.children) {
    if (si.name !== 'si') continue;
    // <si><t>text</t></si> or <si><r><t>text</t></r></si>
    const parts: string[] = [];
    for (const t of si.children) {
      if (t.name === 't') parts.push(t.text);
      else if (t.name === 'r') {
        for (const tt of t.children) {
          if (tt.name === 't') parts.push(tt.text);
        }
      }
    }
    out.push(parts.join(''));
  }
  return out;
}

interface SheetRow {
  cells: Map<number, string>;
}

function extractSheetRows(xml: string, sharedStrings: string[]): { rows: SheetRow[]; dimensionRef?: string } {
  const root = parseXml(xml);
  if (!root) return { rows: [] };
  const rows: SheetRow[] = [];
  for (const node of root.children) {
    if (node.name === 'dimension') continue;
    if (node.name !== 'sheetData') continue;
    for (const row of node.children) {
      if (row.name !== 'row') continue;
      const cells = new Map<number, string>();
      for (const cell of row.children) {
        if (cell.name !== 'c') continue;
        const ref = cell.attrs['r'];
        if (!ref) continue;
        const parsed = parseCellRef(ref);
        if (!parsed) continue;
        const type = cell.attrs['t'];
        const valueNode = cell.children.find((n) => n.name === 'v') ?? undefined;
        const inlineNode = cell.children.find((n) => n.name === 'is') ?? undefined;
        let value = '';
        if (type === 'inlineStr' && inlineNode) {
          for (const t of inlineNode.children) {
            if (t.name === 't') value += t.text;
          }
        } else if (type === 's' && valueNode) {
          const idx = Number(valueNode.text);
          value = sharedStrings[idx] ?? '';
        } else if (type === 'str' && valueNode) {
          value = valueNode.text;
        } else if (valueNode) {
          value = valueNode.text;
        } else if (inlineNode) {
          for (const t of inlineNode.children) {
            if (t.name === 't') value += t.text;
          }
        }
        cells.set(parsed.col, value);
      }
      rows.push({ cells });
    }
  }
  const dim = root.children.find((n) => n.name === 'dimension');
  return { rows, dimensionRef: dim?.attrs['ref'] };
}

// ----- Public entry --------------------------------------------------------

function selectSheetPath(workbookXml: string): string | undefined {
  const root = parseXml(workbookXml);
  if (!root) return undefined;
  for (const node of root.children) {
    if (node.name === 'sheets') {
      for (const sh of node.children) {
        if (sh.name === 'sheet') {
          const id = sh.attrs['r:id'];
          if (id) return `xl/worksheets/sheet${id.replace(/^rId/, '')}.xml`;
        }
      }
    }
  }
  return undefined;
}

export function parseXlsxRoster(buffer: Buffer, draftIdPrefix: string): XlsxRosterResult {
  if (!Buffer.isBuffer(buffer)) return { ok: false, reason: 'input is not a buffer' };
  if (buffer.length < 22) return { ok: false, reason: 'input too small to be an xlsx' };
  // EOCD is at end; check first bytes are local file header signatures to
  // confirm the buffer is actually a ZIP.
  if (buffer.readUInt32LE(0) !== 0x04034b50 && buffer.readUInt32LE(0) !== 0x02014b50) {
    return { ok: false, reason: 'not a valid zip / xlsx container' };
  }
  const cd = readCentralDirectory(buffer);
  if (cd.error) return { ok: false, reason: cd.error };
  const byName = new Map<string, ZipEntry>();
  for (const e of cd.entries) byName.set(e.name, e);

  const sharedStringsEntry = byName.get('xl/sharedStrings.xml');
  let sharedStrings: string[] = [];
  if (sharedStringsEntry) {
    try {
      sharedStrings = extractSharedStrings(inflate(buffer, sharedStringsEntry).toString('utf8'));
    } catch (err) {
      return { ok: false, reason: `sharedStrings inflate/parse failed: ${(err as Error).message}` };
    }
  }

  let sheetPath = selectSheetPath(
    byName.has('xl/workbook.xml')
      ? inflate(buffer, byName.get('xl/workbook.xml')!).toString('utf8')
      : '',
  );
  if (!sheetPath || !byName.has(sheetPath)) {
    // Fallback: first xl/worksheets/sheet*.xml.
    const candidates = cd.entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .map((e) => e.name)
      .sort();
    sheetPath = candidates[0];
  }
  if (!sheetPath || !byName.has(sheetPath)) {
    return { ok: false, reason: 'no worksheet found' };
  }

  let sheetXml: string;
  try {
    sheetXml = inflate(buffer, byName.get(sheetPath)!).toString('utf8');
  } catch (err) {
    return { ok: false, reason: `worksheet inflate failed: ${(err as Error).message}` };
  }
  const { rows } = extractSheetRows(sheetXml, sharedStrings);
  if (rows.length === 0) return { ok: true, drafts: [], unresolvedStatements: [] };

  const headerCells = rows[0]!.cells;
  const headers: string[] = [];
  const maxCol = Math.max(...Array.from(headerCells.keys()));
  for (let c = 0; c <= maxCol; c += 1) {
    headers.push((headerCells.get(c) ?? '').trim());
  }
  if (headers.every((h) => h === '')) {
    return { ok: false, reason: 'worksheet header row is empty' };
  }

  const records: Record<string, unknown>[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r]!.cells;
    const obj: Record<string, unknown> = {};
    let hasAny = false;
    for (let c = 0; c < headers.length; c += 1) {
      const h = headers[c]!;
      if (h === '') continue;
      const v = cells.get(c);
      if (v !== undefined) {
        obj[h] = v;
        if (v !== '') hasAny = true;
      }
    }
    if (hasAny) records.push(obj);
  }
  return { ok: true, ...tableRowsToDrafts(records, draftIdPrefix) };
}
