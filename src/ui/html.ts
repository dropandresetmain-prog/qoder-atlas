/**
 * E2 — small pure rendering helpers. No DOM dependency: the UI is built as
 * typed functions from read models to HTML strings, runnable/testable on
 * Node and servable through the existing node:http seam (E3/integrator).
 */
import type { IsoDateTime, Money } from '../domain/common.ts';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape all HTML-significant characters; every dynamic value goes through this. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Encode dynamic path/query segments for href attributes (not for HTML text). */
export function encodeUri(value: string): string {
  return encodeURIComponent(value);
}

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: money.currency,
  }).format(money.amount);
}

export interface CostDeltaDisplay {
  text: string;
  kind: 'extra' | 'saving';
}

/** Cost delta versus the original plan, phrased for users. */
export function formatCostDelta(money: Money): CostDeltaDisplay {
  if (money.amount < 0) {
    return { text: `${formatMoney({ ...money, amount: Math.abs(money.amount) })} saved`, kind: 'saving' };
  }
  return { text: `+${formatMoney(money)} added cost`, kind: 'extra' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Deterministic, offset-preserving instant display. Keeps the source
 * timezone visible instead of silently shifting it.
 */
export function formatInstant(iso: IsoDateTime): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1] ?? match[2];
  const offset = match[6] === 'Z' ? 'UTC' : `UTC${match[6]}`;
  return `${Number(match[3])} ${month} ${match[1]}, ${match[4]}:${match[5]} ${offset}`;
}

/**
 * Short queue/feed timestamp: "22 Sep, 09:05" — date and time in the
 * source offset, without the year/offset chrome of formatInstant.
 */
export function formatShort(iso: IsoDateTime): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1] ?? match[2];
  return `${Number(match[3])} ${month}, ${match[4]}:${match[5]}`;
}

/**
 * Roster timestamp relative to a reference instant (usually the view's
 * generatedAt): same day → "09:30", the day before → "Yesterday",
 * otherwise "22 Sep". Deterministic; never fabricates freshness.
 */
export function formatRosterTime(iso: IsoDateTime, relativeTo: IsoDateTime): string {
  const day = iso.slice(0, 10);
  const refDay = relativeTo.slice(0, 10);
  const time = iso.slice(11, 16);
  if (day === refDay) return time;
  const dayMs = Date.parse(`${day}T00:00:00Z`);
  const refMs = Date.parse(`${refDay}T00:00:00Z`);
  if (Number.isFinite(dayMs) && Number.isFinite(refMs) && refMs - dayMs === 86_400_000) {
    return 'Yesterday';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1] ?? match[2];
  return `${Number(match[3])} ${month}`;
}

/** Join a class list, dropping falsy entries. */
export function cx(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
