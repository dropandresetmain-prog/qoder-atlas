/** Pure math / script parsing only. Not a browser or runtime acceptance test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { fitOverviewCamera, overviewFocusBox } from '../src/ui/overview-graph/camera.ts';
import { OVERVIEW_GRAPH_SCRIPT } from '../src/ui/overview-graph/controller.ts';

const box = { x: 300, y: 50, w: 500, h: 300 };
test('active-cluster fit uses the supplied bounds and reserves toolbar/legend lanes', () => {
  const frame = fitOverviewCamera(box, 1000, 520, 60, 40, 12, 1.15)!;
  assert.equal(frame.scale, 1.15);
  assert.ok(frame.x + box.x * frame.scale >= 12);
  assert.ok(frame.x + (box.x + box.w) * frame.scale <= 988);
  assert.ok(frame.y + box.y * frame.scale >= 72);
  assert.ok(frame.y + (box.y + box.h) * frame.scale <= 468);
});
test('whole-event framing and active-change framing are distinct inputs', () => {
  const whole = fitOverviewCamera({ x: 0, y: 0, w: 3000, h: 400 }, 1000, 520, 60, 40, 12, 1.15)!;
  const active = fitOverviewCamera(box, 1000, 520, 60, 40, 12, 1.15)!;
  assert.ok(active.scale > whole.scale * 3);
});
test('invalid, hidden or over-obstructed viewports never produce a broken transform', () => {
  for (const invalid of [{ ...box, w: 0 }, { ...box, h: -1 }, { ...box, x: NaN }]) {
    assert.equal(fitOverviewCamera(invalid, 1000, 520, 60, 40, 12, 1.15), null);
  }
  assert.equal(fitOverviewCamera(box, 0, 0, 60, 40, 12, 1.15), null);
  assert.equal(fitOverviewCamera(box, 300, 90, 60, 40, 12, 1.15), null);
});
test('focus includes the selected traveller and direct supplied context, not unrelated population', () => {
  const nodes = [
    { id: 'traveller-a', x: 200, y: 300, w: 148, h: 68 },
    { id: 'flight-a', x: 400, y: 0, w: 160, h: 58 },
    { id: 'commitment-a', x: 200, y: 150, w: 140, h: 58 },
    { id: 'unrelated', x: 4000, y: 0, w: 200, h: 60 },
  ];
  assert.deepEqual(overviewFocusBox('traveller-a', nodes, [
    { from: 'flight-a', to: 'traveller-a' }, { from: 'traveller-a', to: 'commitment-a' },
  ]), { x: 184, y: -16, w: 392, h: 400 });
  assert.equal(overviewFocusBox('absent', nodes, []), null);
});
test('the emitted browser controller is valid JavaScript and embeds the tested functions', () => {
  assert.doesNotThrow(() => new Script(OVERVIEW_GRAPH_SCRIPT));
  assert.ok(OVERVIEW_GRAPH_SCRIPT.includes(fitOverviewCamera.toString()));
  assert.ok(OVERVIEW_GRAPH_SCRIPT.includes(overviewFocusBox.toString()));
});
test('polling retains manual camera and uses automatic bounds only before manual intervention', () => {
  assert.match(OVERVIEW_GRAPH_SCRIPT, /st\.mode === 'manual' && st\.fitted/);
  assert.match(OVERVIEW_GRAPH_SCRIPT, /signature === st\.frameSignature/);
  assert.match(OVERVIEW_GRAPH_SCRIPT, /st\.explicitView/);
  assert.match(OVERVIEW_GRAPH_SCRIPT, /st\.selected/);
  assert.match(OVERVIEW_GRAPH_SCRIPT, /st\.additionalOpen/);
  assert.match(OVERVIEW_GRAPH_SCRIPT, /observer\.disconnect/);
  assert.doesNotMatch(OVERVIEW_GRAPH_SCRIPT, /Sarah|Jordan|Batik|Narita|Singapore/);
});
