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
import { renderDemoConsolePopoverScript, DEFAULT_TRIGGER_DELAY_SECONDS } from './demoConsolePopover.ts';

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
   * Faint Demo Console top-bar control. Opens an anchored popover (same
   * `/api/v2/demo/*` endpoints as the standalone `/demo/control` fallback
   * page) instead of navigating away. Only when the demo/reset gate is open.
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
  const demoConsoleRuntime = isOperator && options.demoConsole
    ? renderDemoConsolePopoverScript()
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
${demoConsoleRuntime}
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
.demo-console-widget { position: relative; display: inline-flex; }
.demo-console-link { font: inherit; font-size: 12px; color: var(--text-soft); background: none; border: none; text-decoration: none; opacity: 0.55; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
.demo-console-link:hover, .demo-console-link:focus-visible { opacity: 0.9; color: var(--text); outline: 1px solid var(--border); outline-offset: 2px; }
.demo-console-pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 200; width: 340px; max-width: min(340px, calc(100vw - 24px)); max-height: 80vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18); padding: 14px; font-size: 13px; color: var(--text); }
.demo-console-pop[hidden] { display: none; }
.demo-console-pop h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-soft); margin: 14px 0 8px; font-weight: 600; }
.demo-console-pop .dc-pop-head strong { display: block; font-size: 14px; margin-bottom: 2px; }
.demo-console-pop .dc-note { font-size: 12px; color: var(--text-soft); margin: 0; }
.demo-console-pop .dc-pending-note { font-size: 12px; color: var(--text-soft); background: rgba(15, 23, 42, 0.05); border-radius: 6px; padding: 6px 8px; margin: 10px 0 0; }
.demo-console-pop .dc-pending-note[hidden] { display: none; }
.demo-console-pop .dc-delay-row { display: flex; gap: 12px; }
.demo-console-pop .dc-delay-opt { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text); }
.demo-console-pop .dc-group h3 { margin-top: 12px; }
.demo-console-pop .dc-control { margin: 0 0 8px; }
.demo-console-pop button[data-demo-console], .demo-console-pop button.dc-reset {
  font: inherit; font-size: 12px; padding: 6px 10px; border-radius: 6px; width: 100%; text-align: left;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer;
}
.demo-console-pop button[data-demo-console]:hover:not(:disabled), .demo-console-pop button.dc-reset:hover:not(:disabled) { background: rgba(15, 23, 42, 0.04); }
.demo-console-pop button:disabled { opacity: 0.55; cursor: progress; }
.demo-console-pop button.dc-reset { border-color: #c9a0a0; color: #6b2a2a; }
.demo-console-pop .dc-status { font-size: 11px; color: var(--text-soft); min-height: 1.1em; margin: 4px 0 0; white-space: pre-wrap; }
.demo-console-pop .dc-status.is-ok { color: #1f6b3a; }
.demo-console-pop .dc-status.is-err { color: #8a1f1f; }
.demo-console-pop .dc-utility { border-top: 1px solid var(--border); padding-top: 10px; }
.demo-console-pop details { margin-top: 6px; font-size: 11px; color: var(--text-soft); }
.demo-console-pop pre { margin: 6px 0 0; padding: 8px; background: rgba(15, 23, 42, 0.04); border-radius: 4px; overflow: auto; max-height: 180px; }
.dc-overlay { position: fixed; top: 72px; right: 16px; z-index: 300; display: flex; align-items: center; gap: 10px; background: rgba(15, 23, 42, 0.92); color: #fff; font-size: 13px; padding: 8px 12px; border-radius: 8px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.28); }
.dc-overlay[hidden] { display: none; }
.dc-overlay.is-ok { background: rgba(31, 107, 58, 0.92); }
.dc-overlay.is-err { background: rgba(138, 31, 31, 0.92); }
.dc-overlay-cancel { font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.45); background: transparent; color: #fff; cursor: pointer; }
.dc-overlay-cancel:hover { background: rgba(255, 255, 255, 0.12); }
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
    right.unshift(renderDemoConsoleControl());
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
 * The faint `Demo Console` top-bar control: a toggle button (no navigation)
 * plus its anchored popover shell and the persistent top-right countdown
 * status. Popover content (the configured control catalog, preflight
 * detail) is filled in by `demoConsolePopover.ts`'s client script from the
 * same `/api/v2/demo/*` endpoints the standalone `/demo/control` page uses —
 * this function only emits static chrome, never a second control
 * implementation.
 */
function renderDemoConsoleControl(): string {
  const delayOptions: Array<{ value: string; label: string }> = [
    { value: 'off', label: 'Off' },
    { value: '3', label: '3s' },
    { value: '5', label: '5s' },
  ];
  const delayRadios = delayOptions.map((opt) => `
        <label class="dc-delay-opt"><input type="radio" name="dc-delay" value="${escapeHtml(opt.value)}" ${opt.value === String(DEFAULT_TRIGGER_DELAY_SECONDS) ? 'checked' : ''}>${escapeHtml(opt.label)}</label>`).join('');
  return `<div class="demo-console-widget" data-test="demo-console-widget">
    <button type="button" class="demo-console-link" data-demo-console-toggle data-test="demo-console-toggle" aria-haspopup="true" aria-expanded="false" title="Open the Demo Console">Demo Console</button>
    <div class="demo-console-pop" data-demo-console-pop data-test="demo-console-pop" role="dialog" aria-label="Demo Console" hidden>
      <div class="dc-pop-head">
        <strong>Demo Console</strong>
        <p class="dc-note">Triggers configured demo inputs through normal product boundaries.</p>
      </div>
      <p class="dc-pending-note" data-demo-console-pending-note hidden></p>
      <section class="dc-delay" data-test="demo-console-pop-delay">
        <h3>Trigger delay</h3>
        <div class="dc-delay-row">${delayRadios}</div>
      </section>
      <div data-demo-console-controls data-test="demo-console-pop-controls"><p class="dc-note">Loading controls…</p></div>
      <section class="dc-utility" data-test="demo-console-pop-preflight">
        <h3>Demo readiness</h3>
        <button type="button" data-demo-console="preflight" data-test="demo-console-pop-preflight-btn">Run preflight</button>
        <p class="dc-status" data-demo-console-status="preflight" role="status" aria-live="polite"></p>
        <details data-test="demo-console-pop-preflight-detail"><summary>Detailed checks</summary><pre data-demo-console-detail="preflight"></pre></details>
      </section>
      <section class="dc-utility dc-reset-section" data-test="demo-console-pop-reset">
        <h3>Demo state</h3>
        <button type="button" class="dc-reset" data-action="reset-demo" data-test="demo-console-pop-reset-btn" title="Return the demo to its starting state">Reset demo</button>
        <p class="dc-status" data-action-status role="status" aria-live="polite"></p>
      </section>
    </div>
    <div class="dc-overlay" data-demo-console-overlay data-test="demo-console-overlay" role="status" aria-live="polite" hidden>
      <span data-demo-console-overlay-text></span>
      <button type="button" class="dc-overlay-cancel" data-demo-console-overlay-cancel data-test="demo-console-overlay-cancel">Cancel</button>
    </div>
  </div>`;
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
