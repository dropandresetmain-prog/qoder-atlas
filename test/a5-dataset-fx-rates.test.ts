/**
 * CP-A: organisation budget FX in the demo dataset must load and hash with
 * the rest of the bundle so materialization can seed fx_observations for
 * mixed-currency recovery cost comparison.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDataset } from '../src/app/demo/datasetLoader.ts';

const sourceDirectory = path.resolve('fixtures/programmes/ait-summit-2026');

test('dataset loader admits fx-rates.json and exposes Jordan USD→SGD budget evidence', async () => {
  const loaded = await loadDataset(sourceDirectory);
  assert.ok(loaded.contributingFiles.includes('fx-rates.json'));
  assert.ok(loaded.fxRates);
  const usdSgd = loaded.fxRates.rates.find(
    (rate) => rate.baseCurrency === 'USD' && rate.homeCurrency === 'SGD',
  );
  assert.ok(usdSgd);
  assert.equal(usdSgd.id, 'fx-usd-sgd-ait-budget');
  assert.equal(usdSgd.rate, 1.35);
  assert.equal(usdSgd.sourceId, 'src-syn-ait-event');
});

test('fx-rates.json changes the dataset content hash', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'northstar-dataset-fx-hash-'));
  try {
    await cp(sourceDirectory, directory, { recursive: true });
    const baseline = await loadDataset(directory);
    const fx = JSON.parse(await readFile(path.join(directory, 'fx-rates.json'), 'utf8')) as {
      rates: Array<{ rate: number }>;
    };
    fx.rates[0]!.rate = 1.36;
    await writeFile(path.join(directory, 'fx-rates.json'), JSON.stringify(fx), 'utf8');
    const changed = await loadDataset(directory);
    assert.notEqual(changed.contentHash, baseline.contentHash);
    assert.equal(changed.fxRates?.rates.find((rate) => rate.id === 'fx-usd-sgd-ait-budget')?.rate, 1.36);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('dataset loader rejects malformed fx-rates.json', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'northstar-dataset-fx-invalid-'));
  try {
    await cp(sourceDirectory, directory, { recursive: true });
    await writeFile(path.join(directory, 'fx-rates.json'), JSON.stringify({ rates: [{ id: 'x' }] }), 'utf8');
    await assert.rejects(() => loadDataset(directory), /fx-rates\.json does not match/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
