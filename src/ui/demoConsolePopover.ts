/**
 * A5.1 — Demo Console top-bar popover.
 *
 * Replaces the `Demo Console` link's navigation to `/demo/control` with an
 * anchored popover that reuses the SAME `/api/v2/demo/*` endpoints. Reset
 * Demo is delegated to the shell runtime's existing `data-action="reset-demo"`
 * handling (confirm + blocking overlay + redirect) — this module only
 * supplies the popover chrome and the client-side trigger-delay countdown.
 *
 * Countdown state lives at this (persistent, once-per-page-load) script
 * level, not inside the popover DOM, so it survives the popover closing.
 * The wait is real wall-clock `setTimeout`/`setInterval` only: no backend
 * call happens until the countdown reaches zero, and nothing here touches
 * the evaluation clock, scenario timestamps or provider payloads.
 *
 * The pure reducer functions below are unit-tested directly (`node:test`)
 * and also embedded verbatim (via `.toString()`) into the shipped browser
 * script, so the tested code is the shipped code — the same discipline
 * `shellRuntime.ts` uses for its pure helpers.
 */

export type CountdownPhase = 'counting' | 'triggering' | 'done';

export interface PendingTrigger {
  controlId: string;
  label: string;
  phase: CountdownPhase;
  secondsLeft: number;
  ok?: boolean;
  message?: string;
}

export type PendingState = PendingTrigger | null;

export const TRIGGER_DELAY_OPTIONS = [0, 3, 5] as const;
export const DEFAULT_TRIGGER_DELAY_SECONDS = 5;

/** `select`/radio value ("off"|"3"|"5"|anything unrecognised) -> delay seconds. */
export function parseTriggerDelay(value: string | null | undefined): number {
  if (value == null) return DEFAULT_TRIGGER_DELAY_SECONDS;
  if (value === 'off' || value === '0') return 0;
  const n = Number(value);
  return TRIGGER_DELAY_OPTIONS.includes(n as 0 | 3 | 5) ? n : DEFAULT_TRIGGER_DELAY_SECONDS;
}

/** A label fit for the countdown line ("Trigger configured airline disruption" -> "configured airline disruption"). */
export function countdownDisplayLabel(label: string): string {
  return label.replace(/^trigger\s+/i, '').trim() || label;
}

/** Only one control may be queued/counting/triggering at a time. */
export function canQueueNewTrigger(state: PendingState): boolean {
  return state === null;
}

/** Start a countdown (or, for a zero delay, go straight to 'triggering'). */
export function beginCountdown(controlId: string, label: string, delaySeconds: number): PendingTrigger {
  return delaySeconds > 0
    ? { controlId, label, phase: 'counting', secondsLeft: delaySeconds }
    : { controlId, label, phase: 'triggering', secondsLeft: 0 };
}

/** Advance one second. No-op outside 'counting'. Reaching zero flips to 'triggering'. */
export function tickCountdown(state: PendingState): PendingState {
  if (!state || state.phase !== 'counting') return state;
  const next = state.secondsLeft - 1;
  return next <= 0
    ? { ...state, phase: 'triggering', secondsLeft: 0 }
    : { ...state, secondsLeft: next };
}

/** Cancel only while still counting down (a Trigger already in flight cannot be cancelled). */
export function cancelCountdown(state: PendingState): PendingState {
  if (!state || state.phase !== 'counting') return state;
  return null;
}

/** Record the apply request's outcome. No-op outside 'triggering'. */
export function completeTrigger(state: PendingState, ok: boolean, message: string): PendingState {
  if (!state || state.phase !== 'triggering') return state;
  return { ...state, phase: 'done', ok, message };
}

/**
 * The popover + countdown browser script. Emitted once per full operator
 * page load (outside `<main>`, alongside the shell runtime), so it is never
 * duplicated by a region patch and countdown state outlives the popover
 * closing.
 */
