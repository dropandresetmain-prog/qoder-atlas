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
  RecoveryStrategyChangeView,
  RecoveryStrategyView,
} from '../../contracts/v2/product/readModels.ts';
import {
  assessmentToneClass,
  ldgSemanticTone,
} from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { escapeHtml, formatInstant, formatMoney, formatShort } from '../html.ts';
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

/**
 * One line of "what this option actually changes", built from the strategy's
 * own persisted ScenarioChange effect joined to canonical programme state.
 *
 * FB1-6: the founder saw two VIABLE options rendered as a truncated UUID and
 * a version number and could not tell them apart. They were never duplicates
 * — the deterministic proposer emits one option per distinct programme swap
 * pair, so two options genuinely move the same blocked item into two
 * different slots. Saying which slot is the whole difference, so that is what
 * this renders. Nothing is generated or inferred: when the read model has no
 * window for a subject, the line simply says less.
 */
function strategyChangeLine(change: RecoveryStrategyChangeView): string {
  const label = `<strong>${escapeHtml(change.subjectLabel)}</strong>`;
  if (change.proposedWindow && change.currentWindow) {
    // `currentWindow` is canonical state read now, and `proposedWindow` is
    // what this option asked for. Once an approved option has executed, the
    // two are equal — so say the change is already in effect rather than
    // printing a "from 06:30 to 06:30" move that reads like a bug.
    const alreadyInEffect = change.currentWindow.start === change.proposedWindow.start
      && change.currentWindow.end === change.proposedWindow.end;
    if (alreadyInEffect) {
      return `<li data-test="strategy-change" data-change-state="IN_EFFECT" data-subject-ref="${escapeHtml(change.subjectRef)}">
        ${label} is already at ${escapeHtml(formatShort(change.proposedWindow.start))}–${escapeHtml(formatShort(change.proposedWindow.end))}
      </li>`;
    }
    return `<li data-test="strategy-change" data-change-state="PROPOSED" data-subject-ref="${escapeHtml(change.subjectRef)}">
      Move ${label} from ${escapeHtml(formatShort(change.currentWindow.start))} to ${escapeHtml(formatShort(change.proposedWindow.start))}
      <span class="meta">(${escapeHtml(formatShort(change.proposedWindow.start))}–${escapeHtml(formatShort(change.proposedWindow.end))})</span>
    </li>`;
  }
  if (change.proposedWindow) {
    return `<li data-test="strategy-change" data-subject-ref="${escapeHtml(change.subjectRef)}">
      Set ${label} to ${escapeHtml(formatShort(change.proposedWindow.start))}–${escapeHtml(formatShort(change.proposedWindow.end))}
    </li>`;
  }
  return `<li data-test="strategy-change" data-subject-ref="${escapeHtml(change.subjectRef)}">
    ${escapeHtml(change.effectKind.toLowerCase().split('_').join(' '))} · ${label}
  </li>`;
}

/** "Sarah Lim: at risk -> confirmed" — who the option fixes, per case subject. */
function strategyResolveLine(resolve: RecoveryStrategyView['resolves'][number]): string {
  const tone = resolve.projectedVerdict === 'PASS' ? 'done' : resolve.projectedVerdict === 'FAIL' ? 'failed' : 'neutral';
  return `<li data-test="strategy-resolves" data-subject-ref="${escapeHtml(resolve.subjectRef)}">
    ${escapeHtml(resolve.personLabel)} ${badge(resolve.currentVerdict, 'failed')} → ${badge(resolve.projectedVerdict, tone)}
  </li>`;
}

/**
 * One recovery option as a card the operator can read and choose.
 *
 * The real `strategyRef` remains the value the Approve control carries — the
 * option number is presentation only, and internal refs/version stay as
 * secondary metadata rather than the headline.
 */
