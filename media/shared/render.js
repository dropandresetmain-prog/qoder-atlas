(() => {
  const NS = window.NS = window.NS || {};

  NS.clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  NS.lerp = (a, b, t) => a + (b - a) * t;
  NS.window01 = (t, a, b) => NS.clamp((t - a) / (b - a));
  NS.smooth = t => { t = NS.clamp(t); return t * t * (3 - 2 * t); };
  NS.cubic = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  NS.outCubic = t => 1 - Math.pow(1 - NS.clamp(t), 3);
  NS.inCubic = t => Math.pow(NS.clamp(t), 3);
  NS.bell = t => Math.sin(Math.PI * NS.clamp(t));
  NS.mixColorAlpha = (alpha, rgb = '76,154,110') => `rgba(${rgb},${alpha})`;

  NS.opacity = (el, value) => { if (el) el.style.opacity = String(NS.clamp(value)); };
  NS.xyScale = (el, x, y, scale = 1) => {
    if (el) el.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
  };

  NS.formatTimecode = function formatTimecode(t) {
    const s = Math.floor(t);
    const ms = Math.floor((t - s) * 1000);
    return `00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  NS.bootSequence = function bootSequence({ duration, renderAt }) {
    const params = new URLSearchParams(location.search);
    const capture = window.__NS_CAPTURE__ === true || params.has('capture');
    if (capture) document.documentElement.classList.add('ns-capture');
    NS.fitStage?.();

    window.__NS_RENDER_AT__ = (t) => renderAt(NS.clamp(Number(t) || 0, 0, duration));
    window.__NS_READY__ = true;

    if (params.has('t')) {
      renderAt(NS.clamp(Number(params.get('t')) || 0, 0, duration));
      return;
    }
    if (capture) {
      renderAt(0);
      return;
    }

    const startFallback = () => {
      const started = performance.now();
      const loop = now => {
        const t = ((now - started) / 1000) % duration;
        renderAt(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };

    if (window.gsap) {
      const clock = { t: 0 };
      const master = window.gsap.timeline({ repeat: -1, defaults: { ease: 'none' } });
      master.to(clock, {
        t: duration,
        duration,
        ease: 'none',
        onUpdate: () => renderAt(clock.t),
        onRepeat: () => { clock.t = 0; renderAt(0); }
      });
      window.__NS_MASTER_TIMELINE__ = master;
      return;
    }

    // Normal browser preview prefers GSAP. Capture mode never depends on network.
    const gs = document.createElement('script');
    gs.src = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js';
    gs.onload = () => {
      const clock = { t: 0 };
      const master = window.gsap.timeline({ repeat: -1, defaults: { ease: 'none' } });
      master.to(clock, {
        t: duration,
        duration,
        ease: 'none',
        onUpdate: () => renderAt(clock.t),
        onRepeat: () => { clock.t = 0; renderAt(0); }
      });
      window.__NS_MASTER_TIMELINE__ = master;
    };
    gs.onerror = startFallback;
    document.head.appendChild(gs);
  };
})();
