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
  return `
<main class="shell product-operator-overview" data-test="product-operator-overview">
  <div class="page-head">
    <h1>${escapeHtml(surface.title)}</h1>
    <p class="sub">Managed travel readiness across the programme — state colour follows status meaning.</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  ${surface.summaryHtml}
  <section class="section" aria-label="Trips">
    <h2>All participants <span class="count">${overviewCountedTotal(view)}</span></h2>
    ${surface.itemsHtml}
  </section>
</main>`;
}
