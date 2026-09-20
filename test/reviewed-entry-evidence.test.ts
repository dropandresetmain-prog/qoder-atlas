import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ReviewedEntryPolicySchema,
  verifyReviewedEntryEvidence,
  type ReviewedEntryEvidenceContext,
  type ReviewedEntryPolicy,
} from '../src/resolution/planning/reviewedEntryEvidence.ts';
import type { OfficialDocumentEvidence } from '../src/providers/research/officialDocuments.ts';

const NOW = '2030-06-01T12:00:00.000Z';
const SOURCE = {
  sourceId: 'entry-source',
  url: 'https://authority.example/entry',
  publisher: 'Public authority',
  contentSha256: 'a'.repeat(64),
};

function policy(over: Partial<ReviewedEntryPolicy> = {}): ReviewedEntryPolicy {
  return ReviewedEntryPolicySchema.parse({
    id: 'policy-entry-1',
    countryCode: 'JP',
    purposes: ['tourism'],
    nationalityCodes: ['SG'],
    effectiveWindow: { start: '2030-05-01T00:00:00.000Z', end: '2030-07-01T00:00:00.000Z' },
    maxEvidenceAgeSeconds: 3_600,
    sources: [SOURCE],
    expression: { operator: 'PREDICATE', predicateId: 'journey.purpose_in', parameters: { purposes: ['tourism'] } },
    ...over,
  });
}

function context(over: Partial<ReviewedEntryEvidenceContext> = {}): ReviewedEntryEvidenceContext {
  return {
    journeyId: 'journey-1',
    visitId: 'visit-1',
    jurisdictionId: 'jurisdiction-jp',
    countryCode: 'JP',
    purpose: 'tourism',
    nationalityCode: 'SG',
    visitWindow: { start: '2030-06-20T00:00:00.000Z', end: '2030-06-22T00:00:00.000Z' },
    ...over,
  };
}

function document(over: Partial<OfficialDocumentEvidence> = {}): OfficialDocumentEvidence {
  return {
    sourceId: SOURCE.sourceId,
    publisher: SOURCE.publisher,
    url: SOURCE.url,
    observedAt: '2030-06-01T11:30:00.000Z',
    contentSha256: SOURCE.contentSha256,
    text: 'sanitized official text',
    ...over,
  };
}

function verify(over: {
  policy?: ReviewedEntryPolicy;
  context?: ReviewedEntryEvidenceContext;
  documents?: readonly OfficialDocumentEvidence[];
  now?: string;
} = {}) {
  return verifyReviewedEntryEvidence({
    policy: over.policy ?? policy(),
    actualOfficialDocumentEvidence: over.documents ?? [document()],
    now: over.now ?? NOW,
    context: over.context ?? context(),
  });
}

test('reviewed entry evidence: preserves exact source provenance and bounded expiry', () => {
  const input = { policy: policy(), context: context(), documents: [document()] };
  const before = structuredClone(input);
  const result = verify({ ...input });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.documents, input.documents);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0]?.contentSha256, SOURCE.contentSha256);
  assert.equal(result.expiresAt, '2030-06-01T12:30:00.000Z');
  assert.deepEqual(input, before, 'verification does not mutate caller-owned policy or documents');

  result.policy.sources[0]!.publisher = 'mutated result only';
  assert.equal(input.policy.sources[0]!.publisher, SOURCE.publisher);
});

test('reviewed entry evidence: changed hash, URL or publisher refuses provenance', () => {
  for (const changed of [
    { contentSha256: 'b'.repeat(64) },
    { url: 'https://authority.example/changed' },
    { publisher: 'Different authority' },
  ]) {
    const result = verify({ documents: [document(changed)] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'source_provenance_mismatch');
  }
});

test('reviewed entry evidence: stale and future observations remain unknown evidence', () => {
  const stale = verify({ documents: [document({ observedAt: '2030-06-01T11:00:00.000Z' })] });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.reason, 'stale_source_evidence');

  const future = verify({ documents: [document({ observedAt: '2030-06-01T12:00:01.000Z' })] });
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.reason, 'future_source_evidence');
});

test('reviewed entry evidence: country, purpose, nationality and visit window are all scoped', () => {
  for (const changed of [
    { countryCode: 'SG' },
    { purpose: 'study' },
    { nationalityCode: 'JP' },
    { visitWindow: { start: '2030-07-01T00:00:00.000Z', end: '2030-07-02T00:00:00.000Z' } },
  ]) {
    const result = verify({ context: context(changed) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'scope_mismatch');
  }
});

test('reviewed entry evidence: duplicate policy sources and duplicate observations refuse', () => {
  const duplicatePolicy = {
    ...policy(),
    sources: [SOURCE, { ...SOURCE }],
  } as ReviewedEntryPolicy;
  const duplicatePolicyResult = verify({ policy: duplicatePolicy });
  assert.equal(duplicatePolicyResult.ok, false);
  if (!duplicatePolicyResult.ok) assert.equal(duplicatePolicyResult.reason, 'duplicate_policy_source');

  const duplicateEvidenceResult = verify({ documents: [document(), document()] });
  assert.equal(duplicateEvidenceResult.ok, false);
  if (!duplicateEvidenceResult.ok) assert.equal(duplicateEvidenceResult.reason, 'duplicate_source_evidence');
});

test('reviewed entry evidence: unknown predicate cannot become a reviewed policy', () => {
  const unknown = {
    ...policy(),
    expression: { operator: 'PREDICATE', predicateId: 'made.up.predicate', parameters: {} },
  } as ReviewedEntryPolicy;
  const result = verify({ policy: unknown });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'unsupported_predicate');
  assert.equal(ReviewedEntryPolicySchema.safeParse(unknown).success, false);
});
