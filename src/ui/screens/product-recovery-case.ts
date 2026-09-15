/**
 * M9 — product recovery case surface from v2 RecoveryCaseView read models.
 * Booking/service state and whole-trip viability stay separate; recovery
 * actions, partial recovery, duplicate exposure, and connection progression
 * render only when the projection supplies them.
 */
import type {
  ConnectionProgression,
  DuplicateBookingExposureView,
  PartialRecoveryView,
  RecoveryActionView,
  RecoveryCaseView,
} from '../../contracts/v2/product/readModels.ts';
import {
  assessmentToneClass,
  ldgSemanticTone,
} from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { escapeHtml, formatInstant, formatMoney } from '../html.ts';
import { bulletList, uncertaintyList } from '../components.ts';

const CONNECTION_PROGRESSION_LABEL: Record<ConnectionProgression, string> = {
  HEALTHY: 'Connection healthy',
  CONNECTION_SAFE: 'Connection safe',
  CONNECTION_AT_RISK: 'Connection at risk',
  CONNECTION_IMPOSSIBLE: 'Connection no longer works',
  RECOVERY_PLANNING: 'Planning recovery',
  AWAITING_APPROVAL: 'Awaiting approval',
  EXECUTING_COORDINATED_RECOVERY: 'Executing coordinated recovery',
  CHECKING_RESULTS: 'Checking results',
  RECOVERED: 'Recovered',
  STILL_UNRESOLVED: 'Still unresolved',
};

const EXECUTION_STATE_TONE: Record<RecoveryActionView['executionState'], string> = {
  PROPOSED: 'watch',
  AUTHORIZED: 'watch',
  REJECTED: 'alert',
  SUPERSEDED: 'neutral',
  EXECUTING: 'active',
  COMPLETED: 'ok',
  FAILED: 'alert',
  PENDING: 'watch',
  RECONCILING: 'active',
  OUTCOME_UNKNOWN: 'neutral',
};

function badge(label: string, tone: string): string {
  return `<span class="badge tone-${tone}">${escapeHtml(label)}</span>`;
}

function viabilityPair(view: RecoveryCaseView): string {
  const bookingTone = ldgSemanticTone(view.bookingServiceState.state);
  const tripTone = assessmentToneClass(view.tripViability.verdict);
  const bookingDetail = view.bookingServiceState.detail
    ? `<p class="card-sub">${escapeHtml(view.bookingServiceState.detail)}</p>`
    : '';
  const tripDetail = view.tripViability.detail
    ? `<p class="card-sub">${escapeHtml(view.tripViability.detail)}</p>`
    : '';
  return `
    <div class="trip-grid">
      <div class="card" data-test="booking-service-state">
        <p class="kv-label">Booking / service state</p>
        <div class="card-head">
          <div>
            <p class="card-title">${escapeHtml(view.bookingServiceState.label)}</p>
            ${bookingDetail}
          </div>
          ${badge(view.bookingServiceState.state, bookingTone)}
        </div>
      </div>
      <div class="card" data-test="trip-viability">
        <p class="kv-label">Whole trip viability</p>
        <div class="card-head">
          <div>
            <p class="card-title">${escapeHtml(view.tripViability.label)}</p>
            ${tripDetail}
          </div>
          ${badge(view.tripViability.verdict, tripTone)}
        </div>
      </div>
    </div>`;
}

function recoveryActionRow(action: RecoveryActionView): string {
  const tone = EXECUTION_STATE_TONE[action.executionState];
  const cost = action.cost ? `<span class="chip chip-cost">${escapeHtml(formatMoney({ amount: Number(action.cost.amount), currency: action.cost.currency }))}</span>` : '';
  const observation = action.observationResult
    ? `<span class="chip">${escapeHtml(action.observationResult)}</span>`
    : '';
  const dependsOn = action.dependsOnActionRefs ?? [];
  const depends =
    dependsOn.length > 0
      ? `<p class="b-extra">Depends on ${escapeHtml(dependsOn.join(', '))}</p>`
      : '';
  return `
    <div class="check-row ${action.executionState === 'COMPLETED' ? 'done' : action.executionState === 'FAILED' ? 'failed' : action.executionState === 'EXECUTING' || action.executionState === 'RECONCILING' ? 'doing' : 'queued'}" data-test="recovery-action" data-action-ref="${escapeHtml(action.actionRef)}">
      <span class="c-ic">${action.executionState === 'COMPLETED' ? '✓' : action.executionState === 'FAILED' ? '✕' : '○'}</span>
      <div>
        <div class="c-t">${escapeHtml(action.domain)} · ${escapeHtml(action.capability)}</div>
        <div class="b-extra">${escapeHtml(action.authorityState)}${action.approvalState ? ` · ${escapeHtml(action.approvalState)}` : ''}</div>
        ${depends}
        <div class="opt-flags">${cost}${observation}${badge(action.executionState, tone)}</div>
      </div>
      <span class="c-sub">#${action.dependencyOrder}</span>
    </div>`;
}

