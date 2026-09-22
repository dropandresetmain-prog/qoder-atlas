/**
 * V7.2 camera/selection only. Automatic framing follows supplied bounds until
 * the operator pans/zooms. Manual camera, explicit framing, selection and
 * disclosures survive polling. No health, membership or topology is inferred.
 */
import { fitOverviewCamera, overviewFocusBox } from './camera.ts';

export const OVERVIEW_GRAPH_SCRIPT = `
(function () {
  'use strict';
  if (window.__northstarOverviewGraph) { window.__northstarInitOverviewGraphs(); return; }
  var store = window.__northstarOverviewGraph = {};
  var fitOverviewCamera = ${fitOverviewCamera.toString()};
  var overviewFocusBox = ${overviewFocusBox.toString()};
  var MIN = 0.05, MAX = 1.6;
  function parseBox(text) {
    if (!text) return null;
    var p = text.split(' ').map(Number);
    return p.length === 4 && p.every(isFinite) && p[2] > 0 && p[3] > 0 ? { x: p[0], y: p[1], w: p[2], h: p[3] } : null;
  }
  function alignPulses(canvas) {
    var edges = Array.prototype.slice.call(canvas.querySelectorAll('.og-edge'));
    Array.prototype.forEach.call(canvas.querySelectorAll('.og-pulse'), function (p) {
      var mp = p.querySelector('mpath');
      var href = mp && mp.getAttribute('href');
      var edge = href ? edges.find(function (e) { return e.id === href.replace(/^#/, ''); }) : null;
      if (!edge || edge.getAttribute('data-live') !== 'true') { p.remove(); return; }
      p.classList.remove('og-h-green', 'og-h-amber', 'og-h-red');
      var health = edge.getAttribute('data-health');
      if (health) p.classList.add('og-h-' + health);
      p.classList.toggle('og-dim', edge.classList.contains('og-dim'));
    });
  }
  function init(canvas) {
    if (canvas.__ogInit) { alignPulses(canvas); return; }
    var viewport = canvas.querySelector('.og-viewport'), world = canvas.querySelector('.og-world');
    if (!viewport || !world) return;
    canvas.__ogInit = true;
    var key = canvas.getAttribute('data-og-key') || 'overview';
    var active = canvas.getAttribute('data-og-active') === 'true';
    var focusIdentity = canvas.getAttribute('data-og-focus-id') || '';
    var saved = store[key];
    if (saved && saved.release) saved.release();
    var st = saved || { x: 0, y: 0, scale: 1, expanded: false, view: active ? 'change' : 'event', selected: null, fitted: false, mode: 'auto', explicitView: false, wasActive: false, focusIdentity: '' };
    store[key] = st;
    var homeBox = parseBox(canvas.getAttribute('data-og-home'));
    var incidentBox = parseBox(canvas.getAttribute('data-og-incident'));
    // New active incident may reframe automatically. Updates to the same
    // incident, and any manual/explicit camera choice, keep the operator's view.
    var becameActive = active && !st.wasActive;
    var focusChanged = active && focusIdentity !== '' && focusIdentity !== st.focusIdentity;
    st.wasActive = active;
    st.focusIdentity = focusIdentity;
    if ((becameActive || focusChanged) && st.mode !== 'manual' && !st.explicitView) {
      st.mode = 'auto';
      st.fitted = false;
      st.view = 'change';
    }
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var nodes = Array.prototype.slice.call(canvas.querySelectorAll('[data-og-node]'));
    var edges = Array.prototype.slice.call(canvas.querySelectorAll('.og-edge'));
    if (reduced) Array.prototype.forEach.call(canvas.querySelectorAll('.og-pulse'), function (p) { p.remove(); });
    var pulses = Array.prototype.slice.call(canvas.querySelectorAll('.og-pulse'));
    var additional = canvas.querySelector('.og-additional');
    if (additional) {
      additional.open = !!st.additionalOpen;
      additional.addEventListener('toggle', function () { st.additionalOpen = additional.open; });
    }
    nodes.concat(edges).forEach(function (n) { n.setAttribute('data-og-basedim', n.classList.contains('og-dim') ? 'true' : 'false'); });
    function apply(animate) {
      world.style.transition = animate && !reduced ? 'transform .35s cubic-bezier(.2,.8,.2,1)' : 'none';
      world.style.transform = 'translate3d(' + st.x + 'px,' + st.y + 'px,0) scale(' + st.scale + ')';
      world.classList.toggle('og-lod-overview', st.scale < 0.62);
    }
    function setView(name) {
      st.view = name;
      Array.prototype.forEach.call(canvas.querySelectorAll('[data-og-view]'), function (b) {
        var selected = b.getAttribute('data-og-view') === name;
        b.classList.toggle('is-active', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
    }
    function focusBox(id) {
      return overviewFocusBox(id, nodes.map(function (n) {
        return { id: n.getAttribute('data-og-node'), x: parseFloat(n.style.left), y: parseFloat(n.style.top), w: parseFloat(n.style.width), h: parseFloat(n.style.height) };
      }), edges.map(function (edge) { return { from: edge.getAttribute('data-og-from'), to: edge.getAttribute('data-og-to') }; }));
    }
    function canonicalBox() {
      if (st.mode === 'focus' && st.focusId) return focusBox(st.focusId) || (st.view === 'change' ? incidentBox : homeBox) || homeBox;
      return st.view === 'change' && active && incidentBox ? incidentBox : homeBox;
    }
    function frameCanonical(animate) {
      var box = canonicalBox(), rect = viewport.getBoundingClientRect();
      if (!box) return false;
      // Use viewport-relative rectangles, not an offsetTop from a potentially
      // different offset parent. Reserve real toolbar/legend lanes only.
      var toolbar = canvas.querySelector('.og-toolbar'), legend = canvas.querySelector('.og-legend');
      var top = toolbar ? Math.max(8, toolbar.getBoundingClientRect().bottom - rect.top + 8) : 8;
      var bottom = legend ? Math.max(8, rect.bottom - legend.getBoundingClientRect().top + 8) : 8;
      var signature = [box.x, box.y, box.w, box.h, rect.width, rect.height, top, bottom, st.view, st.mode].join('|');
      if (st.fitted && signature === st.frameSignature) { apply(false); return true; }
      // Change/focus framing is tight around a small cluster; give it a
      // margin so nodes straddling the box edge aren't sliced by the
      // viewport (see fitOverviewCamera's margin param in camera.ts).
      // 32 is measured, not guessed: it is the largest world-space margin that
      // still frames the change TIGHTER than the whole-event view at 1100-1920
      // wide. Larger values (the 48-72 range) zoom out past the whole-event
      // scale, which would make "Active change" the wider of the two views and
      // invert what the toggle means.
      var contextMargin = st.mode === 'focus' || st.view === 'change' ? 32 : 0;
      var frame = fitOverviewCamera(box, rect.width, rect.height, top, bottom, st.expanded ? 24 : 12, st.mode === 'focus' ? 1.3 : 1.15, st.view === 'change' ? 'start' : 'center', contextMargin);
      if (!frame) return false;
      st.x = frame.x; st.y = frame.y; st.scale = frame.scale; st.fitted = true; st.frameSignature = signature;
      apply(animate); return true;
    }
    function syncPulses() {
      pulses.forEach(function (p) {
        var mp = p.querySelector('mpath'), href = mp && mp.getAttribute('href');
        var edge = href ? edges.find(function (e) { return e.id === href.slice(1); }) : null;
        if (edge) p.classList.toggle('og-dim', edge.classList.contains('og-dim'));
      });
    }
    function clearSelection() {
      st.selected = null;
      if (st.mode === 'focus') { st.mode = 'manual'; st.focusId = null; }
      var inspector = canvas.querySelector('[data-og-inspector]');
      if (inspector) { inspector.hidden = true; inspector.textContent = ''; }
      nodes.forEach(function (n) { n.classList.remove('og-focus'); n.classList.toggle('og-dim', n.getAttribute('data-og-basedim') === 'true'); });
      edges.forEach(function (e) { e.classList.toggle('og-dim', e.getAttribute('data-og-basedim') === 'true'); });
      syncPulses();
    }
    function select(id) {
      var target = nodes.find(function (n) { return n.getAttribute('data-og-node') === id; });
      if (!target) { clearSelection(); return; }
      st.selected = id;
      var near = new Set([id]), live = [];
      edges.forEach(function (edge) {
        var from = edge.getAttribute('data-og-from'), to = edge.getAttribute('data-og-to');
        if (from === id || to === id) { near.add(from); near.add(to); live.push(edge); }
      });
      nodes.forEach(function (n) { var nid = n.getAttribute('data-og-node'); n.classList.toggle('og-focus', nid === id); n.classList.toggle('og-dim', !near.has(nid)); });
      edges.forEach(function (edge) { edge.classList.toggle('og-dim', live.indexOf(edge) < 0); });
      var inspector = canvas.querySelector('[data-og-inspector]');
      if (inspector) { inspector.textContent = target.getAttribute('data-og-description') || ''; inspector.hidden = false; }
      syncPulses();
    }
    nodes.forEach(function (n) {
      n.addEventListener('click', function (event) {
        if (event.target.closest('a')) return;
        event.stopPropagation(); select(n.getAttribute('data-og-node'));
      });
      n.addEventListener('keydown', function (event) {
        if (event.target.closest('a')) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(n.getAttribute('data-og-node')); }
      });
    });
    function zoomAround(x, y, factor) {
      var scale = Math.max(Math.min(MIN, st.scale), Math.min(MAX, st.scale * factor));
      var wx = (x - st.x) / st.scale, wy = (y - st.y) / st.scale;
      st.x = x - wx * scale; st.y = y - wy * scale; st.scale = scale; st.mode = 'manual'; st.fitted = true;
      apply(false);
    }
    var expandTimer;
    canvas.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-og-action],[data-og-view],[data-og-focus]');
      if (!btn || !canvas.contains(btn)) return;
      var action = btn.getAttribute('data-og-action'), rect = viewport.getBoundingClientRect();
      if (action === 'zoom-in') zoomAround(rect.width / 2, rect.height / 2, 1.18);
      if (action === 'zoom-out') zoomAround(rect.width / 2, rect.height / 2, 1 / 1.18);
      if (action === 'home') {
        clearSelection(); st.mode = 'auto'; st.explicitView = false; st.fitted = false;
        setView(active ? 'change' : 'event'); frameCanonical(true);
      }
      if (action === 'expand') {
        st.expanded = !st.expanded; viewport.classList.toggle('og-expanded', st.expanded);
        btn.setAttribute('aria-pressed', String(st.expanded));
        btn.setAttribute('aria-label', st.expanded ? 'Collapse graph' : 'Expand graph');
        btn.setAttribute('title', st.expanded ? 'Collapse graph' : 'Expand graph');
        clearTimeout(expandTimer);
        expandTimer = setTimeout(function () { st.fitted = false; frameCanonical(true); }, reduced ? 0 : 360);
      }
      var view = btn.getAttribute('data-og-view');
      if (view) { clearSelection(); st.mode = 'auto'; st.explicitView = true; st.fitted = false; setView(view); frameCanonical(true); }
      var id = btn.getAttribute('data-og-focus');
      if (id && focusBox(id)) { st.mode = 'focus'; st.focusId = id; st.fitted = false; select(id); frameCanonical(true); }
    });
    viewport.addEventListener('click', function (event) { if (!event.target.closest('.og-node,.og-toolbar')) clearSelection(); });
    viewport.addEventListener('keydown', function (event) { if (event.key === 'Escape') clearSelection(); });
    viewport.addEventListener('wheel', function (event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault(); var rect = viewport.getBoundingClientRect();
      zoomAround(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * .0022));
    }, { passive: false });
    var drag = null;
    viewport.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || event.target.closest('.og-node,.og-toolbar,.og-focus-pill')) return;
      drag = { x: event.clientX, y: event.clientY }; viewport.classList.add('is-dragging');
      try { viewport.setPointerCapture(event.pointerId); } catch (e) { /* not capturable */ }
    });
    viewport.addEventListener('pointermove', function (event) {
      if (!drag) return;
      st.x += event.clientX - drag.x; st.y += event.clientY - drag.y;
      drag = { x: event.clientX, y: event.clientY }; st.mode = 'manual'; st.fitted = true; apply(false);
    });
    function endDrag(event) {
      drag = null; viewport.classList.remove('is-dragging');
      try { viewport.releasePointerCapture(event.pointerId); } catch (e) { /* already released */ }
    }
    viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
    viewport.classList.toggle('og-expanded', st.expanded);
    var expand = canvas.querySelector('[data-og-action="expand"]');
    if (expand) { expand.setAttribute('aria-pressed', String(st.expanded)); expand.setAttribute('aria-label', st.expanded ? 'Collapse graph' : 'Expand graph'); }
    if (st.mode === 'auto' && !st.explicitView) setView(active ? 'change' : 'event'); else setView(st.view);
    if (st.mode === 'manual' && st.fitted) apply(false); else frameCanonical(false);
    if (st.selected) select(st.selected);
    var observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () {
      if (!canvas.isConnected) { observer.disconnect(); return; }
      if (st.mode !== 'manual' || !st.fitted) frameCanonical(false);
    }) : null;
    if (observer) observer.observe(viewport);
    st.release = function () { if (observer) observer.disconnect(); clearTimeout(expandTimer); };
  }
  function initAll() { Array.prototype.forEach.call(document.querySelectorAll('[data-og-canvas]'), init); }
  window.__northstarInitOverviewGraphs = initAll;
  var queued = false;
  new MutationObserver(function () {
    if (queued) return; queued = true;
    requestAnimationFrame(function () { queued = false; initAll(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll); else initAll();
})();
`;
