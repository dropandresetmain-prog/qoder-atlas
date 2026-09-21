/** Current PostgreSQL Overview: V7.2 graph, compact readiness, sticky attention rail. */
import type { OperatorOverview } from '../../contracts/v2/product/readModels.ts';
import { adaptOperatorOverviewToDashboard, overviewCountedTotal } from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { SHELL_LINKS } from '../../app/target/productShell.ts';
import { escapeHtml } from '../html.ts';
import { renderEventOverviewGraph, renderOverviewGraphAssets } from '../overview-graph/index.ts';
import { renderOverviewRosterControllerScript } from '../overviewRosterController.ts';
import { renderOverviewWorkspaceScript } from '../operatorWorkspaceClient.ts';
import { OPERATOR_WORKSPACE_STYLES } from '../operatorWorkspaceStyles.ts';

function focusControl(options: readonly { tripRef: string; label: string; caseRef?: string }[]): string {
  if (options.length === 0) return '';
  const choices = options.map((option) => {
    const value = option.caseRef ?? option.tripRef;
    return `<option value="${escapeHtml(value)}">${escapeHtml(option.label)}</option>`;
  }).join('');
  return `<label class="v5-focus" data-overview-focus>Focus
    <select data-overview-focus-select aria-label="Incident focus">${choices}</select></label>`;
}

export function renderProductOperatorOverview(view: OperatorOverview): string {
  const surface = adaptOperatorOverviewToDashboard(view);
  const airlineConfigured = view.demoIngress?.airlineRebookingConfigured === true;
  const lifecycle = view.populationAssessmentLifecycle;
  const total = overviewCountedTotal(view);
  const organiser = view.eventContext?.organiserLabel;
  const eventTitle = view.eventContext?.title;
  const eyebrow = organiser ? `<p class="v5-eyebrow">${escapeHtml(organiser)}</p>` : '';
  const eventLine = eventTitle
    ? `<p class="sub" data-test="event-context">${escapeHtml(eventTitle)}</p>`
    : '';
  const active = surface.focusOptions[0]?.label;
  return `${OPERATOR_WORKSPACE_STYLES}
<main class="shell product-operator-overview v5-workspace" data-test="product-operator-overview" data-assessment-lifecycle="${lifecycle.state}" data-assessment-pending-count="${lifecycle.pendingCount}" data-stable-revision="${view.change.projectionRevision}">
  <div class="page-head" data-poll-region="overview-heading">${eyebrow}<h1>${escapeHtml(surface.title)}</h1>
    <p class="sub">See the event as a connected system, then go straight to the cases that need attention.</p>
    ${eventLine}
    <p class="sub" data-test="overview-reconciling"${lifecycle.state === 'RECONCILING' ? '' : ' hidden'}>Reconciling changes…</p></div>
  <div class="v5-overview-layout">
    <div class="v5-overview-main">
      <div class="v5-workspace-tabs">
        <div class="v5-tabs" role="tablist" aria-label="Overview views">
          <button type="button" class="v5-tab is-active" data-overview-tab="event" role="tab" aria-selected="true">Event health</button>
          <button type="button" class="v5-tab" data-overview-tab="participants" role="tab" aria-selected="false">All participants <span class="v5-count">${total}</span></button>
        </div>
        ${focusControl(surface.focusOptions)}
      </div>
      <section class="v5-panel" data-overview-panel="event">
        <div class="v5-active-context">${active ? `<strong data-test="overview-active-context">${escapeHtml(active)}</strong>` : '<span data-test="overview-active-context">No incident in focus</span>'}</div>
        ${renderOverviewGraphAssets()}${renderEventOverviewGraph(view)}
        <div data-poll-region="overview-summary">${surface.summaryHtml}</div>
      </section>
      <section class="v5-panel" data-overview-panel="participants" hidden>
        <div class="roster-tools" data-test="roster-filters">
          <button type="button" class="v5-tab" data-roster-filter="all" aria-pressed="true">All</button>
          <button type="button" class="v5-tab" data-roster-filter="attention" aria-pressed="false">Needs attention</button>
          <button type="button" class="v5-tab" data-roster-filter="watching" aria-pressed="false">Watching</button>
          <button type="button" class="v5-tab" data-roster-filter="unconfirmed" aria-pressed="false">Unconfirmed</button>
        </div>
        <div data-poll-region="overview-roster" aria-label="All participants">${surface.rosterHtml}</div>
      </section>
      <details class="section" data-test="simulated-airline-update" data-region-key="simulated-airline-update" data-configured="${airlineConfigured ? 'true' : 'false'}">
        <summary><strong>Simulated airline update</strong></summary>
        <p class="b-extra">Disclosed demo control: applies the organiser-supplied simulated airline cancellation and rebooking through the normal provider-event boundary.</p>
        <p data-test="simulated-airline-update-status" data-action-status class="sim-status">${airlineConfigured ? 'Ready. Applying posts a disclosed simulated provider event through the normal HTTP boundary.' : 'Demo trigger not configured on this runtime.'}</p>
        <button type="button" class="btn" data-test="simulated-airline-update-apply"${airlineConfigured ? '' : ' disabled'}>Apply simulated airline update</button>
      </details>
    </div>
    <aside class="v5-context-rail" aria-label="Needs attention">
      <h2 class="v5-rail-title">Needs attention <span>${surface.attentionCount} open ${surface.attentionCount === 1 ? 'story' : 'stories'}</span></h2>
      <div data-poll-region="overview-attention">${surface.attentionHtml}</div>
      <section class="v5-activity" aria-label="Northstar activity">
        <h2 class="v5-rail-title">Northstar activity</h2>
        <p class="sub">Observable activity stays on the activity log. This rail does not invent a second feed.</p>
        <p><a href="${SHELL_LINKS.activity}">View log →</a></p>
      </section>
    </aside>
  </div>
</main>${renderOverviewRosterControllerScript()}${renderOverviewWorkspaceScript()}`;
}
