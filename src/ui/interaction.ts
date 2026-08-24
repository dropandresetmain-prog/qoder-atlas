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

    // Collect hidden inputs into JSON body
    var body = {};
    var inputs = form.querySelectorAll('input[type="hidden"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      body[input.name] = input.value;
    }

    // Also collect any named buttons that were clicked
    var submitter = e.submitter;
    if (submitter && submitter.name && submitter.value) {
      body[submitter.name] = submitter.value;
    }

    // Disable button during request
    var button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;

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
        // Success: reload to show updated state
        window.location.reload();
      } else {
        // Error: show message and re-enable button
        var msg = result.data.error || result.data.message || 'Request failed';
        alert('Action failed: ' + msg);
        if (button) button.disabled = false;
      }
    })
    .catch(function(err) {
      alert('Request failed: ' + err.message);
      if (button) button.disabled = false;
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
