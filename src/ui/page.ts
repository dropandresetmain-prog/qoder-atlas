/**
 * E2 — HTML document shell. Nav links are injected so the integrator (E3)
 * can map them onto real application routes; previews use relative files.
 *
 * The brand block is the only place the product wordmark lives; screens
 * never restate it. Theme is inlined (no static-asset dependency).
 *
 * Operator chrome implements the approved shell: brand · event select ·
 * primary nav (Overview / Programme / Decisions+count / Activity) ·
 * mode pill + operator avatar on the right. Traveller pages render no
 * operator chrome — the traveller screen owns its own `.t-topbar` inside
 * the mobile-first shell.
 */
import { THEME_CSS } from './theme.ts';
import { escapeHtml } from './html.ts';
import { renderFormEnhancementScript } from './interaction.ts';
import { renderProgrammeChangeEnhancementScript } from './programme-change-interaction.ts';
import { renderCaseResolutionEnhancementScript } from './case-resolution-interaction.ts';
import { renderShellRuntimeScript } from './shellRuntime.ts';

export type NavTarget = 'dashboard' | 'programme' | 'case' | 'decisions' | 'activity' | 'traveller';

export interface PageLinks {
  dashboard?: string;
  programme?: string;
  decisions?: string;
  activity?: string;
  traveller?: string;
}

export interface PageOptions {
  title: string;
  active: NavTarget;
  links?: PageLinks;
  /** Traveller pages are mobile-first and render without the operator top bar. */
  surface?: 'operator' | 'traveller';
  /** Programme/event name shown in the shell's event select when known. */
  eventName?: string;
  /** Open decision count shown as the alert pill on the Decisions nav item. */
  decisionCount?: number;
  /** Operator initials for the shell avatar. Omitted when no identity is known. */
  operatorInitials?: string;
  /**
   * When present, the top-right profile menu offers this reset action as a
   * secondary/admin control (never on the primary surface itself).
   */
  profileResetAction?: string;
  /**
   * Development/demo-only safety banner. When present, a clearly marked strip
   * is rendered above the page content showing the adapter mode and a brief
   * explanation of what external calls (if any) the current mode permits.
   * Must never be wired in production.
   */
  /**
   * Render the persistent `Reset demo` control (data-action="reset-demo").
   * Set only on runtimes where the backend reset gate is open; the shell
   * never decides that itself.
   */
  resetDemo?: boolean;
  /**
   * Faint Demo Console link (opens `/demo/control` in a new tab). Only when
   * the demo/reset gate is open — same gate as resetDemo.
   */
  demoConsole?: boolean;
  /** Back link rendered above the page body (`renderBackLink`). */
  backLink?: { label: string; href: string };
  demoBanner?: {
    adapterMode: 'LIVE' | 'RECORD' | 'REPLAY';
    plannerMode?: 'MODEL_STUDIO' | 'OPENROUTER' | 'DETERMINISTIC_FALLBACK';
  };
}

export function renderPage(options: PageOptions, bodyHtml: string): string {
  const isOperator = options.surface !== 'traveller';
  const banner = options.demoBanner
    ? renderDemoBanner(options.demoBanner)
    : '';
  const chrome = isOperator ? renderOperatorTopbar(options) : '';
  const programmeChangeScript = isOperator
    ? renderProgrammeChangeEnhancementScript()
    : '';
  const caseResolutionScript = isOperator
    ? renderCaseResolutionEnhancementScript()
    : '';
  // ONE runtime per full page load (delegated controls + region poller). It
  // lives outside <main>, so a poll can never replace or re-run it.
  const shellRuntime = isOperator
    ? renderShellRuntimeScript({ intervalMs: options.active === 'dashboard' ? 2000 : 4000 })
    : '';
  const backLink = options.backLink
    ? `<div class="shell shell-back">${renderBackLink(options.backLink.label, options.backLink.href)}</div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} · Northstar</title>
<style>${THEME_CSS}${SHELL_CSS}</style>
</head>
<body class="${isOperator ? 'surface-operator' : 'surface-traveller'}">
${chrome}
${banner}
${backLink}
${bodyHtml}
${programmeChangeScript}
${caseResolutionScript}
${renderFormEnhancementScript()}
${isOperator ? renderProfileMenuScript() : ''}
${shellRuntime}
</body>
</html>`;
}

