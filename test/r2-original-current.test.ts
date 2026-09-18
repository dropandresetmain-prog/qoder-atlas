/**
 * R2 — Original ↔ Current toggle over the PERSISTED immutable Original.
 *
 * The browser never captures, stores or infers an Original: it renders what the
 * read model supplies (`originalFocusedGraph`) through the same renderer, and shows
 * an honest unavailable state when there is none. Regression guards below prove no
 * browser-side / memory-first-seen substitute survives anywhere in src/ui.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildOriginalCurrentRegion, originalCurrentToggleScript } from '../src/ui/originalCurrent.ts';
import { casePollingScript } from '../src/ui/casePolling.ts';
import { INTERACTIONS_SCRIPT } from '../src/ui/graph/interactions.ts';

const original = { graphHtml: '<div data-test="stored-original-graph">O</div>', capturedAt: '2026-09-19T14:03:00.000Z', capturedLabel: '19 Sep 2026, 14:03 UTC' };

describe('buildOriginalCurrentRegion', () => {
  test('renders Current and Original tabs and both panels; Current is active and shown', () => {
    const html = buildOriginalCurrentRegion({ currentHtml: '<div>Now</div>', original });
    assert.match(html, /data-oc-view="current"/);
    assert.match(html, /data-oc-view="original"/);
    assert.match(html, /data-test="current-panel"/);
    assert.match(html, /data-test="original-panel"[^>]*hidden/);
    assert.ok(html.includes('<div>Now</div>'));
  });

  test('a stored Original is rendered with its capture time and no "first seen this session" wording', () => {
    const html = buildOriginalCurrentRegion({ currentHtml: '<div>Now</div>', original });
    assert.ok(html.includes('data-test="stored-original-graph"'));
    assert.match(html, /captured <time datetime="2026-09-19T14:03:00.000Z">19 Sep 2026, 14:03 UTC<\/time>/);
    assert.doesNotMatch(html, /first seen this session|capture begins this session|Original snapshot not available/i);
    assert.doesNotMatch(html, /data-test="original-unavailable"/);
  });

  test('no stored Original => honest unavailable state, never Current as a substitute', () => {
    const html = buildOriginalCurrentRegion({ currentHtml: '<div data-test="live-graph">Now</div>' });
    assert.match(html, /data-test="original-unavailable"/);
    assert.match(html, /Original graph unavailable/);
    const originalPanel = html.slice(html.indexOf('data-test="original-panel"'));
    assert.ok(!originalPanel.includes('data-test="live-graph"'), 'Current markup must not appear inside the Original panel');
  });

  test('capture provenance is escaped', () => {
    const html = buildOriginalCurrentRegion({ currentHtml: '', original: { ...original, capturedLabel: '<b>x</b>' } });
    assert.ok(!html.includes('<b>x</b>'));
  });

  test('output is deterministic', () => {
    assert.equal(buildOriginalCurrentRegion({ currentHtml: 'a', original }), buildOriginalCurrentRegion({ currentHtml: 'a', original }));
  });
});

describe('originalCurrentToggleScript (display-only)', () => {
  const script = originalCurrentToggleScript();

  test('switches panels and tab state, and is re-applicable after a polling swap', () => {
    assert.ok(script.includes('data-oc-view'));
    assert.ok(script.includes("removeAttribute('hidden')"));
    assert.ok(script.includes("setAttribute('hidden', '')"));
    assert.ok(script.includes('window.__northstarApplyOriginalCurrent = apply'));
    assert.ok(script.includes('__northstarOriginalCurrentStarted'));
  });

  test('uses a delegated document listener so it survives markup swaps', () => {
    assert.ok(script.includes("document.addEventListener('click'"));
  });

  test('performs no capture, browser write or network call', () => {
    for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'POST', 'PUT', 'DELETE', 'innerHTML', 'capturedOriginalHtml', 'capturedAt', 'first seen']) {
      assert.ok(!script.includes(bad), `toggle script must not contain ${bad}`);
    }
  });
});

describe('polling swap keeps display state', () => {
  test('after a swap the graphs re-initialise and the Original/Current tab is re-applied', () => {
    const script = casePollingScript({ caseRef: 'c' });
    assert.ok(script.includes('__northstarInitGraphs'));
    assert.ok(script.includes('__northstarApplyOriginalCurrent'));
    assert.ok(script.indexOf('window.__northstarInitGraphs()') < script.indexOf('window.__northstarApplyOriginalCurrent()'));
  });

  test('the graph interaction script is multi-canvas, idempotent and hidden-panel safe', () => {
    assert.ok(INTERACTIONS_SCRIPT.includes("querySelectorAll('.fg-canvas')"));
    assert.ok(INTERACTIONS_SCRIPT.includes('__fgInit'));
    assert.ok(INTERACTIONS_SCRIPT.includes('fg:show'));
  });
});

describe('no competing definition of Original survives in the browser layer', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  // The Case-graph surface: renderer, toggle, polling and the Case screen. (Unrelated
  // screens, e.g. the programme-stage helper, are out of scope for this guard.)
  const files = [
    ...walk('src/ui/graph'),
    'src/ui/originalCurrent.ts',
    'src/ui/casePolling.ts',
    'src/ui/screens/product-recovery-case.ts',
  ];

  test('the Case-graph surface never touches browser storage', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      assert.doesNotMatch(text, /\b(localStorage|sessionStorage|indexedDB)\b/, `${f} must not use browser storage`);
    }
  });

  test('no memory-first-seen Original substitute or "this session" wording remains', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      assert.doesNotMatch(text, /first seen this session|capture begins this session|capturedOriginalHtml|memory-only capture/i, `${f} still defines a session Original`);
    }
  });
});
