/**
 * Development/demo-only Demo Console page body.
 * Utility surface — not a product Overview/Case screen.
 */
import { escapeHtml } from '../html.ts';
import type { DemoControlDefinition } from '../../app/demo/demoControlCatalog.ts';
import type { EvaluationClockSnapshot } from '../../app/target/evaluationClock.ts';

export interface DemoConsoleView {
  workspaceId: string;
  evaluationClock: EvaluationClockSnapshot & { now: string };
  controls: DemoControlDefinition[];
  disruptionConfigured: boolean;
  timelineConfigured: boolean;
}

function groupControls(controls: DemoControlDefinition[]): Array<{ group: string; controls: DemoControlDefinition[] }> {
  const order: string[] = [];
  const map = new Map<string, DemoControlDefinition[]>();
  for (const control of controls) {
    if (!map.has(control.group)) {
      order.push(control.group);
      map.set(control.group, []);
    }
    map.get(control.group)!.push(control);
  }
  return order.map((group) => ({ group, controls: map.get(group)! }));
}

/** Render the Demo Console utility body (shell wraps chrome separately). */
export function renderDemoConsole(view: DemoConsoleView): string {
  const groups = groupControls(view.controls);
  const clockLabel = view.evaluationClock.mode === 'CONTROLLED'
    ? `CONTROLLED @ ${view.evaluationClock.now}`
    : `WALL @ ${view.evaluationClock.now}`;

  return `<main class="demo-console" data-test="demo-console">
  <style>
    .demo-console { max-width: 720px; margin: 0 auto; padding: 24px 20px 48px; font: 14px/1.45 system-ui, sans-serif; color: #1a1d21; }
    .demo-console h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
    .demo-console .dc-sub { color: #5c6570; margin: 0 0 20px; font-size: 13px; }
    .demo-console section { margin: 0 0 22px; padding: 14px 0 0; border-top: 1px solid #e4e7eb; }
    .demo-console h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #5c6570; margin: 0 0 10px; font-weight: 600; }
    .demo-console .dc-meta { font-size: 13px; color: #3a4149; margin: 0 0 8px; }
    .demo-console .dc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; margin: 0 0 10px; }
    .demo-console button {
      font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 6px;
      border: 1px solid #c9d0c8; background: #f7f8f9; color: #1a1d21; cursor: pointer;
    }
    .demo-console button:hover:not(:disabled) { background: #eef0f2; }
    .demo-console button:disabled { opacity: 0.55; cursor: progress; }
    .demo-console button.dc-reset { border-color: #c9a0a0; color: #6b2a2a; }
    .demo-console .dc-note { font-size: 12px; color: #5c6570; margin: 0 0 8px; max-width: 36rem; }
    .demo-console .dc-status { font-size: 12px; color: #5c6570; min-height: 1.2em; white-space: pre-wrap; }
    .demo-console .dc-status.is-ok { color: #1f6b3a; }
    .demo-console .dc-status.is-err { color: #8a1f1f; }
    .demo-console details { margin-top: 8px; font-size: 12px; color: #5c6570; }
    .demo-console pre { margin: 6px 0 0; padding: 8px; background: #f4f5f6; border-radius: 4px; overflow: auto; max-height: 240px; }
  </style>

  <h1>Northstar Demo Console</h1>
  <p class="dc-sub">Development/demo utility. Triggers configured demo inputs through normal product boundaries. Not a product screen.</p>

  <section data-test="demo-console-workspace">
    <h2>Workspace</h2>
    <p class="dc-meta">Workspace ready for demo controls</p>
    <p class="dc-meta">Evaluation clock: <strong data-test="demo-console-clock">${escapeHtml(clockLabel)}</strong></p>
    <p class="dc-meta">Configured airline event: ${view.disruptionConfigured ? 'yes' : 'no'} · Progressive timeline: ${view.timelineConfigured ? 'yes' : 'no'}</p>
  </section>

  <section data-test="demo-console-preflight">
    <h2>Demo readiness</h2>
    <p class="dc-note">Runs the existing read-only readiness preflight. Does not provision or mutate world state.</p>
    <div class="dc-row">
      <button type="button" data-demo-console="preflight" data-test="demo-console-preflight-btn">Check demo readiness</button>
    </div>
    <p class="dc-status" data-demo-console-status="preflight" role="status" aria-live="polite"></p>
    <details data-test="demo-console-preflight-detail"><summary>Details</summary><pre data-demo-console-detail="preflight"></pre></details>
  </section>

  ${groups.map((group) => `
  <section data-test="demo-console-group" data-group="${escapeHtml(group.group)}">
    <h2>${escapeHtml(group.group)}</h2>
    ${group.controls.map((control) => `
    <div class="dc-control" data-control-id="${escapeHtml(control.id)}">
      <p class="dc-note">${escapeHtml(control.description)}</p>
      <div class="dc-row">
        <button type="button"
          data-demo-console="apply"
          data-control-id="${escapeHtml(control.id)}"
          data-test="demo-console-apply-${escapeHtml(control.id)}"
          title="${escapeHtml(control.kind)}">${escapeHtml(control.label)}</button>
      </div>
      <p class="dc-status" data-demo-console-status="${escapeHtml(control.id)}" role="status" aria-live="polite"></p>
    </div>`).join('')}
  </section>`).join('')}

  <section data-test="demo-console-reset">
    <h2>Demo state</h2>
    <p class="dc-note">Returns this workspace to its healthy provisioned baseline in the same running process. Refused after external execution history.</p>
    <div class="dc-row">
      <button type="button" class="dc-reset" data-demo-console="reset" data-test="demo-console-reset-btn">Reset to healthy baseline</button>
    </div>
    <p class="dc-status" data-demo-console-status="reset" role="status" aria-live="polite"></p>
  </section>
</main>
<script>
(function () {
  'use strict';
  function setStatus(key, ok, text) {
    var el = document.querySelector('[data-demo-console-status="' + key + '"]');
    if (!el) return;
    el.textContent = text;
    el.className = 'dc-status ' + (ok ? 'is-ok' : 'is-err');
  }
  function setBusy(btn, busy) {
    btn.disabled = !!busy;
  }
  async function readJson(res) {
    var text = await res.text();
    try { return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : {} }; }
    catch (_) { return { ok: res.ok, status: res.status, body: { message: text || ('HTTP ' + res.status) } }; }
  }
  function errMessage(body) {
    if (!body) return 'Request failed';
    return body.message || body.error || JSON.stringify(body);
  }
  document.addEventListener('click', function (event) {
    var btn = event.target && event.target.closest ? event.target.closest('[data-demo-console]') : null;
    if (!btn) return;
    var action = btn.getAttribute('data-demo-console');
    if (action === 'preflight') {
      setBusy(btn, true);
      setStatus('preflight', true, 'Running…');
      fetch('/api/v2/demo/preflight', { method: 'POST', headers: { 'accept': 'application/json' } })
        .then(readJson)
        .then(function (r) {
          var detail = document.querySelector('[data-demo-console-detail="preflight"]');
          if (detail) detail.textContent = JSON.stringify(r.body, null, 2);
          if (!r.ok) {
            setStatus('preflight', false, errMessage(r.body));
            return;
          }
          var summary = r.body.summary || {};
          var line = (r.body.ok ? 'PASS' : 'FAIL')
            + ' · required failures: ' + ((summary.requiredFailed || []).join(', ') || 'none')
            + ' · advisory gaps: ' + ((summary.advisoryFailed || []).join(', ') || 'none');
          setStatus('preflight', !!r.body.ok, line);
        })
        .catch(function (e) { setStatus('preflight', false, e.message || String(e)); })
        .finally(function () { setBusy(btn, false); });
      return;
    }
    if (action === 'reset') {
      if (!window.confirm('Reset the demo workspace to its healthy baseline?')) return;
      setBusy(btn, true);
      setStatus('reset', true, 'Resetting…');
      fetch('/api/v2/demo/reset', { method: 'POST', headers: { 'accept': 'application/json' } })
        .then(readJson)
        .then(function (r) {
          if (!r.ok) {
            setStatus('reset', false, errMessage(r.body));
            return;
          }
          setStatus('reset', true, 'Healthy baseline restored. Evaluation clock resynced.');
          var clock = document.querySelector('[data-test="demo-console-clock"]');
          if (clock && r.body.evaluationClock) {
            clock.textContent = r.body.evaluationClock.mode === 'CONTROLLED'
              ? ('CONTROLLED @ ' + r.body.evaluationClock.now)
              : ('WALL @ ' + r.body.evaluationClock.now);
          }
        })
        .catch(function (e) { setStatus('reset', false, e.message || String(e)); })
        .finally(function () { setBusy(btn, false); });
      return;
    }
    if (action === 'apply') {
      var id = btn.getAttribute('data-control-id');
      if (!id) return;
      setBusy(btn, true);
      setStatus(id, true, 'Applying…');
      fetch('/api/v2/demo/controls/' + encodeURIComponent(id) + '/apply', {
        method: 'POST',
        headers: { 'accept': 'application/json' },
      })
        .then(readJson)
        .then(function (r) {
          if (!r.ok) {
            setStatus(id, false, errMessage(r.body));
            return;
          }
          var clock = r.body.evaluationClock
            ? (' · clock ' + r.body.evaluationClock.mode + ' @ ' + r.body.evaluationClock.now)
            : '';
          setStatus(id, true, (r.body.detail || 'Applied.') + clock);
          var clockEl = document.querySelector('[data-test="demo-console-clock"]');
          if (clockEl && r.body.evaluationClock) {
            clockEl.textContent = r.body.evaluationClock.mode === 'CONTROLLED'
              ? ('CONTROLLED @ ' + r.body.evaluationClock.now)
              : ('WALL @ ' + r.body.evaluationClock.now);
          }
        })
        .catch(function (e) { setStatus(id, false, e.message || String(e)); })
        .finally(function () { setBusy(btn, false); });
    }
  });
})();
</script>`;
}