/**
 * The shell's back affordance (`← Back to Overview`). Pages call this instead
 * of hand-writing a link so wording, styling and the test hook stay one thing.
 */
export function renderBackLink(label: string, href: string): string {
  return `<a class="back-link" data-test="back-link" href="${escapeHtml(href)}"><span aria-hidden="true">←</span> ${escapeHtml(label)}</a>`;
}

const SHELL_CSS = `
.back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-soft); text-decoration: none; padding: 4px 0; }
.back-link:hover { color: var(--text); text-decoration: underline; }
.shell-back { padding-top: 12px; padding-bottom: 0; }
.reset-demo { display: inline-flex; align-items: center; gap: 8px; }
.reset-demo-btn { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-soft); cursor: pointer; }
.reset-demo-btn:hover:not(:disabled) { color: var(--text); border-color: rgba(20, 23, 28, 0.32); }
.reset-demo-btn:disabled, [data-action]:disabled { opacity: .55; cursor: progress; }
.reset-demo-status, [data-action-status] { font-size: 12px; color: var(--text-soft); }
[data-action-status]:empty { display: none; }
.demo-console-link { font-size: 12px; color: var(--text-soft); text-decoration: none; opacity: 0.55; padding: 4px 6px; border-radius: 4px; }
.demo-console-link:hover, .demo-console-link:focus-visible { opacity: 0.9; color: var(--text); outline: 1px solid var(--border); outline-offset: 2px; }
`;

/** Closes the profile popover when the operator clicks anywhere outside it. */
function renderProfileMenuScript(): string {
  return `<script>
(function() {
  'use strict';
  document.addEventListener('click', function(event) {
    var menus = document.querySelectorAll('.profile-menu[open]');
    for (var i = 0; i < menus.length; i += 1) {
      if (!menus[i].contains(event.target)) menus[i].removeAttribute('open');
    }
  });
})();
</script>`;
}

/**
 * Approved operator top bar: brand, event select (when the programme is
 * known), primary nav with the decision count, and the mode pill + operator
 * avatar on the right. Links render only when the integrator provides them.
 */
function renderOperatorTopbar(options: PageOptions): string {
  const links = options.links ?? {};
  const eventSelect = options.eventName
    ? `<span class="event-select"><span class="es-dot" aria-hidden="true"></span>${escapeHtml(options.eventName)}<span class="es-caret" aria-hidden="true">▾</span></span>`
    : '';
  const navItems: string[] = [];
  if (links.dashboard) {
    const active = options.active === 'dashboard' || options.active === 'case';
    navItems.push(`<a href="${escapeHtml(links.dashboard)}" class="${active ? 'is-active' : ''}">Overview</a>`);
  }
  if (links.programme) {
    navItems.push(`<a href="${escapeHtml(links.programme)}" class="${options.active === 'programme' ? 'is-active' : ''}">Programme</a>`);
  }
  if (links.decisions) {
    const count = options.decisionCount && options.decisionCount > 0
      ? ` <span class="nav-count">${options.decisionCount}</span>`
      : '';
    navItems.push(`<a href="${escapeHtml(links.decisions)}" class="${options.active === 'decisions' ? 'is-active' : ''}">Decisions${count}</a>`);
  }
  if (links.activity) {
    navItems.push(`<a href="${escapeHtml(links.activity)}" class="${options.active === 'activity' ? 'is-active' : ''}">Activity</a>`);
  }
  const nav = navItems.length > 0
    ? `<nav aria-label="Main">${navItems.join('')}</nav>`
    : '';
  const right: string[] = [];
  if (options.demoBanner) {
    const live = options.demoBanner.adapterMode !== 'REPLAY';
    const label = live
      ? `${options.demoBanner.adapterMode === 'LIVE' ? 'Live' : 'Record'} · external calls possible`
      : 'Replay · recorded providers';
    right.push(`<span class="replay-pill${live ? ' rp-live' : ''}">${escapeHtml(label)}</span>`);
  }
  if (options.operatorInitials || options.profileResetAction) {
    right.push(renderProfileMenu(options.operatorInitials ?? 'A', options.profileResetAction, options.eventName));
  }
  if (options.demoConsole) {
    right.unshift(`<a class="demo-console-link" data-test="demo-console-link" href="/demo/control" target="_blank" rel="noopener noreferrer" title="Open Demo Console in a new tab">Demo Console</a>`);
  }
  if (options.resetDemo) {
    right.unshift(`<span class="reset-demo" data-test="reset-demo"><button type="button" class="reset-demo-btn" data-action="reset-demo" data-test="reset-demo-btn" title="Return the demo to its starting state">Reset demo</button><span class="reset-demo-status" data-action-status role="status" aria-live="polite"></span></span>`);
  }
  const tbRight = right.length > 0 ? `<div class="tb-right">${right.join('')}</div>` : '';
  return `<header class="topbar" data-surface="operator" data-poll-region="shell-topbar">
  <div class="brand"><img class="mark" src="/assets/northstar-logo.png" alt="" aria-hidden="true" width="128" height="128">Northstar<small>AI Travel Resolution Engine</small></div>
  ${eventSelect}
  ${nav}
  ${tbRight}
</header>`;
}

