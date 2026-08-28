(()=>{const NS=window.NS,C=NS.OBJECTIVE_FIELD,D=17,world=document.getElementById('world'),svg=document.getElementById('world-svg'),m=NS.buildObjectiveField({world,svg,includeHeroes:true,includeConstraints:true});
 const rail=document.getElementById('maintain-rail'),wid=document.getElementById('world-id'),copy=document.getElementById('focus-copy'),heroKey=C.baseline.hero,hero=m.heroes.get(heroKey);
 // Final Seq05 field is the exact opening state: commitments + selected docks visible, detailed heroes/constraints hidden.
 function setField(alpha=1){m.layers.health.style.opacity=String(.58*alpha);m.layers.mini.style.opacity=String(alpha);[...m.dayLabels.values(),...m.commitments.values()].forEach(e=>e.style.opacity=String(alpha));m.programmeEdges.forEach(e=>e.style.opacity=String(.62*alpha));m.miniEdges.forEach(e=>e.path.style.opacity=String(alpha));m.dockEdges.forEach(e=>e.path.style.opacity=String(.58*alpha))}
 function renderAt(t){t=NS.clamp(t,0,D);let x=C.cameras.programme.x,y=C.cameras.programme.y,s=C.cameras.programme.scale;
  if(t<3){const p=NS.smooth(NS.window01(t,1.25,2.9));x=NS.lerp(C.cameras.programme.x,C.cameras.hero37.x,p);y=NS.lerp(C.cameras.programme.y,C.cameras.hero37.y,p);s=NS.lerp(C.cameras.programme.scale,C.cameras.hero37.scale,p)}else if(t<11.4){x=C.cameras.hero37.x;y=C.cameras.hero37.y;s=C.cameras.hero37.scale}else{const p=NS.cubic(NS.window01(t,11.4,16.65));x=NS.lerp(C.cameras.hero37.x,C.cameras.wideFinal.x,p);y=NS.lerp(C.cameras.hero37.y,C.cameras.wideFinal.y,p);s=NS.lerp(C.cameras.hero37.scale,C.cameras.wideFinal.scale,p)}NS.setCamera(world,x,y,s);
  const close=NS.smooth(NS.window01(t,1.7,3.25))*(1-NS.smooth(NS.window01(t,11.2,14.6)));setField(NS.lerp(1,.24,close));
  // Detailed hero emerges from its mini representation at close LOD.
  m.heroes.forEach((h,id)=>{const primary=id===heroKey;h.root.style.opacity=String(primary?close:NS.lerp(.0,.26,1-close));h.root.style.transform=`scale(${primary?NS.lerp(.86,1,close):.72})`;h.targetEdge.style.opacity=String(primary?NS.lerp(.25,1,close):.22)});
  const primaryMini=m.minis.get(hero.spec.travellerId);if(primaryMini)primaryMini.style.opacity=String(1-close);
  // Named travel stages receive selective neutral emphasis without changing semantic state.
  const beats=[['flight',4.0,5.1],['transfer1',5.05,6.15],['hotel',6.1,7.2],['transfer2',7.15,8.25]];beats.forEach(([id,a,b])=>{const idx=hero.spec.stages.findIndex(st=>st.id===id),p=NS.bell(NS.window01(t,a,b));if(p>.12){hero.nodes[idx].style.boxShadow=`0 20px 52px rgba(20,23,28,.07),0 0 0 ${5*p}px rgba(20,23,28,.09)`;hero.nodes[idx].style.transform=`translateY(${-3*p}px) scale(${1+.014*p})`}else{hero.nodes[idx].style.boxShadow='';hero.nodes[idx].style.transform=''}});
  // Constraints tether in one at a time; no dump.
  [...m.constraints.values()].forEach((c,i)=>{const p=NS.outCubic(NS.window01(t,7.55+i*.63,8.25+i*.63));c.card.style.opacity=String(p*close);c.card.style.transform=`translateY(${NS.lerp(14,0,p)}px)`;c.edge.style.opacity=String(p*close);NS.drawProgress(c.edge,p)});
  // Follow the hero's objective edge before returning to programme scale.
  const objectivePulse=NS.smooth(NS.window01(t,9.6,10.55));hero.targetEdge.style.strokeWidth=String(NS.lerp(2.6,4.2,NS.bell(objectivePulse)));hero.targetEdge.style.opacity=String(Math.max(Number(hero.targetEdge.style.opacity)||0,objectivePulse));
  const wide=NS.smooth(NS.window01(t,12.6,16.2));m.heroes.forEach((h,id)=>{if(id!==heroKey)h.root.style.opacity=String(.22*wide)});
  const idIn=NS.outCubic(NS.window01(t,14.0,15.2));rail.style.opacity=String(idIn*.85);wid.style.opacity=String(idIn);copy.style.opacity=String(idIn);wid.style.transform=`translateY(${NS.lerp(-8,0,idIn)}px)`;
  if(t<=.001){NS.setCamera(world,C.cameras.programme.x,C.cameras.programme.y,C.cameras.programme.scale);setField(1);m.heroes.forEach(h=>{h.root.style.opacity='0';h.targetEdge.style.opacity='0'});m.constraints.forEach(c=>{c.card.style.opacity='0';c.edge.style.opacity='0'});rail.style.opacity='0';wid.style.opacity='0';copy.style.opacity='0'}
 }
 NS.bootSequence({duration:D,renderAt});})();
