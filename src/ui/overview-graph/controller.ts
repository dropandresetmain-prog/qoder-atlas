/**
 * Event Overview graph — small client controller (vanilla JS, no framework).
 *
 * Owns display concerns only: pan, zoom, Home, expand, framing views and
 * selection emphasis. It never changes business state and never infers
 * anything from the graph.
 *
 * Survives background patching: camera, view, expand state and selection are
 * kept in memory per canvas key. When a poll replaces the markup, a
 * MutationObserver initialises the fresh canvas and RESTORES that state. The
 * camera is auto-fitted only on the first render of a key and on Home / an
 * explicit framing choice — never because data refreshed.
 *
 * Wheel zoom needs Ctrl/Cmd (or a pinch), so the page keeps scrolling normally.
 */
export const OVERVIEW_GRAPH_SCRIPT = `
(function () {
  'use strict';
  if (window.__northstarOverviewGraph) { window.__northstarInitOverviewGraphs(); return; }
  var store = window.__northstarOverviewGraph = {};
  var MIN = 0.3, MAX = 1.6;

  function parseBox(text) {
    if (!text) return null;
    var p = text.split(' ').map(Number);
    return p.length === 4 && p.every(isFinite) ? { x: p[0], y: p[1], w: p[2], h: p[3] } : null;
  }

  function init(canvas) {
    if (canvas.__ogInit) return;
    var viewport = canvas.querySelector('.og-viewport');
    var world = canvas.querySelector('.og-world');
    if (!viewport || !world) return;
    canvas.__ogInit = true;

    var key = canvas.getAttribute('data-og-key') || 'overview';
    var saved = store[key];
    var st = saved || { x: 0, y: 0, scale: 1, expanded: false, view: 'event', selected: null, fitted: false };
    store[key] = st;
    var additional = canvas.querySelector('.og-additional');
    if (additional) {
      additional.open = !!st.additionalOpen;
      additional.addEventListener('toggle', function () { st.additionalOpen = additional.open; });
    }
    var homeBox = parseBox(canvas.getAttribute('data-og-home'));
    var incidentBox = parseBox(canvas.getAttribute('data-og-incident'));
    var active = canvas.getAttribute('data-og-active') === 'true';
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      Array.prototype.forEach.call(canvas.querySelectorAll('.og-pulse'), function (p) { p.parentNode.removeChild(p); });
    }

    function lod() {
      world.classList.toggle('og-lod-overview', st.scale < 0.62);
    }

    function apply(animate) {
      world.style.transition = animate ? 'transform .5s cubic-bezier(.2,.8,.2,1)' : 'none';
      world.style.transform = 'translate3d(' + st.x + 'px,' + st.y + 'px,0) scale(' + st.scale + ')';
      lod();
    }

    function size() {
      var r = viewport.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }

    function frame(box, maxScale, pad, animate) {
      var s = size();
      if (!box || s.w <= 0 || s.h <= 0) return false;
      var scale = Math.max(0.01, Math.min((s.w - pad * 2) / box.w, (s.h - pad * 2) / box.h, maxScale));
      st.scale = scale;
      st.x = (s.w - box.w * scale) / 2 - box.x * scale;
      st.y = (s.h - box.h * scale) / 2 - box.y * scale;
      st.fitted = true;
      apply(animate);
      return true;
    }

    function frameCanonical(animate) {
      var pad = st.expanded ? 24 : 10;
      if (st.view === 'change' && active && incidentBox) return frame(incidentBox, 1.05, pad, animate);
      return frame(homeBox, 1.05, pad, animate);
    }

    function setView(name) {
      st.view = name;
      Array.prototype.forEach.call(canvas.querySelectorAll('[data-og-view]'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-og-view') === name);
      });
    }

    function zoomAround(cx, cy, factor) {
      var scale = Math.max(MIN, Math.min(MAX, st.scale * factor));
      var wx = (cx - st.x) / st.scale, wy = (cy - st.y) / st.scale;
      st.x = cx - wx * scale; st.y = cy - wy * scale; st.scale = scale;
      st.fitted = true;
      apply(false);
    }

    // --- selection: display-only, neighbourhood of the visible projection ---
    var nodes = Array.prototype.slice.call(canvas.querySelectorAll('[data-og-node]'));
    var edges = Array.prototype.slice.call(canvas.querySelectorAll('.og-edge'));
    var pulses = Array.prototype.slice.call(canvas.querySelectorAll('.og-pulse'));
    function baseDim(el) { return el.getAttribute('data-og-basedim') === 'true'; }
    nodes.forEach(function (n) { n.setAttribute('data-og-basedim', n.classList.contains('og-dim') ? 'true' : 'false'); });
    edges.forEach(function (e) { e.setAttribute('data-og-basedim', e.classList.contains('og-dim') ? 'true' : 'false'); });

    function clearSelection() {
      st.selected = null;
      var inspector = canvas.querySelector('[data-og-inspector]');
      if (inspector) { inspector.hidden = true; inspector.textContent = ''; }
      nodes.forEach(function (n) { n.classList.remove('og-focus'); n.classList.toggle('og-dim', baseDim(n)); });
      edges.forEach(function (e) { e.classList.toggle('og-dim', baseDim(e)); });
      syncPulses();
    }

    function syncPulses() {
      // A pulse follows its connector: dim when the connector is dimmed.
      pulses.forEach(function (p) {
        var mp = p.querySelector('mpath');
        var id = mp ? (mp.getAttribute('href') || '').slice(1) : '';
        var edge = id ? canvas.querySelector('#' + id) : null;
        if (edge) p.classList.toggle('og-dim', edge.classList.contains('og-dim'));
      });
    }

    function select(id) {
      var target = canvas.querySelector('[data-og-node="' + id.replace(/"/g, '') + '"]');
      if (!target) { clearSelection(); return; }
      st.selected = id;
      var inspector = canvas.querySelector('[data-og-inspector]');
      if (inspector) { inspector.textContent = target.getAttribute('data-og-description') || ''; inspector.hidden = false; }
      var near = {}; near[id] = true;
      var live = [];
      edges.forEach(function (e) {
        var f = e.getAttribute('data-og-from'), t = e.getAttribute('data-og-to');
        if (f === id || t === id) { near[f] = true; near[t] = true; live.push(e); }
      });
      nodes.forEach(function (n) {
        var nid = n.getAttribute('data-og-node');
        n.classList.toggle('og-focus', nid === id);
        n.classList.toggle('og-dim', !near[nid]);
      });
      edges.forEach(function (e) { e.classList.toggle('og-dim', live.indexOf(e) < 0); });
      syncPulses();
    }

    nodes.forEach(function (n) {
      n.addEventListener('click', function (ev) {
        if (ev.target.closest && ev.target.closest('a')) return;
        ev.stopPropagation();
        select(n.getAttribute('data-og-node'));
      });
      n.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(n.getAttribute('data-og-node')); }
      });
    });
    viewport.addEventListener('click', function (ev) {
      if (!ev.target.closest('.og-node') && !ev.target.closest('.og-toolbar') && !ev.target.closest('.og-focus-pill')) clearSelection();
    });
    viewport.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') clearSelection(); });

    // --- controls ---
    canvas.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-og-action],[data-og-view],[data-og-focus]') : null;
      if (!btn || !canvas.contains(btn)) return;
      var action = btn.getAttribute('data-og-action');
      var s = size();
      if (action === 'zoom-in') zoomAround(s.w / 2, s.h / 2, 1.18);
      else if (action === 'zoom-out') zoomAround(s.w / 2, s.h / 2, 1 / 1.18);
      else if (action === 'home') { setView(active ? 'change' : 'event'); frameCanonical(true); }
      else if (action === 'expand') {
        st.expanded = !st.expanded;
        viewport.classList.toggle('og-expanded', st.expanded);
        btn.setAttribute('aria-pressed', st.expanded ? 'true' : 'false');
        btn.setAttribute('aria-label', st.expanded ? 'Collapse graph' : 'Expand graph');
        btn.setAttribute('title', st.expanded ? 'Collapse graph' : 'Expand graph');
        setTimeout(function () { frameCanonical(true); }, 360);
      }
      var view = btn.getAttribute('data-og-view');
      if (view) {
        setView(view);
        var pad = st.expanded ? 24 : 10;
        if (view === 'change' && incidentBox) frame(incidentBox, 1.05, pad, true);
        else frame(homeBox, 1.05, pad, true);
      }
      var focusId = btn.getAttribute('data-og-focus');
      if (focusId) {
        // A deliberate action: tighten on the chosen traveller and what it touches.
        var ids = {}; ids[focusId] = true;
        edges.forEach(function (e) {
          var f = e.getAttribute('data-og-from'), t = e.getAttribute('data-og-to');
          if (f === focusId || t === focusId) { ids[f] = true; ids[t] = true; }
        });
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(function (n) {
          if (!ids[n.getAttribute('data-og-node')]) return;
          var x = parseFloat(n.style.left), y = parseFloat(n.style.top);
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + parseFloat(n.style.width)); maxY = Math.max(maxY, y + parseFloat(n.style.height));
        });
        if (isFinite(minX)) frame({ x: minX - 20, y: minY - 20, w: maxX - minX + 40, h: maxY - minY + 40 }, 1.1, 16, true);
        select(focusId);
      }
    });
    Array.prototype.forEach.call(canvas.querySelectorAll('.og-toolbar button, .og-focus-pill button'), function (b) {
      b.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    });

    viewport.addEventListener('wheel', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      var r = viewport.getBoundingClientRect();
      zoomAround(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0022));
    }, { passive: false });

    var drag = null;
    viewport.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('.og-toolbar') || ev.target.closest('.og-focus-pill') || ev.target.closest('.og-node')) return;
      drag = { x: ev.clientX, y: ev.clientY };
      viewport.classList.add('is-dragging');
      try { viewport.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
    });
    viewport.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      st.x += ev.clientX - drag.x; st.y += ev.clientY - drag.y;
      drag = { x: ev.clientX, y: ev.clientY };
      st.fitted = true;
      apply(false);
    });
    function endDrag(ev) {
      drag = null; viewport.classList.remove('is-dragging');
      try { viewport.releasePointerCapture(ev.pointerId); } catch (e) { /* already released */ }
    }
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    // --- first render vs. restore ---
    viewport.classList.toggle('og-expanded', st.expanded);
    var expandBtn = canvas.querySelector('[data-og-action="expand"]');
    if (expandBtn && st.expanded) {
      expandBtn.setAttribute('aria-pressed', 'true');
      expandBtn.setAttribute('aria-label', 'Collapse graph');
    }
    setView(st.view);
    function firstFit() {
      if (st.fitted) { apply(false); return true; }
      setView(active ? 'change' : 'event');
      return frameCanonical(false);
    }
    if (!firstFit() && typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () { if (firstFit()) ro.disconnect(); });
      ro.observe(viewport);
    }
    if (saved && st.selected) select(st.selected);
  }

  function initAll() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-og-canvas]'), init);
  }
  window.__northstarInitOverviewGraphs = initAll;

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; initAll(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
`;
