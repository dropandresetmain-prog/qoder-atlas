/**
 * Development/demo-only control panel.
 *
 * Provides a human-clickable surface for resetting state, triggering
 * scenario disruptions, and navigating the product. Visually distinct
 * from the production product screens. Never wired in production.
 */
import type { AppConfig } from '../../config/config.ts';
import { escapeHtml } from '../html.ts';

export interface DemoPanelContext {
  adapterMode: AppConfig['adapterMode'];
  plannerMode: 'MODEL_STUDIO' | 'DETERMINISTIC_FALLBACK';
  scenarioNames: string[];
  programmeEventId?: string;
}

const SCENARIO_LABELS: Record<string, { title: string; description: string; safetyClass: string; safetyLabel: string }> = {
  'anchor-event-speaker': {
    title: 'Case B — Provider disruption (hero scenario)',
    description: 'Speaker\'s outbound flight is cancelled. The engine assesses blast radius (transfer, hotel, keynote objective), plans recovery, and resolves through the full authority → execution → verification loop.',
    safetyClass: 'm-replay',
    safetyLabel: 'REPLAY PROVIDER DATA',
  },
  'corporate-tmc': {
    title: 'Case A — Traveller change request',
    description: 'A corporate traveller requests a flight change. The engine processes the change through the same recovery loop: planning, traveller approval, simulated execution.',
    safetyClass: 'm-replay',
    safetyLabel: 'REPLAY PROVIDER DATA',
  },
};