/**
 * Compact profile menu (approved #12): the coordinator identity reads
 * directly in the top-right as a two-line treatment beside the avatar, and
 * the popover keeps the secondary/admin actions. The reset control lives
 * here — never on the primary surface — and is worded without internal
 * scenario vocabulary.
 */
function renderProfileMenu(initials: string, resetAction: string | undefined, eventName?: string): string {
  const eventLabel = eventName?.trim() ?? '';
  const roleLine = eventLabel ? `Travel Coordinator · ${eventLabel}` : 'Travel Coordinator';
  const resetForm = resetAction
    ? `
      <form class="pm-reset" method="post" action="${escapeHtml(resetAction)}" data-test="profile-reset-form">
        <button type="submit" class="pm-reset-btn" data-test="profile-reset-btn">Reset scenario</button>
      </form>`
    : '';
  return `<details class="profile-menu" data-test="profile-menu">
  <summary class="profile-toggle" aria-label="Profile: ${escapeHtml(initials)}, Travel Coordinator" data-test="profile-menu-toggle"><span class="avatar-circle">${escapeHtml(initials)}</span><span class="avatar-meta"><span class="am-name">${escapeHtml(initials)}</span><span class="am-role">${escapeHtml(roleLine)}</span></span></summary>
  <div class="profile-pop" role="menu" aria-label="Profile">
    <p class="pm-role">Travel Coordinator</p>
    ${eventLabel ? `<p class="pm-event">${escapeHtml(eventLabel)}</p>` : ''}${resetForm}
  </div>
</details>`;
}

/**
 * Development/demo-only safety strip. Clearly marked so it is never confused
 * with a product control. Shows the adapter mode and a one-line explanation
 * of what the current mode permits.
 */
function renderDemoBanner(banner: {
  adapterMode: 'LIVE' | 'RECORD' | 'REPLAY';
  plannerMode?: 'MODEL_STUDIO' | 'OPENROUTER' | 'DETERMINISTIC_FALLBACK';
}): string {
  const isReplay = banner.adapterMode === 'REPLAY';
  const modeLabel = isReplay ? 'DEMO MODE — REPLAY' : `LIVE MODE — ${banner.adapterMode}`;
  const modeNote = isReplay
    ? 'No external provider calls will be made. All data comes from local fixtures and recorded responses.'
    : banner.adapterMode === 'LIVE'
      ? 'LIVE mode: external provider APIs may be called. Provider-side state changes are possible.'
      : 'RECORD mode: external provider APIs are called and responses are recorded.';
  const plannerNote =
    banner.plannerMode === 'MODEL_STUDIO'
      ? ' Recovery suggestions: external AI (Model Studio).'
      : banner.plannerMode === 'OPENROUTER'
        ? ' Recovery suggestions: external AI (OpenRouter).'
        : ' Recovery suggestions: local deterministic (no external calls).';
  const toneClass = isReplay ? 'db-replay' : 'db-live';
  return `<div class="demo-banner ${toneClass}" role="status" aria-label="Demo mode indicator">
  <span class="db-mode">${escapeHtml(modeLabel)}</span>
  <span class="db-note">${escapeHtml(modeNote)}${escapeHtml(plannerNote)} <a href="/demo" class="db-link">Demo controls</a></span>
</div>`;
}
