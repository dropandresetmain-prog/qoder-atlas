import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import './style.css';

const ink = '#14171C';
const green = '#4C9A6E';
const brass = '#D9A24A';
const red = '#E0521F';
const grey = '#C6CBD2';

type State = 'healthy' | 'changed' | 'broken' | 'risk' | 'unknown';

const ease = (frame: number, start: number, duration = 14) =>
  interpolate(frame, [start, start + duration], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

const stateColour = (state: State) => ({healthy: green, changed: brass, broken: red, risk: brass, unknown: grey})[state];

const reveal = (frame: number, start: number, children: React.ReactNode, className = '') => {
  const progress = ease(frame, start, 12);
  return <div className={className} style={{opacity: progress, transform: `translateY(${(1 - progress) * 10}px)`}}>{children}</div>;
};

const Status = ({label, state, active = false}: {label: string; state: State; active?: boolean}) => (
  <span className="status" style={{color: stateColour(state), borderColor: `${stateColour(state)}66`, backgroundColor: `${stateColour(state)}13`}}>
    <span className={active ? 'status-dot live-dot' : 'status-dot'} style={{backgroundColor: stateColour(state)}} />{label}
  </span>
);

const Link = ({label, detail, state, frame, start, icon = false}: {label: string; detail: string; state: State; frame: number; start: number; icon?: boolean}) => {
  const p = ease(frame, start, 11);
  const changed = state !== 'healthy';
  return (
    <div className="journey-link" style={{opacity: p, transform: `translateX(${(1 - p) * 18}px)`}}>
      <div className="link-rail"><span className="link-dot" style={{background: stateColour(state)}} /><span className="link-line" style={{background: stateColour(state), opacity: state === 'healthy' ? 0.45 : 0.9}} /></div>
      <div className="link-card" style={{borderColor: changed ? `${stateColour(state)}99` : 'rgba(20,23,28,.13)'}}>
        <div className="meta">{icon ? '✦ ' : ''}{label}</div>
        <div className="link-detail">{detail}</div>
        <Status label={state === 'healthy' ? 'CONFIRMED' : state === 'changed' ? 'AFFECTED' : state === 'risk' ? 'AT RISK' : 'NOT VIABLE'} state={state} />
      </div>
    </div>
  );
};

const Journey = ({frame}: {frame: number}) => {
  const flightState: State = frame < 42 ? 'healthy' : 'changed';
  const downstreamState: State = frame < 75 ? 'healthy' : 'risk';
  return <div className="journey-panel">
    <div className="eyebrow">TRAVELLER 01 / SINGAPORE PROGRAMME</div>
    <div className="journey-heading">Arrival sequence</div>
    <div className="journey-sub">28 SEP · LOCAL TIME</div>
    <div className="journey-list">
      <Link frame={frame} start={6} label="FLIGHT" detail={frame < 42 ? 'SQ 236 · 06:40 → 13:50' : 'SQ 236 · 09:35 → 16:45'} state={flightState} />
      {frame >= 42 && reveal(frame, 43, <div className="rebooked"><span>REBOOKED</span><b>✓</b><em>NEW ARRIVAL +2:55</em></div>)}
      <Link frame={frame} start={18} label="TRANSFER" detail="CHANGI → MARINA BAY · 55 MIN" state={downstreamState} />
      <Link frame={frame} start={30} label="HOTEL" detail="MARINA BAY · CHECK-IN 15:00" state={downstreamState} />
      <Link frame={frame} start={42} label="KEYNOTE" detail="✦ 17:00 · MAIN STAGE" state={downstreamState} icon />
    </div>
    {frame >= 102 && reveal(frame, 102, <div className="verdict"><div>REBOOKED <span>✓</span></div><strong>TRIP NOT RECOVERED</strong></div>)}
  </div>;
};

const commitments = [
  ['OPENING KEYNOTE', 3850, 1060], ['INVESTOR BRIEFING', 4800, 1330], ['PRESS ROOM', 4550, 2180],
  ['PARTNER DINNER', 3550, 2560], ['WORKSHOP', 5250, 2570], ['CLOSING', 5700, 1750],
] as const;

const travellerPoints = Array.from({length: 42}, (_, index) => ({
  id: index + 1,
  x: 2200 + (index % 7) * 390 + Math.floor(index / 7) * 80,
  y: 800 + Math.floor(index / 7) * 460 + (index % 3) * 36,
  state: (index === 0 ? 'risk' : index === 5 || index === 19 ? 'broken' : index % 6 === 0 ? 'risk' : 'healthy') as State,
}));

const WorldNode = ({x, y, state, label, small = false, opacity = 1}: {x: number; y: number; state: State; label?: string; small?: boolean; opacity?: number}) => (
  <div className={small ? 'world-dot' : 'world-node'} style={{left: x, top: y, opacity, borderColor: `${stateColour(state)}AA`}}>
    <i style={{backgroundColor: stateColour(state)}} />{label && <span>{label}</span>}
  </div>
);

const WorldLine = ({x1, y1, x2, y2, state, opacity = 0.34, active = false}: {x1: number; y1: number; x2: number; y2: number; state: State; opacity?: number; active?: boolean}) => {
  const dx = x2 - x1; const dy = y2 - y1; const length = Math.sqrt(dx * dx + dy * dy);
  return <div className={active ? 'world-line active-line' : 'world-line'} style={{left: x1, top: y1, width: length, opacity, backgroundColor: stateColour(state), transform: `rotate(${Math.atan2(dy, dx)}rad)`}} />;
};

const ProgrammeWorld = ({frame}: {frame: number}) => {
  const worldOpacity = ease(frame, 138, 42);
  const blast = ease(frame, 276, 42);
  return <div className="world" style={{opacity: worldOpacity}}>
    <div className="programme-anchor"><div className="meta">AIT SUMMIT 2026</div><strong>PROGRAMME</strong><span>67 PARTICIPANTS</span></div>
    {commitments.map(([label, x, y], index) => <React.Fragment key={label}>
      <WorldLine x1={3500} y1={1830} x2={x} y2={y} state={index === 0 && blast > 0 ? 'broken' : 'healthy'} opacity={0.22 + blast * (index === 0 ? 0.65 : 0)} active={index === 0 && blast > 0.05} />
      <WorldNode x={x} y={y} state={index === 0 && blast > 0 ? 'broken' : 'healthy'} label={label} opacity={0.35 + worldOpacity * 0.65} />
    </React.Fragment>)}
    {travellerPoints.map((person, index) => {
      const commitment = commitments[index % commitments.length];
      const hit = index === 0 || index === 5 || index === 19;
      const state = blast > 0 && hit ? (index === 0 ? 'healthy' : index === 5 ? 'risk' : 'broken') : person.state;
      return <React.Fragment key={person.id}>
        <WorldLine x1={person.x + 24} y1={person.y + 24} x2={commitment[1]} y2={commitment[2]} state={state} opacity={0.08 + (hit ? blast * 0.8 : 0)} active={hit && blast > 0.1} />
        <WorldNode x={person.x} y={person.y} state={state} small opacity={0.25 + worldOpacity * 0.75} />
      </React.Fragment>;
    })}
    <div className="world-label graph-label"><span className="live-dot" />LIVE / RESOLUTION STATE</div>
    {blast > 0.02 && <div className="supplier-signal" style={{opacity: blast, transform: `translateY(${(1 - blast) * -12}px)`}}><div className="meta">SUPPLIER SIGNAL</div><strong>SQ 236 RETIMED</strong><span>Selective paths only</span></div>}
    {blast > 0.45 && <div className="outcomes" style={{opacity: interpolate(blast, [0.45, 0.8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
      <div><b style={{color: green}}>✓</b> 28 RECOVERED</div><div><b style={{color: brass}}>▲</b> 03 AT RISK</div><div><b style={{color: red}}>✕</b> 01 NOT VIABLE</div>
    </div>}
  </div>;
};

export const Benchmark = () => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const pull = ease(frame, 150, 120);
  const scale = interpolate(pull, [0, 1], [1.14, 0.34]);
  // The journey panel and every programme element share this one coordinate plane.
  // Camera focus moves across that plane; there is never a scene-layout swap.
  const focusX = interpolate(pull, [0, 1], [1640, 3550]);
  const focusY = interpolate(pull, [0, 1], [1350, 1850]);
  const worldTransform = `translate(${width / 2 - focusX * scale}px, ${height / 2 - focusY * scale}px) scale(${scale})`;
  const title = frame > 326 ? ease(frame, 326, 16) : 0;
  return <AbsoluteFill className="film">
    <div className="grain" />
    <div className="topline"><span>NORTHSTAR / LIVE OPERATIONS</span><span className="frame-counter">00:{String(Math.floor(frame / 30)).padStart(2, '0')}:{String(frame % 30).padStart(2, '0')}</span></div>
    <div className="viewport"><div className="camera" style={{transform: worldTransform}}>
      <div className="close-stage"><Journey frame={frame} /></div>
      <ProgrammeWorld frame={frame} />
    </div></div>
    {frame >= 146 && <div className="pull-caption" style={{opacity: ease(frame, 146, 12) * (1 - ease(frame, 255, 15))}}>ONE TRIP. ONE PROGRAMME.</div>}
    {frame >= 292 && <div className="impact-overlay" style={{opacity: ease(frame, 292, 14), transform: `translateY(${(1 - ease(frame, 292, 14)) * -10}px)`}}>
      <div className="meta">BLAST RADIUS / SQ 236 RETIMED</div>
      <div className="impact-states"><span><b>✓</b> RECOVERED</span><span><b>▲</b> AT RISK</span><span><b>✕</b> NOT VIABLE</span></div>
    </div>}
    {title > 0 && <div className="end-title" style={{opacity: title, transform: `translateY(${(1-title)*8}px)`}}><span className="live-dot" /> LIVE DEPENDENCY GRAPH</div>}
    <div className="corner-mark">N</div>
  </AbsoluteFill>;
};
