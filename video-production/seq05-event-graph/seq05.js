(() => {
  const NS=window.NS;
  const DURATION=9.0;
  const C=NS.CONNECTED_PROGRAMME;
  const world=document.getElementById('world');
  const svg=document.getElementById('world-svg');
  const field=NS.buildConnectedScaleField({world,svg,includeHero:true});
  const programme=NS.buildConnectedProgramme({world,svg});
  const scaleHud=document.getElementById('scale-hud');
  const scaleSummary=document.getElementById('scale-summary');
  const threshold=document.getElementById('threshold-label');
  const graphHud=document.getElementById('graph-hud');
  const rootLabel=document.getElementById('world-root-label');
  const heroFocus=document.getElementById('hero-focus');
  const northstarId=document.getElementById('northstar-id');
  const stageMode=document.getElementById('stage-mode');

  const hero=field.hero;
  const commitmentList=C.programme.days.flatMap(d=>d.commitments);
  const commitmentOrder=commitmentList.map(c=>programme.commitments[c.id]);
  const dayOrder=C.programme.days.map(d=>programme.days[d.id]);

  function setSeq04FinalVisual() {
    const cam=C.cameras.seq04Final;
    NS.setCamera(world,cam.x,cam.y,cam.scale);
    heroFocus.style.opacity='.12';
    northstarId.style.opacity='.55'; stageMode.style.opacity='.48';
    scaleHud.style.opacity='1'; scaleSummary.style.opacity='1'; threshold.style.opacity='1'; graphHud.style.opacity='0';
    field.healthLayer.style.opacity='1'; field.supplier.style.opacity='1'; field.supplierEdges.forEach(e=>e.style.opacity='.82');
    Object.values(hero.nodes).forEach(n=>{
      n.querySelector('.node-kicker').style.opacity='.10';
      n.querySelector('.node-value').style.opacity='.18';
      n.querySelector('.node-meta').style.opacity='0';
      n.style.transform='scale(.82)';
      n.style.boxShadow='0 22px 58px rgba(20,23,28,.025)';
    });
    hero.heading.style.opacity='.28';
    programme.frame.style.opacity='0'; dayOrder.forEach(d=>d.style.opacity='0'); commitmentOrder.forEach(c=>c.style.opacity='0');
    programme.programmeEdges.forEach(p=>{p.style.opacity='0';p.style.strokeDashoffset='1';});
    programme.travellerEdges.forEach(e=>{e.path.style.opacity='0';e.path.style.strokeDashoffset='1';});
    rootLabel.style.opacity='0';
  }

  function renderAt(t) {
    t=NS.clamp(t,0,DURATION);
    northstarId.textContent=t<.65?'NORTHSTAR · TRIP STATE':'NORTHSTAR · CONNECTED STATE';
    stageMode.textContent=t<.65?'WHOLE-TRIP VIABILITY':'PROGRAMME / LIVE';
    const pull=NS.cubic(NS.window01(t,.45,6.65));
    const A=C.cameras.seq04Final,B=C.cameras.whole;
    NS.setCamera(world,NS.lerp(A.x,B.x,pull),NS.lerp(A.y,B.y,pull),NS.lerp(A.scale,B.scale,pull));

    const oldQuiet=NS.smooth(NS.window01(t,.28,1.75));
    [scaleHud,scaleSummary,threshold].forEach(el=>{el.style.opacity=String(1-oldQuiet);el.style.transform=`translateY(${NS.lerp(0,-12,oldQuiet)}px)`;});
    field.supplier.style.opacity=String(NS.lerp(1,.16,oldQuiet));
    field.supplierEdges.forEach(e=>e.style.opacity=String(NS.lerp(.82,.16,oldQuiet)));
    heroFocus.style.opacity=String(NS.lerp(.12,0,oldQuiet));
    northstarId.style.opacity=String(NS.lerp(.55,.72,oldQuiet)); stageMode.style.opacity=String(NS.lerp(.48,.68,oldQuiet));

    const fieldQuiet=NS.smooth(NS.window01(t,2.0,6.0));
    field.healthLayer.style.opacity=String(NS.lerp(1,.72,fieldQuiet));
    Object.values(hero.nodes).forEach(n=>n.style.opacity=String(NS.lerp(1,.55,fieldQuiet)));
    hero.heading.style.opacity=String(NS.lerp(.28,.14,fieldQuiet));

    const frameIn=NS.outCubic(NS.window01(t,1.35,2.65));
    programme.frame.style.opacity=String(frameIn*.94);
    programme.frame.style.transform=`translateX(${NS.lerp(70,0,frameIn)}px) scale(${NS.lerp(.985,1,frameIn)})`;
    rootLabel.style.opacity=String(NS.smooth(NS.window01(t,2.0,3.0))*.82);

    dayOrder.forEach((el,i)=>{
      const p=NS.outCubic(NS.window01(t,2.10+i*.72,3.35+i*.72));
      const settle=1-NS.smooth(NS.window01(t,7.2,8.55));
      const drift=Math.sin((t+i*.55)*.82)*8*settle;
      el.style.opacity=String(p);
      el.style.transform=`translateY(${NS.lerp(32,0,p)+drift}px) scale(${NS.lerp(.965,1,p)})`;
    });

    commitmentOrder.forEach((el,i)=>{
      const dayIndex=Math.floor(i/4);
      const local=i%4;
      const p=NS.outCubic(NS.window01(t,2.75+dayIndex*.72+local*.10,3.58+dayIndex*.72+local*.10));
      const settle=1-NS.smooth(NS.window01(t,7.4,8.5));
      const drift=Math.sin((t*1.05+i)*.7)*5*settle;
      el.style.opacity=String(p);
      el.style.transform=`translateY(${NS.lerp(22,0,p)+drift}px) scale(${NS.lerp(.90,1,p)})`;
    });

    programme.programmeEdges.forEach((p,i)=>{
      const q=NS.smooth(NS.window01(t,3.55+i*.12,4.45+i*.12));
      p.style.opacity=String(q*.78); p.style.strokeDashoffset=String(1-q);
    });

    programme.travellerEdges.forEach((entry,i)=>{
      const q=NS.smooth(NS.window01(t,5.00+i*.085,6.05+i*.085));
      entry.path.style.opacity=String(q*(entry.tone==='green'?.38:.62));
      entry.path.style.strokeDashoffset=String(1-q);
    });

    const hudIn=NS.outCubic(NS.window01(t,7.25,8.15));
    graphHud.style.opacity=String(hudIn); graphHud.style.transform=`translateY(${NS.lerp(12,0,hudIn)}px)`;

    if(t>=8.55){
      const q=NS.smooth(NS.window01(t,8.55,9));
      dayOrder.forEach(el=>el.style.transform='none'); commitmentOrder.forEach(el=>el.style.transform='none');
      programme.frame.style.transform='none';
      rootLabel.style.opacity=String(NS.lerp(.82,.68,q));
    }

    if(t<=.001) setSeq04FinalVisual();
  }

  NS.SEQ05_FINAL_STATE=()=>({camera:{...C.cameras.whole},world:C.world,graphVersion:C.finalState.version});
  NS.bootSequence({duration:DURATION,renderAt});
})();
