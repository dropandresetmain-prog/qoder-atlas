/**
 * E2 — shared screen fragments. Everything here is a pure function of
 * frozen-contract data; no scenario branching, no fabricated states.
 */
import type { ReadModelStatus, RemainderViability } from '../contracts/readmodels.ts';
import {
  STATUS_LABEL,
  STATUS_TONE,
  VIABILITY_EXPLANATION,
  VIABILITY_LABEL,
  type StatusTone,
} from './copy.ts';
import { cx, escapeHtml } from './html.ts';

export function toneClass(tone: StatusTone, prefix: string): string {
  return `${prefix} tone-${tone}`;
}

/** Status pill used across operator surfaces. */
export function statusBadge(status: ReadModelStatus): string {
  const tone = STATUS_TONE[status];
  return `<span class="${toneClass(tone, 'badge')}" role="status" aria-label="Trip status: ${escapeHtml(STATUS_LABEL[status])}">${escapeHtml(STATUS_LABEL[status])}</span>`;
}

/** Plain bullet list; empty arrays render an honest empty note instead. */
export function bulletList(items: readonly string[], emptyNote: string): string {
  if (items.length === 0) return `<p class="empty-note">${escapeHtml(emptyNote)}</p>`;
  const rows = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<ul class="plain-list">${rows}</ul>`;
}

export interface IconRow {
  icon: string;
  iconClass: string;
  text: string;
}

export function iconList(rows: readonly IconRow[]): string {
  if (rows.length === 0) return '';
  const items = rows
    .map(
      (row) =>
        `<li><span class="ic ${escapeHtml(row.iconClass)}" aria-hidden="true">${escapeHtml(row.icon)}</span><span>${escapeHtml(row.text)}</span></li>`,
    )
    .join('');
  return `<ul class="icon-list">${items}</ul>`;
}

/** Loading surface: never shows data it does not have. */
export function loadingPanel(title: string, detail: string): string {
  return `
  <div class="panel state-panel" role="status" data-ui-state="loading">
    <p class="state-title">${escapeHtml(title)}</p>
    <p>${escapeHtml(detail)}</p>
    <div class="skeleton" aria-hidden="true"></div>
    <div class="skeleton" aria-hidden="true"></div>
  </div>`;
}

/** Error surface: honest failure, explicit that trip state is untouched. */
export function errorPanel(title: string, message?: string): string {
  const detail = message ?? 'The latest information is not available right now.';
  return `
  <div class="panel state-panel is-error" role="alert" data-ui-state="error">
    <p class="state-title">${escapeHtml(title)}</p>
    <p>${escapeHtml(detail)}</p>
  </div>`;
}

/** "Still unclear" list — uncertainty shown explicitly, never hidden. */
export function uncertaintyList(uncertainties: readonly string[]): string {
  if (uncertainties.length === 0) return '';
  const rows = uncertainties.map((item) => ({ icon: '?', iconClass: 'ic-unknown', text: item }));
  return `
  <div class="kv">
    <p class="kv-label">Still unclear</p>
    ${iconList(rows)}
  </div>`;
}

/** Remainder-of-trip viability chip + explanation (traveller surface). */
export function viabilityBlock(viability: RemainderViability): string {
  const toneMap: Record<RemainderViability, StatusTone> = {
    VIABLE: 'ok',
    AT_RISK: 'watch',
    NOT_VIABLE: 'alert',
    UNKNOWN: 'neutral',
  };
  const tone = toneMap[viability];
  return `
  <div class="card t-card" data-viability="${escapeHtml(viability)}">
    <h2>The rest of your trip</h2>
    <p><span class="${toneClass(tone, 'badge')}">${escapeHtml(VIABILITY_LABEL[viability])}</span></p>
    <p class="card-sub">${escapeHtml(VIABILITY_EXPLANATION[viability])}</p>
  </div>`;
}

/** Section wrapper with a user-facing heading; omitted entirely when empty. */
export function optionalSection(title: string, body: string | undefined): string {
  if (!body) return '';
  return `
  <section class="section">
    <h2>${escapeHtml(title)}</h2>
    ${body}
  </section>`;
}

export function classForStatus(status: ReadModelStatus): string {
  return cx('trip-card', `status-${status.toLowerCase()}`);
}
