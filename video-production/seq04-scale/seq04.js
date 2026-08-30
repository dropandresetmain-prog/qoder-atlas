(() => {
  const NS = window.NS;
  const DURATION = 6.0;
  const H = NS.SEQ03_04_HANDOFF;
  const world = document.getElementById('world');
  const svg = document.getElementById('world-svg');
  const hero = NS.buildSeq0304Hero({ world, svg });
  const mediumLayer = document.getElementById('medium-layer');
  const healthLayer = document.getElementById('health-layer');
  const supplier = document.getElementById('supplier-card');
  const scaleHud = document.getElementById('scale-hud');
  const summary = document.getElementById('state-summary');
  const threshold = document.getElementById('threshold-label');
  const readout = document.getElementById('hero-readout');
  const heroFocus = document.getElementById('hero-focus');

  // Exact handoff state is instantiated from Seq03's source-of-truth data.
  const nodes = hero.nodes;
  const edges = hero.edges;
  Object.values(nodes).forEach(n => NS.setJourneySettle(n,0));

  const affected = new Set([4,9,12,18,23,31,37,44,52,59,65]);
  const outcomes = new Map([
    [4,['green','✓ RECOVERED']], [9,['brass','▲ AT RISK']], [12,['red','✕ NOT VIABLE']],
    [18,['green','✓ RECOVERED']], [23,['brass','▲ AT RISK']], [31,['red','✕ NOT VIABLE']],
    [37,['green','✓ RECOVERED']], [44,['green','✓ RECOVERED']], [52,['brass','▲ AT RISK']],
    [59,['green','✓ RECOVERED']], [65,['brass','▲ AT RISK']]
  ]);

  // Medium LOD: only a bounded neighbourhood is labelled. This prevents the
  // pull-back from turning into microscopic text soup.
  const mediumSpecs = [
    {id:4,x:720,y:520}, {id:9,x:720,y:730}, {id:12,x:720,y:1160},
    {id:18,x:2260,y:720}, {id:23,x:2260,y:1040}, {id:31,x:2260,y:1390},
    {id:37,x:3780,y:650}, {id:44,x:3780,y:980}, {id:52,x:3780,y:1320},
    {id:59,x:5000,y:760}, {id:65,x:5000,y:1100}, {id:70,x:5000,y:1450}
  ];
  const mediumModels = [];
  mediumSpecs.forEach(s => {
    const model = NS.createMiniJourney(mediumLayer,{id:`medium-${s.id}`,x:s.x,y:s.y,label:`T${String(s.id).padStart(2,'0')}`});
    const out = outcomes.get(s.id) || ['green','✓ HEALTHY'];
    NS.setMiniJourneyState(model,out[0],out[1]);
    mediumModels.push({id:s.id,...s,model});
  });

  // Far LOD: 71 other travellers become structured health marks. Traveller 17
  // remains the original full world-space journey and is never teleported.
  const healthModels = [];
  const cols = [640,1500,2360,3220,4080,4940];
  let travellerId = 1;
  for (let row=0; row<12; row++) {
    for (let col=0; col<6; col++) {
      if (travellerId === 17) travellerId++;
      if (travellerId > 72) break;
      const x = cols[col];
      const y = 690 + row*215;
      const out = outcomes.get(travellerId) || ['green','✓'];
      const mark = NS.createHealthMark(healthLayer,{x,y,tone:out[0]});
      NS.setHealthMarkState(mark,out[0],out[0]==='brass'?'▲':out[0]==='red'?'✕':'✓');
      healthModels.push({id:travellerId,x,y,mark,tone:out[0]});
      travellerId++;
    }
  }

  // Show four representative causal paths (healthy/recovered, at-risk, not-viable,
  // recovered) while the supplier card carries the full 12-affected count. This
  // keeps causality explicit without drawing a graph hairball.
  const supplierEdges = [];
  const representativeIds = new Set([4,9,31,44]);
  for (const m of healthModels.filter(m => representativeIds.has(m.id))) {
    const ex=m.x, ey=m.y+18;
    const d=`M1070 415 C${1420 + (m.id%3)*150} ${430 + (m.id%4)*55}, ${Math.max(1550,ex-480)} ${ey}, ${ex} ${ey}`;
    const p=NS.svgPath(svg,`supplier-edge-${m.id}`,d,'supplier-edge');
    p.setAttribute('pathLength','1');
    supplierEdges.push({id:m.id,path:p,target:m});
  }
  const supplierPulse = NS.svgCircle(svg,'supplier-pulse',12);

  function setHeroHandoff() {
    NS.setJourneyState(nodes.flight,'green',{value:'Inbound 09:35',meta:'REBOOKED · VERIFIED'});
    NS.setJourneyState(nodes.transfer,'brass',{value:'Airport → Hotel',meta:'12 MIN BUFFER · AT RISK'});
    NS.setJourneyState(nodes.hotel,'brass',{value:'Room held',meta:'LATE ARRIVAL · NEEDS EYES'});
    NS.setJourneyState(nodes.commitment,'red',{value:'Main stage 13:00',meta:'ARRIVAL 13:18 · NOT VIABLE'});
    NS.setDependencyState(edges['edge-flight-transfer'],'brass');
    NS.setDependencyState(edges['edge-transfer-hotel'],'brass');
    NS.setDependencyState(edges['edge-hotel-commitment'],'red');
  }

  function renderSupplier(t) {
    const inP = NS.outCubic(NS.window01(t,3.38,3.88));
    supplier.style.opacity = String(inP);
    supplier.style.transform = `translateY(${NS.lerp(28,0,inP)}px) scale(${NS.lerp(.96,1,inP)})`;

    supplierEdges.forEach((entry,i) => {
      const start = 3.70 + i*.055;
      const p = NS.smooth(NS.window01(t,start,start+.62));
      entry.path.style.opacity = String(inP*.82);
      entry.path.style.strokeDashoffset = String(1-p);
    });

    // One propagation marker follows representative branches, communicating
    // causality without turning the field into a particle network.
    const reps = supplierEdges.slice(0,3);
    let active=false;
    reps.forEach((entry,idx) => {
      const a=4.08+idx*.32, b=a+.42;
      if (!active && t>=a && t<=b) {
        const q=NS.outCubic(NS.window01(t,a,b));
        const path=entry.path;
        const len=path.getTotalLength();
        const pt=path.getPointAtLength(len*q);
        supplierPulse.setAttribute('cx',pt.x); supplierPulse.setAttribute('cy',pt.y);
        supplierPulse.style.opacity=String(NS.bell(NS.window01(t,a,b)));
        active=true;
      }
    });
    if (!active) supplierPulse.style.opacity='0';
  }

  function renderAt(t) {
    t=NS.clamp(t,0,DURATION);
    setHeroHandoff();

    // Exact Seq03 frame at t=0, followed by a single uninterrupted camera pull-back.
    let p=NS.cubic(NS.window01(t,.18,4.45));
    const camScale=NS.lerp(H.camera.scale,.33,p);
    const camX=NS.lerp(H.camera.x,-12,p);
    const camY=NS.lerp(H.camera.y,-24,p);
    NS.setCamera(world,camX,camY,camScale);

    // Handoff readout stays untouched at t=0, then yields to the scale story.
    const readoutQuiet=NS.smooth(NS.window01(t,.42,1.70));
    readout.style.opacity=String(1-readoutQuiet);
    readout.style.transform=`translateY(${NS.lerp(0,-16,readoutQuiet)}px)`;
    heroFocus.style.opacity=String(NS.lerp(.8,.12,NS.smooth(NS.window01(t,.55,2.55))));

    // Hero LOD: the original journey remains in world space, but text detail
    // recedes as the camera moves away. State silhouettes remain readable.
    const detailQuiet=NS.smooth(NS.window01(t,1.55,3.10));
    Object.values(nodes).forEach((n,idx) => {
      n.querySelector('.node-kicker').style.opacity=String(NS.lerp(1,.10,detailQuiet));
      n.querySelector('.node-value').style.opacity=String(NS.lerp(1,.18,detailQuiet));
      n.querySelector('.node-meta').style.opacity=String(NS.lerp(1,0,detailQuiet));
      n.style.boxShadow=`0 22px 58px rgba(20,23,28,${NS.lerp(.07,.025,detailQuiet)})`;
      n.style.transform=`scale(${NS.lerp(1,.82,detailQuiet)})`;
    });
    hero.heading.style.opacity=String(NS.lerp(.96,.28,detailQuiet));

    // Medium LOD discovers several real journey chains before the far field takes over.
    const mediumIn=NS.smooth(NS.window01(t,.95,1.85));
    const mediumOut=1-NS.smooth(NS.window01(t,3.05,4.15));
    mediumLayer.style.opacity=String(mediumIn*mediumOut);
    mediumModels.forEach((m,i) => {
      const stagger=NS.smooth(NS.window01(t,1.02+i*.045,1.62+i*.045));
      m.model.el.style.opacity=String(stagger);
      m.model.el.style.transform=`translateY(${NS.lerp(18,0,stagger)}px)`;
    });

    // Far LOD converts the system to structured health marks; no microscopic labels.
    const healthIn=NS.smooth(NS.window01(t,2.45,3.90));
    healthLayer.style.opacity=String(healthIn);
    healthModels.forEach((m,i) => {
      const stagger=NS.smooth(NS.window01(t,2.42+(i%12)*.028,3.10+(i%12)*.028));
      m.mark.style.opacity=String(stagger);
      m.mark.style.transform=`translateY(${NS.lerp(14,0,stagger)}px)`;
    });

    const cohortIn=NS.smooth(NS.window01(t,2.55,3.55));
    const cohortOut=1-NS.smooth(NS.window01(t,4.65,5.45));
    ['cohort-a','cohort-b','cohort-c'].forEach((id,i)=>{
      const el=document.getElementById(id); el.style.opacity=String(cohortIn*cohortOut*.78);
      el.style.transform=`translateY(${NS.lerp(12,0,cohortIn)}px)`;
    });

    renderSupplier(t);

    // State marks are initially healthy; after the supplier change, affected
    // travellers settle into differentiated outcomes only.
    healthModels.forEach((m,i) => {
      if (!affected.has(m.id)) return;
      const settle=NS.smooth(NS.window01(t,4.25+(i%5)*.08,4.78+(i%5)*.08));
      const out=outcomes.get(m.id);
      if (settle < .45) NS.setHealthMarkState(m.mark,'brass','▲');
      else NS.setHealthMarkState(m.mark,out[0],out[0]==='red'?'✕':out[0]==='brass'?'▲':'✓');
      m.mark.style.filter = settle>0 && settle<1 ? `drop-shadow(0 0 ${NS.lerp(0,7,NS.bell(settle))}px rgba(20,23,28,.10))` : 'none';
    });

    const hudIn=NS.outCubic(NS.window01(t,2.75,3.55));
    scaleHud.style.opacity=String(hudIn);
    scaleHud.style.transform=`translateY(${NS.lerp(12,0,hudIn)}px)`;
    const count=document.getElementById('traveller-count');
    count.textContent=String(Math.round(NS.lerp(1,72,NS.smooth(NS.window01(t,2.62,3.42)))));

    const summaryIn=NS.outCubic(NS.window01(t,4.72,5.34));
    summary.style.opacity=String(summaryIn);
    summary.style.transform=`translateY(${NS.lerp(18,0,summaryIn)}px)`;
    NS.setPanelSettle(summary,NS.bell(NS.window01(t,4.95,5.62)),'green');

    const thresholdIn=NS.outCubic(NS.window01(t,5.10,5.62));
    threshold.style.opacity=String(thresholdIn);
    threshold.style.transform=`translateY(${NS.lerp(8,0,thresholdIn)}px)`;

    // The original red commitment remains visible as one journey among the field,
    // while secondary chrome quiets for a calm final frame.
    const calm=NS.smooth(NS.window01(t,5.45,5.90));
    document.getElementById('northstar-id').style.opacity=String(NS.lerp(1,.55,calm));
    document.getElementById('stage-mode').style.opacity=String(NS.lerp(1,.48,calm));

    // Exact opening frame lock. Nothing extra may be visible at t=0.
    if (t <= .001) {
      NS.setCamera(world,H.camera.x,H.camera.y,H.camera.scale);
      readout.style.opacity='1'; readout.style.transform='none';
      heroFocus.style.opacity='.8'; mediumLayer.style.opacity='0'; healthLayer.style.opacity='0';
      supplier.style.opacity='0'; supplierEdges.forEach(e=>e.path.style.opacity='0'); supplierPulse.style.opacity='0';
      scaleHud.style.opacity='0'; summary.style.opacity='0'; threshold.style.opacity='0';
      ['cohort-a','cohort-b','cohort-c'].forEach(id=>document.getElementById(id).style.opacity='0');
      Object.values(nodes).forEach(n=>{
        n.querySelector('.node-kicker').style.opacity='1'; n.querySelector('.node-value').style.opacity='1'; n.querySelector('.node-meta').style.opacity='1';
        n.style.transform='none'; n.style.boxShadow='0 22px 58px rgba(20,23,28,.07)';
      });
      hero.heading.style.opacity='.96';
      document.getElementById('northstar-id').style.opacity='1'; document.getElementById('stage-mode').style.opacity='1';
    }
  }

  NS.bootSequence({duration:DURATION,renderAt});
})();
