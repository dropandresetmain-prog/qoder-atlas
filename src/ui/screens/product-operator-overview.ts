/**
 * M9 — product operator overview surface from v2 OperatorOverview read models.
 * Structural, truthful rendering using the approved state palette (DESIGN.md).
 */
import type { OperatorOverview } from '../../contracts/v2/product/readModels.ts';
import {
  adaptOperatorOverviewToDashboard,
  overviewCountedTotal,
} from '../../app/target/adapters/operatorOverviewAdapter.ts';
import { escapeHtml, formatInstant } from '../html.ts';

export function renderProductOperatorOverview(view: OperatorOverview): string {
  const surface = adaptOperatorOverviewToDashboard(view);
  const demoIngress = (view as { demoIngress?: { airlineRebookingConfigured?: boolean } }).demoIngress;
  const airlineConfigured = demoIngress?.airlineRebookingConfigured === true;
  return `
<main class="shell product-operator-overview" data-test="product-operator-overview">
  <div class="page-head">
    <h1>${escapeHtml(surface.title)}</h1>
    <p class="sub">Managed travel readiness across the programme — state colour follows status meaning.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  ${surface.summaryHtml}
  <details class="section" data-test="simulated-airline-update" data-configured="${airlineConfigured ? "true" : "false"}">
    <summary><strong>Simulated airline update</strong></summary>
    <p class="b-extra">Disclosed demo control: applies the organiser-supplied simulated airline cancellation and rebooking through the normal provider-event boundary.</p>
    <p data-test="simulated-airline-update-status" class="sim-status">${airlineConfigured ? "Ready. Applying posts a disclosed simulated provider event through the normal HTTP boundary." : "Demo trigger not configured on this runtime."}</p>
    <button type="button" class="btn" data-test="simulated-airline-update-apply"${airlineConfigured ? "" : " disabled"}>Apply simulated airline update</button>
  </details>
  <section class="section" aria-label="Trips">
    <h2>All participants <span class="count">${overviewCountedTotal(view)}</span></h2>
    ${surface.itemsHtml}
  </section>
</main>`;
}
