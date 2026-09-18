/**
 * R2 LANE B — inline interaction script.
 *
 * Vanilla JS (no framework): pan, zoom, toolbar, named views, node selection.
 * Semantic zoom: hide detail below scale threshold.
 */

export const INTERACTIONS_SCRIPT = `
(function() {
  'use strict';

  const canvas = document.querySelector('.fg-canvas');
  if (!canvas) return;

  const viewport = canvas.querySelector('.fg-viewport');
  const stage = canvas.querySelector('.fg-stage');
  const toolbar = canvas.querySelector('.fg-toolbar');
  const views = canvas.querySelector('.fg-views');
  const zoomReadout = canvas.querySelector('.fg-zoom-readout');

  if (!viewport || !stage || !toolbar || !views || !zoomReadout) return;

  // State
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let startTranslateX = 0;
  let startTranslateY = 0;
  let selectedNode = null;

  // Constants
  const MIN_SCALE = 0.3;
  const MAX_SCALE = 2.0;
  const ZOOM_STEP = 0.15;
  const SEMANTIC_ZOOM_THRESHOLD = 0.7;

  // Apply transform
  function applyTransform() {
    stage.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
    zoomReadout.textContent = Math.round(scale * 100) + '%';

    // Semantic zoom: hide detail when zoomed out
    if (scale < SEMANTIC_ZOOM_THRESHOLD) {
      stage.classList.add('fg-zoom-out');
    } else {
      stage.classList.remove('fg-zoom-out');
    }
  }

  // Zoom around point
  function zoomAt(clientX, clientY, delta) {
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const worldX = (x - translateX) / scale;
    const worldY = (y - translateY) / scale;

    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));

    translateX = x - worldX * newScale;
    translateY = y - worldY * newScale;
    scale = newScale;

    applyTransform();
  }

  // Fit view to bounds
  function fitView(minX, minY, maxX, maxY, padding) {
    const rect = viewport.getBoundingClientRect();
    const width = maxX - minX;
    const height = maxY - minY;

    const scaleX = (rect.width - padding * 2) / width;
    const scaleY = (rect.height - padding * 2) / height;
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(scaleX, scaleY)));

    translateX = (rect.width - width * scale) / 2 - minX * scale;
    translateY = (rect.height - height * scale) / 2 - minY * scale;

    applyTransform();
  }

  // Named views
  function setView(viewName) {
    const buttons = views.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    if (viewName === 'overview') {
      // Fit all nodes
      const nodes = Array.from(stage.querySelectorAll('.fg-node'));
      if (nodes.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(node => {
        const x = parseFloat(node.style.left);
        const y = parseFloat(node.style.top);
        const w = parseFloat(node.style.width);
        const h = parseFloat(node.style.height);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      });

      fitView(minX, minY, maxX, maxY, 60);
    } else if (viewName === 'disruption') {
      // Fit causal nodes only
      const causalNodes = Array.from(stage.querySelectorAll('.fg-node[data-focus="causal"], .fg-node.fg-focal'));
      if (causalNodes.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      causalNodes.forEach(node => {
        const x = parseFloat(node.style.left);
        const y = parseFloat(node.style.top);
        const w = parseFloat(node.style.width);
        const h = parseFloat(node.style.height);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      });

      fitView(minX, minY, maxX, maxY, 80);
    }
  }

  // Pan handlers
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.fg-node')) return;
    isPanning = true;
    startX = e.clientX;
    startY = e.clientY;
    startTranslateX = translateX;
    startTranslateY = translateY;
    viewport.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    translateX = startTranslateX + (e.clientX - startX);
    translateY = startTranslateY + (e.clientY - startY);
    applyTransform();
  });

  document.addEventListener('mouseup', () => {
    isPanning = false;
    viewport.style.cursor = 'grab';
  });

  // Wheel zoom
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    zoomAt(e.clientX, e.clientY, delta);
  }, { passive: false });

  // Toolbar buttons
  toolbar.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;

    const action = button.dataset.action;
    if (action === 'zoom-in') {
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, ZOOM_STEP);
    } else if (action === 'zoom-out') {
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, -ZOOM_STEP);
    } else if (action === 'home') {
      setView('overview');
    }
  });

  // View buttons
  views.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || button.disabled) return;
    setView(button.dataset.view);
  });

  // Node selection
  stage.addEventListener('click', (e) => {
    const node = e.target.closest('.fg-node');

    if (!node) {
      // Clicked empty space: clear selection
      if (selectedNode) {
        selectedNode.classList.remove('fg-highlighted');
        selectedNode = null;
        stage.querySelectorAll('.fg-dimmed').forEach(el => el.classList.remove('fg-dimmed'));
      }
      return;
    }

    const ref = node.dataset.ref;

    // Clear previous selection
    if (selectedNode) {
      selectedNode.classList.remove('fg-highlighted');
      stage.querySelectorAll('.fg-dimmed').forEach(el => el.classList.remove('fg-dimmed'));
    }

    // If clicking same node, just deselect
    if (selectedNode === node) {
      selectedNode = null;
      return;
    }

    // Select new node
    selectedNode = node;
    node.classList.add('fg-highlighted');

    // Find connected nodes
    const connectedRefs = new Set([ref]);
    const edges = stage.querySelectorAll('.fg-edge');
    edges.forEach(edge => {
      const source = edge.dataset.source;
      const target = edge.dataset.target;
      if (source === ref || target === ref) {
        connectedRefs.add(source);
        connectedRefs.add(target);
      }
    });

    // Dim unconnected nodes and edges
    stage.querySelectorAll('.fg-node').forEach(n => {
      if (!connectedRefs.has(n.dataset.ref)) {
        n.classList.add('fg-dimmed');
      }
    });

    edges.forEach(edge => {
      const source = edge.dataset.source;
      const target = edge.dataset.target;
      if (source !== ref && target !== ref) {
        edge.classList.add('fg-dimmed');
      }
    });
  });

  // Escape key: clear selection
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedNode) {
      selectedNode.classList.remove('fg-highlighted');
      selectedNode = null;
      stage.querySelectorAll('.fg-dimmed').forEach(el => el.classList.remove('fg-dimmed'));
    }
  });

  // Initial view
  setTimeout(() => setView('overview'), 0);
})();
`;
