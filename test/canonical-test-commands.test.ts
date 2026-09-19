/**
 * H4: living commands and docs must not treat raw `node --test` as the
 * canonical verification entrypoint. Historical evidence under
 * docs/refactor/evidence remains untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

test('package.json suite scripts go through run-suite.mjs, not raw node --test', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  const script = (name: string): string => {
    const command = pkg.scripts[name];
    assert.ok(command, `missing package.json script ${name}`);
    return command;
  };
  assert.match(script('test'), /gate:test-boundary/);
  assert.match(script('test'), /run-suite\.mjs current/);
  assert.match(script('test:current'), /run-suite\.mjs current/);
  assert.match(script('test:postgres'), /run-suite\.mjs postgres/);
  assert.match(script('test:postgres:fast'), /run-suite\.mjs postgresFast/);
  assert.match(script('test:migration'), /run-suite\.mjs migration/);
  assert.match(script('test:legacy'), /run-suite\.mjs legacy/);
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (!name.startsWith('test')) continue;
    assert.doesNotMatch(
      command,
      /(?:^|[^\w./-])node --test(?:\s|$)/,
      `${name} must not invoke raw node --test`,
    );
  }
});

test('living docs name npm test as the canonical current gate', () => {
  const readme = read('README.md');
  const testing = read('docs/TESTING.md');
  assert.match(readme, /npm test/);
  assert.match(readme, /do not run raw `node --test`/i);
  assert.match(testing, /`npm test` is the canonical current/);
  assert.doesNotMatch(readme, /npm test[^\n]*`node --test --test-concurrency=1`/);
  assert.doesNotMatch(testing, /default `npm test`[^\n]*discovers \*\*every\*\* file/);
});
