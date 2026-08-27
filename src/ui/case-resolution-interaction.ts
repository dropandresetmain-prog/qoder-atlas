/**
 * Case Resolve choreography — presentation overlay around real engine results.
 *
 * Does not slow the planning/execution engines. Stages are UI-only progress
 * while a real plan/begin/execute request runs (or a short settle when options
 * are already projected). Respects prefers-reduced-motion.
 */
export function renderCaseResolutionEnhancementScript(): string {
  return `<script>
(function() {
  'use strict';
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var RESOLVE_MS = REDUCE ? 200 : 3000;
  var EXEC_MS = REDUCE ? 150 : 1800;

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function setPhase(root, phase) {
    if (!root) return;
    root.setAttribute('data-case-phase', phase);
    root.setAttribute('data-test', 'case-phase-' + phase);
  }

  function ensureOverlay(id, title, steps) {
    var existing = document.getElementById(id);
    if (existing) return existing;
    var scrim = document.createElement('div');
    scrim.id = id;
    scrim.className = 'ns-resolve-scrim';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-label', title);
    scrim.hidden = true;
    var stepsHtml = steps.map(function(label, i) {
      return '<li data-step="' + i + '"><span class="ns-resolve-step-mark" aria-hidden="true"></span><span>' + label + '</span></li>';
    }).join('');
    scrim.innerHTML =
      '<div class="ns-resolve-modal">' +
        '<p class="ns-resolve-kicker">Northstar AI</p>' +
        '<h2 class="ns-resolve-title">' + title + '</h2>' +
        '<div class="ns-resolve-bar" aria-hidden="true"><i></i></div>' +
        '<ol class="ns-resolve-steps">' + stepsHtml + '</ol>' +
      '</div>';
    document.body.appendChild(scrim);
    return scrim;
  }

  function runStages(overlay, durationMs) {
    var steps = qsa('[data-step]', overlay);
    var bar = qs('.ns-resolve-bar > i', overlay);
    var start = Date.now();
    overlay.hidden = false;
    document.body.classList.add('ns-resolve-open');
    steps.forEach(function(step) { step.classList.remove('is-active', 'is-done'); });
    return new Promise(function(resolve) {
      function tick() {
        var elapsed = Date.now() - start;
        var t = Math.min(1, elapsed / durationMs);
        if (bar) bar.style.width = Math.round(t * 100) + '%';
        var idx = Math.min(steps.length - 1, Math.floor(t * steps.length));
        steps.forEach(function(step, i) {
          step.classList.toggle('is-done', i < idx);
          step.classList.toggle('is-active', i === idx);
        });
        if (t >= 1) {
          steps.forEach(function(step) {
            step.classList.add('is-done');
            step.classList.remove('is-active');
          });
          resolve();
          return;
        }
        window.requestAnimationFrame(tick);
      }
      window.requestAnimationFrame(tick);
    }).then(function() {
      overlay.hidden = true;
      document.body.classList.remove('ns-resolve-open');
    });
  }

  function selectedStrategyId(root) {
    var selected = qs('.option-card.is-selected[data-option-id]', root);
    if (selected) return selected.getAttribute('data-option-id');
    var recommended = qs('.option-card.is-recommended[data-option-id]', root);
    return recommended ? recommended.getAttribute('data-option-id') : null;
  }

  function syncStrategyInputs(root) {
    var id = selectedStrategyId(root);
    if (!id) return;
    qsa('input[name="strategyId"]', root).forEach(function(input) {
      input.value = id;
    });
    qsa('[data-selected-strategy-label]', root).forEach(function(el) {
      var card = qs('.option-card.is-selected .opt-title, .option-card.is-recommended .opt-title', root);
      if (card) el.textContent = card.textContent;
    });
  }

  function bindOptionSelection(root) {
    qsa('.option-card[data-option-selectable="true"]', root).forEach(function(card) {
      card.addEventListener('click', function() {
        if (card.classList.contains('is-rejected')) return;
        qsa('.option-card.is-selected', root).forEach(function(other) {
          other.classList.remove('is-selected');
          other.setAttribute('aria-pressed', 'false');
        });
        card.classList.add('is-selected');
        card.setAttribute('aria-pressed', 'true');
        syncStrategyInputs(root);
      });
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-pressed', card.classList.contains('is-selected') ? 'true' : 'false');
      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });
    var initial = qs('.option-card.is-recommended[data-option-selectable="true"]', root)
      || qs('.option-card[data-option-selectable="true"]:not(.is-rejected)', root);
    if (initial && !qs('.option-card.is-selected', root)) {
      initial.classList.add('is-selected');
      initial.setAttribute('aria-pressed', 'true');
    }
    syncStrategyInputs(root);
  }

  function revealOptions(root) {
    setPhase(root, 'options');
    var options = qs('[data-case-options-panel]', root);
    if (options) options.hidden = false;
    var resolveCta = qs('[data-resolve-northstar-cta]', root);
    if (resolveCta) resolveCta.hidden = true;
    var beginPanel = qs('[data-case-begin-panel]', root);
    if (beginPanel) beginPanel.hidden = false;
    syncStrategyInputs(root);
  }

  document.addEventListener('DOMContentLoaded', function() {
    var root = qs('[data-case-workspace]');
    if (!root) return;

    bindOptionSelection(root);

    var params = new URLSearchParams(window.location.search);
    if (params.get('nsResolve') === '1' || params.get('nsPhase') === 'options') {
      revealOptions(root);
    }

    var resolveBtn = qs('[data-resolve-northstar]', root);
    if (resolveBtn) {
      resolveBtn.addEventListener('click', function() {
        var overlay = ensureOverlay(
          'ns-resolve-overlay',
          'Resolving with Northstar AI',
          [
            'Checking trip dependencies',
            'Searching recovery options',
            'Testing whole-trip viability',
            'Checking policy and authority'
          ]
        );
        var planForm = qs('[data-test="plan-recovery-form"]', root);
        var alreadyHasOptions = !!qs('[data-test="case-options"]', root);
        var planPromise = Promise.resolve();
        if (planForm && !alreadyHasOptions) {
          var body = {};
          qsa('input', planForm).forEach(function(input) {
            if (input.name) body[input.name] = input.value;
          });
          planPromise = fetch(planForm.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          }).then(function(r) {
            return r.json().then(function(data) {
              if (!r.ok) throw new Error(data.message || data.error || 'Planning failed');
              return data;
            });
          });
        }
        var stagePromise = runStages(overlay, RESOLVE_MS);
        Promise.all([planPromise, stagePromise])
          .then(function() {
            if (alreadyHasOptions) {
              revealOptions(root);
              return;
            }
            var url = new URL(window.location.href);
            url.searchParams.set('nsResolve', '1');
            window.location.href = url.toString();
          })
          .catch(function(err) {
            alert('Resolve failed: ' + (err && err.message ? err.message : String(err)));
          });
      });
    }

    // Execution transition after approve/execute/begin forms.
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (!form.classList.contains('inline-form') && !form.classList.contains('action-form')) return;
      var isExec =
        form.getAttribute('data-test') === 'begin-strategy-form' ||
        form.getAttribute('data-test') === 'execute-approved-strategy-form' ||
        form.getAttribute('action') === '/api/runtime/execute' ||
        form.getAttribute('action') === '/api/runtime/begin';
      if (!isExec) return;
      syncStrategyInputs(root);
      var overlay = ensureOverlay(
        'ns-execute-overlay',
        'Applying the recovery',
        [
          'Applying change',
          'Confirming provider result',
          'Rechecking downstream trip'
        ]
      );
      // Let the shared form shim own the fetch; we only show choreography.
      runStages(overlay, EXEC_MS);
    }, true);
  });
})();
</script>`;
}
