import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { TargetRecoveryContextPreparer } from '../src/app/targetRecoveryContext.ts';
import { ReviewedEntryPolicySchema } from '../src/resolution/planning/reviewedEntryEvidence.ts';
import { emptyWorld } from './support/m6World.ts';

const NOW = '2030-06-01T12:00:00.000Z';

function fakePolicy() {
  const text = 'reviewed official entry policy';
  return {
    policy: ReviewedEntryPolicySchema.parse({
      id: randomUUID(), countryCode: 'JP', purposes: ['tourism'], nationalityCodes: ['SG'],
      effectiveWindow: { start: '2030-05-01T00:00:00.000Z', end: '2030-07-01T00:00:00.000Z' },
      maxEvidenceAgeSeconds: 3_600,
      sources: [{ sourceId: randomUUID(), url: 'https://authority.example/entry', publisher: 'Public authority', contentSha256: createHash('sha256').update(text).digest('hex') }],
      expression: { operator: 'PREDICATE', predicateId: 'journey.purpose_in', parameters: { purposes: ['tourism'] } },
    }),
    text,
  };
}

function fakePool(input: {
  workspaceId: string;
  connectionId: string;
  visitId: string;
  travellerId: string;
  journeyId: string;
  jurisdictionId: string;
  reviewerId: string;
}) {
  return {
    async query(sql: string, params: readonly unknown[]) {
      if (sql.includes('FROM external_connections')) return { rows: [{ id: input.connectionId }] };
      if (sql.includes('FROM external_records')) {
        const recordType = params[2];
        return { rows: recordType === 'SOURCE_INTENDED_VISIT'
          ? [{ subject_id: input.journeyId, subject_kind: 'JOURNEY' }]
          : [{ subject_id: input.travellerId, subject_kind: 'TRAVELLER' }] };
      }
      if (sql.includes('FROM traveller_booking_identities')) return { rows: [{ nationality: 'SG' }] };
      if (sql.includes('FROM domain_subjects')) return { rows: [
        { kind: 'JOURNEY', id: input.journeyId },
        { kind: 'JURISDICTION', id: input.jurisdictionId },
        { kind: 'PRINCIPAL', id: input.reviewerId },
      ] };
      throw new Error(`unexpected test query: ${sql}`);
    },
  };
}

