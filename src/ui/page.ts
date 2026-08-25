/**
 * E2 — HTML document shell. Nav links are injected so the integrator (E3)
 * can map them onto real application routes; previews use relative files.
 *
 * The brand block is the only place the product wordmark lives; screens
 * never restate it. Theme is inlined (no static-asset dependency).
 */
import { THEME_CSS } from './theme.ts';
import { escapeHtml } from './html.ts';
import { renderFormEnhancementScript } from './interaction.ts';

export type NavTarget = 'dashboard' | 'programme' | 'case' | 'traveller';

export interface PageLinks {
  dashboard?: string;
  programme?: string;
  traveller?: string;
}

export interface PageOptions {
  title: string;
  active: NavTarget;
  links?: PageLinks;
  /** Traveller pages are mobile-first; nav collapses to a single link. */
  surface?: 'operator' | 'traveller';
  /**
   * Development/demo-only safety banner. When present, a clearly marked strip
   * is rendered above the page content showing the adapter mode and a brief
   * explanation of what external calls (if any) the current mode permits.
   * Must never be wired in production.
   */
  demoBanner?: {
    adapterMode: 'LIVE' | 'RECORD' | 'REPLAY';
    plannerMode?: 'MODEL_STUDIO' | 'DETERMINISTIC_FALLBACK';
  };
}

export function renderPage(options: PageOptions, bodyHtml: string): string {
  const dashboardHref = options.links?.dashboard ?? '#';
  const programmeHref = options.links?.programme;
  const travellerHref = options.links?.traveller ?? '#';
  const isOperator = options.surface !== 'traveller';
  const nav = isOperator
    ? `<nav aria-label="Main">
        <a href="${escapeHtml(dashboardHref)}" class="${options.active === 'dashboard' || options.active === 'case' ? 'is-active' : ''}">Operations</a>
        ${programmeHref ? `<a href="${escapeHtml(programmeHref)}" class="${options.active === 'programme' ? 'is-active' : ''}">Programme</a>` : ''}
        <a href="${escapeHtml(travellerHref)}" class="${options.active === 'traveller' ? 'is-active' : ''}">Traveller preview</a>
      </nav>`
    : `<nav aria-label="Main">
        <a href="${escapeHtml(dashboardHref)}">Operator view</a>
        ${programmeHref ? `<a href="${escapeHtml(programmeHref)}">Programme</a>` : ''}
      </nav>`;
  const banner = options.demoBanner
    ? renderDemoBanner(options.demoBanner)
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} · Northstar</title>
<style>${THEME_CSS}</style>
</head>
<body class="${isOperator ? 'surface-operator' : 'surface-traveller'}">
<header class="topbar" data-surface="${isOperator ? 'operator' : 'traveller'}">
  <div class="brand"><span class="mark" aria-hidden="true">✦</span>Northstar<small>keeps the whole trip working</small></div>
  ${nav}
</header>
${banner}
${bodyHtml}
${renderFormEnhancementScript()}
</body>
</html>`;
}

/**
 * Development/demo-only safety strip. Clearly marked so it is never confused
 * with a product control. Shows the adapter mode and a one-line explanation
 * of what the current mode permits.
 */
function renderDemoBanner(banner: {
  adapterMode: 'LIVE' | 'RECORD' | 'REPLAY';
  plannerMode?: 'MODEL_STUDIO' | 'DETERMINISTIC_FALLBACK';
}): string {
  const isReplay = banner.adapterMode === 'REPLAY';
  const modeLabel = isReplay ? 'DEMO MODE — REPLAY' : `LIVE MODE — ${banner.adapterMode}`;
  const modeNote = isReplay
    ? 'No external provider calls will be made. All data comes from local fixtures and recorded responses.'
    : banner.adapterMode === 'LIVE'
      ? 'LIVE mode: external provider APIs may be called. Provider-side state changes are possible.'
      : 'RECORD mode: external provider APIs are called and responses are recorded.';
  const plannerNote = banner.plannerMode === 'MODEL_STUDIO'
    ? ' AI planner: EXTERNAL AI API (Model Studio).'
    : ' AI planner: local deterministic (no external calls).';
  const toneClass = isReplay ? 'db-replay' : 'db-live';
  return `<div class="demo-banner ${toneClass}" role="status" aria-label="Demo mode indicator">
  <span class="db-mode">${escapeHtml(modeLabel)}</span>
  <span class="db-note">${escapeHtml(modeNote)}${escapeHtml(plannerNote)} <a href="/demo" class="db-link">Demo controls</a></span>
</div>`;
}
