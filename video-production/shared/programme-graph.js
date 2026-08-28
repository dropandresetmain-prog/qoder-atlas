(() => {
  const NS = window.NS = window.NS || {};

  NS.createProgrammeFrame = function(parent, spec) {
    const el=document.createElement('section');
    el.className='ns-programme-frame';
    el.id=spec.id || 'programme-frame';
    Object.assign(el.style,{left:`${spec.x}px`,top:`${spec.y}px`,width:`${spec.w}px`,height:`${spec.h}px`});
    el.innerHTML=`<div class="ns-programme-heading"><strong>${spec.title}</strong><span>${spec.meta || ''}</span></div>`;
    parent.appendChild(el); return el;
  };

  NS.createDayTerritory = function(parent, spec) {
    const el=document.createElement('section');
    el.className='ns-day-territory'; el.id=spec.id;
    Object.assign(el.style,{left:`${spec.x}px`,top:`${spec.y}px`,width:`${spec.w}px`,height:`${spec.h}px`});
    el.innerHTML=`<div class="ns-day-meta"><div class="day-index">${spec.label}</div><div class="day-detail">${spec.detail || ''}</div></div>`;
    parent.appendChild(el); return el;
  };

  NS.createCommitmentNode = function(parent, spec) {
    const el=document.createElement('div');
    el.className=`ns-commitment-node is-${spec.tone || 'green'}`; el.id=spec.id;
    Object.assign(el.style,{left:`${spec.x}px`,top:`${spec.y}px`});
    el.innerHTML=`<div class="commitment-inner"><span class="commitment-star">✦</span><span class="commitment-name">${spec.name}</span><span class="commitment-time">${spec.time || ''}</span></div>`;
    parent.appendChild(el); return el;
  };

  NS.createHeroJourney = function(parent, spec) {
    const root=document.createElement('section');
    root.className='ns-hero-journey'; root.id=spec.id;
    Object.assign(root.style,{left:`${spec.x}px`,top:`${spec.y}px`});
    root.innerHTML=`<div class="journey-id">${spec.label}</div><div class="journey-sub">${spec.sub || 'journey dependency'}</div>`;
    const nodes=[]; const links=[]; const xs=[0,330,660,990,1320];
    spec.stages.forEach((stage,i)=>{
      const n=document.createElement('div');
      n.className=`ns-stage-node is-${stage.tone || 'green'}`;
      n.style.left=`${xs[i]}px`;
      n.innerHTML=`<span class="stage-icon">${stage.icon}</span><div class="stage-kicker">${stage.kicker}</div><div class="stage-value">${stage.value}</div><div class="stage-meta">${stage.meta}</div>`;
      root.appendChild(n); nodes.push(n);
      if(i<spec.stages.length-1){ const l=document.createElement('i'); l.className=`ns-stage-link is-${stage.linkTone || stage.tone || 'green'}`; l.style.left=`${xs[i]+220}px`; l.style.width='110px'; root.appendChild(l); links.push(l); }
    });
    parent.appendChild(root); return {root,nodes,links};
  };

  NS.createConstraintCard = function(parent, spec) {
    const el=document.createElement('section');
    el.className=`ns-constraint-card is-${spec.tone || 'green'}`; el.id=spec.id;
    Object.assign(el.style,{left:`${spec.x}px`,top:`${spec.y}px`});
    el.innerHTML=`<div class="constraint-label">${spec.label}</div><div class="constraint-value">${spec.value}</div>`;
    parent.appendChild(el); return el;
  };

  NS.createSystemBoundary = function(parent,spec){
    const el=document.createElement('section');
    el.className='ns-system-boundary'; el.id=spec.id || 'system-boundary';
    Object.assign(el.style,{left:`${spec.x}px`,top:`${spec.y}px`,width:`${spec.w}px`,height:`${spec.h}px`});
    el.innerHTML=`<div class="system-label"><strong>${spec.title}</strong><span>${spec.subtitle}</span></div><div class="system-meta">${(spec.meta||[]).map(x=>`<span>${x}</span>`).join('')}</div>`;
    parent.appendChild(el); return el;
  };

  NS.setCommitmentTone=function(el,tone){ if(!el)return; ['green','brass','red','grey','ink'].forEach(t=>el.classList.remove(`is-${t}`)); el.classList.add(`is-${tone}`); };
})();
