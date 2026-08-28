(() => {
  const NS=window.NS;
  const DURATION=14.0;
  const C=NS.CONNECTED_PROGRAMME;
  const world=document.getElementById('world');
  const svg=document.getElementById('world-svg');
  const field=NS.buildConnectedScaleField({world,svg,includeHero:true});
  const programme=NS.buildConnectedProgramme({world,svg});
  const heroes=NS.buildConnectedHeroes({world,svg,heroIds:['hero-31','hero-65']});
  const graphHud=document.getElementById('graph-hud');
  const rootLabel=document.getElementById('world-root-label');
  const northstarId=document.getElementById('northstar-id');
  const stageMode=document.getElementById('stage-mode');
  const originalHero=field.hero;

  const anchorTarget=C.programme.days.flatMap(d=>d.commitments).find(c=>c.id===C.anchorConnection.target);
  const anchor=NS.svgPath(svg,'anchor-t17-programme',
    `M${C.anchorConnection.from.x} ${C.anchorConnection.from.y} C3150 850, 5150 ${anchorTarget.y+110}, ${anchorTarget.x} ${anchorTarget.y+110}`,
    `ns-traveller-programme-edge is-${C.anchorConnection.tone}`);
  anchor.setAttribute('pathLength','1');

  const boundary=NS.createSystemBoundary(world,C.finalState.boundary);
  const B=C.finalState.boundary;
  const boundaryTrace=NS.svgPath(svg,'boundary-trace',
    `M${B.x+54} ${B.y} H${B.x+B.w-54} Q${B.x+B.w} ${B.y} ${B.x+B.w} ${B.y+54} V${B.y+B.h-54} Q${B.x+B.w} ${B.y+B.h} ${B.x+B.w-54} ${B.y+B.h} H${B.x+54} Q${B.x} ${B.y+B.h} ${B.x} ${B.y+B.h-54} V${B.y+54} Q${B.x} ${B.y} ${B.x+54} ${B.y}`,'');
  boundaryTrace.setAttribute('class','');
  boundaryTrace.id='boundary-trace'; boundaryTrace.setAttribute('pathLength','1');
  boundaryTrace.style.strokeDasharray='1'; boundaryTrace.style.strokeDashoffset='1';

  const hero31=heroes.models['hero-31'];
  const hero65=heroes.models['hero-65'];
  const mark31=field.health.find(x=>x.id===31)?.mark;
  const mark65=field.health.find(x=>x.id===65)?.mark;
  const pos31=NS.connectedHealthPosition(31), pos65=NS.connectedHealthPosition(65);
  const delta31={x:pos31.x-hero31.spec.x,y:pos31.y-hero31.spec.y};
  const delta65={x:pos65.x-hero65.spec.x,y:pos65.y-hero65.spec.y};

  function setOpeningHandoff(){
    NS.setCamera(world,C.cameras.whole.x,C.cameras.whole.y,C.cameras.whole.scale);
    northstarId.style.opacity='.72'; stageMode.style.opacity='.68';
    field.healthLayer.style.opacity='.72'; field.supplier.style.opacity='.16'; field.supplierEdges.forEach(e=>e.style.opacity='.16');
    Object.values(originalHero.nodes).forEach(n=>{
      n.style.opacity='.55'; n.style.transform='scale(.82)'; n.style.boxShadow='0 22px 58px rgba(20,23,28,.025)';
      n.querySelector('.node-kicker').style.opacity='.10'; n.querySelector('.node-value').style.opacity='.18'; n.querySelector('.node-meta').style.opacity='0';
    });
    originalHero.heading.style.opacity='.14';
    programme.frame.style.opacity='.94'; programme.frame.style.transform='none';
    Object.values(programme.days).forEach(el=>{el.style.opacity='1';el.style.transform='none';});
    Object.values(programme.commitments).forEach(el=>{el.style.opacity='1';el.style.transform='none';});
    programme.programmeEdges.forEach(p=>{p.style.opacity='.78';p.style.strokeDashoffset='0';});
    programme.travellerEdges.forEach(e=>{e.path.style.opacity=String(e.tone==='green'?.38:.62);e.path.style.strokeDashoffset='0';});
    rootLabel.style.opacity='.68'; graphHud.style.opacity='1'; graphHud.style.transform='none';
    anchor.style.opacity='0'; anchor.style.strokeDashoffset='1';
    boundary.style.opacity='0'; boundaryTrace.style.opacity='0'; boundaryTrace.style.strokeDashoffset='1';
    [hero31,hero65].forEach(h=>{h.root.style.opacity='0';h.targetEdge.style.opacity='0';h.targetEdge.style.strokeDashoffset='1';});
    Object.values(heroes.constraints).forEach(c=>{c.card.style.opacity='0';c.edge.style.opacity='0';c.edge.style.strokeDashoffset='1';});
  }

  function setCameraBetween(t){
    const whole=C.cameras.whole;
    const c31=C.cameras.hero31;
    const c65=C.cameras.hero65;
    if(t<3.45){
      const p=NS.cubic(NS.window01(t,.45,3.25));
      NS.setCamera(world,NS.lerp(whole.x,c31.x,p),NS.lerp(whole.y,c31.y,p),NS.lerp(whole.scale,c31.scale,p));
    } else if(t<8.45){
      const p=NS.cubic(NS.window01(t,5.55,8.20));
      NS.setCamera(world,NS.lerp(c31.x,c65.x,p),NS.lerp(c31.y,c65.y,p),NS.lerp(c31.scale,c65.scale,p));
    } else {
      const p=NS.cubic(NS.window01(t,8.45,11.55));
      NS.setCamera(world,NS.lerp(c65.x,whole.x,p),NS.lerp(c65.y,whole.y,p),NS.lerp(c65.scale,whole.scale,p));
    }
  }

  function animateHero(h,mark,delta,t,a,b){
    const p=NS.outCubic(NS.window01(t,a,b));
    h.root.style.opacity=String(p);
    h.root.style.transform=`translate(${NS.lerp(delta.x,0,p)}px,${NS.lerp(delta.y,0,p)}px) scale(${NS.lerp(.12,1,p)})`;
    if(mark) mark.style.opacity=String(NS.lerp(1,0,p));
    const edgeP=NS.smooth(NS.window01(t,b-.15,b+.75));
    h.targetEdge.style.opacity=String(edgeP*.82); h.targetEdge.style.strokeDashoffset=String(1-edgeP);
    h.nodes.forEach((node,i)=>{
      const q=NS.outCubic(NS.window01(t,a+.25+i*.08,b+.05+i*.08));
      node.style.opacity=String(q); node.style.transform=`translateY(${NS.lerp(18,0,q)}px)`;
    });
  }

  function renderAt(t){
    t=NS.clamp(t,0,DURATION);
    setCameraBetween(t);

    const hudQuiet=NS.smooth(NS.window01(t,.35,1.45));
    graphHud.style.opacity=String(1-hudQuiet); graphHud.style.transform=`translateY(${NS.lerp(0,-10,hudQuiet)}px)`;
    rootLabel.style.opacity=String(NS.lerp(.68,.38,hudQuiet));
    northstarId.style.opacity=String(NS.lerp(.72,.88,hudQuiet)); stageMode.style.opacity=String(NS.lerp(.68,.80,hudQuiet));

    const close31=NS.smooth(NS.window01(t,.75,2.45));
    field.healthLayer.style.opacity=String(NS.lerp(.72,.33,close31));
    programme.travellerEdges.forEach(e=>e.path.style.opacity=String(NS.lerp(e.tone==='green'?.38:.62,.16,close31)));
    programme.frame.style.opacity=String(NS.lerp(.94,.74,close31));

    animateHero(hero31,mark31,delta31,t,1.15,2.80);
    const anchorP=NS.smooth(NS.window01(t,2.0,3.25));
    anchor.style.opacity=String(anchorP*.52); anchor.style.strokeDashoffset=String(1-anchorP);

    Object.values(heroes.constraints).forEach((c,i)=>{
      const p=NS.outCubic(NS.window01(t,3.25+i*.22,4.25+i*.22));
      c.card.style.opacity=String(p); c.card.style.transform=`translateY(${NS.lerp(20,0,p)}px)`;
      const e=NS.smooth(NS.window01(t,3.55+i*.22,4.55+i*.22));
      c.edge.style.opacity=String(e*.72); c.edge.style.strokeDashoffset=String(1-e);
    });

    animateHero(hero65,mark65,delta65,t,5.55,7.18);
    const constraintQuiet=NS.smooth(NS.window01(t,6.15,7.75));
    Object.values(heroes.constraints).forEach(c=>{c.card.style.opacity=String(NS.lerp(1,.26,constraintQuiet));c.edge.style.opacity=String(NS.lerp(.72,.18,constraintQuiet));});

    const wide=NS.smooth(NS.window01(t,8.45,11.60));
    field.healthLayer.style.opacity=String(NS.lerp(.33,.66,wide));
    programme.frame.style.opacity=String(NS.lerp(.74,.88,wide));
    programme.travellerEdges.forEach(e=>e.path.style.opacity=String(NS.lerp(.16,e.tone==='green'?.32:.54,wide)));
    [hero31,hero65].forEach(h=>{
      h.root.querySelectorAll('.stage-kicker,.stage-value,.stage-meta').forEach(el=>el.style.opacity=String(NS.lerp(1,.12,wide)));
      h.root.style.opacity=String(NS.lerp(1,.58,wide));
      h.targetEdge.style.opacity=String(NS.lerp(.82,.58,wide));
    });
    Object.values(heroes.constraints).forEach(c=>{c.card.style.opacity=String(NS.lerp(.26,.36,wide));c.edge.style.opacity=String(NS.lerp(.18,.26,wide));});

    const trace=NS.smooth(NS.window01(t,10.25,12.15));
    boundaryTrace.style.opacity=String(trace*.88); boundaryTrace.style.strokeDashoffset=String(1-trace);
    const boundaryIn=NS.outCubic(NS.window01(t,11.45,12.55));
    boundary.style.opacity=String(boundaryIn);
    boundary.style.transform=`scale(${NS.lerp(.992,1,boundaryIn)})`;

    const finalCalm=NS.smooth(NS.window01(t,12.35,13.55));
    northstarId.style.opacity=String(NS.lerp(.88,.34,finalCalm)); stageMode.style.opacity=String(NS.lerp(.80,.30,finalCalm));
    rootLabel.style.opacity=String(NS.lerp(.38,.16,finalCalm));
    field.supplier.style.opacity=String(NS.lerp(.16,.09,finalCalm)); field.supplierEdges.forEach(e=>e.style.opacity=String(NS.lerp(.16,.08,finalCalm)));
    boundaryTrace.style.opacity=String(NS.lerp(.88,.18,finalCalm));

    if(t<=.001) setOpeningHandoff();
  }

  NS.SEQ06_FINAL_GRAPH_STATE=()=>({
    graphVersion:C.finalState.version,
    world:{...C.world},
    camera:{...C.cameras.whole},
    boundary:{...C.finalState.boundary},
    programme:C.programme,
    scaleField:C.scaleField,
    heroes:C.heroes,
    constraints:C.constraints,
    anchorConnection:C.anchorConnection
  });

  NS.bootSequence({duration:DURATION,renderAt});
})();
