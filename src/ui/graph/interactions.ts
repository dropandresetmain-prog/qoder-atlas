/**
 * R2 LANE B — inline interaction script.
 *
 * Vanilla JS (no framework): pan, zoom, toolbar, named views, node selection.
 * Semantic zoom: hide detail below scale threshold.
 *
 * The script initialises EVERY `.fg-canvas` on the page (Current and Original),
 * each with its own state, exactly once (`__fgInit`). It is safe to emit more than
 * once and safe to call again after a polling swap replaced the markup:
 *   - each canvas records its pan/zoom/view/selection (in memory, keyed by
 *     `data-graph-role`) as the operator uses it;
 *   - `window.__northstarInitGraphs()` initialises new canvases and restores that
 *     recorded state, so a poll never resets what the operator is looking at.
 * A canvas inside a hidden panel has no size, so it fits lazily when first shown
 * (`fg:show`).
 */

export const INTERACTIONS_SCRIPT = `
(function() {
  'use strict';

  var MIN_SCALE = 0.3;
  var MAX_SCALE = 2.0;
  var ZOOM_STEP = 0.15;
  var SEMANTIC_ZOOM_THRESHOLD = 0.7;

  window.__northstarGraphState = window.__northstarGraphState || {};

  function initCanvas(canvas) {
    if (canvas.__fgInit) return;
    var viewport = canvas.querySelector('.fg-viewport');
    var stage = canvas.querySelector('.fg-stage');
    var toolbar = canvas.querySelector('.fg-toolbar');
    var views = canvas.querySelector('.fg-views');
    var zoomReadout = canvas.querySelector('.fg-zoom-readout');
    if (!viewport || !stage || !toolbar || !views || !zoomReadout) return;
    canvas.__fgInit = true;

    var role = canvas.getAttribute('data-graph-role') || 'current';
    var scale = 1;
    var translateX = 0;
    var translateY = 0;
    var currentView = 'overview';
    var selectedRef = null;
    var fitted = false;

    function visible() {
      var r = viewport.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function remember() {
      window.__northstarGraphState[role] = { scale: scale, x: translateX, y: translateY, view: currentView, selected: selectedRef };
    }

    function applyTransform() {
      stage.style.transform = 'translate(' + translateX + 'px, ' + translateY + 'px) scale(' + scale + ')';
      zoomReadout.textContent = Math.round(scale * 100) + '%';
      if (scale < SEMANTIC_ZOOM_THRESHOLD) stage.classList.add('fg-zoom-out');
      else stage.classList.remove('fg-zoom-out');
      remember();
    }

    function zoomAt(clientX, clientY, delta) {
      var rect = viewport.getBoundingClientRect();
      var x = clientX - rect.left;
      var y = clientY - rect.top;
      var worldX = (x - translateX) / scale;
      var worldY = (y - translateY) / scale;
      var newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));
      translateX = x - worldX * newScale;
      translateY = y - worldY * newScale;
      scale = newScale;
      applyTransform();
    }

    function fitView(minX, minY, maxX, maxY, padding) {
      var rect = viewport.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      var width = maxX - minX;
      var height = maxY - minY;
      var scaleX = (rect.width - padding * 2) / width;
      var scaleY = (rect.height - padding * 2) / height;
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(scaleX, scaleY)));
      translateX = (rect.width - width * scale) / 2 - minX * scale;
      translateY = (rect.height - height * scale) / 2 - minY * scale;
      fitted = true;
      applyTransform();
    }

    function bounds(nodes) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(function(node) {
        var x = parseFloat(node.style.left);
        var y = parseFloat(node.style.top);
        var w = parseFloat(node.style.width);
        var h = parseFloat(node.style.height);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      });
      return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    }

    function markActive(viewName) {
      currentView = viewName;
      views.querySelectorAll('button').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.view === viewName);
      });
    }

    function setView(viewName) {
      markActive(viewName);
      var nodes;
      var padding = 60;
      if (viewName === 'disruption') {
        nodes = Array.prototype.slice.call(stage.querySelectorAll('.fg-node[data-focus="causal"], .fg-node.fg-focal'));
        padding = 80;
      } else {
        nodes = Array.prototype.slice.call(stage.querySelectorAll('.fg-node'));
      }
      if (nodes.length === 0) return;
      var b = bounds(nodes);
      fitView(b.minX, b.minY, b.maxX, b.maxY, padding);
    }

    function clearSelection() {
      stage.querySelectorAll('.fg-highlighted').forEach(function(el) { el.classList.remove('fg-highlighted'); });
      stage.querySelectorAll('.fg-dimmed').forEach(function(el) { el.classList.remove('fg-dimmed'); });
      selectedRef = null;
      remember();
    }

    function selectRef(ref) {
      clearSelection();
      var node = null;
      stage.querySelectorAll('.fg-node').forEach(function(n) { if (n.dataset.ref === ref) node = n; });
      if (!node) return;
      selectedRef = ref;
      node.classList.add('fg-highlighted');
      var connected = {};
      connected[ref] = true;
      var edges = stage.querySelectorAll('.fg-edge');
      edges.forEach(function(edge) {
        if (edge.dataset.source === ref || edge.dataset.target === ref) {
          connected[edge.dataset.source] = true;
          connected[edge.dataset.target] = true;
        }
      });
      stage.querySelectorAll('.fg-node').forEach(function(n) {
        if (!connected[n.dataset.ref]) n.classList.add('fg-dimmed');
      });
      edges.forEach(function(edge) {
        if (edge.dataset.source !== ref && edge.dataset.target !== ref) edge.classList.add('fg-dimmed');
      });
      remember();
    }

    // Pan: document listeners exist only while a drag is in progress.
    viewport.addEventListener('mousedown', function(e) {
      if (e.target.closest('.fg-node')) return;
      var startX = e.clientX, startY = e.clientY, startTx = translateX, startTy = translateY;
      viewport.style.cursor = 'grabbing';
      function move(ev) {
        translateX = startTx + (ev.clientX - startX);
        translateY = startTy + (ev.clientY - startY);
        applyTransform();
      }
      function up() {
        viewport.style.cursor = 'grab';
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    viewport.addEventListener('wheel', function(e) {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
    }, { passive: false });

    toolbar.addEventListener('click', function(e) {
      var button = e.target.closest('button');
      if (!button) return;
      var action = button.dataset.action;
      var rect = viewport.getBoundingClientRect();
      if (action === 'zoom-in') zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, ZOOM_STEP);
      else if (action === 'zoom-out') zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, -ZOOM_STEP);
      else if (action === 'home') setView('overview');
    });

    views.addEventListener('click', function(e) {
      var button = e.target.closest('button');
      if (!button || button.disabled) return;
      setView(button.dataset.view);
    });

    stage.addEventListener('click', function(e) {
      var node = e.target.closest('.fg-node');
      if (!node) { clearSelection(); return; }
      if (selectedRef === node.dataset.ref) { clearSelection(); return; }
      selectRef(node.dataset.ref);
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && canvas.isConnected && selectedRef) clearSelection();
    });

    // A canvas in a hidden panel fits the first time it is shown.
    canvas.addEventListener('fg:show', function() {
      if (!fitted) setView(currentView);
    });

    // Restore what the operator was looking at before a polling swap, else fit the overview.
    var saved = window.__northstarGraphState[role];
    if (saved && visible()) {
      scale = saved.scale; translateX = saved.x; translateY = saved.y;
      markActive(saved.view);
      fitted = true;
      applyTransform();
      if (saved.selected) selectRef(saved.selected);
    } else if (saved) {
      // Hidden right now: remember the operator's view, apply it when shown.
      markActive(saved.view);
      canvas.addEventListener('fg:show', function once() {
        canvas.removeEventListener('fg:show', once);
        scale = saved.scale; translateX = saved.x; translateY = saved.y;
        fitted = true;
        applyTransform();
        if (saved.selected) selectRef(saved.selected);
      });
    } else if (visible()) {
      setView('overview');
    }
  }

  window.__northstarInitGraphs = function() {
    document.querySelectorAll('.fg-canvas').forEach(initCanvas);
  };
  window.__northstarShowGraphs = function(root) {
    (root || document).querySelectorAll('.fg-canvas').forEach(function(canvas) {
      canvas.dispatchEvent(new Event('fg:show'));
    });
  };
  window.__northstarInitGraphs();
})();
`;
