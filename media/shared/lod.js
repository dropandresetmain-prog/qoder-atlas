(() => {
  const NS = window.NS = window.NS || {};
  // Returns a smooth opacity weight for an element intended to be visible
  // between camera scales `minScale` and `maxScale`.
  NS.lodWeight = function lodWeight(scale, minScale, maxScale, feather = .10) {
    const enter = NS.smooth(NS.clamp((scale - minScale) / feather));
    const leave = 1 - NS.smooth(NS.clamp((scale - maxScale) / feather));
    return NS.clamp(enter * leave);
  };
})();
