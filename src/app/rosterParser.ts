/**
 * DR-10 — deterministic roster parser for the optional Upload Event Details
 * onboarding surface (Lane H).
 *
 * Parses CSV text (and pre-parsed table-like rows) into validated roster
 * records: speaker name, role, home location, travel-required flag, contact.
 * This is an intermediate representation — uploadIntake.ts converts roster
 * records into ProgrammeTravellerDrafts for the existing promotion path.
 *
 * Anti-fabrication: malformed rows produce structured ParseIssue entries,
 * never guessed data. Missing optional fields stay absent.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Roster record schema
// ---------------------------------------------------------------------------

export const RosterContactSchema = z.strictObject({
  email: z.string().optional(),
  phone: z.string().optional(),
});
export type RosterContact = z.infer<typeof RosterContactSchema>;

export const RosterRecordSchema = z.strictObject({
  /** Speaker/attendee display name (required — rows without it are issues). */
  speakerName: z.string().min(1),
  /** Role/title at the event (optional). */
  role: z.string().optional(),
  /** Home city/location free text (optional). */
  homeLocation: z.string().optional(),
  /** Whether this attendee requires travel arrangements. */
  travelRequired: z.boolean(),
  /** Contact details (optional). */
  contact: RosterContactSchema.optional(),
});
export type RosterRecord = z.infer<typeof RosterRecordSchema>;

export const ParseIssueSchema = z.strictObject({
  /** 1-based row number (header is row 1; first data row is row 2). */
  rowNumber: z.number().int().positive(),
  /** Raw cell values from the row for triage. */
  rawValues: z.record(z.string(), z.string()),
  /** What went wrong. */
  reason: z.string(),
});
export type ParseIssue = z.infer<typeof ParseIssueSchema>;

export const RosterParseResultSchema = z.strictObject({
  records: z.array(RosterRecordSchema),
  issues: z.array(ParseIssueSchema),
});
export type RosterParseResult = z.infer<typeof RosterParseResultSchema>;

// ---------------------------------------------------------------------------
// Header aliases
// ---------------------------------------------------------------------------

type AliasGroup =
  | 'speakerName'
  | 'role'
  | 'homeLocation'
  | 'travelRequired'
  | 'email'
  | 'phone';

const ALIASES: Record<string, AliasGroup> = {
  // speaker name
  'speaker name': 'speakerName',
  'name': 'speakerName',
  'full name': 'speakerName',
  'attendee': 'speakerName',
  'attendee name': 'speakerName',
  'delegate': 'speakerName',
  'delegate name': 'speakerName',
  'participant': 'speakerName',
  'participant name': 'speakerName',
  'traveller': 'speakerName',
  'traveller name': 'speakerName',
  // role
  'role': 'role',
  'title': 'role',
  'job title': 'role',
  'position': 'role',
  'designation': 'role',
  // home location
  'home location': 'homeLocation',
  'home city': 'homeLocation',
  'home': 'homeLocation',
  'home airport': 'homeLocation',
  'city': 'homeLocation',
  'from': 'homeLocation',
  'origin': 'homeLocation',
  'based in': 'homeLocation',
  // travel required
  'travel required': 'travelRequired',
  'needs travel': 'travelRequired',
  'travel': 'travelRequired',
  'requires travel': 'travelRequired',
  'travel needed': 'travelRequired',
  // contact
  'email': 'email',
  'e-mail': 'email',
  'email address': 'email',
  'contact email': 'email',
  'phone': 'phone',
  'mobile': 'phone',
  'phone number': 'phone',
  'contact phone': 'phone',
  'telephone': 'phone',
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ');
}

function aliasFor(header: string): AliasGroup | undefined {
  return ALIASES[normalizeHeader(header)];
}

// ---------------------------------------------------------------------------
// CSV tokenizer (RFC-4180-ish: quoted fields, escaped quotes, CRLF/LF)
// ---------------------------------------------------------------------------

function tokenizeCsv(text: string): { ok: true; rows: string[][] } | { ok: false; reason: string } {
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
    if (c === '\t') {
      // TSV support: tab as separator
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      row.push(field);
      field = '';
      if (i + 1 < len && text[i + 1] === '\n') i += 2;
      else i += 1;
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) tokens.push(row);
      row = [];
      continue;
    }
    if (c === '\n') {
      row.push(field);
      field = '';
      i += 1;
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) tokens.push(row);
      row = [];
      continue;
    }
    field += c;
    i += 1;
  }
  if (inQuotes) return { ok: false, reason: 'unterminated quoted field' };
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) tokens.push(row);
  }
  return { ok: true, rows: tokens };
}

