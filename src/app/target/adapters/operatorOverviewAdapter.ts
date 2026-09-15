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
import { VIABILITY_LABEL } from '../../../ui/copy.ts';

/** Presentation-safe dashboard surface — HTML fragments the UI can compose. */
export interface ProductSurfaceModel {
  title: string;
  summaryHtml: string;
  itemsHtml: string;
}

const OPERATIONAL_STATUS_LABEL: Record<ProductOperationalStatus, string> = {
  READY: 'Confirmed',
  AT_RISK: 'At risk',
  DISRUPTED: 'Needs attention',
  RECOVERING: 'Recovery under way',
  UNKNOWN: 'Unconfirmed',
};

const OPERATIONAL_STATUS_TONE: Record<ProductOperationalStatus, string> = {
  READY: 'ok',
  AT_RISK: 'watch',
  DISRUPTED: 'alert',
  RECOVERING: 'active',
  UNKNOWN: 'neutral',
};

export function operationalStatusLabel(status: ProductOperationalStatus): string {
  return OPERATIONAL_STATUS_LABEL[status];
}

export function operationalStatusTone(status: ProductOperationalStatus): string {
  return OPERATIONAL_STATUS_TONE[status];
}

export function assessmentToneClass(tone: AssessmentTone): string {
  if (tone === 'PASS') return 'ok';
  if (tone === 'FAIL') return 'alert';
  return 'neutral';
}

export function ldgSemanticTone(state: LdgSemanticState): string {
  switch (state) {
    case 'HEALTHY':
    case 'RECOVERED':
      return 'ok';
    case 'CHANGED':
    case 'AFFECTED':
    case 'PROPOSED':
      return 'watch';
    case 'FAILED':
      return 'alert';
    case 'ACTIVE':
      return 'active';
    default:
      return 'neutral';
  }
}

export function remainderViabilityTone(viability: RemainderViability): string {
  switch (viability) {
    case 'VIABLE':
      return 'ok';
    case 'AT_RISK':
      return 'watch';
    case 'NOT_VIABLE':
      return 'alert';
    default:
      return 'neutral';
  }
}

function summaryTiles(view: OperatorOverview): string {
  const { summary } = view;
  const tiles = [
    { count: summary.ready, label: 'Confirmed', tone: 'ok' },
    { count: summary.atRisk, label: 'At risk', tone: 'watch' },
    { count: summary.disrupted, label: 'Needs attention', tone: 'alert', attention: summary.disrupted > 0 },
    { count: summary.recovering, label: 'Recovery under way', tone: 'active' },
    { count: summary.unknown, label: 'Unconfirmed', tone: 'neutral' },
  ];
  return tiles
    .map(
      (tile) =>
        `<div class="tile tone-${tile.tone}${tile.attention ? ' is-attention' : ''}" data-test="summary-${tile.tone}"><div class="tile-count">${tile.count}</div><div class="tile-label">${escapeHtml(tile.label)}</div></div>`,
    )
    .join('');
}

function fleetDot(item: OperatorOverviewItem, index: number): string {
  const tone = operationalStatusTone(item.status);
  const dotClass =
    tone === 'ok'
      ? 'd-ok'
      : tone === 'watch'
        ? 'd-watch'
        : tone === 'alert'
          ? 'd-bad'
          : tone === 'active'
            ? 'd-active'
            : 'd-unconfirmed';
  const label = `${item.travellerLabel} — ${operationalStatusLabel(item.status)}`;
  return `<i class="${dotClass}" style="--i:${index}" title="${escapeHtml(label)}" data-trip-ref="${escapeHtml(item.tripRef)}"></i>`;
}

function queueGlyph(item: OperatorOverviewItem): string {
  if (item.decisionRequired) return 'g-bad';
  if (item.status === 'DISRUPTED') return 'g-bad';
  if (item.status === 'AT_RISK') return 'g-warn';
  if (item.status === 'UNKNOWN') return 'g-unk';
  return 'g-ok';
}

function queueGlyphChar(item: OperatorOverviewItem): string {
  if (item.decisionRequired) return '✕';
  if (item.status === 'UNKNOWN') return '?';
  if (item.status === 'AT_RISK') return '▲';
  if (item.status === 'DISRUPTED') return '✕';
  return '✓';
}

function overviewItemRow(item: OperatorOverviewItem): string {
  const issue =
    item.whatChanged ??
    item.recoveryActivity ??
    (item.decisionRequired ? 'Decision required before recovery can continue.' : 'No open issues reported.');
  const viability = `<span class="badge tone-${remainderViabilityTone(item.remainderViability)}">${escapeHtml(VIABILITY_LABEL[item.remainderViability])}</span>`;
  const uncertainty =
    item.unresolvedUncertainty.length > 0
      ? `<p class="b-extra">${escapeHtml(item.unresolvedUncertainty.join(' · '))}</p>`
      : '';
  return `
    <div class="qrow" data-trip-ref="${escapeHtml(item.tripRef)}" data-test="overview-item">
      <span class="q-glyph ${queueGlyph(item)}" aria-hidden="true">${queueGlyphChar(item)}</span>
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
