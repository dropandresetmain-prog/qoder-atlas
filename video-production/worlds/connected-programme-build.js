(() => {
  const NS = window.NS = window.NS || {};

  function healthPosition(id) {
    const C=NS.CONNECTED_PROGRAMME.scaleField;
    let n=0;
    for(let row=0;row<12;row++){
      for(let col=0;col<6;col++){
        let traveller=n+1;
        if(traveller>=C.heroId) traveller++;
        if(traveller===id) return {x:C.cols[col],y:C.rowStart+row*C.rowStep};
        n++;
      }
    }
    return null;
  }
  NS.connectedHealthPosition=healthPosition;

  NS.buildConnectedScaleField=function({world,svg,includeHero=true}){
    const C=NS.CONNECTED_PROGRAMME.scaleField;
    const healthLayer=document.createElement('div'); healthLayer.className='ns-connected-health-layer'; world.appendChild(healthLayer);
    const health=[];
    let travellerId=1;
    for(let row=0;row<12;row++){
      for(let col=0;col<6;col++){
        if(travellerId===C.heroId) travellerId++;
        if(travellerId>C.count) break;
        const x=C.cols[col], y=C.rowStart+row*C.rowStep;
        const out=C.outcomes[travellerId] || ['green','✓'];
        const mark=NS.createHealthMark(healthLayer,{x,y,tone:out[0]});
        NS.setHealthMarkState(mark,out[0],out[1]);
        health.push({id:travellerId,x,y,mark,tone:out[0]});
        travellerId++;
      }
    }

    let hero=null;
    if(includeHero && NS.buildSeq0304Hero){
      hero=NS.buildSeq0304Hero({world,svg});
      NS.setJourneyState(hero.nodes.flight,'green',{value:'Inbound 09:35',meta:'REBOOKED · VERIFIED'});
      NS.setJourneyState(hero.nodes.transfer,'brass',{value:'Airport → Hotel',meta:'12 MIN BUFFER · AT RISK'});
      NS.setJourneyState(hero.nodes.hotel,'brass',{value:'Room held',meta:'LATE ARRIVAL · NEEDS EYES'});
      NS.setJourneyState(hero.nodes.commitment,'red',{value:'Main stage 13:00',meta:'ARRIVAL 13:18 · NOT VIABLE'});
      NS.setDependencyState(hero.edges['edge-flight-transfer'],'brass');
      NS.setDependencyState(hero.edges['edge-transfer-hotel'],'brass');
      NS.setDependencyState(hero.edges['edge-hotel-commitment'],'red');
    }

    const supplier=document.createElement('section'); supplier.className='ns-connected-supplier';
    supplier.innerHTML='<div class="supplier-top"><span class="ns-label">SUPPLIER SIGNAL</span><span class="supplier-dot"></span></div><div class="supplier-title">AIRLINE RETIME</div><div class="supplier-foot ns-data"><span>12 AFFECTED</span><span>ONE CHANGE</span></div>';
    world.appendChild(supplier);
    const supplierEdges=[];
    C.representativeSupplier.forEach(id=>{
      const p=healthPosition(id); if(!p)return;
      const d=`M1070 415 C${1420+(id%3)*150} ${430+(id%4)*55}, ${Math.max(1550,p.x-480)} ${p.y+18}, ${p.x} ${p.y+18}`;
      supplierEdges.push(NS.svgPath(svg,`connected-supplier-${id}`,d,'ns-connected-supplier-edge'));
    });
    return {healthLayer,health,hero,supplier,supplierEdges};
  };

  NS.buildConnectedProgramme=function({world,svg}){
    const C=NS.CONNECTED_PROGRAMME;
    const layer=document.createElement('div'); layer.className='ns-connected-programme-layer'; world.appendChild(layer);
    const frame=NS.createProgrammeFrame(layer,C.programme.frame);
    const days={}, commitments={};
    C.programme.days.forEach(day=>{
      days[day.id]=NS.createDayTerritory(layer,day);
      day.commitments.forEach(c=> commitments[c.id]=NS.createCommitmentNode(layer,c));
    });
    const allSpecs=Object.values(commitments).map(el=>{
      const r={}; C.programme.days.some(d=>d.commitments.some(c=>c.id===el.id && Object.assign(r,c))); return r;
    });
    const centers={}; allSpecs.forEach(c=>centers[c.id]={x:c.x+110,y:c.y+110});
    const programmeEdges=[];
    C.programme.programmeEdges.forEach(([a,b,tone],i)=>{
      const A=centers[a],B=centers[b];
      const d=`M${A.x} ${A.y} C${NS.lerp(A.x,B.x,.38)} ${A.y}, ${NS.lerp(A.x,B.x,.68)} ${B.y}, ${B.x} ${B.y}`;
      const p=NS.svgPath(svg,`programme-edge-${i}`,d,`ns-programme-edge is-${tone}`); p.setAttribute('pathLength','1'); programmeEdges.push(p);
    });
    const travellerEdges=[];
    C.programme.travellerConnections.forEach(([id,target,tone],i)=>{
      const P=healthPosition(id),B=centers[target]; if(!P||!B)return;
      const sx=P.x+85, sy=P.y+18;
      const d=`M${sx} ${sy} C${sx+720+(id%4)*90} ${sy}, ${B.x-920-(id%3)*90} ${B.y}, ${B.x-110} ${B.y}`;
      const p=NS.svgPath(svg,`traveller-programme-${id}-${target}`,d,`ns-traveller-programme-edge is-${tone}`); p.setAttribute('pathLength','1'); travellerEdges.push({id,target,tone,path:p});
    });
    return {layer,frame,days,commitments,centers,programmeEdges,travellerEdges};
  };

  NS.buildConnectedHeroes=function({world,svg,heroIds=null}){
    const C=NS.CONNECTED_PROGRAMME;
    const layer=document.createElement('div'); layer.className='ns-connected-hero-layer'; world.appendChild(layer);
    const constraintLayer=document.createElement('div'); constraintLayer.className='ns-connected-constraint-layer'; world.appendChild(constraintLayer);
    const models={};
    C.heroes.filter(spec=>!heroIds || heroIds.includes(spec.id)).forEach(spec=>{
      const model=NS.createHeroJourney(layer,spec); models[spec.id]={spec,...model};
      const target=C.programme.days.flatMap(d=>d.commitments).find(c=>c.id===spec.target);
      const sx=spec.x+1540,sy=spec.y+109, ex=target.x+10,ey=target.y+110;
      const d=`M${sx} ${sy} C${sx+260} ${sy}, ${ex-320} ${ey}, ${ex} ${ey}`;
      models[spec.id].targetEdge=NS.svgPath(svg,`hero-target-${spec.id}`,d,`ns-traveller-programme-edge is-${spec.tone}`); models[spec.id].targetEdge.setAttribute('pathLength','1');
    });
    const constraints={};
    C.constraints.filter(spec=>!heroIds || heroIds.includes(spec.hero)).forEach((spec,i)=>{
      const card=NS.createConstraintCard(constraintLayer,spec); constraints[spec.id]={spec,card};
      const hero=C.heroes.find(h=>h.id===spec.hero); const stageX=hero.x+[0,330,660,990,1320][spec.stageIndex]+110; const stageY=hero.y+88;
      const sx=spec.x+150, sy=spec.y; const d=`M${sx} ${sy} C${sx} ${sy-70}, ${stageX} ${stageY+120}, ${stageX} ${stageY}`;
      constraints[spec.id].edge=NS.svgPath(svg,`constraint-edge-${i}`,d,'ns-constraint-edge'); constraints[spec.id].edge.setAttribute('pathLength','1');
    });
    return {layer,constraintLayer,models,constraints};
  };
})();
