/**
 * E2 — preview generator for human inspection.
 *
 * Renders every fixture state as a standalone HTML page under
 * `data/ui-preview/` (gitignored). Run: `node src/ui/preview.ts`.
 *
 * This is a lane-local inspection aid, not application code: the integrator
 * (E3/I5) serves the same renderers from real read-model endpoints.
 */
import { mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { renderPage, type PageOptions } from './page.ts';
import { renderOperatorDashboard } from './screens/operator-dashboard.ts';
import { renderProgramme } from './screens/operator-programme.ts';
import { renderCaseDetail } from './screens/operator-case.ts';
import { renderDecisions } from './screens/operator-decisions.ts';
import { renderActivity } from './screens/operator-activity.ts';
import { renderTravellerTrip } from './screens/traveller.ts';
import { escapeHtml } from './html.ts';
import type { ReadModelEnvelope } from '../contracts/readmodels.ts';
import type { CaseDetailView } from './case-view-model.ts';
import {
  CASE_FIXTURES,
  TRAVELLER_FIXTURES,
  TRAVELLER_PRESENTATIONS,
  activityError,
  activityLoaded,
  activityLoading,
  decisionsError,
  decisionsLoaded,
  decisionsLoading,
  operatorDashboardAlt,
  operatorDashboardError,
  operatorDashboardLoaded,
  operatorDashboardLoading,
  healthyProgrammeLoaded,
  programmeWithEndangeredCommitmentLoaded,
  programmeLoading,
  programmeError,
  travellerError,
  travellerLoading,
} from './fixtures/readmodels.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(repoRoot, 'data', 'ui-preview');
const assetsSource = path.join(repoRoot, 'fixtures', 'ui');
const renderAssetsSource = path.join(repoRoot, '..', 'ui-renders', 'docs', 'design-renders', 'assets');

const LINKS = {
  dashboard: 'operator-dashboard.html',
  programme: 'operator-programme.html',
  decisions: 'operator-decisions.html',
  activity: 'operator-activity.html',
  traveller: 'traveller-awaiting-input.html',
};

interface GeneratedPage {
  file: string;
  title: string;
  html: string;
}

function page(file: string, title: string, options: PageOptions, bodyHtml: string): GeneratedPage {
  const isTraveller = options.surface === 'traveller';
  return {
    file,
    title,
    html: renderPage(
      {
        ...options,
        links: LINKS,
        ...(isTraveller
          ? {}
          : {
              decisionCount: 2,
              eventName: options.eventName ?? 'Innovation Summit 2026',
              operatorInitials: options.operatorInitials ?? 'AK',
              demoBanner: options.demoBanner ?? { adapterMode: 'REPLAY' },
            }),
      },
      bodyHtml,
    ),
  };
}

function buildPages(): GeneratedPage[] {
  const pages: GeneratedPage[] = [
    page('operator-dashboard.html', 'Operations overview', { title: 'Operations overview', active: 'dashboard' }, renderOperatorDashboard(operatorDashboardLoaded)),
    page('operator-dashboard-alt.html', 'Operations overview — alternate dataset', { title: 'Operations overview', active: 'dashboard' }, renderOperatorDashboard({ state: 'LOADED', data: operatorDashboardAlt } satisfies ReadModelEnvelope<typeof operatorDashboardAlt>)),
    page('operator-dashboard-loading.html', 'Operations overview — loading', { title: 'Operations overview', active: 'dashboard' }, renderOperatorDashboard(operatorDashboardLoading)),
    page('operator-dashboard-error.html', 'Operations overview — error', { title: 'Operations overview', active: 'dashboard' }, renderOperatorDashboard(operatorDashboardError)),
    page('operator-programme.html', 'Programme', { title: 'Programme', active: 'programme' }, renderProgramme(healthyProgrammeLoaded)),
    page('operator-programme-p2.html', 'Programme — endangered commitments', { title: 'Programme', active: 'programme' }, renderProgramme(programmeWithEndangeredCommitmentLoaded)),
    page('operator-programme-loading.html', 'Programme — loading', { title: 'Programme', active: 'programme' }, renderProgramme(programmeLoading)),
    page('operator-programme-error.html', 'Programme — error', { title: 'Programme', active: 'programme' }, renderProgramme(programmeError)),
    page('operator-decisions.html', 'Decisions', { title: 'Decisions', active: 'decisions' }, renderDecisions(decisionsLoaded)),
    page('operator-decisions-loading.html', 'Decisions — loading', { title: 'Decisions', active: 'decisions' }, renderDecisions(decisionsLoading)),
    page('operator-decisions-error.html', 'Decisions — error', { title: 'Decisions', active: 'decisions' }, renderDecisions(decisionsError)),
    page('operator-activity.html', 'Activity', { title: 'Activity', active: 'activity' }, renderActivity(activityLoaded)),
    page('operator-activity-loading.html', 'Activity — loading', { title: 'Activity', active: 'activity' }, renderActivity(activityLoading)),
    page('operator-activity-error.html', 'Activity — error', { title: 'Activity', active: 'activity' }, renderActivity(activityError)),
  ];
  for (const fixture of CASE_FIXTURES) {
    const envelope: ReadModelEnvelope<CaseDetailView> = { state: 'LOADED', data: fixture.view };
    pages.push(
      page(`case-${fixture.id}.html`, `Case — ${fixture.title}`, { title: fixture.title, active: 'case' }, renderCaseDetail(envelope)),
    );
  }
  for (const fixture of TRAVELLER_FIXTURES) {
    pages.push(
      page(`traveller-${fixture.id}.html`, `Traveller — ${fixture.title}`, { title: fixture.title, active: 'traveller', surface: 'traveller' }, renderTravellerTrip({ state: 'LOADED', data: fixture.view }, TRAVELLER_PRESENTATIONS[fixture.id])),
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
  return renderPage({ title: 'UI preview', active: 'dashboard', links: LINKS, eventName: 'Innovation Summit 2026', operatorInitials: 'AK', demoBanner: { adapterMode: 'REPLAY' } }, `
<main class="shell">
  <div class="page-head">
    <h1>UI preview — Lane E</h1>
    <p class="sub">Every screen rendered from typed fixtures against the frozen read-model contracts. No live backend is wired in this lane.</p>
  </div>
  <div class="panel"><ul class="plain-list">${links}</ul></div>
</main>`);
}

async function copyAssetsFrom(source: string): Promise<number> {
  try {
    const assetFiles = (await readdir(source)).filter((f) => !f.startsWith('.'));
    if (assetFiles.length === 0) return 0;
    const assetsOut = path.join(outDir, 'assets');
    await mkdir(assetsOut, { recursive: true });
    for (const file of assetFiles) {
      await copyFile(path.join(source, file), path.join(assetsOut, file));
    }
    return assetFiles.length;
  } catch {
    return 0;
  }
}

const pages = buildPages();
await mkdir(outDir, { recursive: true });
for (const generated of pages) {
  await writeFile(path.join(outDir, generated.file), generated.html, 'utf8');
}
await writeFile(path.join(outDir, 'index.html'), indexPage(pages), 'utf8');

const copiedLocal = await copyAssetsFrom(assetsSource);
const copiedRenders = copiedLocal > 0 ? 0 : await copyAssetsFrom(renderAssetsSource);
if (copiedLocal + copiedRenders === 0) {
  console.log('No fixtures/ui or render assets found; heroes render as ink gradients.');
}

console.log(`Wrote ${pages.length + 1} preview pages to ${outDir}`);
console.log(`Open: ${pathToFileURL(path.join(outDir, 'index.html')).href}`);