// ---------------------------------------------------------------------------
// Travel-required parsing
// ---------------------------------------------------------------------------

function parseTravelRequired(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === '') return false;
  if (/^(yes|y|true|1|required)$/i.test(v)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

function normalizeRow(
  rawValues: Record<string, string>,
  rowNumber: number,
): { record?: RosterRecord; issue?: ParseIssue } {
  let speakerName: string | undefined;
  let role: string | undefined;
  let homeLocation: string | undefined;
  let travelRequired = false;
  let email: string | undefined;
  let phone: string | undefined;
  const unknownColumns: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(rawValues)) {
    const group = aliasFor(rawKey);
    const value = rawValue.trim();
    if (value === '') continue;

    if (group === undefined) {
      unknownColumns.push(`${rawKey}=${value}`);
      continue;
    }
    switch (group) {
      case 'speakerName':
        speakerName = value;
        break;
      case 'role':
        role = value;
        break;
      case 'homeLocation':
        homeLocation = value;
        break;
      case 'travelRequired':
        travelRequired = parseTravelRequired(value);
        break;
      case 'email':
        email = value;
        break;
      case 'phone':
        phone = value;
        break;
    }
  }

  if (speakerName === undefined || speakerName.trim() === '') {
    return {
      issue: {
        rowNumber,
        rawValues,
        reason: 'missing speaker name; row cannot be mapped to a roster record',
      },
    };
  }

  const contact: RosterContact = {};
  if (email !== undefined) contact.email = email;
  if (phone !== undefined) contact.phone = phone;

  const record: RosterRecord = {
    speakerName: speakerName.trim(),
    travelRequired,
    ...(role !== undefined ? { role } : {}),
    ...(homeLocation !== undefined ? { homeLocation } : {}),
    ...(Object.keys(contact).length > 0 ? { contact } : {}),
  };

  // Validate through the schema for structural safety.
  const validated = RosterRecordSchema.safeParse(record);
  if (!validated.success) {
    return {
      issue: {
        rowNumber,
        rawValues,
        reason: `roster record failed schema validation: ${validated.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')}`,
      },
    };
  }

  return { record: validated.data };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse CSV (or TSV) text into roster records. Header row on line 1.
 * Malformed rows produce ParseIssue entries; they are never silently dropped
 * or guessed.
 */
export function parseRosterFromCsv(text: string): RosterParseResult {
  const tokenized = tokenizeCsv(text);
  if (!tokenized.ok) {
    return {
      records: [],
      issues: [{ rowNumber: 1, rawValues: {}, reason: `csv parse failure: ${tokenized.reason}` }],
    };
  }
  const rows = tokenized.rows;
  if (rows.length === 0) {
    return {
      records: [],
      issues: [{ rowNumber: 1, rawValues: {}, reason: 'csv is empty' }],
    };
  }
  const headers = rows[0]!.map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => h === '')) {
    return {
      records: [],
      issues: [{ rowNumber: 1, rawValues: {}, reason: 'csv header row is empty' }],
    };
  }

  const records: RosterRecord[] = [];
  const issues: ParseIssue[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r]!;
    // Skip blank lines.
    if (cells.length === 1 && cells[0] === '') continue;
    const rawValues: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c]!;
      if (key === '') continue;
      rawValues[key] = c < cells.length ? cells[c]! : '';
    }
    const result = normalizeRow(rawValues, r + 1);
    if (result.record) records.push(result.record);
    if (result.issue) issues.push(result.issue);
  }

  return { records, issues };
}

/**
 * Parse pre-parsed table rows (Record<string, string>[]) into roster records.
 * Same normalization as CSV; useful for XLSX or frontend table inputs.
 */
export function parseRosterFromTable(rows: Record<string, string>[]): RosterParseResult {
  const records: RosterRecord[] = [];
  const issues: ParseIssue[] = [];
  for (let r = 0; r < rows.length; r += 1) {
    const result = normalizeRow(rows[r]!, r + 2);
    if (result.record) records.push(result.record);
    if (result.issue) issues.push(result.issue);
  }
  return { records, issues };
}
