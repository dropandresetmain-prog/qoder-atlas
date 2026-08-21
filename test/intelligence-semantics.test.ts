/**
 * D2 — semantic interpretation + research tests (T-AI semantics/research).
 * Uses saved/scripted model outputs; no live model calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PreferenceSchema } from '../src/domain/preferences.ts';
import { UncertaintyRecordSchema } from '../src/domain/common.ts';
import { ModelStudioClient, ScriptedModelTransport } from '../src/intelligence/client.ts';
import {
  SemanticService,
  interpretResearchFindings,
  resolvePreferences,
} from '../src/intelligence/semantics.ts';
import {
  ModelStudioResearchSource,
  ResearchService,
  ScriptedResearchSource,
  toResearchFindings,
} from '../src/intelligence/research.ts';
import { RawResearchFindingsModelSchema, type RawResearchFindingModel } from '../src/intelligence/schemas.ts';
import type { ResearchFinding } from '../src/contracts/capabilities.ts';

const AT = '2026-09-14T09:00:00+09:00';
const here = dirname(fileURLToPath(import.meta.url));

function savedModelOutput(name: string): string {
  return readFileSync(join(here, 'fixtures', 'model-outputs', name), 'utf8');
}

function service(responses: string[], idFactory?: (prefix: string) => string): SemanticService {
  const transport = new ScriptedModelTransport(responses);
  const client = new ModelStudioClient({ apiKey: 'k', transport });
  return new SemanticService({ client, ...(idFactory !== undefined ? { idFactory } : {}) });
}

// ---------------------------------------------------------------------------
// Objective / instruction / consequence / uncertainty interpretation
// ---------------------------------------------------------------------------

test('semantics: objective interpretation accepts schema-valid saved output', async () => {
  const svc = service([
    '{"objective":"reach the venue before the session starts","explicit":true,"originKind":"EXPLICIT_INSTRUCTION","ambiguities":["exact session start not stated"],"insufficientEvidence":false}',
  ]);
  const result = await svc.interpretObjective('messy traveller message');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.explicit, true);
    assert.equal(result.value.originKind, 'EXPLICIT_INSTRUCTION');
    assert.equal(result.value.ambiguities.length, 1);
    assert.equal(result.value.insufficientEvidence, false);
  }
});

test('semantics: malformed model output fails closed (no fabrication, no throw)', async () => {
  const notJson = service(['this is not JSON']);
  const badNotJson = await notJson.interpretObjective('text');
  assert.equal(badNotJson.ok, false);
  if (!badNotJson.ok) assert.equal(badNotJson.error.category, 'INVALID_OUTPUT');

  const schemaViolation = service(['{"objective":"x","explicit":"yes"}']);
  const badSchema = await schemaViolation.interpretObjective('text');
  assert.equal(badSchema.ok, false);
  if (!badSchema.ok) assert.equal(badSchema.error.category, 'INVALID_OUTPUT');
});

test('semantics: insufficient evidence surfaces as such, not as invented objective', async () => {
  const svc = service(['{"explicit":false,"ambiguities":[],"insufficientEvidence":true}']);
  const result = await svc.interpretObjective('no objective anywhere in this text');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.objective, undefined);
    assert.equal(result.value.insufficientEvidence, true);
  }
});

test('semantics: explicit instructions extracted with none-marker support', async () => {
  const svc = service([
    '{"instructions":[{"statement":"book the earliest available flight","action":"book earliest flight","none":false}]}',
  ]);
  const result = await svc.interpretExplicitInstructions('please book the earliest available flight');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0]!.action, 'book earliest flight');
  }
});

test('semantics: consequence assessments retain their uncertainty', async () => {
  const svc = service([
    '{"assessments":[{"consequence":"hotel check-in may be missed","impact":"HIGH","confidence":0.6,"uncertainty":"hotel late-arrival policy unverified"}]}',
  ]);
  const result = await svc.assessConsequences('flight delayed past hotel cutoff');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value[0]!.impact, 'HIGH');
    assert.equal(result.value[0]!.uncertainty, 'hotel late-arrival policy unverified');
  }
});

test('semantics: identified uncertainties become validated UncertaintyRecords', async () => {
  let counter = 0;
  const svc = service(
    ['{"uncertainties":[{"statement":"fare change cost unknown","severity":"HIGH"},{"statement":"traffic conditions unknown"}]}'],
    (prefix) => `${prefix}_${++counter}`,
  );
  const result = await svc.identifyUncertainties('disruption context');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 2);
    for (const record of result.value) {
      UncertaintyRecordSchema.parse(record);
    }
    assert.equal(result.value[0]!.id, 'unc_1');
    assert.equal(result.value[0]!.severity, 'HIGH');
    assert.equal(result.value[1]!.severity, 'MEDIUM', 'severity defaults, never guessed');
  }
});

// ---------------------------------------------------------------------------
// Preference precedence: explicit instruction > explicit profile > latent
// ---------------------------------------------------------------------------

test('semantics: explicit instruction outranks latent preference and both validate', async () => {
  const candidates = JSON.parse(savedModelOutput('latent-preference-candidates.json')) as {
    candidates: Parameters<typeof resolvePreferences>[0];
  };
  const resolved = resolvePreferences(candidates.candidates, {
    travellerId: 'trv_1',
    sourceId: 'src_message',
    issuedAt: AT,
    explicitStatements: ['traveller explicitly asked for an aisle seat'],
  });

  // Explicit instruction dominates every latent inference.
  assert.equal(resolved.rankedPreferences[0]!.origin.kind, 'EXPLICIT_INSTRUCTION');
  const firstLatent = resolved.rankedPreferences.find((p) => p.origin.kind === 'LATENT_INFERRED');
  assert.ok(firstLatent !== undefined);
  assert.ok(
    resolved.rankedPreferences.indexOf(resolved.rankedPreferences[0]!) <
      resolved.rankedPreferences.indexOf(firstLatent),
  );
  for (const preference of resolved.rankedPreferences) {
    PreferenceSchema.parse(preference); // frozen preference shape must hold
  }
});

test('semantics: accessibility and legal/entry are requirements, never latent preferences', async () => {
  const candidates = JSON.parse(savedModelOutput('latent-preference-candidates.json')) as {
    candidates: Parameters<typeof resolvePreferences>[0];
  };
  const resolved = resolvePreferences(candidates.candidates, {
    travellerId: 'trv_1',
    sourceId: 'src_profile',
    issuedAt: AT,
  });

  assert.ok(resolved.requirementStatements.includes('traveller requires step-free transfers'));
  assert.ok(resolved.requirementStatements.includes('entry requires a valid visa for the destination'));
  for (const preference of resolved.rankedPreferences) {
    assert.ok(!preference.statement.includes('step-free'), 'accessibility leaked into preferences');
    assert.ok(!preference.statement.includes('visa'), 'legal/entry leaked into preferences');
  }
});

test('semantics: latent preference conflicting with an explicit statement is recorded', async () => {
  const candidates = JSON.parse(savedModelOutput('latent-preference-candidates.json')) as {
    candidates: Parameters<typeof resolvePreferences>[0];
  };
  const resolved = resolvePreferences(candidates.candidates, {
    travellerId: 'trv_1',
    sourceId: 'src_profile',
    issuedAt: AT,
    explicitStatements: ['traveller explicitly asked for an aisle seat'],
  });
  assert.ok(resolved.conflicts.includes('traveller likely prefers the window seat'));
});

test('semantics: latent inferences stay soft (confidence/evidence preserved, never constraints)', async () => {
  const candidates = JSON.parse(savedModelOutput('latent-preference-candidates.json')) as {
    candidates: Parameters<typeof resolvePreferences>[0];
  };
  const resolved = resolvePreferences(candidates.candidates, { travellerId: 'trv_1', sourceId: 'src_profile', issuedAt: AT });
  const latent = resolved.rankedPreferences.find((p) => p.origin.kind === 'LATENT_INFERRED');
  assert.ok(latent !== undefined);
  assert.equal(latent.origin.kind, 'LATENT_INFERRED');
  if (latent.origin.kind === 'LATENT_INFERRED') {
    assert.ok(latent.origin.evidence !== undefined);
    assert.ok(latent.origin.confidence !== undefined && latent.origin.confidence <= 1);
  }
});

// ---------------------------------------------------------------------------
// Research interpretation: legal facts need authoritative sourcing
// ---------------------------------------------------------------------------

function savedResearchFindings(): RawResearchFindingModel[] {
  const raw = JSON.parse(savedModelOutput('research-entry-findings.json')) as unknown;
  return RawResearchFindingsModelSchema.parse(raw).findings;
}

test('research: legal facts require authoritative sourcing; estimates keep uncertainty', () => {
  const findings = savedResearchFindings();
  const interpretation = interpretResearchFindings(findings);
  const [sourcedLegal, unsourcedLegal, sourcedEstimate] = findings as [
    RawResearchFindingModel,
    RawResearchFindingModel,
    RawResearchFindingModel,
    RawResearchFindingModel,
  ];

  // Authoritative + sourced legal fact accepted.
  assert.ok(interpretation.accepted.includes(sourcedLegal.statement));
  // Unsourced/asserted legal claim excluded and surfaced as uncertainty.
  assert.ok(interpretation.excludedStatements.includes(unsourcedLegal.statement));
  assert.ok(
    interpretation.uncertainties.some((u) => u.includes(unsourcedLegal.statement)),
    'excluded legal claim must remain visible as uncertainty',
  );
  // Operational estimates accepted with uncertainty retained.
  assert.ok(interpretation.accepted.includes(sourcedEstimate.statement));
  assert.ok(interpretation.uncertainties.includes('queue times vary with arrival banks'));
  assert.deepEqual(
    interpretation.decisions.map((d) => d.accepted),
    [true, false, true, true],
  );
});

test('research: normalization downgrades unsourced legal claims instead of accepting them', () => {
  const normalized = toResearchFindings(savedResearchFindings());
  assert.equal(normalized.length, 4);
  const [sourcedLegal, unsourcedLegal, , unsourcedEstimate] = normalized as [
    ResearchFinding,
    ResearchFinding,
    ResearchFinding,
    ResearchFinding,
  ];

  assert.equal(sourcedLegal.authority, 'AUTHORITATIVE');
  assert.equal(sourcedLegal.sourceUris.length, 1);

  assert.equal(unsourcedLegal.authority, 'INFERRED', 'unsourced legal claim must not stay authoritative');
  assert.ok(unsourcedLegal.uncertainty?.includes('authoritative sourcing'));

  assert.equal(unsourcedEstimate.kind, 'OPERATIONAL_ESTIMATE');
  assert.ok(unsourcedEstimate.uncertainty !== undefined, 'estimate without evidence notes the gap');
});

// ---------------------------------------------------------------------------
// ResearchCapability seam: envelope, replay, unavailable paths
// ---------------------------------------------------------------------------

test('research capability: replay source returns envelope with normalized findings', async () => {
  const findings = savedResearchFindings();
  const source = new ScriptedResearchSource({ entry: [{ ok: true, findings, insufficientEvidence: false }] });
  const capability = new ResearchService({ source, now: () => AT });

  assert.equal(capability.descriptor.family, 'RESEARCH');
  assert.equal(capability.descriptor.mode, 'REPLAY');
  assert.equal(capability.descriptor.maxSideEffectLevel, 'READ_ONLY');
  assert.deepEqual(capability.descriptor.supportedOperations, [
    'research.entry_requirements',
    'research.local_context',
  ]);

  const result = await capability.researchEntryRequirements({
    destinationCountryCode: 'XX',
    nationalityCodes: ['YY'],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.findings.length, 4);
    assert.equal(result.meta.mode, 'REPLAY');
    assert.equal(result.meta.requestedAt, AT);
  }
});

test('research capability: backend failure is a structured envelope, not a crash', async () => {
  const source = new ScriptedResearchSource({
    entry: [{ ok: false, error: { category: 'NOT_CONFIGURED', code: 'research_unconfigured', message: 'no research backend configured' } }],
    local: [{ ok: false, error: { category: 'TIMEOUT', code: 'research_timeout', message: 'research timed out', retryable: true } }],
  });
  const capability = new ResearchService({ source, now: () => AT });

  const entry = await capability.researchEntryRequirements({ destinationCountryCode: 'XX', nationalityCodes: ['YY'] });
  assert.equal(entry.ok, false);
  if (!entry.ok) assert.equal(entry.error.category, 'NOT_CONFIGURED');

  const local = await capability.researchLocalContext({ topic: 'ground transport' });
  assert.equal(local.ok, false);
  if (!local.ok) {
    assert.equal(local.error.category, 'TIMEOUT');
    assert.equal(local.error.retryable, true);
  }
});

test('research capability: model-backed source without credentials fails structured', async () => {
  const source = new ModelStudioResearchSource(new ModelStudioClient({}));
  assert.equal(source.mode, 'LIVE');
  const entry = await source.entryRequirements({ destinationCountryCode: 'XX', nationalityCodes: ['YY'] });
  assert.equal(entry.ok, false);
  if (!entry.ok) assert.equal(entry.error.category, 'NOT_CONFIGURED');
});

test('research capability: model-backed source validates saved findings through the same path', async () => {
  const transport = new ScriptedModelTransport([savedModelOutput('research-entry-findings.json')]);
  const client = new ModelStudioClient({ apiKey: 'k', transport });
  const source = new ModelStudioResearchSource(client);
  const result = await source.entryRequirements({ destinationCountryCode: 'XX', nationalityCodes: ['YY'] });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.findings.length, 4);
    assert.equal(result.insufficientEvidence, false);
  }
});

test('research capability: malformed research output fails closed', async () => {
  const transport = new ScriptedModelTransport(['{"findings":[{"statement":"x"}]}']);
  const client = new ModelStudioClient({ apiKey: 'k', transport });
  const source = new ModelStudioResearchSource(client);
  const result = await source.localContext({ topic: 'anything' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, 'INVALID_OUTPUT');
});