function partialRecoveryBlock(partial: PartialRecoveryView): string {
  return `
    <div class="callout tone-watch" data-test="partial-recovery">
      <h3>Partial recovery</h3>
      <p><strong>Succeeded:</strong> ${escapeHtml(partial.succeeded.join(', ') || 'None')}</p>
      <p><strong>Failed:</strong> ${escapeHtml(partial.failed.join(', ') || 'None')}</p>
      <p><strong>Pending:</strong> ${escapeHtml(partial.pending.join(', ') || 'None')}</p>
    </div>`;
}

function duplicateExposureBlock(exposures: readonly DuplicateBookingExposureView[]): string {
  const rows = exposures
    .map(
      (exposure) => `
      <div class="impact-row" data-test="duplicate-booking-exposure">
        <span class="i-count tone-alert">!</span>
        <div>
          <strong>Duplicate booking exposure</strong>
          <p class="b-extra">Replacement ${escapeHtml(exposure.replacementObservation)} on ${escapeHtml(exposure.displacedSubjectRef)}; displaced cancellation ${escapeHtml(exposure.displacedCancellationObservation)}.</p>
          ${exposure.detail ? `<p class="b-extra">${escapeHtml(exposure.detail)}</p>` : ''}
        </div>
      </div>`,
    )
    .join('');
  return `
    <div class="panel tone-alert" data-test="duplicate-exposure-panel">
      <h2>Duplicate booking exposure</h2>
      ${rows}
    </div>`;
}

function connectionProgressionBlock(progression: ConnectionProgression): string {
  const tone =
    progression === 'HEALTHY' || progression === 'CONNECTION_SAFE' || progression === 'RECOVERED'
      ? 'ok'
      : progression === 'CONNECTION_AT_RISK' || progression === 'AWAITING_APPROVAL' || progression === 'RECOVERY_PLANNING'
        ? 'watch'
        : progression === 'CONNECTION_IMPOSSIBLE' || progression === 'STILL_UNRESOLVED'
          ? 'alert'
          : 'active';
  return `
    <div class="callout tone-${tone}" data-test="connection-progression">
      <p class="callout-title">Connection progression</p>
      <p>${escapeHtml(CONNECTION_PROGRESSION_LABEL[progression])}</p>
    </div>`;
}

export function renderProductRecoveryCase(view: RecoveryCaseView): string {
  const actions =
    view.recoveryActions.length > 0
      ? `<div class="panel" data-test="recovery-actions"><h2>Recovery actions</h2>${view.recoveryActions.map(recoveryActionRow).join('')}</div>`
      : '';
  const partial = view.partialRecovery ? partialRecoveryBlock(view.partialRecovery) : '';
  const duplicate =
    view.duplicateBookingExposure.length > 0
      ? duplicateExposureBlock(view.duplicateBookingExposure)
      : '';
  const progression = view.connectionProgression
    ? connectionProgressionBlock(view.connectionProgression)
    : '';
  const remaining =
    view.remainingRecoveryWork.length > 0
      ? `<section class="section"><h2>Remaining recovery work</h2>${bulletList(view.remainingRecoveryWork, 'No remaining work listed.')}</section>`
      : '';
  const aggregateCost = view.aggregateRecoveryCost
    ? `<p class="meta">Aggregate recovery cost ${escapeHtml(formatMoney({ amount: Number(view.aggregateRecoveryCost.amount), currency: view.aggregateRecoveryCost.currency }))}</p>`
    : '';
  const requirementVsActual = view.requirementVsActual
    ? `<div class="callout tone-watch"><p class="callout-title">Requirement vs actual</p><p>Required: ${escapeHtml(view.requirementVsActual.requirement)}</p><p>Actual: ${escapeHtml(view.requirementVsActual.actual)}</p></div>`
    : '';

  return `
<main class="shell product-recovery-case" data-test="product-recovery-case">
  <div class="page-head">
    <h1>Recovery case ${escapeHtml(view.caseRef)} ${badge(view.status, view.status === 'RESOLVED' || view.status === 'CLOSED' ? 'done' : view.status === 'EXECUTING' ? 'active' : view.status === 'OPEN' || view.status === 'PLANNING' ? 'watch' : 'neutral')}</h1>
    <p class="sub">${escapeHtml(view.changeSummary)}</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))} · Authority ${escapeHtml(view.authorityState)} · Execution ${escapeHtml(view.executionState)} · Reconciliation ${escapeHtml(view.reconciliationState)}</p>
    ${aggregateCost}
  </div>
  ${progression}
  ${viabilityPair(view)}
  ${requirementVsActual}
  ${partial}
  ${duplicate}
  ${actions}
  ${remaining}
  ${uncertaintyList(view.uncertainty)}
  ${view.resolutionSummary ? `<div class="resolution is-full"><p class="res-title">Resolution</p><p>${escapeHtml(view.resolutionSummary)}</p></div>` : ''}
</main>`;
}
