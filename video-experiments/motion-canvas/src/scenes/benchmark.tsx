import {Camera, Circle, Line, Node, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {all, chain, createRef, easeInOutCubic, sequence, waitFor} from '@motion-canvas/core';

const C = {
  bg: '#F2F4F5', surface: '#FFFFFF', ink: '#14171C', line: 'rgba(20,23,28,.13)', soft: 'rgba(20,23,28,.07)',
  green: '#4C9A6E', greenText: '#2F6B47', brass: '#D9A24A', brassText: '#96670F', red: '#E0521F', redText: '#C2431A', grey: '#C6CBD2',
};
type State = 'ok' | 'watch' | 'alert' | 'neutral';
const tone = (state: State) => ({ok: C.green, watch: C.brass, alert: C.red, neutral: C.grey}[state]);
function edge(from: any, to: any, state: State = 'neutral') { return <Line points={[from, to]} stroke={tone(state)} lineWidth={state === 'neutral' ? 2 : 3} opacity={state === 'neutral' ? .55 : 1} lineDash={state === 'watch' ? [10, 8] : []}/>; }
function label(text: string, x: number, y: number, color = C.ink, size = 22) { return <Txt text={text} position={[x, y]} fill={color} fontFamily={'ui-monospace, Cascadia Mono, monospace'} fontSize={size} fontWeight={600} letterSpacing={2}/>; }
function journeyCard(title: string, subtitle: string, x: number, y: number, state: State, ref?: any) {
  return <Rect ref={ref} position={[x, y]} width={255} height={118} radius={8} fill={C.surface} stroke={C.line} lineWidth={2} opacity={0} scale={.94}>
    <Circle x={-101} y={-34} size={12} fill={tone(state)}/><Txt text={title} x={-80} y={-36} fill={C.ink} fontSize={22} fontWeight={650} fontFamily={'Arial'} />
    <Txt text={subtitle} x={-104} y={12} fill={'#5F6670'} fontSize={16} fontFamily={'ui-monospace, Cascadia Mono, monospace'} /><Line points={[[-104, 38], [104, 38]]} stroke={C.soft} lineWidth={2}/>
  </Rect>;
}
export default makeScene2D(function* (view) {
  view.fill(C.bg);
  const camera = createRef<Camera>(); const world = createRef<Node>(); const flight = createRef<Rect>(); const transfer = createRef<Rect>(); const hotel = createRef<Rect>(); const keynote = createRef<Rect>();
  const chainEdges = createRef<Node>(); const repl = createRef<Txt>(); const tripBroken = createRef<Txt>(); const supplier = createRef<Rect>(); const live = createRef<Rect>();
  view.add(<Camera ref={camera}><Node ref={world}>
    <Rect width={1920} height={1080} fill={C.bg}/><Txt text={'NORTHSTAR / JOURNEY STATE'} position={[-680, -390]} fill={'#6B7280'} fontSize={18} fontFamily={'ui-monospace, Cascadia Mono, monospace'} fontWeight={700} letterSpacing={3}/>
    <Rect position={[-10, -45]} width={1380} height={440} radius={16} fill={'rgba(255,255,255,.72)'} stroke={C.line} lineWidth={2}/>
    <Node ref={chainEdges} opacity={0}>{edge([-500, -45], [-330, -45], 'ok')}{edge([-180, -45], [-10, -45], 'ok')}{edge([140, -45], [310, -45], 'ok')}</Node>
    {journeyCard('FLIGHT', 'SIN  07:40', -620, -45, 'ok', flight)}{journeyCard('TRANSFER', '08:35  CONFIRMED', -300, -45, 'ok', transfer)}{journeyCard('HOTEL', 'CHECK-IN  09:05', 20, -45, 'ok', hotel)}{journeyCard('✦  KEYNOTE', '09:20  MAIN STAGE', 340, -45, 'ok', keynote)}
    <Txt ref={repl} text={'REBOOKED  ✓'} position={[-620, 140]} fill={C.greenText} fontFamily={'ui-monospace, Cascadia Mono, monospace'} fontSize={22} fontWeight={800} opacity={0}/><Txt ref={tripBroken} text={'TRIP NOT RECOVERED'} position={[35, 205]} fill={C.redText} fontFamily={'ui-monospace, Cascadia Mono, monospace'} fontSize={29} fontWeight={800} opacity={0}/>
    <Node position={[0, 500]}><Txt text={'PROGRAMME / AIT SUMMIT 2026'} position={[-860, -40]} fill={C.ink} fontSize={25} fontWeight={700} fontFamily={'Arial'}/><Txt text={'67 PARTICIPANTS  ·  3 DAYS  ·  14 COMMITMENTS'} position={[-860, 10]} fill={'#6B7280'} fontSize={16} fontFamily={'ui-monospace, Cascadia Mono, monospace'} letterSpacing={2}/>
      {[[-560,-170],[-180,-170],[200,-170],[580,-170],[-560,110],[-180,110],[200,110],[580,110]].map(([x,y], i) => <Node key={`${i}`}>{edge([x, y], [x + (i % 4 === 3 ? -1140 : 380), y + (i < 4 ? 280 : -280)], i === 0 ? 'watch' : 'neutral')}<Rect position={[x,y]} width={220} height={100} radius={10} fill={C.surface} stroke={C.line} lineWidth={2}><Circle x={-82} y={-26} size={12} fill={i === 0 ? C.brass : i === 5 ? C.red : C.green}/><Txt text={['ARRIVALS','DAY 01','DAY 02','DAY 03','SPEAKERS','VENUE','DINNER','DEPARTURES'][i]} x={-62} y={-26} fill={C.ink} fontSize={17} fontWeight={700} fontFamily={'Arial'}/><Txt text={['18 LINKS','4 EVENTS','5 EVENTS','5 EVENTS','12 PEOPLE','3 WINDOWS','42 SEATS','25 LINKS'][i]} x={-92} y={22} fill={'#6B7280'} fontSize={14} fontFamily={'ui-monospace, Cascadia Mono, monospace'}/></Rect></Node>)}
      <Rect ref={live} position={[680, -420]} width={360} height={110} radius={9} fill={C.ink} opacity={0}><Txt text={'LIVE DEPENDENCY GRAPH'} y={-15} fill={'#F5F6F7'} fontSize={17} fontWeight={700} fontFamily={'ui-monospace, Cascadia Mono, monospace'} letterSpacing={1}/><Txt text={'67 travellers / 14 commitments'} y={25} fill={'#F4F0E6'} fontSize={14} fontFamily={'Arial'}/></Rect>
      <Rect ref={supplier} position={[-960, -420]} width={315} height={100} radius={9} fill={C.surface} stroke={C.brass} lineWidth={3} opacity={0}><Txt text={'SUPPLIER CHANGE'} y={-15} fill={C.brassText} fontSize={18} fontWeight={800} fontFamily={'ui-monospace, Cascadia Mono, monospace'}/><Txt text={'SINGAPORE AIRLINES'} y={25} fill={C.ink} fontSize={14} fontFamily={'Arial'} /></Rect>{label('✓ RECOVERED', -490, 365, C.greenText, 19)}{label('▲ AT RISK', 50, 365, C.brassText, 19)}{label('✕ NOT VIABLE', 560, 365, C.redText, 19)}
    </Node>
  </Node></Camera>);
  yield* all(...[flight, transfer, hotel, keynote].map((ref, i) => chain(waitFor(i * .12), all(ref().opacity(1, .28), ref().scale(1, .35, easeInOutCubic))))); yield* chain(waitFor(.1), chainEdges().opacity(1, .35)); yield* waitFor(.55);
  yield* all(flight().stroke(C.brass, .25), flight().fill('#FFF9ED', .25), repl().opacity(1, .25)); yield* waitFor(.4); yield* all(flight().stroke(C.green, .35), flight().fill(C.surface, .35), flight().scale(1.035,.13).to(1,.28)); yield* sequence(.18, transfer().stroke(C.brass,.28), transfer().fill('#FFF9ED',.28), keynote().stroke(C.red,.35), keynote().fill('#FFF4F1',.35)); yield* all(chainEdges().opacity(.35,.2), tripBroken().opacity(1,.4)); yield* waitFor(.8);
  yield* all(camera().position([0, 140], 3.4, easeInOutCubic), camera().zoom(.7, 3.4, easeInOutCubic)); yield* waitFor(.35); yield* live().opacity(1,.45); yield* waitFor(.45); yield* all(supplier().opacity(1,.3), supplier().scale(1.04,.14).to(1,.25)); yield* sequence(.16, transfer().stroke(C.brass,.28), keynote().stroke(C.red,.28)); yield* waitFor(.25); yield* all(live().scale(1.04,.2).to(1,.22), supplier().stroke(C.red,.2)); yield* waitFor(1.05);
});
