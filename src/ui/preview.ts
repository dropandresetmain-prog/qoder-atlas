/**
 * E2 — preview generator for human inspection.
 *
 * Renders every fixture state as a standalone HTML page under
 * `data/ui-preview/` (gitignored). Run: `node src/ui/preview.ts`.
 *
 * This is a lane-local inspection aid, not application code: the integrator
 * (E3/I5) serves the same renderers from real read-model endpoints.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { renderPage, type PageOptions } from './page.ts';
import { renderOperatorDashboard } from './screens/operator-dashboard.ts';
import { renderCaseDetail } from './screens/operator-case.ts';
import { renderTravellerTrip } from './screens/traveller.ts';
import { escapeHtml } from './html.ts';
import type { ReadModelEnvelope } from '../contracts/readmodels.ts';
import type { CaseDetailView } from './case-view-model.ts';
import {
  CASE_FIXTURES,
  TRAVELLER_FIXTURES,
  operatorDashboardAlt,
  operatorDashboardError,
  operatorDashboardLoaded,
  operatorDashboardLoading,
  travellerError,
  travellerLoading,
} from './fixtures/readmodels.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(repoRoot, 'data', 'ui-preview');

const LINKS = { dashboard: 'operator-dashboard.html', traveller: 'traveller-awaiting-input.html' };

interface GeneratedPage {
  file: string;
  title: string;
  html: string;
}

function page(file: string, title: string, options: PageOptions, bodyHtml: string): GeneratedPage {
  return { file, title, html: renderPage({ ...options, links: LINKS }, bodyHtml) };
}

function buildPages(): GeneratedPage[] {
  const pages: GeneratedPage[] = [
    page('operator-dashboard.html', 'Operations overview', { title: 'Operations overview', active: 'dashboard' }, renderOperatorDashboard(operatorDashboardLoaded)),
    page('operator-dashboard-alt.html', 'Operations overview — alternate dataset', { title: 'Operations overview', active: 'dashboard' }, renderOperatorDashboard({ state: 'LOADED', data: operatorDashboardAlt } satisfies ReadModelEnvelope<typeof operatorDashboardAlt>)),
    page('operator-dashboard-loading.html', 'Operations overview — loading', { title: 'Operations overview', active: 'dashboard' }, renderOperatorDashboard(operatorDashboardLoading)),
    page('operator-dashboard-error.html', 'Operations overview — error', { title: 'Operations overview', active: 'dashboard' }, renderOperatorDashboard(operatorDashboardError)),
  ];
  for (const fixture of CASE_FIXTURES) {
    const envelope: ReadModelEnvelope<CaseDetailView> = { state: 'LOADED', data: fixture.view };
    pages.push(
      page(`case-${fixture.id}.html`, `Case — ${fixture.title}`, { title: fixture.title, active: 'case' }, renderCaseDetail(envelope)),
    );
  }
  for (const fixture of TRAVELLER_FIXTURES) {
    pages.push(
      page(`traveller-${fixture.id}.html`, `Traveller — ${fixture.title}`, { title: fixture.title, active: 'traveller', surface: 'traveller' }, renderTravellerTrip({ state: 'LOADED', data: fixture.view })),
    );
  }
  pages.push(
    page('traveller-loading.html', 'Traveller — loading', { title: 'Your trip', active: 'traveller', surface: 'traveller' }, renderTravellerTrip(travellerLoading)),
    page('traveller-error.html', 'Traveller — error', { title: 'Your trip', active: 'traveller', surface: 'traveller' }, renderTravellerTrip(travellerError)),
  );
  return pages;
}

function indexPage(pages: GeneratedPage[]): string {
  const links = pages
    .map((p) => `<li><a href="${escapeHtml(p.file)}">${escapeHtml(p.title)}</a></li>`)
    .join('\n');
  return renderPage({ title: 'UI preview', active: 'dashboard', links: LINKS }, `
<main class="shell">
  <div class="page-head">
    <h1>UI preview — Lane E</h1>
    <p class="sub">Every screen rendered from typed fixtures against the frozen read-model contracts. No live backend is wired in this lane.</p>
  </div>
  <div class="panel"><ul class="plain-list">${links}</ul></div>
</main>`);
}

const pages = buildPages();
await mkdir(outDir, { recursive: true });
for (const generated of pages) {
  await writeFile(path.join(outDir, generated.file), generated.html, 'utf8');
}
await writeFile(path.join(outDir, 'index.html'), indexPage(pages), 'utf8');

console.log(`Wrote ${pages.length + 1} preview pages to ${outDir}`);
console.log(`Open: ${pathToFileURL(path.join(outDir, 'index.html')).href}`);
