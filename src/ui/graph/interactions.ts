/**
 * Graph client runtime (inline script; vanilla JS, no framework).
 *
 * Exposes `window.NorthstarGraph`:
 *   - `init(root?)`            initialise every `.fg-canvas` (idempotent, `__fgInit`)
 *   - `update(el, scene, hash?)` patch a live canvas from a NEW scene by node ref /
 *        edge key. Unchanged scene => zero DOM mutation. Changed scene => only the
 *        changed nodes/edges are touched; camera, view, selection and running pulse
 *        animations are preserved. The camera auto-fits ONLY on first render and Home.
 *   - `updateFromDom(el, newEl)` same, reading the scene JSON + `data-graph-scene-hash`
 *        out of a freshly fetched canvas element (what a poller has after DOMParser).
 *   - `state(el)`              {x,y,scale,view,selected} snapshot (diagnostics/tests)
 *
 * Legacy globals kept for the pollers: `__northstarInitGraphs`, `__northstarShowGraphs`.
 * Per-role camera/view/selection is remembered in `window.__northstarGraphState`
 * so a canvas that IS rebuilt (old-style swap) still restores what the operator saw.
 *
 * Deliberately: no document-level listeners (keyboard is on the focusable viewport,
 * so nothing leaks per canvas), no CSS transition on the stage, camera eased by rAF
 * only while animating, drag is direct (no lag), no browser storage.
 */

