/**
 * Northstar RV-N0 — deterministic temporal normalization for extracted values
 * (ADR-040).
 *
 * Model-extracted temporal strings must be parsed/normalized deterministically
 * BEFORE promotion into executable rules. This module never guesses: a value
 * is either already a valid offset-bearing IsoDateTime, or it is normalized
 * using an EXPLICIT timezone only, or it is rejected (undefined) so the caller
 * records uncertainty instead of promoting sloppy time.
 *
 * Accepted shapes:
 *   - already-valid IsoDateTime with explicit offset (passthrough)
 *   - naive datetime "YYYY-MM-DDTHH:mm[:ss]" + explicit IANA timezone
 *   - date-only "YYYY-MM-DD" + explicit IANA timezone (local midnight)
 * Everything else — ambiguous formats, missing timezone, junk — is undefined.
 */
import { IsoDateTimeSchema, type IsoDateTime } from '../domain/common.ts';

const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * UTC offset minutes that an IANA timezone has at the given wall-clock time.
 * Deterministic: Intl-based, no heuristics. DST folds take the earlier offset.
 */
function timezoneOffsetMinutes(wall: { year: number; month: number; day: number; hour: number; minute: number; second: number }, timeZone: string): number | undefined {
  try {
    const utcMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]),
    );
    const hour = parts['hour'] === '24' ? 0 : Number(parts['hour']);
    const asUtcMs = Date.UTC(
      Number(parts['year']),
      Number(parts['month']) - 1,
      Number(parts['day']),
      hour,
      Number(parts['minute']),
      Number(parts['second']),
    );
    return Math.round((asUtcMs - utcMs) / 60_000);
  } catch {
    return undefined;
  }
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * Deterministically normalize an extracted temporal value into an
 * offset-bearing IsoDateTime. Returns undefined when the value cannot be
 * normalized without guessing; callers must treat that as uncertainty.
 */
export function normalizeExtractedTemporal(value: unknown, timezone?: string): IsoDateTime | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  // Already valid with explicit offset: passthrough, never rewritten.
  const direct = IsoDateTimeSchema.safeParse(trimmed);
  if (direct.success) return direct.data;

  if (!timezone) return undefined;

  let wall: { year: number; month: number; day: number; hour: number; minute: number; second: number } | undefined;
  let base: string | undefined;

  const naive = NAIVE_DATETIME.exec(trimmed);
  if (naive) {
    wall = {
      year: Number(naive[1]),
      month: Number(naive[2]),
      day: Number(naive[3]),
      hour: Number(naive[4]),
      minute: Number(naive[5]),
      second: Number(naive[6] ?? 0),
    };
    base = `${naive[1]}-${naive[2]}-${naive[3]}T${naive[4]}:${naive[5]}:${naive[6] ?? '00'}`;
  } else {
    const dateOnly = DATE_ONLY.exec(trimmed);
    if (dateOnly) {
      wall = { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]), hour: 0, minute: 0, second: 0 };
      base = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00`;
    }
  }
  if (!wall || !base) return undefined;

  const offsetMinutes = timezoneOffsetMinutes(wall, timezone);
  if (offsetMinutes === undefined) return undefined;

  const candidate = `${base}${formatOffset(offsetMinutes)}`;
  const normalized = IsoDateTimeSchema.safeParse(candidate);
  return normalized.success ? normalized.data : undefined;
}

/**
 * Temporal fields per PolicyRule kind, derived from the frozen PolicyRule
 * vocabulary (deterministic vocabulary knowledge, not scenario logic).
 */
export const TEMPORAL_RULE_FIELDS: Record<string, readonly string[]> = {
  TIME_WINDOW: ['windowStart', 'windowEnd'],
  NO_SHOW_CUTOFF: ['cutoffAt'],
  CANCELLATION_TERMS: ['refundDeadline'],
  FUNDED_WINDOW: ['windowStart', 'windowEnd'],
};

/**
 * Normalize the known temporal fields of a model-extracted rule draft in
 * place (returns a new record). Fields that cannot be normalized stay as-is
 * so schema validation rejects them into uncertainty — never promoted.
 */
export function normalizeRuleDraftTemporals(
  draft: Record<string, unknown>,
  timezone?: string,
): Record<string, unknown> {
  const kind = typeof draft['kind'] === 'string' ? draft['kind'] : undefined;
  const fields = kind ? TEMPORAL_RULE_FIELDS[kind] : undefined;
  if (!fields) return draft;
  const normalized: Record<string, unknown> = { ...draft };
  for (const field of fields) {
    const value = normalized[field];
    if (value === undefined) continue;
    const result = normalizeExtractedTemporal(value, timezone);
    if (result !== undefined) normalized[field] = result;
  }
  return normalized;
}