function strategyCard(strategy: RecoveryStrategyView, terminal: boolean): string {
  const approvable = !terminal
    && strategy.viability === 'VIABLE'
    && (strategy.status === 'EVALUATED' || strategy.status === 'PROPOSED');
  const changes = strategy.changes.length > 0
    ? `<ul class="opt-changes">${strategy.changes.map(strategyChangeLine).join('')}</ul>`
    : '<p class="meta">This option records no programme change.</p>';
  const resolves = strategy.resolves.length > 0
    ? `<ul class="opt-resolves">${strategy.resolves.map(strategyResolveLine).join('')}</ul>`
    : '';
  // The full reached set is large by design (it is the dependency closure the
  // evaluator actually assessed), so it is summarised rather than listed. The
  // complete per-subject list stays available on the JSON read model.
  const summary = strategy.projectedSummary;
  const reach = summary.total > 0
    ? `<p class="meta" data-test="strategy-reach">Assessed against ${summary.total} reached ${summary.total === 1 ? 'subject' : 'subjects'}: ${summary.pass} pass · ${summary.fail} fail · ${summary.unknown} unknown.</p>`
    : '';
  return `<li class="strategy-row opt-card" data-test="recovery-strategy" data-strategy-ref="${escapeHtml(strategy.strategyRef)}" data-option-number="${strategy.optionNumber}">
    <div class="opt-head">
      <h3 class="opt-title">Option ${strategy.optionNumber}</h3>
      <div class="opt-flags">${badge(strategy.viability, strategy.viability === 'VIABLE' ? 'done' : 'neutral')}${badge(strategy.status, 'neutral')}</div>
    </div>
    ${changes}
    ${resolves}
    ${reach}
    <p class="meta opt-ref">Strategy <span class="mono">${escapeHtml(strategy.strategyRef)}</span> · v${strategy.version}</p>
    ${approvable ? `<button type="button" class="btn" data-test="approve-strategy" data-strategy-ref="${escapeHtml(strategy.strategyRef)}">Approve Option ${strategy.optionNumber} and execute</button>` : ''}
  </li>`;
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
  // T3: cause and causal path come from the read model (change signal +
  // evaluator explanations). Rendered verbatim — no inference here.
  const cause = view.cause
    ? `<div class="callout tone-watch" data-test="case-cause"><p class="callout-title">Cause</p><p>${escapeHtml(view.cause.changeType)} · ${escapeHtml(view.cause.originKind)} · received ${escapeHtml(formatInstant(view.cause.receivedAt))}${view.cause.applied ? '' : ' · application in progress'}</p></div>`
    : '';
  // B1: operator controls over the normal application routes. The buttons
  // only POST and re-read; every outcome shown is the server's own response.
  const terminal = view.status === 'RESOLVED' || view.status === 'CLOSED' || view.status === 'CANCELLED' || view.status === 'SUPERSEDED';
  const strategyRows = view.strategies.map((strategy) => strategyCard(strategy, terminal)).join('');
  // Several viable options are alternatives, not revisions of one another:
  // each is a different change to the programme. Say so, so the operator
  // knows they are choosing rather than looking at duplicates.
  const viableCount = view.strategies.filter((strategy) => strategy.viability === 'VIABLE').length;
  const choiceNote = viableCount > 1
    ? `<p class="meta" data-test="strategy-choice-note">${viableCount} viable options — each changes the programme differently. Choose one.</p>`
    : '';
  const recoveryControls = `<section class="section" data-test="recovery-controls" data-case-ref="${escapeHtml(view.caseRef)}">
    <h2>Recovery options</h2>
    ${terminal ? '' : `<button type="button" class="btn" data-test="propose-strategies">Propose recovery options</button>`}
    <p class="meta" data-test="recovery-controls-status"></p>
    ${choiceNote}
    <ul class="strategy-list">${strategyRows || '<li class="meta">No options proposed yet.</li>'}</ul>
  </section>`;
  const controlsScript = terminal ? '' : `<script>
(function () {
  'use strict';
  var root = document.querySelector('[data-test="recovery-controls"]');
  if (!root) return;
  var caseRef = root.getAttribute('data-case-ref');
  var status = root.querySelector('[data-test="recovery-controls-status"]');
  function say(text) { if (status) status.textContent = text; }
  function post(path, done) {
    fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
      .then(done)
      .catch(function (e) { say('Request failed: ' + e); });
  }
  root.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.getAttribute('data-test') === 'propose-strategies') {
      target.disabled = true;
      say('Proposing and evaluating options…');
      post('/api/v2/cases/' + encodeURIComponent(caseRef) + '/strategies', function (r) {
        if (!r.ok) { say('Refused (' + r.status + '): ' + (r.body && r.body.error ? r.body.error.message : '')); target.disabled = false; return; }
        var rep = r.body.report;
        say('Evaluated ' + rep.candidates.length + ' option(s); ' + rep.candidates.filter(function (c) { return c.viability === 'VIABLE'; }).length + ' viable. Reloading…');
        window.location.reload();
      });
    }
    if (target.getAttribute('data-test') === 'approve-strategy') {
      var strategyRef = target.getAttribute('data-strategy-ref');
      target.disabled = true;
      say('Recording authority decision and approval…');
      post('/api/v2/cases/' + encodeURIComponent(caseRef) + '/strategies/' + encodeURIComponent(strategyRef) + '/approve', function (r) {
        if (!r.ok) { say('Refused (' + r.status + '): ' + (r.body && r.body.error ? r.body.error.message : '')); target.disabled = false; return; }
        say('Approved by ' + r.body.principal.id.slice(0, 8) + '; execution and reassessment run in the background. Reloading…');
        window.location.reload();
      });
    }
  });
})();
</script>`;
  const causalPath = view.causalPath.length > 0
    ? `<section class="section" data-test="case-causal-path"><h2>Why</h2><ul>${view.causalPath
        .map((step) => {
          const facts = Object.entries(step.facts)
            .map(([key, value]) => `${escapeHtml(key)}=${escapeHtml(value === null ? 'null' : String(value))}`)
            .join(', ');
          return `<li><strong>${escapeHtml(step.dimension)}</strong> ${escapeHtml(step.reasonCode)} <span class="meta">${escapeHtml(step.subjectRef)}${facts ? ` · ${facts}` : ''}</span></li>`;
        })
        .join('')}</ul></section>`
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
  ${cause}
  ${viabilityPair(view)}
  ${requirementVsActual}
  ${causalPath}
  ${recoveryControls}
  ${partial}
  ${duplicate}
  ${actions}
  ${remaining}
  ${uncertaintyList(view.uncertainty)}
  ${view.resolutionSummary ? `<div class="resolution is-full"><p class="res-title">Resolution</p><p>${escapeHtml(view.resolutionSummary)}</p></div>` : ''}
</main>
${controlsScript}`;
}
