(() => {
  const DURATION = 12;
  const GREEN = '#4c9a6e', BRASS = '#d9a24a', RED = '#e0521f', INK = '#14171c', SOFT = 'rgba(20,23,28,.13)';
  const world = document.querySelector('#world');
  const svg = document.querySelector('#edges');
  const closeReadout = document.querySelector('#close-readout');
  const rebooked = document.querySelector('#rebooked');
  const contradiction = document.querySelector('#contradiction');
  const wideHud = document.querySelector('#wide-hud');
  const finalLockup = document.querySelector('#final-lockup');
  const timecode = document.querySelector('#timecode');
  const focusWash = document.querySelector('#focus-wash');

  const clamp = (v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const mix = (a,b,t)=>a+(b-a)*t;
  const smooth = t => t*t*(3-2*t);
  const easeInOut = t => t<.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
  const window01 = (t,a,b)=>clamp((t-a)/(b-a));
  const pulseBell = x => { x = clamp(x); return Math.sin(x*Math.PI); };

  function svgPath(id, d, cls='edge soft') {
    const p = document.createElementNS('http://www.w3.org/2000/svg','path');
    p.id = id; p.setAttribute('d', d); p.setAttribute('class', cls); svg.appendChild(p); return p;
  }
  function svgCircle(id, r=13) {
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.id=id; c.setAttribute('r',r); c.setAttribute('class','pulse'); c.style.opacity=0; svg.appendChild(c); return c;
  }

  const closeEdges = [
    svgPath('e-ft','M1120 914 C1160 914 1180 914 1220 914','edge green'),
    svgPath('e-th','M1440 914 C1480 914 1500 914 1540 914','edge green'),
    svgPath('e-hk','M1760 914 C1800 914 1820 914 1860 914','edge green')
  ];
  const closePulse = svgCircle('closePulse', 14);

  const commitments = [
    {id:'d1a',x:2235,y:300,label:'OPEN'}, {id:'d1b',x:2475,y:245,label:'PANEL'}, {id:'d1c',x:2610,y:510,label:'DINNER'}, {id:'d1d',x:2290,y:575,label:'BRIEF'},
    {id:'d2a',x:2235,y:1155,label:'KEYNOTE'}, {id:'d2b',x:2495,y:1110,label:'BOARD'}, {id:'d2c',x:2620,y:1360,label:'PRESS'}, {id:'d2d',x:2300,y:1435,label:'DINNER'},
    {id:'d3a',x:2240,y:2010,label:'PLENARY'}, {id:'d3b',x:2495,y:1970,label:'ROUND'}, {id:'d3c',x:2620,y:2225,label:'CLOSE'}, {id:'d3d',x:2300,y:2295,label:'DEPART'}
  ];
  const cLayer = document.querySelector('#commitment-layer');
  const cEls = {};
  commitments.forEach((c,i)=>{
    const d=document.createElement('div'); d.className='commitment state-green'; d.id=c.id; d.style.left=(c.x-46)+'px'; d.style.top=(c.y-46)+'px';
    d.innerHTML=`<div><span class="star">✦</span>${c.label}</div>`; cLayer.appendChild(d); cEls[c.id]=d;
  });
  svgPath('programme-spine','M2405 720 C2405 800 2405 850 2405 925 M2405 1575 C2405 1655 2405 1700 2405 1780','edge soft');

  // Traveller 17's close-up keynote is the same dependency represented at programme scale.
  const anchorLink = svgPath('anchor-link','M2108 914 C2170 940 2185 1060 2235 1155','edge green');

  const MINI_X = [0,105,210,315];
  const travellers = [];
  const groupRows = [
    [320,400,480,560,640,720,800,880,960,1040,1120,1200,1280,1360],
    [780,860,940,1020,1100,1180,1260,1340,1420,1500,1580,1660,1740,1820],
    [1260,1340,1420,1500,1580,1660,1740,1820,1900,1980,2060,2140,2220,2300]
  ];
  const targets = ['d1a','d1b','d1c','d1d','d2a','d2b','d2c','d2d','d3a','d3b','d3c','d3d'];
  const affectedIds = new Set([2,5,11,18,21,24,31,39]);
  const results = {2:'green',5:'brass',11:'red',18:'green',21:'brass',24:'red',31:'green',39:'red'};
  const miniLayer=document.querySelector('#mini-layer');

  for(let i=0;i<42;i++){
    const group=i<14?0:i<28?1:2;
    const row=i%14;
    const baseX=520 + (i%3)*34;
    const baseY=groupRows[group][row];
    // Traveller 17 is the enlarged hero chain; its mini representation remains ghosted in the wide system.
    const el=document.createElement('div'); el.className='mini-chain'; el.id=`trav-${i+1}`; el.style.left=baseX+'px'; el.style.top=baseY+'px';
    el.innerHTML=`<div class="mini-id">T${String(i+1).padStart(2,'0')}</div>`;
    const nodes=[];
    MINI_X.forEach((x,j)=>{ const n=document.createElement('span'); n.className='mini-node green'; n.style.left=x+'px'; n.style.top='14px'; el.appendChild(n); nodes.push(n); if(j<3){ const s=document.createElement('span'); s.className='mini-seg green'; s.style.left=(x+22)+'px'; s.style.width='83px'; el.appendChild(s); }});
    const result=document.createElement('div'); result.className='mini-result green'; result.textContent='✓ RECOVERED'; el.appendChild(result);
    miniLayer.appendChild(el);
    const targetId = targets[(group*4 + row)%targets.length];
    const target = commitments.find(c=>c.id===targetId);
    const sx=baseX+337, sy=baseY+25;
    const ex=target.x-48, ey=target.y;
    const d=`M${sx} ${sy} C${mix(sx,ex,.46)} ${sy}, ${mix(sx,ex,.72)} ${ey}, ${ex} ${ey}`;
    const dep=svgPath(`dep-${i+1}`,d,'edge soft');
    travellers.push({id:i+1,group,row,baseX,baseY,el,nodes,result,dep,targetId,affected:affectedIds.has(i+1),resultTone:results[i+1]||'green'});
  }

  // Supplier links are only drawn to the travellers actually fed by this changed airline signal.
  const supplierLinks=[];
  travellers.filter(t=>t.affected).forEach((t,idx)=>{
    const ex=t.baseX+11, ey=t.baseY+25;
    const d=`M560 170 C700 ${170+idx*9}, 390 ${ey}, ${ex} ${ey}`;
    supplierLinks.push(svgPath(`sup-${t.id}`,d,'edge soft'));
  });
  const supplierPulse = svgCircle('supplierPulse', 10);

  const heroNodes = ['flight','transfer','hotel','keynote'].map(id=>document.getElementById(id));
  const flightValue = document.querySelector('#flight .value');
  const flightMeta = document.querySelector('#flight .meta');
  const transferMeta = document.querySelector('#transfer .meta');
  const hotelMeta = document.querySelector('#hotel .meta');
  const keynoteMeta = document.querySelector('#keynote .meta');

  function setTone(el,tone){ el.classList.remove('green','brass','red','grey','ink'); el.classList.add(tone); }
  function setCommitTone(el,tone){ el.className=`commitment state-${tone}`; }
  function setEdgeTone(el,tone,affected=false){ el.setAttribute('class',`edge ${tone}${affected?' affected':''}`); }

  function pointOnCubic(p0,p1,p2,p3,t){
    const u=1-t;
    return {
      x:u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,
      y:u*u*u*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*p3.y
    };
  }

  function setClosePulse(t){
    const stages=[
      {a:2.72,b:3.16,p0:{x:1120,y:914},p1:{x:1160,y:914},p2:{x:1180,y:914},p3:{x:1220,y:914},stroke:BRASS},
      {a:3.18,b:3.62,p0:{x:1440,y:914},p1:{x:1480,y:914},p2:{x:1500,y:914},p3:{x:1540,y:914},stroke:BRASS},
      {a:3.64,b:4.12,p0:{x:1760,y:914},p1:{x:1800,y:914},p2:{x:1820,y:914},p3:{x:1860,y:914},stroke:RED}
    ];
    let visible=false;
    for(const s of stages){ if(t>=s.a && t<=s.b){ const q=window01(t,s.a,s.b); const pt=pointOnCubic(s.p0,s.p1,s.p2,s.p3,q); closePulse.setAttribute('cx',pt.x); closePulse.setAttribute('cy',pt.y); closePulse.style.opacity=pulseBell(q); closePulse.style.stroke=s.stroke; visible=true; break; }}
    if(!visible) closePulse.style.opacity=0;
  }

  function renderAt(t){
    t=clamp(t,0,DURATION);
    timecode.textContent=`00:${String(Math.floor(t)).padStart(2,'0')}.${String(Math.floor((t%1)*1000)).padStart(3,'0')}`;

    // Camera: intimate case view -> one continuous pull-back -> slight track toward the affected programme rail.
    let scale, camX, camY;
    if(t<5){
      const q=smooth(window01(t,0,1.25));
      scale=mix(1.34,1.42,q); camX=mix(-1050,-1120,q); camY=mix(-640,-690,q);
    } else if(t<9){
      const q=easeInOut(window01(t,5,9));
      scale=mix(1.42,.43,q); camX=mix(-1120,40,q); camY=mix(-690,8,q);
    } else {
      const q=easeInOut(window01(t,9,12));
      scale=mix(.43,.47,q); camX=mix(40,-25,q); camY=mix(8,-18,q);
    }
    world.style.transform=`translate3d(${camX}px,${camY}px,0) scale(${scale})`;

    // Close-up flight rebooking settle: brass while changing, then back to healthy green.
    const flightChange=window01(t,1.00,1.85);
    const flightSettled=t>=1.85;
    setTone(heroNodes[0], flightSettled?'green':(t>=1?'brass':'green'));
    flightValue.textContent = t<1.18 ? 'Inbound 08:10' : t<1.52 ? 'Inbound 09:·5' : 'Inbound 09:35';
    flightMeta.textContent = t<1.0 ? 'CONFIRMED · T−06:40' : t<1.85 ? 'SUPPLIER CHANGE · VERIFYING' : 'REBOOKED · VERIFIED';
    const settleFlicker = t>=1.14 && t<1.78 ? Math.sin((t-1.14)*32)*2.2 : 0;
    heroNodes[0].style.transform=`translateY(${settleFlicker}px)`;
    heroNodes[0].style.boxShadow = t>=1 && t<1.85 ? `0 22px 60px rgba(20,23,28,.075), inset 0 0 0 ${4*pulseBell(window01(t,1,1.85))}px rgba(217,162,74,.16)` : '0 22px 60px rgba(20,23,28,.075)';

    const rb=window01(t,1.55,2.08); rebooked.style.opacity=smooth(rb); rebooked.style.transform=`translateY(${mix(9,0,smooth(rb))}px)`;

    // Downstream cascade.
    const transferAffected=t>=3.12, hotelAffected=t>=3.56, keynoteAffected=t>=4.02;
    setTone(heroNodes[1],transferAffected?'brass':'green');
    setTone(heroNodes[2],hotelAffected?'brass':'green');
    setTone(heroNodes[3],keynoteAffected?'red':'green');
    transferMeta.textContent=transferAffected?'12 MIN BUFFER · AT RISK':'58 MIN BUFFER';
    hotelMeta.textContent=hotelAffected?'EARLY CHECK-IN LOST':'CONFIRMED 10:00';
    keynoteMeta.textContent=keynoteAffected?'ARRIVAL 13:18 · NOT VIABLE':'MUST ARRIVE BY 12:20';
    setEdgeTone(closeEdges[0], transferAffected?'brass':'green');
    setEdgeTone(closeEdges[1], hotelAffected?'brass':'green');
    setEdgeTone(closeEdges[2], keynoteAffected?'red':'green');
    setEdgeTone(anchorLink,keynoteAffected?'red':'green');
    setClosePulse(t);

    const ct=window01(t,4.12,4.72); contradiction.style.opacity=smooth(ct); contradiction.style.transform=`translateY(${mix(13,0,smooth(ct))}px) scale(${mix(.985,1,smooth(ct))})`;

    // HUD hand-off during pullout; no infographic cut, just reframing the same world.
    const closeFade=1-smooth(window01(t,5.15,6.15)); closeReadout.style.opacity=closeFade;
    const wideIn=smooth(window01(t,6.55,7.7)); const wideOut=1-smooth(window01(t,9.75,10.75)); wideHud.style.opacity=wideIn*wideOut;

    const farAlpha=smooth(window01(t,5.5,7.1));
    document.querySelectorAll('.day-ring').forEach((el,idx)=>{ el.style.opacity=farAlpha; const drift=(idx-1)*10*(1-farAlpha); el.style.transform=`translateY(${drift}px)`; });
    cLayer.style.opacity=farAlpha;
    miniLayer.style.opacity=farAlpha;
    document.querySelector('#supplier').style.opacity=smooth(window01(t,7.15,8.1));
    supplierLinks.forEach(p=>p.style.opacity=farAlpha*.8);
    travellers.forEach(tr=>tr.dep.style.opacity=farAlpha*.66);

    // Hero chain becomes a normal member of the larger system instead of disappearing.
    const heroReduce=smooth(window01(t,6.5,8.4));
    heroNodes.forEach(n=>{ n.style.opacity=mix(1,.72,heroReduce); });
    document.querySelector('#journey-title').style.opacity=mix(1,.38,heroReduce);

    // Programme commitments stay healthy until the second shared signal lands.
    commitments.forEach(c=>setCommitTone(cEls[c.id],'green'));

    // Selective blast radius from 09:00 onward.
    const blast=window01(t,9.0,10.35);
    const supplier=document.querySelector('#supplier');
    supplier.querySelector('.supplier-value').textContent=t<9.0?'AIRLINE CHANGE':'AIRLINE RETIME +55';
    supplier.querySelector('.supplier-state').style.background=t<9.0?BRASS:RED;
    supplier.style.boxShadow=t>=9?`0 30px 70px rgba(20,23,28,.16), inset 0 0 0 ${3*pulseBell(window01(t,9,9.7))}px rgba(224,82,31,.22)`:'0 30px 70px rgba(20,23,28,.16)';

    const affected = travellers.filter(tr=>tr.affected);
    affected.forEach((tr,idx)=>{
      const local=window01(t,9.18+idx*.055,10.25+idx*.055);
      const activated=local>0;
      setEdgeTone(supplierLinks[idx],activated?'red':'soft',activated);
      const depTone = tr.resultTone==='red' ? 'red' : tr.resultTone==='brass' ? 'brass' : (t>=10.55+idx*.035 ? 'green' : 'brass');
      setEdgeTone(tr.dep,activated?depTone:'soft',activated);
      if(activated){
        setTone(tr.nodes[0],'red');
        setTone(tr.nodes[1], tr.resultTone==='green'?'ink':'brass');
        setTone(tr.nodes[2], tr.resultTone==='red'?'red':(tr.resultTone==='brass'?'brass':'green'));
        setTone(tr.nodes[3], tr.resultTone);
      } else tr.nodes.forEach(n=>setTone(n,'green'));
      const settle=window01(t,10.0+idx*.035,10.75+idx*.035);
      tr.result.className=`mini-result ${tr.resultTone}`;
      tr.result.textContent=tr.resultTone==='green'?'✓ RECOVERED':tr.resultTone==='brass'?'▲ AT RISK':'✕ NOT VIABLE';
      tr.result.style.opacity=smooth(settle);
      tr.result.style.transform=`translateX(${mix(-9,0,smooth(settle))}px)`;
      if(settle>0){ setCommitTone(cEls[tr.targetId], tr.resultTone==='red'?'red':tr.resultTone==='brass'?'brass':'green'); }
    });
    travellers.filter(tr=>!tr.affected).forEach(tr=>{tr.nodes.forEach(n=>setTone(n,'green')); tr.result.style.opacity=0; setEdgeTone(tr.dep,'soft');});

    // One moving propagation marker follows the active shared signal rail, deterministic and non-looping.
    let supVisible=false;
    affected.forEach((tr,idx)=>{
      const a=9.18+idx*.055, b=a+.34;
      if(t>=a && t<=b && !supVisible){
        const q=window01(t,a,b); const sx=560, sy=170, ex=tr.baseX+11, ey=tr.baseY+25;
        const pt=pointOnCubic({x:sx,y:sy},{x:700,y:170+idx*9},{x:390,y:ey},{x:ex,y:ey},q);
        supplierPulse.setAttribute('cx',pt.x); supplierPulse.setAttribute('cy',pt.y); supplierPulse.style.stroke=RED; supplierPulse.style.opacity=pulseBell(q); supVisible=true;
      }
    });
    if(!supVisible) supplierPulse.style.opacity=0;

    const lock=smooth(window01(t,10.75,11.55)); finalLockup.style.opacity=lock; finalLockup.style.transform=`translateY(${mix(10,0,lock)}px)`; finalLockup.style.setProperty('--rule',lock);
    focusWash.style.opacity = .08*pulseBell(window01(t,8.86,9.18));
  }

  window.__northstarRender = renderAt;
  window.__northstarDuration = DURATION;
  renderAt(0);

  const params = window.__NORTHSTAR_CAPTURE__ ? new URLSearchParams('?capture=1') : new URLSearchParams(location.search);
  if (params.has('t')) {
    renderAt(Number(params.get('t')) || 0);
    return;
  }
  if (params.has('capture')) return;

  function startWithGsap(){
    const clock={t:0};
    const master=window.gsap.timeline({paused:false});
    master.to(clock,{t:DURATION,duration:DURATION,ease:'none',onUpdate:()=>renderAt(clock.t)});
    window.__northstarTimeline=master;
    window.addEventListener('keydown',e=>{ if(e.key.toLowerCase()==='r'){ master.restart(); } });
  }
  function fallbackPreview(){
    const started=performance.now();
    const tick=now=>{ const t=Math.min(DURATION,(now-started)/1000); renderAt(t); if(t<DURATION) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  window.__startNorthstar = () => window.gsap ? startWithGsap() : fallbackPreview();
})();