export function renderDemoConsolePopoverScript(): string {
  // The stringified functions below close over these two constants; they
  // must be declared in the shipped script too, not just imported here.
  const constants = `var TRIGGER_DELAY_OPTIONS = ${JSON.stringify(TRIGGER_DELAY_OPTIONS)};\n`
    + `var DEFAULT_TRIGGER_DELAY_SECONDS = ${JSON.stringify(DEFAULT_TRIGGER_DELAY_SECONDS)};`;
  const helpers = [
    parseTriggerDelay,
    countdownDisplayLabel,
    canQueueNewTrigger,
    beginCountdown,
    tickCountdown,
    cancelCountdown,
    completeTrigger,
  ].map((fn) => fn.toString()).join('\n');

  return `<script data-demo-console-runtime>
(function () {
  'use strict';
  if (window.__northstarDemoConsoleStarted) return;
  window.__northstarDemoConsoleStarted = true;

${constants}
${helpers}

  var toggle = document.querySelector('[data-demo-console-toggle]');
  var pop = document.querySelector('[data-demo-console-pop]');
  var overlay = document.querySelector('[data-demo-console-overlay]');
  if (!toggle || !pop || !overlay) return;

  var controlsBox = pop.querySelector('[data-demo-console-controls]');
  var loadState = 'idle'; // idle | loading | loaded | error
  var pending = null; // PendingState
  var tickTimer = null;
  var clearTimer = null;

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function currentDelay() {
    var checked = pop.querySelector('input[name="dc-delay"]:checked');
    return parseTriggerDelay(checked ? checked.value : null);
  }

  // ── popover open/close ────────────────────────────────────────────────
  function openPopover() {
    pop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (loadState === 'idle') loadControls();
    renderPendingIntoPopover();
  }
  function closePopover() {
    pop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }
  function togglePopover() {
    if (pop.hidden) openPopover(); else closePopover();
  }
  toggle.addEventListener('click', function (event) {
    event.preventDefault();
    togglePopover();
  });
  document.addEventListener('click', function (event) {
    if (pop.hidden) return;
    if (pop.contains(event.target) || toggle.contains(event.target)) return;
    closePopover();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !pop.hidden) {
      closePopover();
      toggle.focus();
    }
  });

  // ── control catalog (data-driven; same GET the standalone page uses) ───
  function loadControls() {
    loadState = 'loading';
    controlsBox.innerHTML = '<p class="dc-note">Loading controls…</p>';
    fetch('/api/v2/demo/controls', { headers: { accept: 'application/json' } })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        if (!r.ok) {
          loadState = 'error';
          controlsBox.innerHTML = '<p class="dc-note dc-status is-err">' + escapeHtml((r.body && r.body.message) || 'Controls unavailable.') + '</p>';
          return;
        }
        loadState = 'loaded';
        renderControls(r.body.controls || []);
      })
      .catch(function (err) {
        loadState = 'error';
        controlsBox.innerHTML = '<p class="dc-note dc-status is-err">' + escapeHtml(err && err.message ? err.message : 'Controls unavailable.') + '</p>';
      });
  }
  function renderControls(controls) {
    if (controls.length === 0) {
      controlsBox.innerHTML = '<p class="dc-note">No demo controls are configured.</p>';
      return;
    }
    var groups = [];
    var byGroup = {};
    for (var i = 0; i < controls.length; i += 1) {
      var c = controls[i];
      if (!byGroup[c.group]) { byGroup[c.group] = []; groups.push(c.group); }
      byGroup[c.group].push(c);
    }
    var html = '';
    for (var g = 0; g < groups.length; g += 1) {
      var group = groups[g];
      html += '<section class="dc-group" data-test="demo-console-pop-group" data-group="' + escapeHtml(group) + '"><h3>' + escapeHtml(group) + '</h3>';
      for (var j = 0; j < byGroup[group].length; j += 1) {
        var ctrl = byGroup[group][j];
        html += '<div class="dc-control" data-control-id="' + escapeHtml(ctrl.id) + '">'
          + '<button type="button" data-demo-console="trigger" data-control-id="' + escapeHtml(ctrl.id) + '" data-control-label="' + escapeHtml(ctrl.label) + '" data-test="demo-console-pop-trigger-' + escapeHtml(ctrl.id) + '" title="' + escapeHtml(ctrl.description || '') + '">' + escapeHtml(ctrl.label) + '</button>'
          + '</div>';
      }
      html += '</section>';
    }
    controlsBox.innerHTML = html;
    applyPendingDisabledState();
  }

  // ── trigger delay + countdown ───────────────────────────────────────────
  function applyPendingDisabledState() {
    var triggers = pop.querySelectorAll('[data-demo-console="trigger"]');
    var busy = pending !== null;
    for (var i = 0; i < triggers.length; i += 1) triggers[i].disabled = busy;
  }
  function renderPendingIntoPopover() {
    var note = pop.querySelector('[data-demo-console-pending-note]');
    if (!note) return;
    if (pending && (pending.phase === 'counting' || pending.phase === 'triggering')) {
      note.hidden = false;
      note.textContent = countdownDisplayLabel(pending.label) + ' is queued. Cancel it from the status bar to choose another control.';
    } else {
      note.hidden = true;
      note.textContent = '';
    }
    applyPendingDisabledState();
  }

  function overlayEls() {
    return {
      text: overlay.querySelector('[data-demo-console-overlay-text]'),
      cancel: overlay.querySelector('[data-demo-console-overlay-cancel]'),
    };
  }
  function renderOverlay() {
    var els = overlayEls();
    if (!pending) {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    var name = countdownDisplayLabel(pending.label);
    if (pending.phase === 'counting') {
      els.text.textContent = name + ' in ' + pending.secondsLeft + '…';
      if (els.cancel) els.cancel.hidden = false;
    } else if (pending.phase === 'triggering') {
      els.text.textContent = 'Triggering ' + name + '…';
      if (els.cancel) els.cancel.hidden = true;
    } else if (pending.phase === 'done') {
      els.text.textContent = (pending.ok ? '' : 'Failed: ') + (pending.message || (pending.ok ? 'Applied.' : 'The trigger failed.'));
      overlay.className = 'dc-overlay ' + (pending.ok ? 'is-ok' : 'is-err');
      if (els.cancel) els.cancel.hidden = true;
    }
    if (pending.phase !== 'done') overlay.className = 'dc-overlay';
  }

  function stopTicking() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }
  function scheduleAutoClear() {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(function () {
      pending = null;
      clearTimer = null;
      renderOverlay();
      renderPendingIntoPopover();
    }, 4000);
  }

  function fireApply() {
    var controlId = pending.controlId;
    fetch('/api/v2/demo/controls/' + encodeURIComponent(controlId) + '/apply', {
      method: 'POST',
      headers: { accept: 'application/json' },
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        var message = r.ok ? (r.body && r.body.detail ? r.body.detail : 'Applied.') : ((r.body && r.body.message) || 'The trigger failed.');
        pending = completeTrigger(pending, !!r.ok, message);
        renderOverlay();
        renderPendingIntoPopover();
        scheduleAutoClear();
      })
      .catch(function (err) {
        pending = completeTrigger(pending, false, err && err.message ? err.message : 'The trigger failed.');
        renderOverlay();
        renderPendingIntoPopover();
        scheduleAutoClear();
      });
  }

  function startTicking() {
    stopTicking();
    tickTimer = setInterval(function () {
      pending = tickCountdown(pending);
      renderOverlay();
      if (pending && pending.phase === 'triggering') {
        stopTicking();
        fireApply();
      }
    }, 1000);
  }

  function beginTrigger(controlId, label) {
    if (!canQueueNewTrigger(pending)) return;
    var delay = currentDelay();
    pending = beginCountdown(controlId, label, delay);
    closePopover();
    renderOverlay();
    renderPendingIntoPopover();
    if (pending.phase === 'triggering') {
      fireApply();
    } else {
      startTicking();
    }
  }

  pop.addEventListener('click', function (event) {
    var trigger = event.target && event.target.closest ? event.target.closest('[data-demo-console="trigger"]') : null;
    if (trigger) {
      beginTrigger(trigger.getAttribute('data-control-id'), trigger.getAttribute('data-control-label') || trigger.textContent || '');
      return;
    }
    var preflightBtn = event.target && event.target.closest ? event.target.closest('[data-demo-console="preflight"]') : null;
    if (preflightBtn) {
      runPreflight(preflightBtn);
    }
  });

  overlay.addEventListener('click', function (event) {
    var cancelBtn = event.target && event.target.closest ? event.target.closest('[data-demo-console-overlay-cancel]') : null;
    if (!cancelBtn) return;
    if (!pending || pending.phase !== 'counting') return;
    stopTicking();
    pending = cancelCountdown(pending);
    renderOverlay();
    renderPendingIntoPopover();
  });

  // ── preflight (concise status in the popover, no delay applies here) ───
  function runPreflight(btn) {
    var status = pop.querySelector('[data-demo-console-status="preflight"]');
    var detail = pop.querySelector('[data-demo-console-detail="preflight"]');
    btn.disabled = true;
    if (status) { status.textContent = 'Running…'; status.className = 'dc-status'; }
    fetch('/api/v2/demo/preflight', { method: 'POST', headers: { accept: 'application/json' } })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; }); })
      .then(function (r) {
        if (detail) detail.textContent = JSON.stringify(r.body, null, 2);
        if (!r.ok) {
          if (status) { status.textContent = (r.body && r.body.message) || ('HTTP ' + r.status); status.className = 'dc-status is-err'; }
          return;
        }
        var summary = r.body.summary || {};
        var line = (r.body.ok ? 'PASS' : 'FAIL')
          + ' · required: ' + ((summary.requiredFailed || []).join(', ') || 'none')
          + ' · advisory: ' + ((summary.advisoryFailed || []).join(', ') || 'none');
        if (status) { status.textContent = line; status.className = 'dc-status ' + (r.body.ok ? 'is-ok' : 'is-err'); }
      })
      .catch(function (err) {
        if (status) { status.textContent = err && err.message ? err.message : 'Preflight failed.'; status.className = 'dc-status is-err'; }
      })
      .finally(function () { btn.disabled = false; });
  }
})();
</script>`;
}
