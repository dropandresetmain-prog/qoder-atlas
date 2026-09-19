import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProductTravellerRequest } from '../src/ui/screens/product-traveller-request.ts';

test('traveller request surface exposes typed time intent and honest funding declaration', () => {
  const html = renderProductTravellerRequest({ journeyRef: 'JOURNEY:journey-1', eventName: 'Event <unsafe>' });
  assert.match(html, /Arrive by/);
  assert.match(html, /Depart after/);
  assert.match(html, /Stay checkout/);
  assert.match(html, /Prefer a direct flight/);
  assert.match(html, /does not authorize spending/);
  assert.match(html, /Event &lt;unsafe&gt;/);
  assert.match(html, /data-request-submit disabled/);
});

test('traveller request controller keeps authored input out of HTML sinks and gates submit on interpretation', () => {
  const html = renderProductTravellerRequest({ journeyRef: 'JOURNEY:</script><img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.match(html, /if \(!interpreted\)/);
  assert.match(html, /\/requests\/interpret/);
  assert.match(html, /\/requests'/);
  assert.match(html, /Your draft is still here; retry safely/);
  const script = html.match(/<script data-traveller-request-controller>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