export const INTERACTIONS_SCRIPT = String.raw`
(function() {
  'use strict';
  if (window.NorthstarGraph && window.NorthstarGraph.__v === 2) {
    window.__northstarInitGraphs();
    return;
  }

  var MIN_SCALE = 0.22;
  var MAX_SCALE = 1.55;
  var FIT_MAX = 1.15;
  var FIT_PAD = 72;
  var SEMANTIC_ZOOM_THRESHOLD = 0.76;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var CLIENT_CLASSES = ['fg-viewdim', 'fg-dimmed', 'fg-highlighted'];

  window.__northstarGraphState = window.__northstarGraphState || {};

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function reduceMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function readScene(canvas) {
    var el = canvas.querySelector('script.fg-scene');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function Controller(canvas) {
    var self = this;
    this.canvas = canvas;
    this.viewport = canvas.querySelector('.fg-viewport');
    this.stage = canvas.querySelector('.fg-stage');
    this.toolbar = canvas.querySelector('.fg-toolbar');
    this.viewsBar = canvas.querySelector('.fg-views');
    this.readout = canvas.querySelector('.fg-zoom-readout');
    this.inspector = canvas.querySelector('[data-graph-inspector]');
    this.inspectorType = canvas.querySelector('[data-inspector-type]');
    this.inspectorTitle = canvas.querySelector('[data-inspector-title]');
    this.inspectorDetail = canvas.querySelector('[data-inspector-detail]');
    this.inspectorState = canvas.querySelector('[data-inspector-state]');
    this.role = canvas.getAttribute('data-graph-role') || 'current';
    this.scene = readScene(canvas);
    this.sceneStr = this.scene ? JSON.stringify(this.scene) : '';
    this.x = 0; this.y = 0; this.scale = 1;
    this.tx = 0; this.ty = 0; this.tscale = 1;
    this.view = (this.scene && this.scene.defaultView) || 'trip';
    this.selected = null;
    this.fitted = false;
    this.raf = 0;
    this.zoomOut = false;
    this.indexDom();
    this.bind();
    this.markActive(this.view);
    this.applyDim();

    var saved = window.__northstarGraphState[this.role];
    if (saved && this.visible()) {
      this.restore(saved);
    } else if (saved) {
      this.markActive(saved.view);
      this.view = saved.view;
      this.applyDim();
      this.pendingSaved = saved;
    } else if (this.visible()) {
      this.frame(this.view, true);
    }

    // First layout of a hidden/zero-size canvas (or fonts settling): fit once when it gets a size.
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(function() { self.onSized(); });
      this.ro.observe(this.viewport);
    }
    canvas.addEventListener('fg:show', function() { self.onSized(); });
  }

  Controller.prototype.visible = function() {
    var r = this.viewport.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  Controller.prototype.onSized = function() {
    if (this.fitted || !this.visible()) return;
    if (this.pendingSaved) { var s = this.pendingSaved; this.pendingSaved = null; this.restore(s); return; }
    this.frame(this.view, true);
  };

  Controller.prototype.restore = function(saved) {
    this.scale = this.tscale = saved.scale; this.x = this.tx = saved.x; this.y = this.ty = saved.y;
    this.view = saved.view;
    this.markActive(saved.view);
    this.fitted = true;
    this.applyDim();
    this.paint();
    if (saved.selected) this.selectRef(saved.selected);
  };

  Controller.prototype.indexDom = function() {
    this.nodeEls = {};
    this.edgeEls = {};
    this.pulseEls = {};
    var i, list;
    list = this.stage.querySelectorAll('.fg-node');
    for (i = 0; i < list.length; i++) this.nodeEls[list[i].getAttribute('data-ref')] = list[i];
    list = this.stage.querySelectorAll('.fg-edge');
    for (i = 0; i < list.length; i++) this.edgeEls[list[i].getAttribute('data-edge-key')] = list[i];
    list = this.stage.querySelectorAll('.fg-pulse-dot');
    for (i = 0; i < list.length; i++) this.pulseEls[list[i].getAttribute('data-pulse-for')] = list[i];
  };

  Controller.prototype.remember = function() {
    window.__northstarGraphState[this.role] = { scale: this.scale, x: this.x, y: this.y, view: this.view, selected: this.selected };
  };

  /* ---------- camera ---------- */
  Controller.prototype.paint = function() {
    this.stage.style.transform = 'translate(' + this.x + 'px, ' + this.y + 'px) scale(' + this.scale + ')';
    this.readout.textContent = Math.round(this.scale * 100) + '%';
    var out = this.scale < SEMANTIC_ZOOM_THRESHOLD;
    if (out !== this.zoomOut) { this.zoomOut = out; this.stage.classList.toggle('fg-zoom-out', out); }
    this.remember();
  };

  Controller.prototype.tick = function() {
    var self = this;
    this.raf = 0;
    var dx = this.tx - this.x, dy = this.ty - this.y, ds = this.tscale - this.scale;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05 && Math.abs(ds) < 0.0005) {
      this.x = this.tx; this.y = this.ty; this.scale = this.tscale;
      this.paint();
      return;
    }
    this.x += dx * 0.18; this.y += dy * 0.18; this.scale += ds * 0.16;
    this.paint();
    this.raf = requestAnimationFrame(function() { self.tick(); });
  };

  Controller.prototype.moveTo = function(snap) {
    if (snap || reduceMotion()) {
      this.x = this.tx; this.y = this.ty; this.scale = this.tscale;
      this.paint();
      return;
    }
    if (!this.raf) { var self = this; this.raf = requestAnimationFrame(function() { self.tick(); }); }
  };

  Controller.prototype.frame = function(viewName, snap) {
    var scene = this.scene;
    var v = scene && scene.views && scene.views[viewName];
    if (!v) return;
    var r = this.viewport.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    var rect = v.rect;
    var bw = Math.max(1, rect.x2 - rect.x1), bh = Math.max(1, rect.y2 - rect.y1);
    var pad = viewName === 'prog' ? 58 : FIT_PAD;
    this.tscale = clamp(Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh), MIN_SCALE, FIT_MAX);
    this.tx = (r.width - bw * this.tscale) / 2 - rect.x1 * this.tscale;
    this.ty = (r.height - bh * this.tscale) / 2 - rect.y1 * this.tscale;
    this.fitted = true;
    this.moveTo(snap);
  };

  Controller.prototype.zoomAt = function(clientX, clientY, factor) {
    var r = this.viewport.getBoundingClientRect();
    var px = clientX - r.left, py = clientY - r.top;
    var wx = (px - this.tx) / this.tscale, wy = (py - this.ty) / this.tscale;
    var ns = clamp(this.tscale * factor, MIN_SCALE, MAX_SCALE);
    this.tx = px - wx * ns; this.ty = py - wy * ns; this.tscale = ns;
    this.fitted = true;
    this.moveTo(false);
  };

  /* ---------- views + emphasis ---------- */
  Controller.prototype.markActive = function(name) {
    var btns = this.viewsBar.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-view') === name);
  };

  Controller.prototype.setView = function(name, snap) {
    var scene = this.scene;
    if (!scene || !scene.views[name]) name = 'trip';
    this.view = name;
    this.markActive(name);
    this.applyDim();
    this.frame(name, snap === true);
    this.remember();
  };

  Controller.prototype.home = function() { this.setView(this.view, false); };

  function toggle(el, cls, on) {
    if (!el) return;
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  }

  Controller.prototype.applyDim = function() {
    var v = this.scene && this.scene.views && this.scene.views[this.view];
    var keepN = v && v.keepNodes ? new Set(v.keepNodes) : null;
    var keepE = v && v.keepEdges ? new Set(v.keepEdges) : null;
    var ref, key;
    for (ref in this.nodeEls) toggle(this.nodeEls[ref], 'fg-viewdim', !!keepN && !keepN.has(ref));
    for (key in this.edgeEls) toggle(this.edgeEls[key], 'fg-viewdim', !!keepE && !keepE.has(key));
    for (key in this.pulseEls) toggle(this.pulseEls[key], 'fg-viewdim', !!keepE && !keepE.has(key));
  };

  Controller.prototype.clearSelection = function() {
    var ref, key;
    for (ref in this.nodeEls) { toggle(this.nodeEls[ref], 'fg-highlighted', false); toggle(this.nodeEls[ref], 'fg-dimmed', false); }
    for (key in this.edgeEls) toggle(this.edgeEls[key], 'fg-dimmed', false);
    for (key in this.pulseEls) toggle(this.pulseEls[key], 'fg-dimmed', false);
    this.selected = null;
    this.renderInspector(null);
    this.remember();
  };

  Controller.prototype.renderInspector = function(ref) {
    if (!this.inspector) return;
    var node = ref && this.scene && this.scene.nodes ? this.scene.nodes.find(function(n) { return n.ref === ref; }) : null;
    if (!node) {
      this.inspector.hidden = true;
      return;
    }
    // textContent is deliberate: full backend detail must remain readable and
    // must never become executable markup when a node is selected.
    this.inspectorType.textContent = node.entityLabel || '';
    this.inspectorTitle.textContent = node.label || '';
    var timingText = node.attrs && node.attrs['data-timing-text'];
    var detail = [timingText, node.secondaryLabel].filter(Boolean).join(' · ');
    this.inspectorDetail.textContent = detail || 'No additional detail';
    this.inspectorState.textContent = node.stateLabel || 'State unavailable';
    this.inspector.hidden = false;
  };

  Controller.prototype.selectRef = function(ref) {
    this.clearSelection();
    var node = this.nodeEls[ref];
    if (!node) return;
    this.selected = ref;
    toggle(node, 'fg-highlighted', true);
    var connected = {};
    connected[ref] = true;
    var key, e;
    for (key in this.edgeEls) {
      e = this.edgeEls[key];
      if (e.getAttribute('data-source') === ref || e.getAttribute('data-target') === ref) {
        connected[e.getAttribute('data-source')] = true;
        connected[e.getAttribute('data-target')] = true;
      }
    }
    for (var r in this.nodeEls) if (!connected[r]) toggle(this.nodeEls[r], 'fg-dimmed', true);
    for (key in this.edgeEls) {
      e = this.edgeEls[key];
      var touches = e.getAttribute('data-source') === ref || e.getAttribute('data-target') === ref;
      toggle(e, 'fg-dimmed', !touches);
      toggle(this.pulseEls[key], 'fg-dimmed', !touches);
    }
    this.renderInspector(ref);
    this.remember();
  };

  /* ---------- input ---------- */
  Controller.prototype.bind = function() {
    var self = this;
    var viewport = this.viewport;
    var drag = null;

    viewport.addEventListener('pointerdown', function(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('.fg-node')) return;
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, stx: self.x, sty: self.y, moved: false };
      try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      viewport.classList.add('fg-dragging');
    });
    viewport.addEventListener('pointermove', function(e) {
      if (!drag) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      // Direct while dragging: no easing, no lag.
      self.x = self.tx = drag.stx + dx; self.y = self.ty = drag.sty + dy;
      self.scale = self.tscale;
      self.fitted = true;
      self.paint();
    });
    function endDrag(e) {
      if (!drag) return;
      var moved = drag.moved;
      try { viewport.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      drag = null;
      viewport.classList.remove('fg-dragging');
      if (!moved) self.clearSelection();
    }
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    viewport.addEventListener('wheel', function(e) {
      e.preventDefault();
      self.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.00115));
    }, { passive: false });

    viewport.addEventListener('dblclick', function(e) {
      if (!e.target.closest('.fg-node')) self.home();
    });

    this.toolbar.addEventListener('click', function(e) {
      var button = e.target.closest('button');
      if (!button) return;
      var action = button.getAttribute('data-action');
      var r = viewport.getBoundingClientRect();
      if (action === 'zoom-in') self.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.16);
      else if (action === 'zoom-out') self.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.16);
      else if (action === 'home') self.home();
    });

    this.viewsBar.addEventListener('click', function(e) {
      var button = e.target.closest('button');
      if (!button || button.disabled) return;
      self.setView(button.getAttribute('data-view'), false);
    });

    this.stage.addEventListener('click', function(e) {
      var node = e.target.closest('.fg-node');
      if (!node) return;
      var ref = node.getAttribute('data-ref');
      if (self.selected === ref) self.clearSelection(); else self.selectRef(ref);
    });

    // Keyboard lives on the focusable viewport (no document listener => nothing to leak).
    viewport.addEventListener('keydown', function(e) {
      var r = viewport.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var t = e.target;
      if (e.key === 'Escape') { if (self.selected) self.clearSelection(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && t && t.classList && t.classList.contains('fg-node')) {
        e.preventDefault();
        var ref = t.getAttribute('data-ref');
        if (self.selected === ref) self.clearSelection(); else self.selectRef(ref);
        return;
      }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); self.zoomAt(cx, cy, 1.16); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); self.zoomAt(cx, cy, 1 / 1.16); }
      else if (e.key === 'Home' || e.key === '0') { e.preventDefault(); self.home(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); self.tx += 60; self.fitted = true; self.moveTo(false); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); self.tx -= 60; self.fitted = true; self.moveTo(false); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); self.ty += 60; self.fitted = true; self.moveTo(false); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); self.ty -= 60; self.fitted = true; self.moveTo(false); }
    });
  };

  /* ---------- patching (poll updates) ---------- */
  function setClass(el, cls) {
    var keep = [];
    for (var i = 0; i < CLIENT_CLASSES.length; i++) if (el.classList.contains(CLIENT_CLASSES[i])) keep.push(CLIENT_CLASSES[i]);
    var next = keep.length ? cls + ' ' + keep.join(' ') : cls;
    if (el.getAttribute('class') !== next) el.setAttribute('class', next);
  }
  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== String(value)) el.setAttribute(name, value);
  }
  function setStyleProp(el, name, value) {
    if (el.style[name] !== value) el.style[name] = value;
  }

  Controller.prototype.patchNode = function(n) {
    var el = this.nodeEls[n.ref];
    var sig = JSON.stringify(n);
    if (!el) {
      el = document.createElement('article');
      this.nodeEls[n.ref] = el;
      el.__fgSig = '';
      this.stage.appendChild(el);
    }
    if (el.__fgSig === sig) return;
    el.__fgSig = sig;
    setClass(el, n.cls);
    for (var k in n.attrs) setAttr(el, k, n.attrs[k]);
    setStyleProp(el, 'left', n.x + 'px');
    setStyleProp(el, 'top', n.y + 'px');
    setStyleProp(el, 'width', n.w + 'px');
    setStyleProp(el, 'height', n.h + 'px');
    if (el.__fgHtml !== n.html) { el.innerHTML = n.html; el.__fgHtml = n.html; }
  };

  Controller.prototype.patchEdge = function(e) {
    var svg = this.stage.querySelector('.fg-edges');
    var layer = svg.querySelector('.fg-edge-layer');
    var pulses = svg.querySelector('.fg-pulses');
    var el = this.edgeEls[e.key];
    var sig = JSON.stringify(e);
    if (!el) {
      el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('fill', 'none');
      el.setAttribute('data-edge-key', e.key);
      el.__fgSig = '';
      layer.appendChild(el);
      this.edgeEls[e.key] = el;
    }
    if (el.__fgSig !== sig) {
      el.__fgSig = sig;
      setClass(el, e.cls);
      setAttr(el, 'd', e.d);
      setAttr(el, 'data-source', e.source);
      setAttr(el, 'data-target', e.target);
      setAttr(el, 'data-focus', e.focus);
      setAttr(el, 'data-tone', e.tone);
    }
    var dot = this.pulseEls[e.key];
    if (!e.pulse) {
      if (dot) { dot.parentNode.removeChild(dot); delete this.pulseEls[e.key]; }
      return;
    }
    if (!dot) {
      dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('r', '3');
      dot.setAttribute('data-pulse-for', e.key);
      var anim = document.createElementNS(SVG_NS, 'animateMotion');
      anim.setAttribute('repeatCount', 'indefinite');
      dot.appendChild(anim);
      pulses.appendChild(dot);
      this.pulseEls[e.key] = dot;
    }
    setAttr(dot, 'class', 'fg-pulse-dot sem-' + e.tone + (dot.classList.contains('fg-viewdim') ? ' fg-viewdim' : '') + (dot.classList.contains('fg-dimmed') ? ' fg-dimmed' : ''));
    var a = dot.querySelector('animateMotion');
    if (a.getAttribute('dur') !== e.pulse.dur) a.setAttribute('dur', e.pulse.dur);
    if (a.getAttribute('begin') === null) a.setAttribute('begin', e.pulse.begin);
    if (a.getAttribute('path') !== e.d) a.setAttribute('path', e.d);
  };

  Controller.prototype.update = function(scene, hash) {
    var str = JSON.stringify(scene);
    if (str === this.sceneStr) return false; // unchanged: zero DOM mutation
    this.sceneStr = str;
    this.scene = scene;
    var seen = {}, i, key;
    for (i = 0; i < scene.nodes.length; i++) { seen[scene.nodes[i].ref] = true; this.patchNode(scene.nodes[i]); }
    for (key in this.nodeEls) if (!seen[key]) { this.nodeEls[key].parentNode.removeChild(this.nodeEls[key]); delete this.nodeEls[key]; }
    seen = {};
    for (i = 0; i < scene.edges.length; i++) { seen[scene.edges[i].key] = true; this.patchEdge(scene.edges[i]); }
    for (key in this.edgeEls) if (!seen[key]) {
      this.edgeEls[key].parentNode.removeChild(this.edgeEls[key]); delete this.edgeEls[key];
      if (this.pulseEls[key]) { this.pulseEls[key].parentNode.removeChild(this.pulseEls[key]); delete this.pulseEls[key]; }
    }
    setStyleProp(this.stage, 'width', scene.width + 'px');
    setStyleProp(this.stage, 'height', scene.height + 'px');

    // Views: enable/disable buttons; if the active view vanished fall back to trip WITHOUT moving the camera.
    var btns = this.viewsBar.querySelectorAll('button');
    for (i = 0; i < btns.length; i++) {
      var has = !!scene.views[btns[i].getAttribute('data-view')];
      if (btns[i].disabled === has) btns[i].disabled = !has;
    }
    if (!scene.views[this.view]) { this.view = 'trip'; this.markActive('trip'); }
    this.applyDim();
    if (this.selected) { var s = this.selected; if (this.nodeEls[s]) this.selectRef(s); else this.clearSelection(); }
    if (hash !== undefined) setAttr(this.canvas, 'data-graph-scene-hash', hash);
    this.remember();
    return true;
  };

  /* ---------- public API ---------- */
  function canvasOf(el) {
    if (!el) return null;
    if (el.classList && el.classList.contains('fg-canvas')) return el;
    return el.querySelector ? el.querySelector('.fg-canvas') : null;
  }
  function init(canvas) {
    if (canvas.__fgInit) return canvas.__fgInit;
    if (!canvas.querySelector('.fg-viewport') || !canvas.querySelector('.fg-stage') || !canvas.querySelector('.fg-toolbar') ||
        !canvas.querySelector('.fg-views') || !canvas.querySelector('.fg-zoom-readout')) return null;
    canvas.__fgInit = new Controller(canvas);
    return canvas.__fgInit;
  }

  window.NorthstarGraph = {
    __v: 2,
    init: function(root) {
      var list = (root || document).querySelectorAll('.fg-canvas');
      for (var i = 0; i < list.length; i++) init(list[i]);
    },
    update: function(el, scene, hash) {
      var canvas = canvasOf(el);
      if (!canvas || !scene) return false;
      var ctrl = init(canvas);
      return ctrl ? ctrl.update(scene, hash) : false;
    },
    updateFromDom: function(el, freshEl) {
      var canvas = canvasOf(el), fresh = canvasOf(freshEl);
      if (!canvas || !fresh) return false;
      var freshHash = fresh.getAttribute('data-graph-scene-hash');
      if (freshHash !== null && freshHash === canvas.getAttribute('data-graph-scene-hash')) return false;
      var scene = readScene(fresh);
      if (!scene) return false;
      return window.NorthstarGraph.update(canvas, scene, freshHash === null ? undefined : freshHash);
    },
    state: function(el) {
      var canvas = canvasOf(el);
      var c = canvas && canvas.__fgInit;
      return c ? { x: c.x, y: c.y, scale: c.scale, view: c.view, selected: c.selected } : null;
    }
  };

  window.__northstarInitGraphs = function() {
    document.querySelectorAll('.fg-canvas').forEach(function(canvas) { init(canvas); });
  };
  // Initialise anything not yet initialised (e.g. the Original canvas, emitted without a
  // script of its own), then tell canvases under root they are visible so a hidden-at-load one fits.
  window.__northstarShowGraphs = function(root) {
    window.__northstarInitGraphs();
    (root || document).querySelectorAll('.fg-canvas').forEach(function(canvas) {
      canvas.dispatchEvent(new Event('fg:show'));
    });
  };
  window.__northstarInitGraphs();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.__northstarShowGraphs(); });
  } else {
    window.__northstarShowGraphs();
  }
})();
`;
