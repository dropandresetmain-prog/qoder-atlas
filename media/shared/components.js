(() => {
  const NS = window.NS = window.NS || {};

  NS.setBadge = function setBadge(el, state, text) {
    if (!el) return;
    el.classList.remove('is-active', 'is-ok', 'is-alert', 'is-ink');
    if (state) el.classList.add(`is-${state}`);
    if (text != null) el.textContent = text;
  };

  NS.setPanelSettle = function setPanelSettle(el, amount = 0, tone = 'green') {
    if (!el) return;
    const color = tone === 'brass'
      ? 'rgba(217,162,74,.20)'
      : tone === 'red'
        ? 'rgba(224,82,31,.18)'
        : 'rgba(76,154,110,.18)';
    el.style.setProperty('--ns-settle-ring', `${Math.max(0, amount) * 5}px`);
    el.style.setProperty('--ns-settle-color', color);
  };

  NS.setCheck = function setCheck(el, state, label) {
    if (!el) return;
    el.classList.remove('is-active', 'is-ok');
    if (state === 'active') el.classList.add('is-active');
    if (state === 'ok') el.classList.add('is-ok');
    const target = el.querySelector('.state');
    if (target && label != null) target.textContent = label;
  };
})();
