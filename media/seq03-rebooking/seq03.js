(() => {
  const NS = window.NS;
  const DURATION = 3.0;
  const H = NS.SEQ03_04_HANDOFF;
  const world = document.getElementById('world');
  const svg = document.getElementById('world-svg');
  const hero = NS.buildSeq0304Hero({ world, svg });
  const pulse = NS.svgCircle(svg, 'cascade-pulse', 14);
  const readout = document.getElementById('hero-readout');
  const booking = document.getElementById('booking-result');
  const trip = document.getElementById('trip-result');
  const truthRule = document.getElementById('truth-rule');

  const F = hero.nodes.flight;
  const T = hero.nodes.transfer;
  const Ho = hero.nodes.hotel;
  const K = hero.nodes.commitment;
  const eFT = hero.edges['edge-flight-transfer'];
  const eTH = hero.edges['edge-transfer-hotel'];
  const eHK = hero.edges['edge-hotel-commitment'];

  function cubicPoint(x0,y0,x1,y1,x2,y2,x3,y3,t) {
    const u = 1-t;
    return {
      x:u*u*u*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3,
      y:u*u*u*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3
    };
  }

  function placePulse(t) {
    const spans = [
      {a:1.02,b:1.30,p:[1150,886,1192,886,1218,886,1260,886],tone:'var(--ns-brass-f)'},
      {a:1.35,b:1.64,p:[1490,886,1532,886,1558,886,1600,886],tone:'var(--ns-brass-f)'},
      {a:1.72,b:2.05,p:[1830,886,1872,886,1898,886,1940,886],tone:'var(--ns-red-f)'}
    ];
    let active = false;
    for (const s of spans) {
      if (t >= s.a && t <= s.b) {
        const q = NS.outCubic(NS.window01(t,s.a,s.b));
        const p = cubicPoint(...s.p,q);
        pulse.setAttribute('cx', p.x);
        pulse.setAttribute('cy', p.y);
        pulse.style.opacity = String(NS.bell(NS.window01(t,s.a,s.b)));
        pulse.style.stroke = s.tone;
        active = true;
        break;
      }
    }
    if (!active) pulse.style.opacity = '0';
  }

  function renderAt(t) {
    t = NS.clamp(t,0,DURATION);

    // A tiny camera settle ends exactly on the shared Seq03→04 handoff transform.
    const camP = NS.smooth(NS.window01(t,0,.72));
    const scale = NS.lerp(1.315,H.camera.scale,camP);
    const x = NS.lerp(-960,H.camera.x,camP);
    const y = NS.lerp(-632,H.camera.y,camP);
    NS.setCamera(world,x,y,scale);

    const bookIn = NS.outCubic(NS.window01(t,.34,.78));
    booking.style.opacity = String(bookIn);
    booking.style.transform = `translateY(${NS.lerp(9,0,bookIn)}px)`;

    // Flight looks solved first.
    if (t < .66) {
      NS.setJourneyState(F,'brass',{value:t<.34?'Inbound 08:10':'Inbound 09:35',meta:'SUPPLIER CHANGE · VERIFYING'});
      NS.setJourneySettle(F, NS.bell(NS.window01(t,.12,.72)), 'brass');
    } else {
      NS.setJourneyState(F,'green',{value:'Inbound 09:35',meta:'REBOOKED · VERIFIED'});
      NS.setJourneySettle(F, NS.bell(NS.window01(t,.56,1.00)), 'green');
    }

    // Downstream truth arrives in ordered causal stages, not a blanket red wash.
    const transferHit = t >= 1.28;
    const hotelHit = t >= 1.63;
    const keynoteHit = t >= 2.02;

    NS.setJourneyState(T, transferHit ? 'brass' : 'green', {
      value:'Airport → Hotel',
      meta: transferHit ? '12 MIN BUFFER · AT RISK' : '58 MIN BUFFER · CONFIRMED'
    });
    NS.setDependencyState(eFT, transferHit ? 'brass' : 'green');
    NS.setJourneySettle(T, NS.bell(NS.window01(t,1.22,1.70)), 'brass');

    NS.setJourneyState(Ho, hotelHit ? 'brass' : 'green', {
      value: hotelHit ? 'Room held' : 'Early check-in',
      meta: hotelHit ? 'LATE ARRIVAL · NEEDS EYES' : 'CONFIRMED 10:00'
    });
    NS.setDependencyState(eTH, hotelHit ? 'brass' : transferHit ? 'brass' : 'green');
    NS.setJourneySettle(Ho, NS.bell(NS.window01(t,1.58,1.98)), 'brass');

    NS.setJourneyState(K, keynoteHit ? 'red' : 'green', {
      value:'Main stage 13:00',
      meta: keynoteHit ? 'ARRIVAL 13:18 · NOT VIABLE' : 'MUST ARRIVE BY 12:20'
    });
    NS.setDependencyState(eHK, keynoteHit ? 'red' : hotelHit ? 'brass' : 'green');
    NS.setJourneySettle(K, NS.bell(NS.window01(t,1.96,2.42)), 'red');
    placePulse(t);

    const tripIn = NS.outCubic(NS.window01(t,2.00,2.38));
    readout.style.opacity = String(Math.max(bookIn, tripIn));
    trip.style.opacity = String(tripIn);
    trip.style.transform = `translateY(${NS.lerp(14,0,tripIn)}px) scale(${NS.lerp(.985,1,tripIn)})`;
    truthRule.style.opacity = String(tripIn);
    truthRule.style.setProperty('--truth-progress', String(NS.smooth(NS.window01(t,2.10,2.64))));
    readout.querySelector('.truth-meta').style.opacity = String(tripIn);

    // Settle everything to the exact handoff state for the final ~0.35s.
    if (t >= 2.64) {
      NS.setCamera(world,H.camera.x,H.camera.y,H.camera.scale);
      NS.setJourneyState(F,'green',{value:'Inbound 09:35',meta:'REBOOKED · VERIFIED'});
      NS.setJourneyState(T,'brass',{value:'Airport → Hotel',meta:'12 MIN BUFFER · AT RISK'});
      NS.setJourneyState(Ho,'brass',{value:'Room held',meta:'LATE ARRIVAL · NEEDS EYES'});
      NS.setJourneyState(K,'red',{value:'Main stage 13:00',meta:'ARRIVAL 13:18 · NOT VIABLE'});
      NS.setDependencyState(eFT,'brass'); NS.setDependencyState(eTH,'brass'); NS.setDependencyState(eHK,'red');
      [F,T,Ho,K].forEach(n => NS.setJourneySettle(n,0));
      pulse.style.opacity='0';
      booking.style.opacity='1'; booking.style.transform='none';
      trip.style.opacity='1'; trip.style.transform='none';
      truthRule.style.opacity='1'; truthRule.style.setProperty('--truth-progress','1');
      readout.querySelector('.truth-meta').style.opacity='1';
    }
  }

  NS.bootSequence({ duration:DURATION, renderAt });
})();
