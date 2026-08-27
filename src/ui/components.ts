/**
 * E2 — shared screen fragments. Everything here is a pure function of
 * frozen-contract data; no scenario branching, no fabricated states.
 */
import type { ReadModelStatus, RemainderViability } from '../contracts/readmodels.ts';
import type { ChainLinkState, ChainLinkView } from './case-view-model.ts';
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

/**
 * Approved glyph vocabulary for journey-chain links (docs/DESIGN.md §4.2):
 * ✓ confirmed · ◌ proposed · ▲ at risk · ✕ impacted · ○ not booked ·
 * ? unconfirmed · ✦ the commitment (never disappears).
 */
export const CHAIN_GLYPH: Record<ChainLinkState, string> = {
  CONFIRMED: '✓',
  PROPOSED: '◌',
  BROKEN: '✕',
  UNBOOKED: '○',
  UNKNOWN: '?',
  AT_RISK: '▲',
};

/** Mini-chain tone class per link state (colour = state only). */
export const CHAIN_MINI_TONE: Record<ChainLinkState, string> = {
  CONFIRMED: 'mc-ok',
  PROPOSED: 'mc-watch',
  BROKEN: 'mc-alert',
  UNBOOKED: 'mc-neutral',
  UNKNOWN: 'mc-neutral',
  AT_RISK: 'mc-watch',
};

/** TYPE icon per link; colour communicates state via CHAIN_MINI_TONE. */
export const CHAIN_TYPE_ICON: Record<NonNullable<ChainLinkView['linkType']>, string> = {
  FLIGHT: '✈',
  GROUND: '⇄',
  STAY: '⌂',
  COMMITMENT: '✦',
};

/** Glyph for one chain link; uses type icon when available. */
export function chainLinkGlyph(link: ChainLinkView): string {
  if (link.linkType) return CHAIN_TYPE_ICON[link.linkType];
  return link.commitment ? '✦' : CHAIN_GLYPH[link.state];
}

/**
 * Mini journey chain for roster rows — flight · transfer · stay · commitment
 * at a glance. Rendered only when the projection supplies the chain; the
 * title names the actual link kinds so the legend is never fabricated.
 */
export function miniChainRow(links: readonly ChainLinkView[]): string {
  if (links.length === 0) return '';
  const parts = links
    .map(
      (link) =>
        `<span class="mini-chain-link ${CHAIN_MINI_TONE[link.state]}" aria-hidden="true" title="${escapeHtml(link.kind)}">${chainLinkGlyph(link)}</span>`,
    )
    .join('<i class="mc-ln" aria-hidden="true"></i>');
  const title = links.map((link) => link.kind).join(' · ');
  return `<div class="mini-chain" title="${escapeHtml(title)}">${parts}</div>`;
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

/** Remainder-of-trip viability block (traveller surface) — the honest one-liner. */
export function viabilityBlock(viability: RemainderViability): string {
  const toneMap: Record<RemainderViability, string> = {
    VIABLE: 'v-ok',
    AT_RISK: 'v-watch',
    NOT_VIABLE: 'v-bad',
    UNKNOWN: 'v-neutral',
  };
  return `
  <div class="viab ${toneMap[viability]}" data-viability="${escapeHtml(viability)}"><strong>${escapeHtml(VIABILITY_LABEL[viability])}.</strong> ${escapeHtml(VIABILITY_EXPLANATION[viability])}</div>`;
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
