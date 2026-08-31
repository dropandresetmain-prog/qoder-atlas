(() => {
  const NS = window.NS = window.NS || {};
  NS.SEQ03_04_HANDOFF = Object.freeze({
    world: { width: 6200, height: 3600 },
    camera: { x: -920, y: -610, scale: 1.28 },
    heading: { x: 920, y: 748 },
    nodes: [
      { id:'flight', x:920, y:820, kicker:'Flight', value:'Inbound 09:35', meta:'REBOOKED · VERIFIED', tone:'green' },
      { id:'transfer', x:1260, y:820, kicker:'Transfer', value:'Airport → Hotel', meta:'12 MIN BUFFER · AT RISK', tone:'brass' },
      { id:'hotel', x:1600, y:820, kicker:'Hotel', value:'Room held', meta:'LATE ARRIVAL · NEEDS EYES', tone:'brass' },
      { id:'commitment', x:1940, y:820, kicker:'✦ Keynote', value:'Main stage 13:00', meta:'ARRIVAL 13:18 · NOT VIABLE', tone:'red', wide:true }
    ],
    edges: [
      { id:'edge-flight-transfer', d:'M1150 886 C1192 886 1218 886 1260 886', tone:'brass' },
      { id:'edge-transfer-hotel', d:'M1490 886 C1532 886 1558 886 1600 886', tone:'brass' },
      { id:'edge-hotel-commitment', d:'M1830 886 C1872 886 1898 886 1940 886', tone:'red' }
    ]
  });

  NS.buildSeq0304Hero = function buildSeq0304Hero({ world, svg }) {
    const H = NS.SEQ03_04_HANDOFF;
    const heading = document.createElement('div');
    heading.id = 'hero-heading';
    heading.className = 'ns-journey-heading';
    heading.style.left = `${H.heading.x}px`;
    heading.style.top = `${H.heading.y}px`;
    heading.innerHTML = '<strong>TRAVELLER 17</strong> · inbound journey · objective dependency';
    world.appendChild(heading);

    const nodes = {};
    H.nodes.forEach(spec => { nodes[spec.id] = NS.createJourneyNode(world, spec); });
    const edges = {};
    H.edges.forEach(spec => { edges[spec.id] = NS.svgPath(svg, spec.id, spec.d, `ns-dependency-edge is-${spec.tone}`); });
    return { heading, nodes, edges };
  };
})();
