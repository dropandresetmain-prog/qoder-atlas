/**
 * Target product controller for the bilateral programme time-swap preview.
 *
 * This is display and request plumbing only. The server owns eligibility,
 * evaluation and the preview result; the browser sends the two selected item
 * references and never applies programme state.
 */
export function programmeItemCommandRef(itemRef: string): string {
  return itemRef.startsWith('PROGRAMME_ITEM:')
    ? itemRef.slice('PROGRAMME_ITEM:'.length)
    : itemRef;
}

export function renderProgrammeTimeSwapController(): string {
  return `<script data-programme-time-swap-controller>
(function () {
  'use strict';
  if (window.__northstarProgrammeTimeSwapController) {
    window.__northstarInitProgrammeTimeSwaps();
    return;
  }
  window.__northstarProgrammeTimeSwapController = true;

  function messageFor(data) {
    var error = data && String(data.error || '');
    var detail = data && String(data.message || '');
    var code = ['PROGRAMME_ITEM_NOT_FOUND', 'PROGRAMME_ITEM_WINDOW_MISSING', 'VALIDATION_FAILED'].indexOf(detail) >= 0
      ? detail
      : error;
    if (code === 'PROGRAMME_ITEM_NOT_FOUND') return 'One of these sessions is no longer available. Refresh the programme and try again.';
    if (code === 'PROGRAMME_ITEM_WINDOW_MISSING') return 'Both sessions need confirmed times before a swap can be previewed.';
    if (code === 'VALIDATION_FAILED') return 'Choose two different scheduled sessions.';
    return 'The time-swap preview could not be completed. Your programme was not changed. Try again.';
  }

  var commandItemRef = ${programmeItemCommandRef.toString()};

  function init(root) {
    if (root.__programmeTimeSwapInit) return;
    var first = root.querySelector('[data-programme-item-a]');
    var second = root.querySelector('[data-programme-item-b]');
    var caseChoice = root.querySelector('[data-programme-case]');
    var button = root.querySelector('[data-programme-time-swap-preview]');
    var status = root.querySelector('[data-programme-time-swap-status]');
    var result = root.querySelector('[data-programme-time-swap-result]');
    if (!first || !second || !button || !status || !result) return;
    root.__programmeTimeSwapInit = true;
    function invalidatePreview() {
      result.hidden = true;
      result.replaceChildren();
      status.textContent = '';
      sync();
    }

    function sync() {
      Array.prototype.forEach.call(second.options, function (option) {
        option.disabled = option.value === first.value;
      });
      if (second.value === first.value) {
        var replacement = Array.prototype.find.call(second.options, function (option) { return !option.disabled; });
        if (replacement) second.value = replacement.value;
      }
      var valid = first.value && second.value && first.value !== second.value;
      button.disabled = !valid;
    }

    function run() {
      if (button.disabled) return;
      button.disabled = true;
      first.disabled = true;
      second.disabled = true;
      if (caseChoice) caseChoice.disabled = true;
      status.textContent = 'Checking the selected sessions…';
      result.hidden = true;
      result.replaceChildren();

      fetch('/api/v2/programme/time-swap/preview?format=html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
        body: JSON.stringify(Object.assign({ itemARef: commandItemRef(first.value), itemBRef: commandItemRef(second.value) }, caseChoice && caseChoice.value ? { recoveryCaseId: caseChoice.value } : {}))
      }).then(function (response) {
        return response.text().then(function (body) {
          return { ok: response.ok, body: body };
        });
      }).then(function (response) {
        if (!response.ok) {
          var data;
          try { data = JSON.parse(response.body); } catch (error) { data = null; }
          throw new Error(messageFor(data));
        }
        result.innerHTML = response.body;
        result.hidden = false;
        status.textContent = 'Preview ready. Nothing has been changed.';
      }).catch(function (error) {
        status.textContent = error && error.message
          ? error.message
          : 'The time-swap preview could not be completed. Your programme was not changed. Try again.';
      }).then(function () {
        first.disabled = false;
        second.disabled = false;
        if (caseChoice) caseChoice.disabled = false;
        sync();
      });
    }

    result.addEventListener('click', function (event) {
      var stage = event.target.closest('[data-programme-time-swap-stage]');
      if (!stage || stage.disabled) return;
      stage.disabled = true;
      first.disabled = true; second.disabled = true; button.disabled = true;
      if (caseChoice) caseChoice.disabled = true;
      status.textContent = 'Checking the latest state and preparing approval…';
      fetch('/api/v2/programme/time-swap/stage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: stage.getAttribute('data-programme-time-swap-stage')
      }).then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.message || 'The change could not be prepared. Review a fresh preview.');
          return data;
        });
      }).then(function (data) {
        status.textContent = 'Ready for approval. The programme has not changed. ';
        var link = document.createElement('a');
        link.href = '/operator/cases/' + encodeURIComponent(data.recoveryCaseId);
        link.textContent = 'Open case to review and approve';
        status.appendChild(link);
      }).catch(function (error) {
        status.textContent = error.message || 'Unable to prepare approval. Please try again.';
        stage.disabled = false;
      }).then(function () {
        first.disabled = false; second.disabled = false;
        if (caseChoice) caseChoice.disabled = false;
        sync();
      });
    });
    first.addEventListener('change', invalidatePreview);
    second.addEventListener('change', invalidatePreview);
    if (caseChoice) caseChoice.addEventListener('change', invalidatePreview);
    button.addEventListener('click', run);
    sync();
  }

  function initAll() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-programme-time-swap]'), init);
  }
  window.__northstarInitProgrammeTimeSwaps = initAll;
  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () { queued = false; initAll(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
</script>`;
}
