/**
 * Northstar RV-N2 — shared deterministic row normalization for programme
 * traveller intake.
 *
 * One normalizer feeds every row-shaped intake channel (CSV, table-like
 * pre-parsed rows, XLSX). The contract:
 *   - Header alias table resolves reasonable messy column names;
 *   - Unknown columns become notes (never silent drops);
 *   - Missing values stay missing (never fabricated airports/nationalities/
 *     passports/dates);
 *   - Rows without a displayName become unresolved statements, not drafts;
 *   - anchorCommitmentIds accept only EntityId-parseable values; others
 *     become unresolved statements and the cell is preserved as a note.
 *
 * This module is anti-hardcoding: nothing here encodes city/airline/event
 * semantics. Scenario-specific reasoning lives downstream of promotion.
 */
import { EntityIdSchema } from '../domain/common.ts';
import type {
  ProgrammeTravellerDraft,
} from '../contracts/programmeIntake.ts';

const NAIVE_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface NormalizedRow {
  displayName?: string;
  email?: string;
  phoneE164?: string;
  dateOfBirth?: string;
  passportNumber?: string;
  nationalityCodes: string[];
  homeLocationText?: string;
  accessibilityStatements: string[];
  notes: string[];
  /** Values that parsed as EntityId. */
  anchorCommitmentIds: string[];
  /** Values that did not parse as EntityId but were offered in a commitments column. */
  badAnchorCommitmentIds: string[];
}

type AliasGroup =
  | 'displayName'
  | 'email'
  | 'phone'
  | 'dob'
  | 'passport'
  | 'nationality'
  | 'home'
  | 'accessibility'
  | 'notes'
  | 'commitments';

const ALIASES: Record<string, AliasGroup> = {
  // display name
  'name': 'displayName',
  'full name': 'displayName',
  'traveller': 'displayName',
  'traveller name': 'displayName',
  'display name': 'displayName',
  'displayname': 'displayName',
  // email
  'email': 'email',
  'e-mail': 'email',
  'email address': 'email',
  // phone
  'phone': 'phone',
  'mobile': 'phone',
  'phone number': 'phone',
  'phonenumber': 'phone',
  // dob
  'dob': 'dob',
  'date of birth': 'dob',
  'dateofbirth': 'dob',
  'birthdate': 'dob',
  // passport
  'passport': 'passport',
  'passport number': 'passport',
  'passportnumber': 'passport',
  // nationality
  'nationality': 'nationality',
  'nationalities': 'nationality',
  'citizenship': 'nationality',
  // home
  'home': 'home',
  'home city': 'home',
  'home airport': 'home',
  'from': 'home',
  // accessibility
  'accessibility': 'accessibility',
  'accessibility needs': 'accessibility',
  'accessibility statements': 'accessibility',
  'special needs': 'accessibility',
  // notes
  'notes': 'notes',
  'note': 'notes',
  'comments': 'notes',
  'dietary': 'notes',
  // commitments
  'commitments': 'commitments',
  'sessions': 'commitments',
  'commitment ids': 'commitments',
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ');
}

function aliasFor(header: string): AliasGroup | undefined {
  const norm = normalizeHeader(header);
  if (ALIASES[norm] !== undefined) return ALIASES[norm];
  // Allow "name 1", "name 2" (common in spreadsheet exports) for display.
  if (norm === 'traveller 1' || norm === 'traveller 2') return 'displayName';
  return undefined;
}

function cleanPhone(value: string): string {
  // Strip spaces, dashes, and parentheses; keep leading +.
  const trimmed = value.trim();
  const cleaned = trimmed.replace(/[ \-()]/g, '');
  // Allow + only at the start.
  if (cleaned.startsWith('+')) {
    return '+' + cleaned.slice(1).replace(/[^\d]/g, '');
  }
  return cleaned.replace(/[^\d]/g, '');
}

