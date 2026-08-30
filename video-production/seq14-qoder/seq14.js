(() => {
  const DURATION = 8;
  const NS = window.NS;
  const camera = document.getElementById('camera');
  const problem = document.getElementById('problem-card');
  const integrate = document.getElementById('integrate');
  const verify = document.getElementById('verify');
  const integrateState = document.getElementById('integrate-state');
  const verifyCount = document.getElementById('verify-count');
  const passLockup = document.getElementById('pass-lockup');
  const phaseIndex = document.getElementById('phase-index');
  const phaseName = document.getElementById('phase-name');
  const timecode = document.getElementById('timecode');
  const flowPulse = document.getElementById('flow-pulse');

  const lanes = [
    { id:'ui', el:document.getElementById('lane-ui'), path:document.getElementById('fo-ui'), fanin:document.getElementById('fi-ui'), start:1.25, complete:4.05, final:'READY' },
    { id:'engine', el:document.getElementById('lane-engine'), path:document.getElementById('fo-engine'), fanin:document.getElementById('fi-engine'), start:1.38, complete:4.32, final:'TESTED' },
    { id:'provider', el:document.getElementById('lane-provider'), path:document.getElementById('fo-provider'), fanin:document.getElementById('fi-provider'), start:1.51, complete:4.58, final:'READY' },
    { id:'testing', el:document.getElementById('lane-testing'), path:document.getElementById('fo-testing'), fanin:document.getElementById('fi-testing'), start:1.64, complete:4.86, final:'DONE' }
  ];
  const verifySteps = Array.from(document.querySelectorAll('.verify-step'));
  const testCells = Array.from(document.querySelectorAll('#lane-testing .test-grid i'));
  const providerStates = Array.from(document.querySelectorAll('#lane-provider .provider-state'));
  const trunk = document.getElementById('integrate-verify-line');

  const setPath = (path, progress, tone) => {
    const p = NS.clamp(progress);
    path.style.strokeDashoffset = String(1 - p);
    if (tone === 'green') path.style.stroke = 'var(--ns-green-f)';
    else if (tone === 'brass') path.style.stroke = 'var(--ns-brass-f)';
    else if (tone === 'ink') path.style.stroke = 'rgba(20,23,28,.72)';
    else path.style.stroke = 'rgba(20,23,28,.16)';
  };

  const placePulse = (t) => {
    const spans = [
      [1.34,1.69,960,292,300,360],
      [1.50,1.85,960,292,730,360],
      [1.66,2.01,960,292,1190,360],
      [1.82,2.17,960,292,1620,360]
    ];
    let active = false;
    for (const [a,b,x0,y0,x1,y1] of spans) {
      if (t >= a && t <= b) {
        const p = NS.outCubic(NS.window01(t,a,b));
        flowPulse.setAttribute('cx', NS.lerp(x0,x1,p));
        flowPulse.setAttribute('cy', NS.lerp(y0,y1,p) - 18 * Math.sin(Math.PI*p));
        flowPulse.style.opacity = String(NS.bell(NS.window01(t,a,b)) * .95);
        flowPulse.style.stroke = 'var(--ns-brass-f)';
        active = true;
        break;
      }
    }
    if (!active) flowPulse.style.opacity = '0';
  };

  function renderLane(lane, t, idx) {
    const branch = NS.smooth(NS.window01(t, lane.start, lane.start + .72));
    const arrive = NS.outCubic(NS.window01(t, lane.start + .18, lane.start + .84));
    const finishP = NS.smooth(NS.window01(t, lane.complete - .18, lane.complete + .28));
    const fanInDim = NS.smooth(NS.window01(t, 5.15, 6.10));

    setPath(lane.path, branch, t >= lane.complete ? 'green' : 'brass');
    const finalQuiet = NS.smooth(NS.window01(t, 6.88, 7.62));
    lane.el.style.opacity = String(arrive * NS.lerp(1, .34, fanInDim) * NS.lerp(1, .22, finalQuiet));
    lane.el.style.transform = `translateY(${NS.lerp(34,0,arrive)}px) scale(${NS.lerp(.92,1,arrive) * NS.lerp(1,.88,fanInDim)})`;

    const activeP = NS.window01(t, lane.start + .42, lane.complete - .22);
    const progress = t >= lane.complete ? 100 : Math.round(12 + activeP * 76);
    lane.el.querySelector('.lane-progress').textContent = `${String(progress).padStart(2,'0')}%`;
    const badge = lane.el.querySelector('.lane-badge');
    if (t < lane.start + .28) NS.setBadge(badge, null, 'QUEUED');
    else if (t < lane.complete) NS.setBadge(badge, 'active', 'WORKING');
    else NS.setBadge(badge, 'ok', lane.final);
    NS.setPanelSettle(lane.el, finishP * (1 - NS.smooth(NS.window01(t,lane.complete+.20,lane.complete+.62))), 'green');

    if (lane.id === 'ui') {
      const lines = Array.from(lane.el.querySelectorAll('.wf-line, .wf-row i'));
      lines.forEach((el, i) => {
        const p = NS.smooth(NS.window01(t, lane.start + .35 + i*.055, lane.start + .72 + i*.055));
        el.style.opacity = String(NS.lerp(.18,1,p));
      });
    }
    if (lane.id === 'engine') {
      const rows = Array.from(lane.el.querySelectorAll('.code-window > div'));
      rows.forEach((row, i) => {
        const p = NS.smooth(NS.window01(t, lane.start + .38 + i*.28, lane.start + .72 + i*.28));
        row.style.opacity = String(NS.lerp(.16,1,p));
        row.style.transform = `translateX(${NS.lerp(-8,0,p)}px)`;
      });
      lane.el.querySelector('.code-result').style.color = t >= lane.complete ? 'var(--ns-green-t)' : 'var(--ns-brass-t)';
      lane.el.querySelector('.code-result span').textContent = t >= lane.complete ? 'state: VALIDATED' : 'state: RECOVERING';
    }
    if (lane.id === 'provider') {
      const stages = [lane.start+.55, lane.start+1.12, lane.start+1.68];
      providerStates.forEach((el, i) => {
        if (t < stages[i]) { el.textContent = i === 2 ? '—' : 'WAIT'; el.style.color='var(--ns-muted)'; }
        else if (t < stages[i] + .42) { el.textContent = i === 2 ? '184ms' : 'CALL'; el.style.color='var(--ns-brass-t)'; }
        else { el.textContent = i === 2 ? '200 · VERIFIED' : 'OK'; el.style.color='var(--ns-green-t)'; }
      });
    }
    if (lane.id === 'testing') {
      let okCount = 0;
      testCells.forEach((cell, i) => {
        const a = lane.start + .48 + i*.16;
        cell.classList.toggle('is-active', t >= a && t < a+.20);
        cell.classList.toggle('is-ok', t >= a+.20);
        if (t >= a+.20) okCount++;
      });
      document.getElementById('test-count').textContent = String(okCount);
      lane.el.querySelector('.activity-line em').style.color = t >= lane.complete ? 'var(--ns-green-t)' : 'var(--ns-brass-t)';
    }

    const fiStart = 5.02 + idx * .08;
    const fi = t >= lane.complete ? NS.smooth(NS.window01(t, fiStart, fiStart + .66)) : 0;
    setPath(lane.fanin, fi, fi >= .98 ? 'green' : 'ink');
  }

  function renderVerify(t) {
    const integrateIn = NS.outCubic(NS.window01(t, 5.35, 5.88));
    const integrateOut = NS.smooth(NS.window01(t, 6.08, 6.48));
    integrate.style.opacity = String(integrateIn * (1 - integrateOut));
    integrate.style.transform = `translateY(${NS.lerp(22,0,integrateIn) - NS.lerp(0,18,integrateOut)}px) scale(${NS.lerp(.94,1,integrateIn)})`;
    integrateState.textContent = t < 5.82 ? 'MERGING' : 'LOCKED';
    integrateState.style.color = t < 5.82 ? 'var(--ns-brass-f)' : 'var(--ns-green-f)';

    setPath(trunk, NS.smooth(NS.window01(t,5.92,6.35)), t >= 6.30 ? 'green' : 'ink');

    const verifyIn = NS.outCubic(NS.window01(t, 6.08, 6.48));
    const finalFocus = NS.smooth(NS.window01(t, 7.08, 7.72));
    verify.style.opacity = String(verifyIn);
    verify.style.transform = `translateY(${NS.lerp(28,0,verifyIn) - NS.lerp(0,300,finalFocus)}px) scale(${NS.lerp(.94,1,verifyIn) * NS.lerp(1,1.16,finalFocus)})`;
    verify.style.boxShadow = finalFocus > 0 ? `0 30px 78px rgba(20,23,28,${NS.lerp(.09,.14,finalFocus)})` : '';

    const starts = [6.34, 6.48, 6.60, 6.72, 6.84];
    let completed = 0;
    verifySteps.forEach((step, i) => {
      const active = t >= starts[i] && t < starts[i] + .18;
      const ok = t >= starts[i] + .18;
      step.classList.toggle('is-active', active);
      step.classList.toggle('is-ok', ok);
      if (ok) completed++;
    });
    verifyCount.textContent = String(completed);
    verifyCount.style.color = completed === 5 ? 'var(--ns-green-t)' : 'var(--ns-ink)';

    const pass = NS.outCubic(NS.window01(t, 7.03, 7.42));
    passLockup.style.opacity = String(pass);
    passLockup.style.transform = `translateY(${NS.lerp(10,0,pass)}px)`;
    const settle = NS.bell(NS.window01(t,7.03,7.64));
    NS.setPanelSettle(verify, settle, 'green');

    const calm = NS.smooth(NS.window01(t,7.25,7.72));
    document.querySelector('.verify-rail').style.opacity = String(NS.lerp(1,.38,calm));
    document.querySelector('.verify-head').style.opacity = String(NS.lerp(1,.62,calm));
  }

  function renderAt(t) {
    t = NS.clamp(t, 0, DURATION);
    timecode.textContent = NS.formatTimecode(t);

    let cx=0, cy=0, cs=1;
    if (t < 1.15) {
      const p = NS.smooth(NS.window01(t,0,.9));
      cs = NS.lerp(1.08,1.03,p); cy = NS.lerp(8,0,p);
    } else if (t < 5.25) {
      const p = NS.cubic(NS.window01(t,1.15,2.15));
      cs = NS.lerp(1.03,.94,p); cy = NS.lerp(0,-8,p);
    } else {
      const p = NS.cubic(NS.window01(t,5.25,7.15));
      cs = NS.lerp(.94,1.0,p); cy = NS.lerp(-8,-26,p);
    }
    NS.setCamera(camera, cx, cy, cs);

    const problemEnter = NS.outCubic(NS.window01(t,.05,.56));
    const collapse = NS.cubic(NS.window01(t,.90,1.48));
    const problemQuiet = 1 - NS.smooth(NS.window01(t,5.32,6.55));
    problem.style.opacity = String(problemEnter * problemQuiet);
    const px = NS.lerp(0,0,collapse);
    const py = NS.lerp(0,-258,collapse);
    const ps = NS.lerp(1,.48,collapse);
    problem.style.transform = `translate3d(${px}px,${py}px,0) scale(${ps})`;
    problem.style.borderRadius = `${NS.lerp(22,18,collapse)}px`;
    problem.style.setProperty('--problem-rule', String(NS.lerp(.18,1,NS.smooth(NS.window01(t,.42,1.0)))));
    problem.querySelector('.problem-foot').style.opacity = String(1 - NS.smooth(NS.window01(t,.82,1.20)));

    lanes.forEach((lane, idx) => renderLane(lane, t, idx));
    placePulse(t);
    renderVerify(t);

    const geometryQuiet = NS.smooth(NS.window01(t, 6.95, 7.62));
    lanes.forEach(lane => {
      lane.path.style.opacity = String(NS.lerp(1,.14,geometryQuiet));
      lane.fanin.style.opacity = String(NS.lerp(1,.22,geometryQuiet));
    });
    trunk.style.opacity = String(NS.lerp(1,.26,geometryQuiet));

    if (t < 1.12) { phaseIndex.textContent='01'; phaseName.textContent='BOUND PROBLEM'; }
    else if (t < 3.8) { phaseIndex.textContent='02'; phaseName.textContent='PARALLEL BOUNDED WORK'; }
    else if (t < 5.5) { phaseIndex.textContent='03'; phaseName.textContent='WORKSTREAMS SETTLE'; }
    else if (t < 6.25) { phaseIndex.textContent='04'; phaseName.textContent='CONTROLLED FAN-IN'; }
    else if (t < 7.03) { phaseIndex.textContent='05'; phaseName.textContent='VERIFY'; }
    else { phaseIndex.textContent='06'; phaseName.textContent='AUTHORITATIVE RESULT'; }

    const quiet = NS.smooth(NS.window01(t,7.20,7.72));
    document.getElementById('northstar-id').style.opacity = String(NS.lerp(1,.48,quiet));
    document.getElementById('qoder-id').style.opacity = String(NS.lerp(1,.68,quiet));
  }

  NS.bootSequence({ duration: DURATION, renderAt });
})();
