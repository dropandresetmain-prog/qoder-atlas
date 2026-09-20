import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDataset } from '../src/app/demo/datasetLoader.ts';

const sourceDirectory = path.resolve('fixtures/programmes/ait-summit-2026');

async function withDatasetRequirements(value: unknown, run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'northstar-journey-requirements-'));
  try {
    await cp(sourceDirectory, directory, { recursive: true });
    await writeFile(path.join(directory, 'journey-requirements.json'), JSON.stringify(value), 'utf8');
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('dataset loader admits typed journey requirements and keeps them optional', async () => {
  const loaded = await loadDataset(sourceDirectory);
  assert.equal(loaded.journeyRequirements?.sourceId, 'src-syn-ait-organiser-policy');
  assert.equal(loaded.journeyRequirements?.requirements[0]?.travellerDraftId, 'ait-draft-09');
  const overnight = loaded.journeyRequirements?.requirements.find((requirement) => requirement.kind === 'OVERNIGHT_ACCOMMODATION');
  assert.equal(overnight?.minimumGapHours, 8);
  const aligned = loaded.journeyRequirements?.requirements.find((requirement) => requirement.kind === 'STAY_ARRIVAL_DATE_ALIGNED');
  assert.deepEqual(aligned && {
    originalStayItemRef: aligned.originalStayItemRef,
    arrivalTransportItemRef: aligned.arrivalTransportItemRef,
  }, {
    originalStayItemRef: { system: 'journey-item', value: 'ait-draft-09#2' },
    arrivalTransportItemRef: { system: 'journey-item', value: 'ait-draft-09#1' },
  });
  assert.ok(!loaded.jurisdictions?.coverage?.topics.includes('ENTRY_REQUIREMENT'),
    'synthetic broad coverage must not certify newly proposed landside entry');
});

test('dataset loader preserves datasets without the optional requirement file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'northstar-journey-requirements-optional-'));
  try {
    await cp(sourceDirectory, directory, { recursive: true });
    await rm(path.join(directory, 'journey-requirements.json'), { force: true });
    const loaded = await loadDataset(directory);
    assert.equal(loaded.journeyRequirements, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('journey requirement loader rejects malformed and duplicate requirement ids', async () => {
  const base = JSON.parse(await readFile(path.join(sourceDirectory, 'journey-requirements.json'), 'utf8')) as Record<string, unknown>;
  await withDatasetRequirements({ ...base, observedAt: 'not-an-offset-instant' }, async (directory) => {
    await assert.rejects(() => loadDataset(directory), /journey-requirements\.json does not match/);
  });
  const requirement = (base.requirements as Array<Record<string, unknown>>)[0]!;
  await withDatasetRequirements({ ...base, requirements: [requirement, { ...requirement }] }, async (directory) => {
    await assert.rejects(() => loadDataset(directory), /duplicate journey requirement id/);
  });
});

test('journey requirement loader rejects unknown traveller draft before materialization', async () => {
  const base = JSON.parse(await readFile(path.join(sourceDirectory, 'journey-requirements.json'), 'utf8')) as Record<string, unknown>;
  const requirement = (base.requirements as Array<Record<string, unknown>>)[0]!;
  await withDatasetRequirements({ ...base, requirements: [{ ...requirement, travellerDraftId: 'unknown-draft' }] }, async (directory) => {
    await assert.rejects(() => loadDataset(directory), /references unknown traveller draft unknown-draft/);
  });
});

test('stay-arrival requirement loader rejects missing or wrongly typed source items', async () => {
  const base = JSON.parse(await readFile(path.join(sourceDirectory, 'journey-requirements.json'), 'utf8')) as {
    sourceId: string;
    observedAt: string;
    requirements: Record<string, unknown>[];
  };
  const aligned = base.requirements.find((requirement) => requirement.kind === 'STAY_ARRIVAL_DATE_ALIGNED')!;
  await withDatasetRequirements({
    ...base,
    requirements: base.requirements.map((requirement) => requirement === aligned
      ? { ...requirement, originalStayItemRef: { system: 'journey-item', value: 'ait-draft-09#99' } }
      : requirement),
  }, async (directory) => {
    await assert.rejects(() => loadDataset(directory), /must resolve to exactly one declared item/);
  });
  await withDatasetRequirements({
    ...base,
    requirements: base.requirements.map((requirement) => requirement === aligned
      ? { ...requirement, originalStayItemRef: { system: 'journey-item', value: 'ait-draft-09#1' } }
      : requirement),
  }, async (directory) => {
    await assert.rejects(() => loadDataset(directory), /original stay item is not a STAY/);
  });
});
