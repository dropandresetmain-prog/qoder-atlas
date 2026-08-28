(() => {
  const NS = window.NS = window.NS || {};
  const SVG_NS = 'http://www.w3.org/2000/svg';

  NS.svgPath = function svgPath(svg, id, d, className = 'ns-dependency-edge is-soft') {
    const p = document.createElementNS(SVG_NS, 'path');
    if (id) p.id = id;
    p.setAttribute('d', d);
    p.setAttribute('class', className);
    svg.appendChild(p);
    return p;
  };

  NS.svgCircle = function svgCircle(svg, id, r = 12, className = 'ns-propagation-mark') {
    const c = document.createElementNS(SVG_NS, 'circle');
    if (id) c.id = id;
    c.setAttribute('r', String(r));
    c.setAttribute('class', className);
    svg.appendChild(c);
    return c;
  };

  NS.createJourneyNode = function createJourneyNode(parent, spec) {
    const el = document.createElement('section');
    el.className = `ns-journey-node ${spec.wide ? 'is-wide ' : ''}is-${spec.tone || 'green'}`;
    el.id = spec.id;
    el.style.left = `${spec.x}px`;
    el.style.top = `${spec.y}px`;
    el.innerHTML = `
      <div class="node-kicker">${spec.kicker}</div>
      <div class="node-value">${spec.value}</div>
      <div class="node-meta">${spec.meta}</div>
      <div class="node-state"></div>`;
    parent.appendChild(el);
    return el;
  };

  NS.setJourneyState = function setJourneyState(el, tone, { value, meta } = {}) {
    if (!el) return;
    ['green','brass','red','grey','ink'].forEach(t => el.classList.remove(`is-${t}`));
    el.classList.add(`is-${tone}`);
    if (value != null) el.querySelector('.node-value').textContent = value;
    if (meta != null) el.querySelector('.node-meta').textContent = meta;
  };

  NS.setJourneySettle = function setJourneySettle(el, amount = 0, tone = 'green') {
    if (!el) return;
    const rgb = tone === 'brass' ? '217,162,74' : tone === 'red' ? '224,82,31' : '76,154,110';
    el.style.setProperty('--journey-settle', `${Math.max(0, amount) * 5}px`);
    el.style.setProperty('--journey-settle-color', `rgba(${rgb},.18)`);
  };

  NS.setDependencyState = function setDependencyState(el, tone, extra = '') {
    if (!el) return;
    el.setAttribute('class', `ns-dependency-edge is-${tone}${extra ? ` ${extra}` : ''}`);
  };

  NS.createMiniJourney = function createMiniJourney(parent, spec) {
    const el = document.createElement('div');
    el.className = 'ns-mini-journey';
    el.id = spec.id;
    el.style.left = `${spec.x}px`;
    el.style.top = `${spec.y}px`;
    el.innerHTML = `<div class="mini-label">${spec.label || ''}</div>`;
    const xs = [0, 96, 192, 288];
    const nodes = [];
    const segs = [];
    xs.forEach((x, i) => {
      const n = document.createElement('i');
      n.className = 'ns-mini-node is-green';
      n.style.left = `${x}px`;
      el.appendChild(n);
      nodes.push(n);
      if (i < xs.length - 1) {
        const s = document.createElement('b');
        s.className = 'ns-mini-seg';
        s.style.left = `${x + 22}px`;
        s.style.width = '74px';
        el.appendChild(s);
        segs.push(s);
      }
    });
    const result = document.createElement('span');
    result.className = 'ns-mini-result is-green';
    result.textContent = '✓ HEALTHY';
    el.appendChild(result);
    parent.appendChild(el);
    return { el, nodes, segs, result };
  };

  NS.setMiniJourneyState = function setMiniJourneyState(model, tone, label) {
    if (!model) return;
    model.nodes.forEach(n => {
      ['green','brass','red','grey','ink'].forEach(t => n.classList.remove(`is-${t}`));
      n.classList.add(`is-${tone}`);
    });
    model.segs.forEach(s => {
      ['brass','red','grey'].forEach(t => s.classList.remove(`is-${t}`));
      if (tone !== 'green' && tone !== 'ink') s.classList.add(`is-${tone}`);
    });
    ['green','brass','red','grey','ink'].forEach(t => model.result.classList.remove(`is-${t}`));
    model.result.classList.add(`is-${tone}`);
    model.result.textContent = label;
  };

  NS.createHealthMark = function createHealthMark(parent, spec) {
    const el = document.createElement('div');
    el.className = `ns-health-mark is-${spec.tone || 'green'}`;
    el.style.left = `${spec.x}px`;
    el.style.top = `${spec.y}px`;
    el.innerHTML = '<i></i><i></i><i></i><i></i><span class="health-glyph"></span>';
    parent.appendChild(el);
    return el;
  };

  NS.setHealthMarkState = function setHealthMarkState(el, tone, glyph) {
    if (!el) return;
    ['green','brass','red','grey','ink'].forEach(t => el.classList.remove(`is-${t}`));
    el.classList.add(`is-${tone}`);
    el.querySelector('.health-glyph').textContent = glyph || '';
  };
})();
