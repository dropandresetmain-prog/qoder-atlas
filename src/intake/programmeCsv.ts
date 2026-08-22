/**
 * Northstar RV-N2 — minimal CSV roster parser.
 *
 * Parses CSV text with support for:
 *   - quoted fields, including escaped double-quotes ("" inside "...");
 *   - CRLF, LF, and CR line endings;
 *   - empty trailing line;
 *   - header row on the first line.
 *
 * No external dependencies. The parser is deliberately minimal and
 * deterministic. Malformed input surfaces as a `csv parse failure` note in
 * `unresolvedStatements` — never an exception, never a fabricated draft.
 */
import type { ProgrammeTravellerDraft } from '../contracts/programmeIntake.ts';
import { normalizeTravellerRow } from './programmeRows.ts';

export interface RosterResult {
  drafts: ProgrammeTravellerDraft[];
  unresolvedStatements: string[];
}

type TokenizeResult = { ok: true; tokens: string[][] } | { ok: false; reason: string };

function tokenize(text: string): TokenizeResult {
  const tokens: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      row.push(field);
      field = '';
      if (i + 1 < len && text[i + 1] === '\n') {
        i += 2;
      } else {
        i += 1;
      }
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
        tokens.push(row);
      }
      row = [];
      continue;
    }
    if (c === '\n') {
      row.push(field);
      field = '';
      i += 1;
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
        tokens.push(row);
      }
      row = [];
      continue;
    }
    field += c;
    i += 1;
  }
  if (inQuotes) {
    return { ok: false, reason: 'unterminated quoted field' };
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      tokens.push(row);
    }
  }
  return { ok: true, tokens };
}

function parseCsv(
  text: string,
): { ok: true; rows: Record<string, unknown>[] } | { ok: false; reason: string } {
  const tokenized = tokenize(text);
  if (!tokenized.ok) return { ok: false, reason: tokenized.reason };
  const rows = tokenized.tokens;
  if (rows.length === 0) {
    return { ok: false, reason: 'csv is empty' };
  }
  const headersRaw = rows[0]!;
  const headers = headersRaw.map((h) => h.trim());
  if (headers.length === 0) {
    return { ok: false, reason: 'csv header row is empty' };
  }
  const records: Record<string, unknown>[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r]!;
    if (cells.length === 1 && cells[0] === '') continue; // skip blank line
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c]!;
      const value = c < cells.length ? cells[c]! : '';
      obj[key] = value;
    }
    records.push(obj);
  }
  return { ok: true, rows: records };
}

/**
 * Parse a CSV roster into draft traveller records. Minimal RFC-4180-ish
 * parsing (quoted fields, escaped quotes, CRLF/LF) plus the shared
 * normalizeTravellerRow. The function shape is fixed by the lane contract:
 * malformed input produces an empty drafts list and a single entry in
 * `unresolvedStatements` so promotion-time triage can flag the failure.
 */
export function parseRosterCsv(text: string, draftIdPrefix: string): RosterResult {
  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return { drafts: [], unresolvedStatements: [`csv parse failure: ${parsed.reason}`] };
  }
  const drafts: ProgrammeTravellerDraft[] = [];
  const unresolvedStatements: string[] = [];
  parsed.rows.forEach((row, index) => {
    const result = normalizeTravellerRow(row, draftIdPrefix, index);
    if (result.draft) drafts.push(result.draft);
    if (result.unresolved) unresolvedStatements.push(result.unresolved);
  });
  return { drafts, unresolvedStatements };
}
