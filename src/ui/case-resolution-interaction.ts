/**
 * Case Resolve choreography — presentation overlay around real engine results.
 *
 * Does not slow the planning/execution engines. Stages are UI-only progress
 * while a real plan/begin/execute request runs (or a short settle when options
 * are already projected). Respects prefers-reduced-motion.
 *
 * Stages are labelled by lifecycle phase (planning → authority → execution →
 * observation → state update) from the choreography contract. Content is
 * driven by structured data attributes on the workspace when present; never
 * by hero/person ID branches.
 *
 * Workspace phase is server-projected (`data-case-phase`). sessionStorage may
 * remember a harmless expansion preference but must not resurrect Resolve,
 * hide Execute, or make a resolved case look open.
 */
import { STEP_ICON_SVG } from './icons.ts';

/** The semantic icon set, embedded as a JS object literal in the page script. */
const STEP_ICONS_JSON = JSON.stringify(STEP_ICON_SVG);

export function renderCaseResolutionEnhancementScript(): string {
  return `<script>
(function() {
  'use strict';
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var RESOLVE_MS = REDUCE ? 200 : 3000;
  var EXEC_MS = REDUCE ? 200 : 2400;

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function setPhase(root, phase) {
    if (!root) return;
    var current = root.getAttribute('data-case-phase');
    if (current === 'resolved' || current === 'execute' || current === 'executing' || current === 'awaiting_authority') {
      return;
    }
    root.setAttribute('data-case-phase', phase);
    root.setAttribute('data-test', 'case-phase-' + phase);
  }

  function parseSteps(raw, fallback) {
    if (!raw) return fallback;
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(function(step) {
          if (typeof step === 'string') return { phase: 'planning', label: step };
          return {
            phase: step.phase || 'planning',
            label: step.label || String(step)
          };
        });
      }
    } catch (err) { /* ignore malformed structured steps */ }
    return fallback;
  }

  var DEFAULT_PLANNING = [
    { phase: 'planning', label: 'Re-checking the trip' },
    { phase: 'planning', label: 'Searching recovery options' },
    { phase: 'planning', label: 'Testing the whole trip with each option' },
    { phase: 'authority', label: 'Checking policy and approval' }
  ];
  var DEFAULT_EXECUTION = [
    { phase: 'execution', label: 'Applying the approved change' },
    { phase: 'observation', label: 'Confirming the result with the provider' },
    { phase: 'state_update', label: 'Updating the trip record' },
    { phase: 'recheck', label: 'Rechecking the rest of the trip' }
  ];

  function stepIcon(phase, label) {
    var icons = ${STEP_ICONS_JSON};
    var text = String(label || '').toLowerCase();
    // Element-topic icons first: a hotel step shows the hotel, a flight step
    // shows the plane — never one rotating glyph for every phase.
    if (/flight|airline|onward|inventory|rebook/.test(text)) return icons.flight;
    if (/connection|depend|transfer|hub/.test(text)) return icons.ground;
    if (/hotel|stay|overnight/.test(text)) return icons.stay;
    if (/entry|immigration|transit|visa/.test(text)) return icons.entry;
    if (/insurance|policy cover/.test(text)) return icons.insurance;
    if (/programme|headline|commitment|event/.test(text)) return icons.commitment;
    if (/cost|fund|price/.test(text)) return icons.cost;
    if (/linked traveller|who is affected|traveller/.test(text)) return icons.travellers;
    if (/proposed|time|when/.test(text)) return icons.time;
    if (/knock|impact|affected trip|ripple/.test(text)) return icons.impact;
    if (/search|finding|option/.test(text)) return icons.search;
    if (/testing|test the whole/.test(text)) return icons.impact;
    if (/re-check|recheck|check the trip|viab/.test(text)) return icons.recheck;
    // Lifecycle phase fallbacks: each phase gets its own semantic category.
    if (phase === 'authority') return icons.authority;
    if (phase === 'execution') return icons.execute;
    if (phase === 'observation') return icons.provider;
    if (phase === 'state_update') return icons.trip_update;
    if (phase === 'recheck') return icons.recheck;
    if (phase === 'completion') return icons.complete;
    return icons.recheck;
  }

  function ensureOverlay(id, title, steps) {
    var existing = document.getElementById(id);
    if (existing) existing.remove();
    var scrim = document.createElement('div');
    scrim.id = id;
    scrim.className = 'ns-resolve-scrim';
    scrim.setAttribute('data-test', 'lifecycle-progress-overlay');
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-label', title);
    scrim.hidden = true;
    var stepsHtml = steps.map(function(step, i) {
      var phase = step.phase || 'planning';
      var label = step.label || String(step);
      var icon = stepIcon(phase, label);
      return '<li data-step="' + i + '" data-phase="' + phase + '">' +
        '<span class="ns-resolve-step-icon" aria-hidden="true">' + icon + '</span>' +
        '<span class="ns-resolve-step-body">' +
          '<span class="ns-resolve-step-label">' + label + '</span>' +
        '</span>' +
      '</li>';
    }).join('');
    scrim.innerHTML =
      '<div class="ns-resolve-modal">' +
        '<p class="ns-resolve-kicker">Northstar progress</p>' +
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

  function formVerdict(form) {
    var input = form.querySelector('input[name="verdict"], input[name="decision"]');
    return input ? String(input.value || '').toUpperCase() : '';
  }

  function isDeclineForm(form) {
    return formVerdict(form) === 'DECLINED' || form.getAttribute('data-test') === 'organisation-decline-form';
  }

  function isExecuteForm(form) {
    if (isDeclineForm(form)) return false;
    return form.getAttribute('data-test') === 'begin-strategy-form' ||
      form.getAttribute('data-test') === 'execute-approved-strategy-form' ||
      form.getAttribute('action') === '/api/runtime/execute' ||
      form.getAttribute('action') === '/api/runtime/begin' ||
      (form.getAttribute('action') || '').indexOf('/traveller-decision') !== -1;
  }

  function submitFormAsync(form) {
    var action = form.getAttribute('action') || window.location.href;
    var method = (form.getAttribute('method') || 'POST').toUpperCase();
    var body = new URLSearchParams();
    qsa('input, select, textarea', form).forEach(function(input) {
      if (!input.name || input.disabled) return;
      if ((input.type === 'checkbox' || input.type === 'radio') && !input.checked) return;
      body.append(input.name, input.value);
    });
    return fetch(action, {
      method: method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json, text/html' },
      body: body.toString(),
      redirect: 'follow'
    });
  }

  function programmeStageKey(caseId) {
    return 'ns-programme-stage-' + caseId;
  }

  function revealProgrammeRecommendation(root) {
    var travel = qs('[data-programme-travel-panel]', root);
    var rec = qs('[data-programme-recommendation]', root);
    if (travel) travel.hidden = true;
    if (rec) rec.hidden = false;
    root.setAttribute('data-programme-recovery-stage', 'programme_recommendation');
  }

  document.addEventListener('DOMContentLoaded', function() {
    var root = qs('[data-case-workspace]');
    if (!root) return;

    bindOptionSelection(root);

    var caseId = root.getAttribute('data-case-id');
    if (caseId && root.getAttribute('data-programme-recovery') === 'true') {
      if (sessionStorage.getItem(programmeStageKey(caseId)) === 'programme_recommendation') {
        revealProgrammeRecommendation(root);
      }
    }

    var planningSteps = parseSteps(root.getAttribute('data-transition-planning'), DEFAULT_PLANNING);
    var executionSteps = parseSteps(root.getAttribute('data-transition-execution'), DEFAULT_EXECUTION);

    var programmeTravelBtn = qs('[data-programme-travel-analysis]', root);
    if (programmeTravelBtn) {
      programmeTravelBtn.addEventListener('click', function() {
        var overlay = ensureOverlay(
          'ns-programme-travel-overlay',
          'Testing travel recovery before changing the programme',
          planningSteps
        );
        runStages(overlay, RESOLVE_MS).then(function() {
          if (caseId) sessionStorage.setItem(programmeStageKey(caseId), 'programme_recommendation');
          revealProgrammeRecommendation(root);
        });
      });
    }

    var resolveBtn = qs('[data-resolve-northstar]', root);
    if (resolveBtn) {
      resolveBtn.addEventListener('click', function() {
        var overlay = ensureOverlay(
          'ns-resolve-overlay',
          'Planning a recovery',
          planningSteps
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
              setPhase(root, 'options');
              return;
            }
            window.location.reload();
          })
          .catch(function(err) {
            alert('Resolve failed: ' + (err && err.message ? err.message : String(err)));
          });
      });
    }

    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (!form.classList.contains('inline-form') && !form.classList.contains('action-form')) return;
      if (isDeclineForm(form)) return;
      if (!isExecuteForm(form)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      syncStrategyInputs(root);
      var isBegin = form.getAttribute('data-test') === 'begin-strategy-form' ||
        form.getAttribute('action') === '/api/runtime/begin';
      var isExecuteApproved = form.getAttribute('data-test') === 'execute-approved-strategy-form' ||
        form.getAttribute('action') === '/api/runtime/execute';
      var overlay = ensureOverlay(
        'ns-execute-overlay',
        isBegin ? 'Starting recovery' : 'Executing approved recovery',
        isBegin ? planningSteps.slice(-2).concat(executionSteps.slice(0, 1)) : executionSteps
      );
      // JSON body matches the progressive-enhancement contract used elsewhere.
      var body = {};
      qsa('input, select, textarea', form).forEach(function(input) {
        if (!input.name || input.disabled) return;
        if ((input.type === 'checkbox' || input.type === 'radio') && !input.checked) return;
        var dot = input.name.indexOf('.');
        if (dot > 0) {
          var parent = input.name.slice(0, dot);
          var child = input.name.slice(dot + 1);
          if (child && !Object.prototype.hasOwnProperty.call(body, parent)) body[parent] = {};
          if (child && body[parent] && typeof body[parent] === 'object') body[parent][child] = input.value;
        } else {
          body[input.name] = input.value;
        }
      });
      var requestPromise = fetch(form.getAttribute('action') || window.location.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body)
      }).then(function(r) {
        return r.json().then(function(data) {
          if (!r.ok) throw new Error(data.message || data.error || 'Action failed');
          return data;
        }).catch(function(err) {
          if (!r.ok) throw err;
          return {};
        });
      });
      // Execute path: hold ~2s so observe → state-update steps are visible.
      var duration = isExecuteApproved ? Math.max(EXEC_MS, 2000) : EXEC_MS;
      var stagePromise = runStages(overlay, duration);
      Promise.all([requestPromise, stagePromise])
        .then(function() {
          window.location.reload();
        })
        .catch(function(err) {
          alert('Action failed: ' + (err && err.message ? err.message : String(err)));
          window.location.reload();
        });
    }, true);
  });
})();
</script>`;
}
