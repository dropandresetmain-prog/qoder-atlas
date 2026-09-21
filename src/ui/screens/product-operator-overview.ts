/** Current PostgreSQL Overview: V7.2 graph, compact readiness, sticky attention rail. */
import type { ActivityFeed, OperatorOverview } from '../../contracts/v2/product/readModels.ts';
import { adaptOperatorOverviewToDashboard, overviewCountedTotal } from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { SHELL_LINKS } from '../../app/target/productShell.ts';
import { escapeHtml } from '../html.ts';
import { renderEventOverviewGraph, renderOverviewGraphAssets } from '../overview-graph/index.ts';
import { buildOverviewGraphModel } from '../overview-graph/model.ts';
import { renderOverviewRosterControllerScript } from '../overviewRosterController.ts';
import { renderOverviewWorkspaceScript } from '../operatorWorkspaceClient.ts';
import { OPERATOR_WORKSPACE_STYLES } from '../operatorWorkspaceStyles.ts';
import { renderCompactActivityRail } from './product-activity-feed.ts';

export interface ProductOperatorOverviewOptions {
  /** Latest real ActivityFeed for the compact right rail. Not owned by OperatorOverview. */
  readonly activity?: ActivityFeed;
}

function focusControl(label: string | undefined): string {
  if (!label) return '';
  return `<p class="v5-focus" data-overview-focus data-test="overview-focus">Focus <strong>${escapeHtml(label)}</strong></p>`;
}

export function renderProductOperatorOverview(
  view: OperatorOverview,
  options: ProductOperatorOverviewOptions = {},
): string {
  const surface = adaptOperatorOverviewToDashboard(view);
  const airlineConfigured = view.demoIngress?.airlineRebookingConfigured === true;
  const lifecycle = view.populationAssessmentLifecycle;
  const total = overviewCountedTotal(view);
  const organiser = view.eventContext?.organiserLabel;
  const eventTitle = view.eventContext?.title;
  const eyebrow = organiser ? `<p class="v5-eyebrow">${escapeHtml(organiser)}</p>` : '';
  const eventLine = eventTitle
    ? `<p class="v5-event-meta" data-test="event-context">${escapeHtml(eventTitle)}</p>`
    : '';
  const active = buildOverviewGraphModel(view)?.focus?.unresolvedTravellerLabel;
  // The topline states WHAT is in focus; the tab-row control states THAT focus is
  // set. Carrying the already-presented change sentence here stops the two reading
  // as the same sentence twice.
  const activeContext = active
    ? surface.focusOptions.find((option) => option.label === active)?.context
    : undefined;
  return `${OPERATOR_WORKSPACE_STYLES}
<main class="shell product-operator-overview v5-workspace" data-test="product-operator-overview" data-assessment-lifecycle="${lifecycle.state}" data-assessment-pending-count="${lifecycle.pendingCount}" data-stable-revision="${view.change.projectionRevision}">
  <div class="page-head v5-page-head" data-poll-region="overview-heading">
    <div class="v5-page-head-main">${eyebrow}<h1>${escapeHtml(surface.title)}</h1>
      <p class="sub">See the event as a connected system, then go straight to the cases that need attention.</p>
      <p class="sub" data-test="overview-reconciling"${lifecycle.state === 'RECONCILING' ? '' : ' hidden'}>Reconciling changes…</p></div>
    <div class="v5-page-head-aside">${eventLine}<div data-poll-region="overview-summary">${surface.summaryHtml}</div></div></div>
  <div class="v5-overview-layout">
    <div class="v5-overview-main">
      <div class="v5-workspace-tabs">
        <div class="v5-tabs" role="tablist" aria-label="Overview views">
          <button type="button" class="v5-tab is-active" data-overview-tab="event" role="tab" aria-selected="true">Event health</button>
          <button type="button" class="v5-tab" data-overview-tab="participants" role="tab" aria-selected="false">All participants <span class="v5-count">${total}</span></button>
        </div>
        ${focusControl(active)}
      </div>
      <section class="v5-panel" data-overview-panel="event">
        <div class="v5-active-context">${active
          ? `<strong data-test="overview-active-context">${escapeHtml(active)}</strong>${activeContext ? `<span class="v5-context-slash" aria-hidden="true">/</span><span class="v5-context-what">${escapeHtml(activeContext)}</span>` : ''}`
          : '<span data-test="overview-active-context">No incident in focus</span>'}</div>
        ${renderOverviewGraphAssets()}${renderEventOverviewGraph(view)}
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
      <div data-poll-region="overview-activity">${renderCompactActivityRail(options.activity, { limit: 4, logHref: SHELL_LINKS.activity })}</div>
    </aside>
  </div>
</main>${renderOverviewRosterControllerScript()}${renderOverviewWorkspaceScript()}`;
}