/** Render the demo control panel HTML body. */
export function renderDemoPanel(ctx: DemoPanelContext): string {
  const isReplay = ctx.adapterMode === 'REPLAY';
  const scenarios = ctx.scenarioNames.map((name) => {
    const info = SCENARIO_LABELS[name] ?? {
      title: name,
      description: 'Trigger this scenario\'s disruption signal.',
      safetyClass: 'm-replay',
      safetyLabel: 'REPLAY',
    };
    return { name, ...info };
  });

  return `
<main class="demo-shell">
  <h1>Demo controls</h1>
  <p class="demo-sub">Development-only panel for local clickaround. This is not part of the product UI.</p>

  <div class="demo-safety">
    <h2>Current mode</h2>
    <p><strong>Adapter:</strong> ${escapeHtml(ctx.adapterMode)}
    &nbsp;·&nbsp;
    <strong>Planner:</strong> ${escapeHtml(ctx.plannerMode === 'MODEL_STUDIO' ? 'Model Studio (LIVE AI)' : 'Deterministic fallback (local)')}</p>
    ${isReplay
      ? '<p style="color: var(--ok); margin: 8px 0 0;">No external provider calls will be made. All data comes from local fixtures and recorded responses.</p>'
      : '<p style="color: var(--alert); margin: 8px 0 0;">WARNING: LIVE mode — external APIs may be called. Provider-side state changes are possible.</p>'}
  </div>

  <div class="demo-section">
    <h2>State management</h2>
    <div class="demo-card">
      <h3>Reset programme</h3>
      <p class="dc-note">Wipes all state and reseeds the 42-traveller demo programme + scenario fixtures from local JSON. No external calls.</p>
      <div class="dc-meta m-local">LOCAL ONLY — deterministic SQLite reset</div>
      <button class="demo-btn danger" data-demo-action="reset">Reset &amp; reseed</button>
      <div id="result-reset" class="demo-result" style="display:none;"></div>
    </div>
  </div>

  <div class="demo-section">
    <h2>Scenario triggers</h2>
    ${scenarios.map((s) => `
    <div class="demo-card">
      <h3>${escapeHtml(s.title)}</h3>
      <p class="dc-note">${escapeHtml(s.description)}</p>
      <div class="dc-meta ${s.safetyClass}">${escapeHtml(s.safetyLabel)}</div>
      <button class="demo-btn" data-demo-action="trigger" data-scenario="${escapeHtml(s.name)}">Trigger ${escapeHtml(s.name === 'anchor-event-speaker' ? 'disruption' : 'change request')}</button>
      <div id="result-${escapeHtml(s.name)}" class="demo-result" style="display:none;"></div>
    </div>`).join('')}
  </div>

  <div class="demo-section">
    <h2>Product pages</h2>
    <div class="demo-links">
      <a href="/operator">Operator dashboard</a>
      <a href="/traveller">Traveller view</a>
      ${ctx.programmeEventId ? `<a href="/programme?event=${escapeHtml(ctx.programmeEventId)}">Programme (42 travellers)</a>` : ''}
    </div>
  </div>

  <div class="demo-safety">
    <h2>Action safety guide</h2>
    <table>
      <thead><tr><th>Action</th><th>Classification</th></tr></thead>
      <tbody>
        <tr><td>Reset programme</td><td class="s-local">LOCAL ONLY</td></tr>
        <tr><td>Open operator dashboard</td><td class="s-local">LOCAL ONLY</td></tr>
        <tr><td>Open traveller view</td><td class="s-local">LOCAL ONLY</td></tr>
        <tr><td>Open programme view</td><td class="s-local">LOCAL ONLY</td></tr>
        <tr><td>View case detail</td><td class="s-local">LOCAL ONLY</td></tr>
        <tr><td>Trigger demo disruption</td><td class="s-local">LOCAL / SYNTHETIC SIGNAL</td></tr>
        <tr><td>Evaluate recovery (after trigger)</td><td class="s-replay">REPLAY PROVIDER DATA</td></tr>
        <tr><td>Submit traveller decision</td><td class="s-local">LOCAL AUTHORITY STATE</td></tr>
        <tr><td>Execute recovery</td><td class="s-replay">SIMULATED — NO REAL PROVIDER SIDE EFFECT</td></tr>
        ${!isReplay ? `
        <tr><td>Atlas flight search</td><td class="s-external">EXTERNAL READ-ONLY API</td></tr>
        <tr><td>Google Routes</td><td class="s-external">EXTERNAL READ-ONLY API</td></tr>
        <tr><td>Nuitée hotel search</td><td class="s-external">EXTERNAL API</td></tr>
        <tr><td>Nuitée booking</td><td class="s-external">EXTERNAL SIDE EFFECT</td></tr>
        <tr><td>Model Studio planning</td><td class="s-external">EXTERNAL AI API</td></tr>
        ` : ''}
      </tbody>
    </table>
  </div>

  ${isReplay ? '' : `
  <div class="demo-config">
    <strong>NOT in REPLAY mode.</strong> External provider calls are possible.
    To switch to safe mode, set <code>ADAPTER_MODE=REPLAY</code> in <code>.env.local</code> and restart the server.
  </div>`}

  <div class="demo-config" style="background: var(--watch-bg); border-color: var(--watch-border); color: var(--watch);">
    <strong>To enable LIVE mode</strong> (do NOT do this during the checkpoint):
    set <code>ADAPTER_MODE=LIVE</code> in <code>.env.local</code> and restart.
    This will allow real Atlas, Nuitée, Google Routes, and Model Studio API calls.
  </div>
</main>

<script>
(function() {
  function showResult(id, ok, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    el.className = 'demo-result ' + (ok ? 'dr-ok' : 'dr-err');
    el.textContent = text;
  }
  document.addEventListener('click', function(e) {
    var btn = e.target;
    if (!btn || !btn.dataset || !btn.dataset.demoAction) return;
    var action = btn.dataset.demoAction;
    btn.disabled = true;
    if (action === 'reset') {
      fetch('/api/demo/reset', { method: 'POST' })
        .then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
        .then(function(r) { showResult('result-reset', r.ok, r.ok ? 'Reset complete. ' + JSON.stringify(r.body) : 'Error: ' + JSON.stringify(r.body)); btn.disabled = false; })
        .catch(function(e) { showResult('result-reset', false, 'Request failed: ' + e.message); btn.disabled = false; });
    } else if (action === 'trigger') {
      var name = btn.dataset.scenario;
      var rid = 'result-' + name;
      fetch('/api/demo/trigger?name=' + encodeURIComponent(name), { method: 'POST' })
        .then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
        .then(function(r) { showResult(rid, r.ok, r.ok ? 'Triggered. ' + JSON.stringify(r.body) : 'Error: ' + JSON.stringify(r.body)); btn.disabled = false; })
        .catch(function(e) { showResult(rid, false, 'Request failed: ' + e.message); btn.disabled = false; });
    }
  });
})();
</script>`;
}