test('existing visit preparation binds the configured passport and publishes scoped reviewed evidence', async () => {
  const workspaceId = randomUUID();
  const connectionId = randomUUID();
  const visitId = randomUUID();
  const travellerId = randomUUID();
  const journeyId = randomUUID();
  const jurisdictionId = randomUUID();
  const reviewerId = randomUUID();
  const credentialId = randomUUID();
  const credentialVersionId = randomUUID();
  const policy = fakePolicy();
  const world = emptyWorld({ workspaceId });
  world.travellers = [{ id: travellerId, revision: 1, lifecycleStatus: 'ACTIVE' }];
  world.journeys = [{ id: journeyId, revision: 4, tripId: randomUUID(), travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null }];
  world.jurisdictions = [{ id: jurisdictionId, revision: 1, name: 'Japan', regimeKind: 'COUNTRY' }];
  world.intendedVisits = [{ id: visitId, journeyId, jurisdictionId, purpose: 'tourism', intended: { start: '2030-06-20T00:00:00.000Z', end: '2030-06-22T00:00:00.000Z' }, transitIntent: false }];
  world.credentials = [{ id: credentialId, travellerId, kind: 'PASSPORT', issuerCountry: 'SG', currentVersionId: credentialVersionId }];
  world.credentialVersions = [{ id: credentialVersionId, credentialId, kind: 'PASSPORT', editionNumber: 1, issueDate: '2029-01-01', expiryDate: '2035-01-01', issuerStatus: 'VALID', physicallyAvailable: true, evidenceId: randomUUID(), issuingStateCode: 'SG', visaClass: null, permittedActivities: [], entriesAllowed: null, permittedStayDays: null }];
  world.credentialSelections = [{ id: randomUUID(), journeyId, credentialId, credentialVersionId, intendedVisitIds: [visitId] }];
  let writes = 0;
  const fakeUow = { async execute() { writes += 1; return { ok: true, value: {}, receipt: {} }; } };
  const preparer = new TargetRecoveryContextPreparer({
    pool: fakePool({ workspaceId, connectionId, visitId, travellerId, journeyId, jurisdictionId, reviewerId }) as never,
    workspaceId, actorPrincipalId: randomUUID(), uow: () => fakeUow as never,
    reviewerRef: { kind: 'PRINCIPAL', id: reviewerId }, hotelTransport: undefined as never,
    jurisdictionCountryCode: async () => 'JP',
    officialDocuments: { read: async () => ({ ok: true, data: { sourceId: policy.policy.sources[0]!.sourceId, publisher: policy.policy.sources[0]!.publisher, url: policy.policy.sources[0]!.url, observedAt: '2030-06-01T11:30:00.000Z', contentSha256: policy.policy.sources[0]!.contentSha256, text: policy.text }, meta: { providerId: 'test-reader', mode: 'REPLAY', requestedAt: NOW } }) },
    hotelPolicies: [], entryPolicies: [policy.policy], configuration: {
      sourceConnectionProviderKind: 'fixture-source', overnightTargets: [],
      passportSelections: [{ travellerSourceRef: 'SOURCE_TRAVELLER_DRAFT:traveller', credentialId, credentialVersionId, guestNationality: 'SG' }],
      existingVisitTargets: [{ visitSourceRef: 'SOURCE_INTENDED_VISIT:visit', visitId, entryPolicyId: policy.policy.id, countryCode: 'JP' }],
    },
  });
  const result = await preparer.prepare({ recoveryCaseId: randomUUID(), now: NOW, world, failing: [] });
  assert.equal(result.evidence?.length, 1);
  assert.equal(result.evidence?.[0]?.status, 'SUCCEEDED');
  assert.equal(result.evidence?.[0]?.provenance.providerId, 'official-documents');
  assert.match(result.evidence?.[0]?.summary ?? '', /existing visit/);
  const writesAfterFirstPreparation = writes;
  const retry = await preparer.prepare({ recoveryCaseId: randomUUID(), now: NOW, world, failing: [] });
  assert.equal(retry.evidence?.[0]?.status, 'SUCCEEDED');
  assert.equal(writes, writesAfterFirstPreparation, 'same source observations and visit scope do not republish on retry');
});

test('existing visit preparation leaves an explicit unavailable evidence record when the alias cannot resolve', async () => {
  const workspaceId = randomUUID();
  const fakePoolWithNoAlias = {
    async query(sql: string) {
      if (sql.includes('FROM external_connections')) return { rows: [{ id: randomUUID() }] };
      if (sql.includes('FROM external_records')) return { rows: [] };
      throw new Error(`unexpected test query: ${sql}`);
    },
  };
  const preparer = new TargetRecoveryContextPreparer({
    pool: fakePoolWithNoAlias as never, workspaceId, actorPrincipalId: randomUUID(), uow: () => undefined as never,
    reviewerRef: { kind: 'PRINCIPAL', id: randomUUID() }, hotelTransport: undefined as never,
    officialDocuments: undefined as never, hotelPolicies: [], entryPolicies: [], configuration: {
      sourceConnectionProviderKind: 'fixture-source', overnightTargets: [], passportSelections: [],
      existingVisitTargets: [{ visitSourceRef: 'SOURCE_INTENDED_VISIT:missing', visitId: randomUUID(), entryPolicyId: 'missing-policy', countryCode: 'JP' }],
    },
  });
  const result = await preparer.prepare({ recoveryCaseId: randomUUID(), now: NOW, world: emptyWorld({ workspaceId }), failing: [] });
  assert.equal(result.evidence?.[0]?.status, 'UNAVAILABLE');
  assert.match(result.evidence?.[0]?.uncertainty[0]?.code ?? '', /context_unavailable/);
});
