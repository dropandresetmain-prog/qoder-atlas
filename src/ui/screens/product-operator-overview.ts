/** Current PostgreSQL Overview: readiness -> explicit case queue -> event context. */
import type { OperatorOverview } from '../../contracts/v2/product/readModels.ts';
import { adaptOperatorOverviewToDashboard, overviewCountedTotal } from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import { renderEventOverviewGraph, renderOverviewGraphAssets } from '../overview-graph/index.ts';
import { renderOverviewRosterControllerScript } from '../overviewRosterController.ts';
import { OPERATOR_WORKSPACE_STYLES } from '../operatorWorkspaceStyles.ts';

export function renderProductOperatorOverview(view: OperatorOverview): string {
  const surface = adaptOperatorOverviewToDashboard(view);
  const airlineConfigured = view.demoIngress?.airlineRebookingConfigured === true;
  const lifecycle = view.populationAssessmentLifecycle;
  return `${OPERATOR_WORKSPACE_STYLES}
<main class="shell product-operator-overview" data-test="product-operator-overview" data-assessment-lifecycle="${lifecycle.state}" data-assessment-pending-count="${lifecycle.pendingCount}" data-stable-revision="${view.change.projectionRevision}">
  <div class="page-head" data-poll-region="overview-heading"><h1>${escapeHtml(surface.title)}</h1>
    <p class="sub">Who is on track, what changed, and where your attention is needed.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
    <p class="sub" data-test="overview-reconciling"${lifecycle.state === 'RECONCILING' ? '' : ' hidden'}>Reconciling changes…</p></div>
  <div data-poll-region="overview-summary">${surface.summaryHtml}</div>
  <section class="section" aria-label="Needs attention" data-poll-region="overview-attention">
    <h2>Needs attention <span class="count${surface.attentionCount > 0 ? ' c-alert' : ''}">${surface.attentionCount}</span></h2>
    ${surface.attentionHtml}</section>
  ${renderOverviewGraphAssets()}${renderEventOverviewGraph(view)}
  <section class="section" aria-label="All participants" data-poll-region="overview-roster">
    <h2>All participants <span class="count">${overviewCountedTotal(view)}</span></h2>${surface.rosterHtml}</section>
  <details class="section" data-test="simulated-airline-update" data-region-key="simulated-airline-update" data-configured="${airlineConfigured ? 'true' : 'false'}">
    <summary><strong>Simulated airline update</strong></summary>
    <p class="b-extra">Disclosed demo control: applies the organiser-supplied simulated airline cancellation and rebooking through the normal provider-event boundary.</p>
    <p data-test="simulated-airline-update-status" data-action-status class="sim-status">${airlineConfigured ? 'Ready. Applying posts a disclosed simulated provider event through the normal HTTP boundary.' : 'Demo trigger not configured on this runtime.'}</p>
    <button type="button" class="btn" data-test="simulated-airline-update-apply"${airlineConfigured ? '' : ' disabled'}>Apply simulated airline update</button>
  </details>
</main>${renderOverviewRosterControllerScript()}`;
}