function splitMulti(value: string, separators: string[]): string[] {
  const out: string[] = [];
  const pattern = new RegExp(separators.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
  for (const part of value.split(pattern)) {
    const t = part.trim();
    if (t.length > 0) out.push(t);
  }
  return out;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return undefined;
}

export interface NormalizeResult {
  draft?: ProgrammeTravellerDraft;
  unresolved?: string;
}

/**
 * Normalize one row of intake data into a ProgrammeTravellerDraft. Unknown
 * columns become notes; missing values stay missing; rows without a
 * displayName yield an unresolved statement instead of a draft.
 *
 * `draftId` is `${draftIdPrefix}-${index+1}` (1-based, deterministic).
 */
export function normalizeTravellerRow(
  row: Record<string, unknown>,
  draftIdPrefix: string,
  index: number,
): NormalizeResult {
  const draftId = `${draftIdPrefix}-${index + 1}`;
  const acc: NormalizedRow = {
    nationalityCodes: [],
    accessibilityStatements: [],
    notes: [],
    anchorCommitmentIds: [],
    badAnchorCommitmentIds: [],
  };

  for (const [rawKey, rawValue] of Object.entries(row)) {
    const header = rawKey;
    const group = aliasFor(header);
    const value = asNonEmptyString(rawValue);
    if (value === undefined) {
      // Empty cell: skip silently, do not invent or annotate.
      continue;
    }
    if (group === undefined) {
      // Unknown column: record as a note rather than dropping.
      acc.notes.push(`unrecognized column '${header}': ${value}`);
      continue;
    }
    switch (group) {
      case 'displayName':
        acc.displayName = value;
        break;
      case 'email':
        acc.email = value;
        break;
      case 'phone': {
        const cleaned = cleanPhone(value);
        if (cleaned.length > 0) acc.phoneE164 = cleaned;
        else acc.notes.push(`phone value could not be cleaned: ${value}`);
        break;
      }
      case 'dob': {
        if (NAIVE_DATE.test(value)) {
          acc.dateOfBirth = value;
        } else {
          acc.notes.push(`dateOfBirth not YYYY-MM-DD: ${value}`);
        }
        break;
      }
      case 'passport':
        acc.passportNumber = value;
        break;
      case 'nationality': {
        const parts = splitMulti(value, [',', ';', '/']);
        for (const p of parts) {
          acc.nationalityCodes.push(p);
        }
        break;
      }
      case 'home':
        acc.homeLocationText = value;
        break;
      case 'accessibility': {
        for (const s of splitMulti(value, [';'])) {
          acc.accessibilityStatements.push(s);
        }
        break;
      }
      case 'notes':
        acc.notes.push(value);
        break;
      case 'commitments': {
        for (const part of splitMulti(value, [',', ';', '/'])) {
          if (EntityIdSchema.safeParse(part).success) {
            acc.anchorCommitmentIds.push(part);
          } else {
            acc.badAnchorCommitmentIds.push(part);
          }
        }
        break;
      }
    }
  }

  const unresolved: string[] = [];
  for (const bad of acc.badAnchorCommitmentIds) {
    unresolved.push(`row ${draftId}: commitment id not parseable as EntityId: ${bad}`);
  }

  if (acc.displayName === undefined) {
    // No name: do not produce a draft. Preserve everything we did collect as
    // an unresolved statement so it can be triaged.
    const fragments: string[] = [`row ${draftId}: no displayName;`];
    if (acc.email !== undefined) fragments.push(`email=${acc.email}`);
    if (acc.phoneE164 !== undefined) fragments.push(`phone=${acc.phoneE164}`);
    if (acc.homeLocationText !== undefined) fragments.push(`home=${acc.homeLocationText}`);
    if (acc.nationalityCodes.length > 0) fragments.push(`nationality=[${acc.nationalityCodes.join(', ')}]`);
    if (acc.notes.length > 0) fragments.push(`notes=[${acc.notes.join(' | ')}]`);
    unresolved.push(fragments.join(' '));
    return unresolved.length > 0 ? { unresolved: unresolved.join(' | ') } : {};
  }

  const identity: { email?: string; phoneE164?: string; dateOfBirth?: string; passportNumber?: string } = {};
  if (acc.email !== undefined) identity.email = acc.email;
  if (acc.phoneE164 !== undefined) identity.phoneE164 = acc.phoneE164;
  if (acc.dateOfBirth !== undefined) identity.dateOfBirth = acc.dateOfBirth;
  if (acc.passportNumber !== undefined) identity.passportNumber = acc.passportNumber;

  const draft: ProgrammeTravellerDraft = {
    draftId,
    displayName: acc.displayName,
    identity,
    nationalityCodes: [...acc.nationalityCodes],
    accessibilityStatements: [...acc.accessibilityStatements],
    notes: [...acc.notes],
    anchorCommitmentIds: [...acc.anchorCommitmentIds],
  };
  if (acc.homeLocationText !== undefined) {
    draft.homeLocationText = acc.homeLocationText;
  }
  return unresolved.length > 0 ? { draft, unresolved: unresolved.join(' | ') } : { draft };
}
