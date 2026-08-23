/**
 * E2 — HTML document shell. Nav links are injected so the integrator (E3)
 * can map them onto real application routes; previews use relative files.
 *
 * The brand block is the only place the product wordmark lives; screens
 * never restate it. Theme is inlined (no static-asset dependency).
 */
import { THEME_CSS } from './theme.ts';
import { escapeHtml } from './html.ts';

export type NavTarget = 'dashboard' | 'case' | 'traveller';

export interface PageLinks {
  dashboard?: string;
  traveller?: string;
}

export interface PageOptions {
  title: string;
  active: NavTarget;
  links?: PageLinks;
  /** Traveller pages are mobile-first; nav collapses to a single link. */
  surface?: 'operator' | 'traveller';
}

export function renderPage(options: PageOptions, bodyHtml: string): string {
  const dashboardHref = options.links?.dashboard ?? '#';
  const travellerHref = options.links?.traveller ?? '#';
  const isOperator = options.surface !== 'traveller';
  const nav = isOperator
    ? `<nav aria-label="Main">
        <a href="${escapeHtml(dashboardHref)}" class="${options.active === 'dashboard' ? 'is-active' : ''}">Operations overview</a>
        <a href="${escapeHtml(travellerHref)}" class="${options.active === 'traveller' ? 'is-active' : ''}">Traveller view</a>
      </nav>`
    : `<nav aria-label="Main">
        <a href="${escapeHtml(dashboardHref)}">Operator view</a>
      </nav>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} · Northstar</title>
<style>${THEME_CSS}</style>
</head>
<body class="${isOperator ? 'surface-operator' : 'surface-traveller'}">
<header class="topbar">
  <div class="brand"><span class="mark" aria-hidden="true">✦</span>Northstar<small>keeps the whole trip working</small></div>
  ${nav}
</header>
${bodyHtml}
</body>
</html>`;
}
