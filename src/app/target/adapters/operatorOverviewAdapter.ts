/**
 * M9 — adapt v2 OperatorOverview read models into presentation-safe surface
 * fragments. UI renderers consume ProductSurfaceModel instead of reconstructing
 * business logic from raw tables.
 */
import type {
  AssessmentTone,
  LdgSemanticState,
  OperatorOverview,
  OperatorOverviewItem,
  ProductOperationalStatus,
  RemainderViability,
} from '../../../contracts/v2/product/readModels.ts';
import { escapeHtml } from '../../../ui/html.ts';
import {
  presentAssessment, presentGraphState, presentOperationalStatus, presentViability,
} from '../../../ui/semantics/adapter.ts';
import { TONE_DOT_CLASS } from '../../../ui/semantics/grammar.ts';
import type { VisualTone } from '../../../ui/semantics/model.ts';

/** Presentation-safe dashboard surface — HTML fragments the UI can compose. */
export interface ProductSurfaceModel {
  title: string;
  summaryHtml: string;
  itemsHtml: string;
}

export function operationalStatusLabel(status: ProductOperationalStatus): string {
  return presentOperationalStatus(status).label;
}

export function operationalStatusTone(status: ProductOperationalStatus): VisualTone {
  return presentOperationalStatus(status).tone;
}

export function assessmentToneClass(tone: AssessmentTone): VisualTone {
  return presentAssessment(tone).tone;
}

export function ldgSemanticTone(state: LdgSemanticState): VisualTone {
  return presentGraphState(state).tone;
}

export function remainderViabilityTone(viability: RemainderViability): VisualTone {
  return presentViability(viability).tone;
}

/** Operator-facing viability wording comes from the single boundary, never traveller copy. */
export function remainderViabilityLabel(viability: RemainderViability): string {
  return presentViability(viability).label;
}

export function semanticToneDotClass(tone: VisualTone): string {
  return TONE_DOT_CLASS[tone];
}

const SUMMARY_TILES: readonly { key: keyof OperatorOverview['summary']; status: ProductOperationalStatus }[] = [
  { key: 'ready', status: 'READY' },
  { key: 'atRisk', status: 'AT_RISK' },
  { key: 'disrupted', status: 'DISRUPTED' },
  { key: 'recovering', status: 'RECOVERING' },
  { key: 'unknown', status: 'UNKNOWN' },
];

function summaryTiles(view: OperatorOverview): string {
  return SUMMARY_TILES
    .map(({ key, status }) => {
      const count = view.summary[key];
      const { label, tone } = presentOperationalStatus(status);
      const attention = status === 'DISRUPTED' && count > 0;
      return `<div class="tile tone-${tone}${attention ? ' is-attention' : ''}" data-test="summary-${tone}"><div class="tile-count">${count}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
    })
    .join('');
}

function fleetDot(item: OperatorOverviewItem, index: number): string {
  const dotClass = semanticToneDotClass(operationalStatusTone(item.status));
  const label = `${item.travellerLabel} — ${operationalStatusLabel(item.status)}`;
  return `<i class="${dotClass}" style="--i:${index}" title="${escapeHtml(label)}" data-trip-ref="${escapeHtml(item.tripRef)}"></i>`;
}

// Keyed by boundary tone so RECOVERING (active) is never drawn as a confirmed check.
const QUEUE_GLYPH: Record<VisualTone, { className: string; char: string }> = {
  ok: { className: 'g-ok', char: '✓' },
  watch: { className: 'g-warn', char: '▲' },
  alert: { className: 'g-bad', char: '✕' },
  active: { className: 'g-active', char: '…' },
  neutral: { className: 'g-unk', char: '?' },
};

function queueGlyph(item: OperatorOverviewItem): { className: string; char: string } {
  // decisionRequired is a supplied read-model flag, not an inferred state.
  return item.decisionRequired ? QUEUE_GLYPH.alert : QUEUE_GLYPH[operationalStatusTone(item.status)];
}

function overviewItemRow(item: OperatorOverviewItem): string {
  const issue =
    item.whatChanged ??
    item.recoveryActivity ??
    (item.decisionRequired ? 'Decision required before recovery can continue.' : 'No open issues reported.');
  const viability = `<span class="badge tone-${remainderViabilityTone(item.remainderViability)}">${escapeHtml(remainderViabilityLabel(item.remainderViability))}</span>`;
  const glyph = queueGlyph(item);
  const uncertainty =
    item.unresolvedUncertainty.length > 0
      ? `<p class="b-extra">${escapeHtml(item.unresolvedUncertainty.join(' · '))}</p>`
      : '';
  return `
    <div class="qrow" data-trip-ref="${escapeHtml(item.tripRef)}" data-test="overview-item">
      <span class="q-glyph ${glyph.className}" aria-hidden="true">${glyph.char}</span>
      <div>
        <div class="q-name">${escapeHtml(item.travellerLabel)}</div>
        <div class="q-issue">${escapeHtml(issue)}</div>
        ${uncertainty}
      </div>
      <div class="b-right">${viability}</div>
    </div>`;
}

function readoutBlock(view: OperatorOverview): string {
  const total = view.items.length;
  const ready = view.summary.ready;
  return `
    <div class="readout-ink">
      <p class="ri-label">Managed travel readiness</p>
      <div class="big big-settle">${ready}<span class="unit">/${total}</span></div>
      <p class="ri-confirmed-word">Confirmed</p>
      <p class="sub ri-scale">${view.summary.disrupted > 0 ? `<span class="seg-bad">${view.summary.disrupted} need attention</span>` : '<span class="seg-ok">No disrupted trips</span>'}</p>
    </div>`;
}

function fleetGrid(view: OperatorOverview): string {
  const cells = view.items.map((item, i) => fleetDot(item, i)).join('');
  return `
    <div class="readout-fleet">
      <div class="fc-head"><span class="fc-title">Fleet · ${view.items.length} participants</span><span class="fc-live">Live</span></div>
      <div class="dotgrid" role="img" aria-label="Participants at a glance" data-test="product-fleet-grid">${cells}</div>
      <div class="legend">
        <span><i class="l-ok"></i>Confirmed</span>
        <span><i class="l-bad"></i>Needs attention</span>
        <span><i class="l-watch"></i>At risk</span>
        <span><i class="l-active"></i>Recovery under way</span>
        <span><i class="l-unconfirmed"></i>Unconfirmed</span>
      </div>
    </div>`;
}

/** Adapt OperatorOverview into dashboard HTML fragments for product surfaces. */
export function adaptOperatorOverviewToDashboard(view: OperatorOverview): ProductSurfaceModel {
  const decisionsNeeded = view.items.filter((item) => item.decisionRequired).length;
  const summaryHtml = `
    <div class="readout">
      ${readoutBlock(view)}
      ${fleetGrid(view)}
    </div>
    <div class="tiles" data-test="product-summary-tiles">${summaryTiles(view)}</div>
    ${decisionsNeeded > 0 ? `<div class="callout tone-alert" data-test="decisions-needed"><p class="callout-title">${decisionsNeeded} decision${decisionsNeeded === 1 ? '' : 's'} needed</p><p>Recovery is blocked until an operator approves the pending work.</p></div>` : ''}`;

  const itemsHtml =
    view.items.length > 0
      ? `<div class="queue" data-test="product-overview-queue">${view.items.map(overviewItemRow).join('')}</div>`
      : '<p class="empty-note">No trips in scope.</p>';

  return {
    title: 'Operations overview',
    summaryHtml,
    itemsHtml,
  };
}
