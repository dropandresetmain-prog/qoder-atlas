import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDataset } from '../src/app/demo/datasetLoader.ts';

const sourceDirectory = path.resolve('fixtures/programmes/ait-summit-2026');
const heroSourceDeclarationPath = path.resolve(
  'data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/original-destination-visit.json',
);
const sourceVisit = {
  id: 'ait-draft-09-singapore-destination',
  travellerDraftId: 'ait-draft-09',
  jurisdictionId: 'jur-sg',
  stayItemRef: { system: 'journey-item', value: 'ait-draft-09#2' },
  transitIntent: false,
} as const;
const sourceDeclaration = {
  sourceId: 'src-syn-ait-destination-visit',
  observedAt: '2026-08-25T09:00:00+00:00',
  visits: [sourceVisit],
};

async function withIntendedVisits(value: unknown, run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'northstar-intended-visits-'));
  try {
    await cp(sourceDirectory, directory, { recursive: true });
    await writeFile(path.join(directory, 'intended-visits.json'), JSON.stringify(value), 'utf8');
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('dataset loader admits an explicit source-owned landside visit without inferring all stays', async () => {
  const sourceInput = JSON.parse(await readFile(heroSourceDeclarationPath, 'utf8')) as unknown;
  await withIntendedVisits(sourceInput, async (directory) => {
    const loaded = await loadDataset(directory);
    assert.equal(loaded.intendedVisits?.sourceId, sourceDeclaration.sourceId);
    assert.deepEqual(loaded.intendedVisits?.visits, [sourceVisit]);
    assert.equal(loaded.intendedVisits?.visits.length, 1,
      'the one declared visit is distinct from the bundle-wide population of stays');
  });
});

test('dataset loader preserves bundles that do not declare source-owned visits', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'northstar-intended-visits-optional-'));
  try {
    await cp(sourceDirectory, directory, { recursive: true });
    await rm(path.join(directory, 'intended-visits.json'), { force: true });
    const loaded = await loadDataset(directory);
    assert.equal(loaded.intendedVisits, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('dataset loader rejects an intended visit that is not backed by its stated stay and jurisdiction', async () => {
  await withIntendedVisits({
    ...sourceDeclaration,
    visits: [{ ...sourceVisit, stayItemRef: { system: 'journey-item', value: 'ait-draft-09#1' } }],
  }, async (directory) => {
    await assert.rejects(() => loadDataset(directory), /stay item reference is not a STAY/);
  });
  await withIntendedVisits({
    ...sourceDeclaration,
    visits: [{ ...sourceVisit, jurisdictionId: 'jur-jp' }],
  }, async (directory) => {
    await assert.rejects(() => loadDataset(directory), /does not contain its declared stay place/);
  });
});
