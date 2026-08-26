/**
 * Development/demo-only control panel.
 *
 * Provides a human-clickable surface for resetting state, launching final
 * hero workflows through real product endpoints, and navigating the product.
 * Visually distinct from the production product screens.
 */
import type { AppConfig } from '../../config/config.ts';
import { escapeHtml } from '../html.ts';

export interface DemoPanelContext {
  adapterMode: AppConfig['adapterMode'];
  plannerMode: 'MODEL_STUDIO' | 'DETERMINISTIC_FALLBACK';
  scenarioNames: string[];
  scenarioRehearsals?: Array<{ id: string; title: string; description: string; scenarioId: string }>;
  heroWorkflows?: Array<{ id: string; title: string; description: string }>;
  programmeEventId?: string;
}

/** Render the demo control panel HTML body. */
export function renderDemoPanel(ctx: DemoPanelContext): string {
  const isReplay = ctx.adapterMode === 'REPLAY';
  const heroes = ctx.heroWorkflows ?? [];
  const rehearsals = ctx.scenarioRehearsals ?? [];

  return `
<main class="demo-shell">
  <h1>Demo controls</h1>
  <p class="demo-sub">Development-only panel for local and deployed clickaround. This is not part of the product UI.</p>

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
      <p class="dc-note">Wipes all state and reseeds the canonical programme world from local fixtures. No external calls.</p>
      <div class="dc-meta m-local">LOCAL ONLY — deterministic SQLite reset</div>
      <button class="demo-btn danger" data-demo-action="reset">Reset &amp; reseed</button>
      <div id="result-reset" class="demo-result" style="display:none;"></div>
    </div>
  </div>

  <div class="demo-section">
    <h2>Scenario rehearsal</h2>
    <p class="demo-sub" style="margin-top:0;">Launch each final acceptance scenario through real product endpoints for diagnosis and rehearsal.</p>
    ${rehearsals.map((rehearsal) => `
    <div class="demo-card">
      <h3>${escapeHtml(rehearsal.title)}</h3>
      <p class="dc-note">${escapeHtml(rehearsal.description)}</p>
      <div class="dc-meta m-replay">REAL ENGINE PATH — acceptance manifest</div>
      <button class="demo-btn" data-demo-action="rehearse" data-scenario="${escapeHtml(rehearsal.scenarioId)}" data-workflow="${escapeHtml(rehearsal.id)}">Launch ${escapeHtml(rehearsal.scenarioId)}</button>
      <div id="result-rehearse-${escapeHtml(rehearsal.scenarioId)}" class="demo-result" style="display:none;"></div>
    </div>`).join('')}
  </div>

  <div class="demo-section">
    <h2>Final video flows</h2>
    <p class="demo-sub" style="margin-top:0;">Accepted hero manifests for presentation choreography. Authority settlement is left for manual rehearsal where required.</p>
    ${heroes.map((hero) => `
    <div class="demo-card">
      <h3>${escapeHtml(hero.title)}</h3>
      <p class="dc-note">${escapeHtml(hero.description)}</p>
      <div class="dc-meta m-replay">REAL ENGINE PATH — acceptance manifest</div>
      <button class="demo-btn" data-demo-action="launch" data-workflow="${escapeHtml(hero.id)}">Launch ${escapeHtml(hero.id)}</button>
      <div id="result-launch-${escapeHtml(hero.id)}" class="demo-result" style="display:none;"></div>
    </div>`).join('')}
  </div>

  <div class="demo-section">
    <h2>Product pages</h2>
    <div class="demo-links">
      <a href="${ctx.programmeEventId ? `/operator?event=${escapeHtml(ctx.programmeEventId)}` : '/operator'}">Operator dashboard</a>
      <a href="/traveller">Traveller view</a>
      <a href="/decisions">Decisions</a>
      ${ctx.programmeEventId ? `<a href="/programme?event=${escapeHtml(ctx.programmeEventId)}">Programme</a>` : ''}
    </div>
  </div>

  <div class="demo-safety">
    <h2>Action safety guide</h2>
    <table>
      <thead><tr><th>Action</th><th>Classification</th></tr></thead>
      <tbody>
        <tr><td>Reset programme</td><td class="s-local">LOCAL ONLY</td></tr>
        <tr><td>Launch final hero workflow</td><td class="s-replay">REAL ENDPOINTS / REPLAY PROVIDER DATA</td></tr>
        <tr><td>Open operator dashboard</td><td class="s-local">LOCAL ONLY</td></tr>
        <tr><td>Open traveller view</td><td class="s-local">LOCAL ONLY</td></tr>
        <tr><td>Submit traveller / organiser decision</td><td class="s-local">LOCAL AUTHORITY STATE</td></tr>
        ${!isReplay ? `
        <tr><td>Atlas / Nuitée / Model Studio</td><td class="s-external">EXTERNAL API POSSIBLE</td></tr>
        ` : ''}
      </tbody>
    </table>
  </div>

  ${isReplay ? '' : `
  <div class="demo-config">
    <strong>NOT in REPLAY mode.</strong> External provider calls are possible.
    To switch to safe mode, set <code>ADAPTER_MODE=REPLAY</code> in <code>.env.local</code> and restart the server.
  </div>`}
</main>

<script>
(function() {
  function showResult(id, ok, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    el.className = 'demo-result ' + (ok ? 'dr-ok' : 'dr-err');
    el.textContent = text;
    if (ok && text) {
      try {
        var body = JSON.parse(text.replace(/^[^\\{]*/, ''));
        if (body && body.inspectPaths && body.inspectPaths.length) {
          var links = document.createElement('div');
          links.style.marginTop = '8px';
          body.inspectPaths.forEach(function(path) {
            var a = document.createElement('a');
            a.href = path;
            a.textContent = path;
            a.style.display = 'block';
            links.appendChild(a);
          });
          el.appendChild(links);
        }
      } catch (_) {}
    }
  }
  document.addEventListener('click', function(e) {
    var btn = e.target;
    if (!btn || !btn.dataset || !btn.dataset.demoAction) return;
    var action = btn.dataset.demoAction;
    btn.disabled = true;
    if (action === 'reset') {
      fetch('/api/demo/reset', { method: 'POST' })
        .then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
        .then(function(r) {
          var msg = r.ok ? 'Populated demo world ready.' : 'Error: ' + JSON.stringify(r.body);
          if (r.ok && r.body && r.body.redirectTo) {
            msg += ' Opening Overview…';
            showResult('result-reset', r.ok, msg);
            window.location.href = r.body.redirectTo;
          } else {
            showResult('result-reset', r.ok, msg);
            btn.disabled = false;
          }
        })
        .catch(function(e) { showResult('result-reset', false, 'Request failed: ' + e.message); btn.disabled = false; });
    } else if (action === 'launch' || action === 'rehearse') {
      var id = btn.dataset.workflow;
      var rid = action === 'rehearse'
        ? 'result-rehearse-' + btn.dataset.scenario
        : 'result-launch-' + id;
      fetch('/api/demo/launch?workflow=' + encodeURIComponent(id), { method: 'POST' })
        .then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
        .then(function(r) {
          showResult(rid, r.ok, JSON.stringify(r.body));
          btn.disabled = false;
        })
        .catch(function(e) { showResult(rid, false, 'Request failed: ' + e.message); btn.disabled = false; });
    } else if (action === 'trigger') {
      var name = btn.dataset.scenario;
      var rid2 = 'result-' + name;
      fetch('/api/demo/trigger?name=' + encodeURIComponent(name), { method: 'POST' })
        .then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
        .then(function(r) { showResult(rid2, r.ok, r.ok ? 'Triggered. ' + JSON.stringify(r.body) : 'Error: ' + JSON.stringify(r.body)); btn.disabled = false; })
        .catch(function(e) { showResult(rid2, false, 'Request failed: ' + e.message); btn.disabled = false; });
    }
  });
})();
</script>`;
}
