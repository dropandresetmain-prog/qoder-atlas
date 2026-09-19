import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProgrammeIntakeCsv, renderProductProgrammeIntake } from '../src/ui/programme-intake-controller.ts';

test('programme intake CSV supports quoted session indexes and typed obligations', () => {
  const result = parseProgrammeIntakeCsv([
    'displayName,participatesInItemIndices,obligation',
    '"Avery <Example>","0, 1",REQUIRED',
    'Bo Example,2,OPTIONAL',
  ].join('\n'));

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [
    { displayName: 'Avery <Example>', participatesInItemIndices: [0, 1], obligation: 'REQUIRED' },
    { displayName: 'Bo Example', participatesInItemIndices: [2], obligation: 'OPTIONAL' },
  ]);
});

test('programme intake CSV reports malformed input without inventing rows', () => {
  const result = parseProgrammeIntakeCsv('displayName,participatesInItemIndices\n"Unclosed,0');
  assert.deepEqual(result.rows, []);
  assert.match(result.errors[0]!, /unterminated quoted field/);
});

test('programme intake escapes untrusted draft values and gates import on preview', () => {
  const html = renderProductProgrammeIntake({
    initialBundle: {
      importKey: 'stable-key',
      organisationLegalName: '<img src=x onerror=alert(1)>',
      eventTitle: 'Event "quoted"',
      programmeTitle: 'Programme',
      items: [{ title: '<script>alert(1)</script>', itemType: 'SESSION', windowStart: '2031-05-01T09:00:00.000Z', windowEnd: '2031-05-01T10:00:00.000Z' }],
      travellers: [{ displayName: "O'Connor", participatesInItemIndices: [0], obligation: 'REQUIRED' }],
    },
  });

  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /data-import-programme disabled/);
  assert.match(html, /if \(!pendingBundle\)/);
  assert.match(html, /\/api\/v2\/programme\/import\/preview/);
  assert.match(html, /\/api\/v2\/programme\/import/);
  assert.match(html, /body: JSON\.stringify\(bundle\)/);
  const controllerScript = html.match(/<script data-programme-intake-controller>([\s\S]*)<\/script>/)?.[1];
  assert.ok(controllerScript);
  assert.doesNotThrow(() => new Function(controllerScript));
});
