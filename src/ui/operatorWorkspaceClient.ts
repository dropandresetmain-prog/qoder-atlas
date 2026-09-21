/**
 * Client behaviour for the V5 workspace composition.
 * Tabs, incident focus and drawers only reveal already-rendered content.
 * They do not classify travellers or decide viability.
 */
export function renderOverviewWorkspaceScript(): string {
  return `<script>
(function() {
  'use strict';
  var tabKey = '__northstarOverviewTab';
  var focusKey = '__northstarOverviewFocus';
  function panels() { return document.querySelectorAll('[data-overview-panel]'); }
  function tabs() { return document.querySelectorAll('[data-overview-tab]'); }
  function show(name) {
    tabs().forEach(function(tab) {
      var on = tab.getAttribute('data-overview-tab') === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels().forEach(function(panel) { panel.hidden = panel.getAttribute('data-overview-panel') !== name; });
    var focus = document.querySelector('[data-overview-focus]');
    if (focus) focus.hidden = name !== 'event';
    try { sessionStorage.setItem(tabKey, name); } catch (e) {}
  }
  function bind() {
    tabs().forEach(function(tab) {
      if (tab.getAttribute('data-bound') === 'true') return;
      tab.setAttribute('data-bound', 'true');
      tab.addEventListener('click', function() { show(tab.getAttribute('data-overview-tab') || 'event'); });
    });
    document.querySelectorAll('[data-switch-overview]').forEach(function(button) {
      if (button.getAttribute('data-bound') === 'true') return;
      button.setAttribute('data-bound', 'true');
      button.addEventListener('click', function() { show(button.getAttribute('data-switch-overview') || 'participants'); });
    });
    var select = document.querySelector('[data-overview-focus-select]');
    if (select && select.getAttribute('data-bound') !== 'true') {
      select.setAttribute('data-bound', 'true');
      select.addEventListener('change', function() {
        var value = select.value;
        try { sessionStorage.setItem(focusKey, value); } catch (e) {}
        document.querySelectorAll('[data-test="overview-item"]').forEach(function(row) {
          row.classList.toggle('is-focused', (row.getAttribute('data-case-ref') || row.getAttribute('data-trip-ref')) === value);
        });
        var label = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : '';
        var context = document.querySelector('[data-test="overview-active-context"]');
        if (context && label) context.textContent = label;
      });
    }
    var saved = 'event';
    try { saved = sessionStorage.getItem(tabKey) || 'event'; } catch (e) {}
    if (!document.querySelector('[data-overview-panel="' + saved + '"]')) saved = 'event';
    show(saved);
  }
  document.addEventListener('northstar:patched', bind);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
</script>`;
}

export function renderCaseWorkspaceScript(): string {
  return `<script>
(function() {
  'use strict';
  var key = '__northstarCaseTab';
  function show(name) {
    document.querySelectorAll('[data-case-tab]').forEach(function(tab) {
      var on = tab.getAttribute('data-case-tab') === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-case-panel]').forEach(function(panel) {
      panel.hidden = panel.getAttribute('data-case-panel') !== name;
    });
    try { sessionStorage.setItem(key, name); } catch (e) {}
  }
  function bind() {
    document.querySelectorAll('[data-case-tab]').forEach(function(tab) {
      if (tab.getAttribute('data-bound') === 'true') return;
      tab.setAttribute('data-bound', 'true');
      tab.addEventListener('click', function() { show(tab.getAttribute('data-case-tab') || 'recovery'); });
    });
    var drawer = document.querySelector('[data-v5-drawer]');
    document.querySelectorAll('[data-drawer-from]').forEach(function(button) {
      if (button.getAttribute('data-bound') === 'true') return;
      button.setAttribute('data-bound', 'true');
      button.addEventListener('click', function() {
        if (!drawer || typeof drawer.showModal !== 'function') return;
        var source = document.querySelector(button.getAttribute('data-drawer-from'));
        var title = drawer.querySelector('[data-v5-drawer-title]');
        var body = drawer.querySelector('[data-v5-drawer-body]');
        if (title) title.textContent = button.getAttribute('data-drawer-title') || 'Details';
        if (body) body.innerHTML = source ? source.innerHTML : '<p>No further evidence is available on this case.</p>';
        drawer.showModal();
      });
    });
    var close = drawer && drawer.querySelector('[data-v5-drawer-close]');
    if (close && close.getAttribute('data-bound') !== 'true') {
      close.setAttribute('data-bound', 'true');
      close.addEventListener('click', function() { drawer.close(); });
    }
    var saved = 'recovery';
    try { saved = sessionStorage.getItem(key) || 'recovery'; } catch (e) {}
    show(saved);
  }
  document.addEventListener('northstar:patched', bind);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
</script>`;
}
