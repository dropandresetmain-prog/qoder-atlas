/**
 * DR-4 — form/action rendering helpers for operator and traveller surfaces.
 *
 * Renders HTML forms that target REAL backend endpoints. Each form uses
 * method=POST with hidden inputs for required parameters. A small progressive
 * enhancement script converts form submissions to JSON fetch requests (the
 * backend endpoints expect JSON, not form-encoded data).
 *
 * These helpers are pure functions — they render markup based on the view
 * data, never fabricate state. The forms declare their endpoints and required
 * inputs; the JS shim handles the conversion and page reload on success.
 */
import { escapeHtml } from './html.ts';

/**
 * Render an action form targeting a real backend endpoint.
 * The form has proper action/method attributes and hidden inputs for all
 * required parameters. The progressive enhancement script (see below) converts
 * submissions to JSON fetch requests.
 */
export interface ActionFormConfig {
  /** The real endpoint URL this form posts to. */
  action: string;
  /** Human-readable button label. */
  label: string;
  /** Hidden input name/value pairs. */
  hiddenInputs?: Record<string, string>;
  /** Additional CSS classes for the button. */
  buttonClass?: string;
  /** Button variant: 'primary' | 'danger' | 'default'. */
  variant?: 'primary' | 'danger' | 'default';
  /** Optional confirmation message before submitting. */
  confirm?: string;
  /** Optional data attribute for test selectors. */
  dataTest?: string;
}

export function renderActionForm(config: ActionFormConfig): string {
  const hiddenInputs = config.hiddenInputs
    ? Object.entries(config.hiddenInputs)
        .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
        .join('\n        ')
    : '';
  const variantClass = config.variant === 'danger' ? 'btn-danger' : config.variant === 'primary' ? 'btn-primary' : '';
  const classes = ['action-btn', variantClass, config.buttonClass ?? ''].filter(Boolean).join(' ');
  const confirmAttr = config.confirm ? ` data-confirm="${escapeHtml(config.confirm)}"` : '';
  const dataTest = config.dataTest ? ` data-test="${escapeHtml(config.dataTest)}"` : '';

  return `<form class="action-form" action="${escapeHtml(config.action)}" method="POST"${dataTest}>
        ${hiddenInputs}
        <button type="submit" class="${classes}"${confirmAttr}>${escapeHtml(config.label)}</button>
      </form>`;
}

/**
 * Render a group of action forms (e.g., approve/decline pair).
 */
export function renderActionGroup(forms: ActionFormConfig[]): string {
  if (forms.length === 0) return '';
  const formsHtml = forms.map(renderActionForm).join('\n      ');
  return `<div class="action-group" role="group" aria-label="Available actions">
      ${formsHtml}
    </div>`;
}

/**
 * Render a clickable row link (for dashboard/programme tables).
 */
export function renderRowLink(href: string, content: string, dataTest?: string): string {
  const dataTestAttr = dataTest ? ` data-test="${escapeHtml(dataTest)}"` : '';
  return `<a href="${escapeHtml(href)}" class="row-link"${dataTestAttr}>${content}</a>`;
}

/**
 * Progressive enhancement script that converts form submissions to JSON.
 * This script:
 * 1. Intercepts form submissions
 * 2. Reads hidden inputs and converts to JSON body
 * 3. Sends fetch request to the form's action URL
 * 4. On success, reloads the page to show updated state
 * 5. On error, shows a brief error message
 *
 * The script is inline and small — no framework, no build step.
 */
export function renderFormEnhancementScript(): string {
  return `<script>
(function() {
  'use strict';
  // e.submitter is not populated in every situation (e.g. keyboard or
  // synthesized submissions), so also remember the last submit button the
  // user clicked on each form — its name/value must reach the JSON body.
  var lastClickedSubmitter = new WeakMap();
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'BUTTON') el = el.parentElement;
    if (el && el.type === 'submit' && el.form) lastClickedSubmitter.set(el.form, el);
  }, true);
  document.addEventListener('submit', function(e) {
    var form = e.target;
    // Intercept forms with either 'action-form' or 'inline-form' class
    if (!form || form.tagName !== 'FORM' || 
        (!form.classList.contains('action-form') && !form.classList.contains('inline-form'))) {
      return;
    }
    e.preventDefault();

    // Confirmation dialog
    var btn = form.querySelector('button[data-confirm]');
    if (btn && btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;

    // Collect the form's product inputs into the JSON body. This includes the
    // traveller request textarea as well as hidden identifiers.
    var body = {};
    var inputs = form.querySelectorAll('input, textarea, select');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (!input.name || input.disabled || input.type === 'submit' || input.type === 'button') continue;
      body[input.name] = input.value;
    }

    // Also collect any named buttons that were clicked
    var submitter = e.submitter || lastClickedSubmitter.get(form) || null;
    if (submitter && submitter.name && submitter.value) {
      body[submitter.name] = submitter.value;
    }

    // Reveal the real planning operation while its POST is in flight. The
    // stages name work performed by that request; no theatrical delay is
    // introduced and the server response remains the source of truth.
    var planningProgress = form.parentElement && form.parentElement.querySelector('[data-planning-progress]');
    if (planningProgress) {
      form.hidden = true;
      planningProgress.hidden = false;
    }

    var resultTarget = form.dataset.resultTarget ? document.getElementById(form.dataset.resultTarget) : null;
    var buttons = form.querySelectorAll('button[type="submit"]');
    for (var j = 0; j < buttons.length; j++) buttons[j].disabled = true;

    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(function(r) {
      return r.json().then(function(data) {
        return { ok: r.ok, status: r.status, data: data };
      });
    })
    .then(function(result) {
      if (result.ok) {
        if (planningProgress) planningProgress.dataset.state = 'complete';
        if (resultTarget) {
          resultTarget.className = 'form-result is-success';
          resultTarget.textContent = 'Request received. Northstar is checking it against your trip.';
          form.reset();
        } else {
          // Operator actions need the newly projected case state. The
          // traveller composer keeps its acknowledgement in place so the
          // response is readable instead of disappearing during a reload.
          window.setTimeout(function() { window.location.reload(); }, 160);
        }
      } else {
        var msg = result.data.clarificationNeeded || result.data.error || result.data.message || 'We could not understand that request.';
        if (resultTarget) {
          resultTarget.className = 'form-result is-error';
          resultTarget.textContent = msg;
        } else {
          alert('Action failed: ' + msg);
        }
        if (planningProgress) {
          planningProgress.hidden = true;
          form.hidden = false;
        }
        for (var j = 0; j < buttons.length; j++) buttons[j].disabled = false;
      }
    })
    .catch(function(err) {
      if (resultTarget) {
        resultTarget.className = 'form-result is-error';
        resultTarget.textContent = 'The request could not be sent. Your trip has not changed.';
      } else {
        alert('Request failed: ' + err.message);
      }
      if (planningProgress) {
        planningProgress.hidden = true;
        form.hidden = false;
      }
      for (var j = 0; j < buttons.length; j++) buttons[j].disabled = false;
    });
  });
})();
</script>`;
}

/**
 * Render an inline result display area for action feedback.
 */
export function renderActionResult(id: string): string {
  return `<div id="${escapeHtml(id)}" class="action-result" style="display:none;" role="status"></div>`;
}
