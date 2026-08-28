(() => {
  const NS = window.NS = window.NS || {};
  const STAGE_W = 1920;
  const STAGE_H = 1080;

  NS.fitStage = function fitStage() {
    const stage = document.getElementById('ns-stage');
    if (!stage || document.documentElement.classList.contains('ns-capture')) return;
    const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };

  NS.setCamera = function setCamera(el, x = 0, y = 0, scale = 1) {
    if (!el) return;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  };

  window.addEventListener('resize', () => NS.fitStage());
  window.addEventListener('DOMContentLoaded', () => NS.fitStage());
})();
