/**
 * R2 — Original/Current toggle tests.
 *
 * Verifies the toggle markup and script contain the required contract elements:
 * honest labels, no localStorage/sessionStorage writes, memory-only capture, empty
 * state copy, and no mutating HTTP (only the GET poll exists).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOriginalCurrentRegion, originalCurrentToggleScript } from '../src/ui/originalCurrent.ts';

test('buildOriginalCurrentRegion renders honest labels', () => {
  const html = buildOriginalCurrentRegion('<div>Graph</div>');
  assert.ok(html.includes('Current'), 'must have Current button');
  assert.ok(html.includes('Original'), 'must have Original button');
  assert.ok(html.includes('data-view="current"'), 'must have current view button');
  assert.ok(html.includes('data-view="original"'), 'must have original view button');
});

test('buildOriginalCurrentRegion includes capture timestamp when provided', () => {
  const timestamp = '2026-09-18T12:00:00Z';
  const html = buildOriginalCurrentRegion('<div>Graph</div>', timestamp);
  assert.ok(html.includes('captured ' + timestamp), 'must include capture timestamp in label');
  assert.ok(html.includes('first seen this session'), 'must include honest "first seen" wording');
});

test('buildOriginalCurrentRegion shows empty state when no capture', () => {
  const html = buildOriginalCurrentRegion('<div>Graph</div>');
  assert.ok(html.includes('Original snapshot not available'), 'must show empty state');
  assert.ok(html.includes('capture begins this session'), 'must explain capture timing');
});

test('buildOriginalCurrentRegion contains current and original panels', () => {
  const html = buildOriginalCurrentRegion('<div>Graph</div>');
  assert.ok(html.includes('data-test="current-panel"'), 'must have current panel');
  assert.ok(html.includes('data-test="original-panel"'), 'must have original panel');
  assert.ok(html.includes('<div>Graph</div>'), 'must include the provided HTML');
});

test('originalCurrentToggleScript contains no localStorage writes', () => {
  const script = originalCurrentToggleScript();
  assert.ok(!script.includes('localStorage'), 'must not use localStorage');
  assert.ok(!script.includes('sessionStorage'), 'must not use sessionStorage');
});

test('originalCurrentToggleScript contains memory-only capture', () => {
  const script = originalCurrentToggleScript();
  assert.ok(script.includes('capturedOriginalHtml'), 'must capture in memory variable');
  assert.ok(script.includes('capturedAt'), 'must track capture timestamp');
  assert.ok(script.includes('var capturedOriginalHtml = null'), 'must initialize as null');
});

test('originalCurrentToggleScript does not capture when case is terminal', () => {
  const script = originalCurrentToggleScript();
  assert.ok(script.includes('TERMINAL_STATUSES'), 'must define terminal statuses');
  assert.ok(script.includes('isTerminalCase'), 'must check terminal status');
  assert.ok(script.includes('if (!isTerminalCase)'), 'must gate capture on non-terminal');
});

test('buildOriginalCurrentRegion contains empty state copy', () => {
  const html = buildOriginalCurrentRegion('<div>Current Graph</div>');
  assert.ok(html.includes('Original snapshot not available'), 'must show empty state copy');
  assert.ok(html.includes('capture begins this session'), 'must explain capture timing');
});

test('originalCurrentToggleScript contains no mutating HTTP', () => {
  const script = originalCurrentToggleScript();
  assert.ok(!script.includes('POST'), 'must not make POST requests');
  assert.ok(!script.includes('PUT'), 'must not make PUT requests');
  assert.ok(!script.includes('DELETE'), 'must not make DELETE requests');
  assert.ok(!script.includes('fetch('), 'must not make any fetch calls');
});

test('originalCurrentToggleScript toggles between panels', () => {
  const script = originalCurrentToggleScript();
  assert.ok(script.includes('toggle-btn'), 'must handle toggle buttons');
  assert.ok(script.includes('data-view'), 'must read view attribute');
  assert.ok(script.includes('removeAttribute(\'hidden\')'), 'must show selected panel');
  assert.ok(script.includes('setAttribute(\'hidden\', \'\')'), 'must hide other panel');
});

test('originalCurrentToggleScript updates button active state', () => {
  const script = originalCurrentToggleScript();
  assert.ok(script.includes('classList.remove(\'active\')'), 'must remove active from all buttons');
  assert.ok(script.includes('classList.add(\'active\')'), 'must add active to selected button');
});

test('originalCurrentToggleScript guards against double-init', () => {
  const script = originalCurrentToggleScript();
  assert.ok(script.includes('__northstarOriginalCurrentStarted'), 'must guard against double-init');
});

test('originalCurrentToggleScript requires toggle region to exist', () => {
  const script = originalCurrentToggleScript();
  assert.ok(script.includes('data-test="original-current-toggle"'), 'must query toggle region');
  assert.ok(script.includes('if (!toggleRegion)'), 'must exit if toggle region missing');
});

test('originalCurrentToggleScript captures from focused-case-graph', () => {
  const script = originalCurrentToggleScript();
  assert.ok(script.includes('data-test="focused-case-graph"'), 'must query graph container');
  assert.ok(script.includes('graphContainer.innerHTML'), 'must capture innerHTML');
});

test('buildOriginalCurrentRegion output is deterministic', () => {
  const html1 = buildOriginalCurrentRegion('<div>Graph</div>', '2026-09-18T12:00:00Z');
  const html2 = buildOriginalCurrentRegion('<div>Graph</div>', '2026-09-18T12:00:00Z');
  assert.equal(html1, html2, 'same inputs must produce identical output');
});

test('buildOriginalCurrentRegion differs with different capturedAt', () => {
  const html1 = buildOriginalCurrentRegion('<div>Graph</div>', '2026-09-18T12:00:00Z');
  const html2 = buildOriginalCurrentRegion('<div>Graph</div>', '2026-09-18T13:00:00Z');
  assert.notEqual(html1, html2, 'different capturedAt must produce different output');
});
