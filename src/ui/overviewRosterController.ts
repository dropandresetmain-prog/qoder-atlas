/**
 * Small client controller for the Overview population roster. The roster is
 * server-rendered from authoritative state; this only filters and pages the
 * already-rendered rows. State is kept on window so a polling patch can
 * replace the rows without losing the operator's search or page.
 */
export function renderOverviewRosterControllerScript(): string {
  return `<script>
(function() {
  'use strict';
  var stateKey = '__northstarOverviewRosterState';
  var state = window[stateKey] || { query: '', page: 0 };

  function initRoster() {
    var roster = document.querySelector('[data-roster]');
    if (!roster) return;
    var search = document.querySelector('[data-roster-search]');
    var previous = document.querySelector('[data-roster-prev]');
    var next = document.querySelector('[data-roster-next]');
    var status = document.querySelector('[data-roster-status]');
    var rows = Array.prototype.slice.call(roster.querySelectorAll('[data-test="population-row"]'));
    var pageSize = Number(roster.getAttribute('data-page-size')) || 10;

    function apply() {
      var query = (state.query || '').trim().toLowerCase();
      var matches = rows.filter(function(row) {
        return !query || (row.textContent || '').toLowerCase().indexOf(query) !== -1;
      });
      var pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
      state.page = Math.max(0, Math.min(Number(state.page) || 0, pageCount - 1));
      var start = state.page * pageSize;
      var end = Math.min(start + pageSize, matches.length);
      rows.forEach(function(row) { row.hidden = true; row.style.display = 'none'; });
      matches.slice(start, end).forEach(function(row) { row.hidden = false; row.style.display = ''; });
      if (status) {
        status.textContent = matches.length === 0
          ? 'No participants match this search.'
          : (String(start + 1) + '–' + String(end) + ' of ' + String(matches.length));
      }
      if (previous) previous.disabled = state.page === 0;
      if (next) next.disabled = state.page >= pageCount - 1;
      window[stateKey] = state;
    }

    if (search && search.getAttribute('data-roster-bound') !== 'true') {
      search.setAttribute('data-roster-bound', 'true');
      search.value = state.query || '';
      search.addEventListener('input', function() {
        state.query = search.value;
        state.page = 0;
        apply();
      });
    } else if (search) {
      search.value = state.query || '';
    }
    if (previous && previous.getAttribute('data-roster-bound') !== 'true') {
      previous.setAttribute('data-roster-bound', 'true');
      previous.addEventListener('click', function() { state.page -= 1; apply(); });
    }
    if (next && next.getAttribute('data-roster-bound') !== 'true') {
      next.setAttribute('data-roster-bound', 'true');
      next.addEventListener('click', function() { state.page += 1; apply(); });
    }
    apply();
  }

  document.addEventListener('northstar:patched', initRoster);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRoster);
  else initRoster();
})();
</script>`;
}
