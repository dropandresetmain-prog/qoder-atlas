/**
 * Lane B evidence — ingestion contract tests (B1/B2/B3).
 *
 * Covers: deterministic structured ingestion, malformed source handling,
 * ambiguity -> uncertainty, explicit > latent precedence, accessibility as
 * hard requirement, authoritative-source gate for legal/entry facts,
 * provenance survival, no direct Trip mutation, and anti-hardcoding.
 * Test data is deliberately scenario-neutral.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createSourceIngestionCapability,
  RecordedExtractionClient,
  SOURCE_AUTHORITY_BY_KIND,
  resolvePreferenceConflicts,
  type IngestionDependencies,
} from '../src/ingest/index.ts';
import type { CapabilityResult } from '../src/contracts/envelope.ts';
import type { IngestionOutcome, SourceInput } from '../src/contracts/capabilities.ts';
import type { SourceRepository } from '../src/contracts/repositories.ts';
import {
  EntityIdSchema,
  type EntityId,
  type SourceKind,
  type SourceRecord,
} from '../src/domain/common.ts';
import { PreferenceSchema, type Preference } from '../src/domain/preferences.ts';
import { TransportLegSchema, StaySchema } from '../src/domain/elements.ts';
import type { MutationProposal } from '../src/operational/mutation.ts';
import type { TripSignal } from '../src/operational/signal.ts';

const NOW = '2026-08-01T00:00:00.000Z';
const fixedClock = () => NOW;

function okData(result: CapabilityResult<IngestionOutcome>): IngestionOutcome {
  assert.equal(result.ok, true, 'expected ok capability result');
  return result.ok ? result.data : assert.fail('unreachable');
}

function deps(overrides: Partial<IngestionDependencies> = {}): IngestionDependencies {
  return { clock: fixedClock, ...overrides };
}

function entityProposals(outcome: IngestionOutcome, entityType: string): MutationProposal[] {
  return outcome.proposals.filter((p) =>
    p.operations.some((op) => op.op === 'UPSERT_ENTITY' && op.entityType === entityType),
  );
}

function entityData(outcome: IngestionOutcome, entityType: string): Record<string, unknown> {
  const proposal = entityProposals(outcome, entityType)[0];
  assert.ok(proposal, `expected an UPSERT_ENTITY proposal for ${entityType}`);
  const op = proposal!.operations.find((o) => o.op === 'UPSERT_ENTITY')!;
  return op.op === 'UPSERT_ENTITY' ? (op.data as Record<string, unknown>) : assert.fail('unreachable');
}

class FakeSourceRepository implements SourceRepository {
  readonly records = new Map<string, SourceRecord>();
  readonly contents = new Map<string, string>();
  async saveSource(source: SourceRecord): Promise<void> {
    this.records.set(source.id, source);
  }
  async getSource(sourceId: EntityId): Promise<SourceRecord | undefined> {
    return this.records.get(sourceId);
  }
  async listSources(kind?: SourceKind): Promise<SourceRecord[]> {
    return [...this.records.values()].filter((r) => kind === undefined || r.kind === kind);
  }
  async saveSourceContent(sourceId: EntityId, content: string): Promise<void> {
    this.contents.set(sourceId, content);
  }
  async getSourceContent(sourceId: EntityId): Promise<string | undefined> {
    return this.contents.get(sourceId);
  }
}

// ---------------------------------------------------------------------------
// B1 — source identity, authority, provenance
// ---------------------------------------------------------------------------

test('B1: authority is derived deterministically from source kind', async () => {
  assert.equal(SOURCE_AUTHORITY_BY_KIND['POLICY_DOCUMENT'], 'AUTHORITATIVE');
  assert.equal(SOURCE_AUTHORITY_BY_KIND['INSURANCE_DOCUMENT'], 'AUTHORITATIVE');
  assert.equal(SOURCE_AUTHORITY_BY_KIND['BOOKING_CONFIRMATION'], 'CONNECTED');
  assert.equal(SOURCE_AUTHORITY_BY_KIND['PROVIDER_STATE'], 'CONNECTED');
  assert.equal(SOURCE_AUTHORITY_BY_KIND['WEBPAGE'], 'ASSERTED');
  assert.equal(SOURCE_AUTHORITY_BY_KIND['EMAIL'], 'ASSERTED');
  assert.equal(SOURCE_AUTHORITY_BY_KIND['RESEARCH'], 'ASSERTED');
  assert.equal(SOURCE_AUTHORITY_BY_KIND['MANUAL'], 'ASSERTED');

  const capability = createSourceIngestionCapability(deps());
  const result = await capability.ingest({
    kind: 'POLICY_DOCUMENT',
    title: 'Organisation travel policy',
    structured: {
      schema: 'RULE_SET',
      payload: {
        kind: 'ORGANISATION',
        name: 'Organisation travel policy',
        rules: [
          {
            kind: 'APPROVAL_ABOVE_SPEND',
            threshold: { amount: 500, currency: 'USD' },
            approver: 'ORGANISATION_APPROVER',
          },
        ],
      },
    },
  });
  const outcome = okData(result);
  const ruleSet = outcome.ruleSets[0];
  assert.ok(ruleSet);
  assert.equal(ruleSet!.sourceId, outcome.sourceId);
  assert.ok(ruleSet!.rules.every((r) => r.sourceId === outcome.sourceId));
});

test('B1: source identity is deterministic, persisted, and raw content stays separate', async () => {
  const repository = new FakeSourceRepository();
  const capability = createSourceIngestionCapability(deps({ sourceRepository: repository }));
  const input: SourceInput = {
    kind: 'WEBPAGE',
    title: 'Event overview',
    uri: 'https://example.test/event',
    content: 'An event happens somewhere.',
  };
  const first = okData(await capability.ingest(input));
  const second = okData(await capability.ingest(input));
  assert.equal(first.sourceId, second.sourceId, 're-ingesting identical input must be idempotent');

  const record = repository.records.get(first.sourceId);
  assert.ok(record, 'source record persisted');
  assert.equal(record!.authority, 'ASSERTED');
  assert.equal(record!.retrievedAt, NOW);
  assert.equal(repository.contents.get(first.sourceId), input.content, 'raw content stored separately');
  // Ingestion emitted uncertainty (no extractor wired) but no trip-state writes.
  assert.ok(first.uncertainties.length > 0);
});

test('B1: a supplied sourceId reuses the existing record instead of creating one', async () => {
  const repository = new FakeSourceRepository();
  const existing: SourceRecord = {
    id: 'src-existing-1',
    kind: 'EMAIL',
    authority: 'ASSERTED',
    retrievedAt: '2026-07-01T00:00:00.000Z',
  };
  repository.records.set(existing.id, existing);
  const capability = createSourceIngestionCapability(deps({ sourceRepository: repository }));
  const outcome = okData(
    await capability.ingest({ sourceId: existing.id, kind: 'EMAIL', content: 'Some email text.' }),
  );
  assert.equal(outcome.sourceId, existing.id);
  assert.equal(repository.records.size, 1, 'no new source record created');
});

test('B1: malformed source input is an INVALID_REQUEST error envelope, not a crash', async () => {
  const capability = createSourceIngestionCapability(deps());
  const result = await capability.ingest({ kind: 'NOT_A_KIND' } as unknown as SourceInput);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'INVALID_REQUEST');
  }
});

test('B1: a source with no content and no structured payload becomes uncertainty', async () => {
  const capability = createSourceIngestionCapability(deps());
  const outcome = okData(await capability.ingest({ kind: 'DOCUMENT', title: 'Empty attachment' }));
  assert.equal(outcome.proposals.length, 0);
  assert.equal(outcome.signals.length, 0);
  assert.ok(outcome.uncertainties.some((u) => u.statement.includes('neither content nor a structured payload')));
});

// ---------------------------------------------------------------------------
// B2 — deterministic structured ingestion (no model involved)
// ---------------------------------------------------------------------------

test('B2: structured booking confirmation maps deterministically to a transport leg', async () => {
  const capability = createSourceIngestionCapability(
    deps({ context: { tripId: 'trip_1', travellerId: 'trv_1' } }),
  );
  const outcome = okData(
    await capability.ingest({
      kind: 'BOOKING_CONFIRMATION',
      title: 'Flight confirmation',
      structured: {
        carrierCode: 'XX',
        flightNumber: 'XX100',
        origin: { code: 'AAA', name: 'Alpha International', timezone: 'Etc/GMT-1' },
        destination: { code: 'BBB', name: 'Bravo International', timezone: 'Etc/GMT-9' },
        departure: '2026-09-10T08:00:00+01:00',
        arrival: '2026-09-10T18:30:00+09:00',
        bookingReference: 'REF-123',
        bookingSystem: 'booking-system-one',
        bookingStatus: 'CONFIRMED',
        passengerName: 'Test Traveller',
      },
    }),
  );

  // No extractor was configured, yet ingestion succeeded: deterministic path.
  const leg = TransportLegSchema.parse(entityData(outcome, 'TRIP_ELEMENT'));
  assert.equal(leg.reservationState, 'CONFIRMED');
  assert.equal(leg.data.mode, 'FLIGHT');
  assert.equal(leg.data.bookingRef?.reference, 'REF-123');
  assert.equal(leg.data.bookingRef?.system, 'booking-system-one');
  assert.equal(leg.data.scheduledDeparture?.value, '2026-09-10T08:00:00+01:00');
  // Provenance survives: facts carry the source id and its authority.
  assert.equal(leg.data.scheduledDeparture?.sourceId, outcome.sourceId);
  assert.equal(leg.data.scheduledDeparture?.authority, 'CONNECTED');
  assert.equal(leg.data.scheduledArrival?.authority, 'CONNECTED');

  const airports = entityProposals(outcome, 'PLACE');
  assert.equal(airports.length, 2);
  const proposal = outcome.proposals.find((p) =>
    p.operations.some((op) => op.op === 'UPSERT_ENTITY' && op.entityType === 'TRIP_ELEMENT'),
  );
  assert.equal(proposal?.origin, 'SYSTEM', 'structured BOOKING_CONFIRMATION maps with SYSTEM origin');
  assert.equal(proposal?.sourceId, outcome.sourceId);
});

test('B2: structured stay confirmation produces a stay element linked to supplier policy', async () => {
  const capability = createSourceIngestionCapability(deps({ context: { tripId: 'trip_1' } }));
  const outcome = okData(
    await capability.ingest({
      kind: 'BOOKING_CONFIRMATION',
      title: 'Hotel confirmation',
      structured: {
        schema: 'STAY_BOOKING',
        payload: {
          propertyName: 'Hotel Example',
          timezone: 'Etc/GMT-9',
          checkIn: '2026-09-10T15:00:00+09:00',
          checkOut: '2026-09-13T11:00:00+09:00',
          bookingReference: 'HTL-1',
          policyRules: [
            { kind: 'NO_SHOW_CUTOFF', cutoffAt: '2026-09-10T18:00:00+09:00', consequence: 'Release room' },
            { kind: 'CANCELLATION_TERMS', refundable: true, refundDeadline: '2026-09-08T00:00:00+09:00' },
          ],
        },
      },
    }),
  );
  const stay = StaySchema.parse(entityData(outcome, 'TRIP_ELEMENT'));
  assert.equal(stay.data.checkIn.value, '2026-09-10T15:00:00+09:00');
  assert.equal(stay.data.checkIn.sourceId, outcome.sourceId);
  assert.equal(stay.data.policyRuleSetIds.length, 1);
  const ruleSet = outcome.ruleSets[0];
  assert.ok(ruleSet, 'supplier policy rule set emitted');
  assert.equal(ruleSet!.kind, 'SUPPLIER');
  assert.equal(ruleSet!.rules.length, 2);
  assert.deepEqual(stay.data.policyRuleSetIds, [ruleSet!.id]);
});

test('B2: structured provider flight state becomes a deterministic cancellation signal', async () => {
  const capability = createSourceIngestionCapability(deps({ context: { tripId: 'trip_1' } }));
  const outcome = okData(
    await capability.ingest({
      kind: 'PROVIDER_STATE',
      structured: {
        status: 'CANCELLED',
        flightNumber: 'XX100',
        bookingReference: 'REF-123',
        occurredAt: '2026-09-10T05:00:00.000Z',
      },
    }),
  );
  assert.equal(outcome.signals.length, 1);
  const signal = outcome.signals[0]!;
  assert.equal(signal.kind, 'FLIGHT_CANCELLATION');
  assert.equal(signal.authority, 'CONNECTED');
  assert.equal(signal.tripId, 'trip_1');
  assert.equal(signal.occurredAt, '2026-09-10T05:00:00.000Z');
  assert.equal(outcome.proposals.length, 0, 'provider state emits a signal, not direct mutations');
});

test('B2: unknown provider state payload becomes uncertainty, never guessed output', async () => {
  const capability = createSourceIngestionCapability(deps());
  const outcome = okData(
    await capability.ingest({ kind: 'PROVIDER_STATE', structured: { shape: 'unrecognised' } }),
  );
  assert.equal(outcome.signals.length, 0);
  assert.ok(outcome.uncertainties.some((u) => u.severity === 'HIGH'));
});

test('B2: invalid policy rule drafts become uncertainty, valid drafts survive', async () => {
  const capability = createSourceIngestionCapability(deps());
  const outcome = okData(
    await capability.ingest({
      kind: 'POLICY_DOCUMENT',
      title: 'Travel policy',
      structured: {
        schema: 'RULE_SET',
        payload: {
          kind: 'ORGANISATION',
          name: 'Travel policy',
          rules: [
            { kind: 'SPEND_LIMIT', maxAmount: { amount: 1200, currency: 'USD' } },
            { kind: 'TIME_WINDOW', notARuleField: true },
          ],
        },
      },
    }),
  );
  const ruleSet = outcome.ruleSets[0];
  assert.ok(ruleSet, 'rule set with the valid draft is still emitted');
  assert.equal(ruleSet!.rules.length, 1);
  assert.equal(ruleSet!.rules[0]!.kind, 'SPEND_LIMIT');
  assert.ok(
    outcome.uncertainties.some((u) => u.statement.includes('failed validation and was not turned into a rule')),
  );
});

test('B2: insurance document becomes an INSURANCE rule set with coverage data', async () => {
  const capability = createSourceIngestionCapability(deps());
  const outcome = okData(
    await capability.ingest({
      kind: 'INSURANCE_DOCUMENT',
      title: 'Trip protection',
      structured: {
        schema: 'INSURANCE',
        payload: {
          name: 'Trip protection plan',
          coveredReasons: ['medical emergency', 'trip cancellation'],
          excess: { amount: 100, currency: 'USD' },
        },
      },
    }),
  );
  const ruleSet = outcome.ruleSets[0];
  assert.ok(ruleSet);
  assert.equal(ruleSet!.kind, 'INSURANCE');
  const rule = ruleSet!.rules[0]!;
  assert.equal(rule.kind, 'INSURANCE_COVERAGE');
  assert.equal(rule.sourceId, outcome.sourceId);
  if (rule.kind === 'INSURANCE_COVERAGE') {
    assert.deepEqual(rule.coveredReasons, ['medical emergency', 'trip cancellation']);
    assert.deepEqual(rule.excess, { amount: 100, currency: 'USD' });
  }
});

// ---------------------------------------------------------------------------
// B2 — semantic path through the model-neutral seam
// ---------------------------------------------------------------------------

test('B2: anchor event webpage extraction produces event/place/org/engagement with provenance', async () => {
  const client = new RecordedExtractionClient([
    {
      task: 'ANCHOR_EVENT',
      output: {
        name: 'Conference One',
        kind: 'CONFERENCE',
        venue: { name: 'Venue Hall', timezone: 'Etc/GMT-9' },
        startsAt: '2026-09-14T09:00:00+09:00',
        endsAt: '2026-09-16T18:00:00+09:00',
        organiserName: 'Organiser Group',
        instructions: 'Speakers must arrive one day early.',
        policyRules: [
          { kind: 'TIME_WINDOW', windowStart: '2026-09-14T08:00:00+09:00', windowEnd: '2026-09-16T20:00:00+09:00' },
        ],
        engagements: [{ title: 'Keynote', startsAt: '2026-09-14T10:00:00+09:00', role: 'speaker' }],
      },
    },
  ]);
  const capability = createSourceIngestionCapability(
    deps({ extractionClient: client, context: { tripId: 'trip_1' } }),
  );
  const outcome = okData(
    await capability.ingest({ kind: 'WEBPAGE', title: 'Conference page', content: 'conference programme text' }),
  );

  const anchor = entityData(outcome, 'ANCHOR_EVENT');
  assert.equal(anchor['name'], 'Conference One');
  assert.deepEqual(anchor['sourceIds'], [outcome.sourceId]);
  assert.equal((anchor['instructions'] as { sourceId: string }).sourceId, outcome.sourceId);

  assert.equal(entityProposals(outcome, 'PLACE').length, 1);
  const org = entityData(outcome, 'ORGANISATION');
  assert.equal(org['name'], 'Organiser Group');

  const engagement = entityData(outcome, 'TRIP_ELEMENT');
  assert.equal(engagement['elementKind'], 'ENGAGEMENT');
  assert.equal(engagement['tripId'], 'trip_1');

  const ruleSet = outcome.ruleSets[0];
  assert.ok(ruleSet);
  assert.equal(ruleSet!.kind, 'EVENT');
  assert.equal(ruleSet!.ownerOrganisationId, org['id']);

  // Extraction ran through the AI seam: proposals carry AI origin.
  assert.ok(outcome.proposals.every((p) => p.origin === 'AI'));
});

test('B2: ambiguous anchor event (missing end time) becomes uncertainty, not a fabricated window', async () => {
  const client = new RecordedExtractionClient([
    {
      task: 'ANCHOR_EVENT',
      output: { name: 'Conference One', startsAt: '2026-09-14T09:00:00+09:00' },
    },
  ]);
  const capability = createSourceIngestionCapability(deps({ extractionClient: client }));
  const outcome = okData(await capability.ingest({ kind: 'WEBPAGE', content: 'partial event page' }));
  assert.equal(entityProposals(outcome, 'ANCHOR_EVENT').length, 0);
  assert.ok(outcome.uncertainties.some((u) => u.severity === 'HIGH' && u.statement.includes('time window')));
});

test('B2: malformed model output fails safely as uncertainty (NFR-04)', async () => {
  const client = new RecordedExtractionClient([
    { task: 'ANCHOR_EVENT', output: { totally: ['wrong', 'shape'] } },
  ]);
  const capability = createSourceIngestionCapability(deps({ extractionClient: client }));
  const outcome = okData(await capability.ingest({ kind: 'WEBPAGE', content: 'event page text' }));
  assert.equal(outcome.proposals.length, 0);
  assert.equal(outcome.ruleSets.length, 0);
  assert.ok(
    outcome.uncertainties.some((u) => u.severity === 'HIGH' && u.statement.includes('failed schema validation')),
  );
});

test('B2: unrecognized content produces uncertainty, never invented entities', async () => {
  const client = new RecordedExtractionClient([]); // no recordings match
  const capability = createSourceIngestionCapability(deps({ extractionClient: client }));
  const outcome = okData(await capability.ingest({ kind: 'DOCUMENT', content: 'unstructured rambling text' }));
  assert.equal(outcome.proposals.length, 0);
  assert.ok(outcome.uncertainties.some((u) => u.statement.includes('No recognized structured content')));
});

test('B2: missing extractor is honest pending-integration uncertainty, not failure', async () => {
  const capability = createSourceIngestionCapability(deps());
  const outcome = okData(await capability.ingest({ kind: 'EMAIL', content: 'flight cancelled, sorry' }));
  assert.ok(
    outcome.uncertainties.some((u) => u.statement.includes('Model Studio client (Lane D1) is not wired yet')),
  );
});

// ---------------------------------------------------------------------------
// B3 — traveller context, precedence, accessibility, research
// ---------------------------------------------------------------------------

test('B3: structured traveller context keeps precedence explicit > trip > persistent > latent', async () => {
  const capability = createSourceIngestionCapability(
    deps({ context: { tripId: 'trip_1', travellerId: 'trv_1' } }),
  );
  const outcome = okData(
    await capability.ingest({
      kind: 'MANUAL',
      structured: {
        schema: 'TRAVELLER_CONTEXT',
        payload: {
          travellerId: 'trv_1',
          instructions: [
            { statement: 'take the earliest flight', issuedBy: 'trv_1', issuedAt: '2026-08-01T00:00:00.000Z' },
          ],
          preferences: [
            { statement: 'take the earliest flight', scope: 'TRIP' },
            { statement: 'prefers aisle seats', scope: 'PERSISTENT' },
          ],
          latentPreferences: [{ statement: 'prefers aisle seats', confidence: 0.4 }],
        },
      },
    }),
  );

  assert.equal(outcome.signals.length, 1);
  const signal = outcome.signals[0]!;
  assert.equal(signal.kind, 'TRAVELLER_INPUT');
  const preferences = (signal.payload['preferences'] ?? []) as Preference[];
  assert.equal(preferences.length, 4);
  const byOrigin = (kind: string) => preferences.filter((p) => p.origin.kind === kind);
  // Identical statement: the instruction dominates the trip preference; the
  // persistent preference dominates the latent duplicate.
  assert.equal(byOrigin('EXPLICIT_TRIP_PREFERENCE')[0]!.status, 'SUPERSEDED');
  assert.equal(byOrigin('EXPLICIT_INSTRUCTION')[0]!.status, 'ACTIVE');
  assert.equal(byOrigin('LATENT_INFERRED')[0]!.status, 'SUPERSEDED');
  assert.equal(byOrigin('EXPLICIT_PERSISTENT')[0]!.status, 'ACTIVE');
  // Latent keeps its soft evidence.
  const latent = byOrigin('LATENT_INFERRED')[0]!;
  assert.equal(latent.origin.kind === 'LATENT_INFERRED' ? latent.origin.confidence : undefined, 0.4);
  // Provenance survives on every preference.
  assert.ok(preferences.every((p) => p.sourceId === outcome.sourceId));
});

test('B3: accessibility is a HARD requirement/constraint, never a preference', async () => {
  const capability = createSourceIngestionCapability(deps({ context: { travellerId: 'trv_1' } }));
  const outcome = okData(
    await capability.ingest({
      kind: 'PROFILE',
      structured: {
        schema: 'TRAVELLER_CONTEXT',
        payload: {
          travellerId: 'trv_1',
          traveller: { name: 'Test Traveller', nationalityCodes: ['XX'] },
          accessibility: [{ kind: 'MOBILITY', statement: 'wheelchair assistance required' }],
        },
      },
    }),
  );

  const constraintOp = outcome.proposals
    .flatMap((p) => p.operations)
    .find((op) => op.op === 'UPSERT_CONSTRAINT');
  assert.ok(constraintOp, 'accessibility emitted as constraint');
  assert.equal(constraintOp!.op, 'UPSERT_CONSTRAINT');
  if (constraintOp!.op === 'UPSERT_CONSTRAINT') {
    assert.equal(constraintOp.constraint.kind, 'ACCESSIBILITY');
    assert.equal(constraintOp.constraint.hardness, 'HARD');
    assert.equal(constraintOp.constraint.evaluator, 'SEMANTIC');
    assert.equal(constraintOp.constraint.status, 'UNKNOWN');
    assert.equal(constraintOp.constraint.sourceId, outcome.sourceId);
  }

  // Traveller entity carries the requirement with source linkage too.
  const traveller = entityData(outcome, 'TRAVELLER');
  const requirements = traveller['accessibilityRequirements'] as Array<{ kind: string; sourceId: string }>;
  assert.equal(requirements.length, 1);
  assert.equal(requirements[0]!.kind, 'MOBILITY');
  assert.equal(requirements[0]!.sourceId, outcome.sourceId);

  // And it never appears inside the preference signal.
  assert.equal(outcome.signals.length, 0);
});

test('B3: claimed explicit instructions without verbatim evidence are demoted', async () => {
  const client = new RecordedExtractionClient([
    {
      task: 'TRAVELLER_CONTEXT',
      output: {
        items: [
          { statement: 'must have a window seat', basis: 'EXPLICIT_INSTRUCTION' }, // no quote
          { statement: 'usually avoids red-eye flights', basis: 'LATENT', confidence: 0.5 },
        ],
      },
    },
  ]);
  const capability = createSourceIngestionCapability(
    deps({ extractionClient: client, context: { travellerId: 'trv_1', tripId: 'trip_1' } }),
  );
  const outcome = okData(await capability.ingest({ kind: 'EMAIL', content: 'traveller email text' }));
  const signal = outcome.signals[0]!;
  const preferences = (signal.payload['preferences'] ?? []) as Preference[];
  assert.ok(preferences.every((p) => p.origin.kind !== 'EXPLICIT_INSTRUCTION'), 'no fabricated instructions');
  assert.ok(preferences.some((p) => p.origin.kind === 'EXPLICIT_TRIP_PREFERENCE'));
  assert.ok(preferences.some((p) => p.origin.kind === 'LATENT_INFERRED'));
  assert.ok(outcome.uncertainties.some((u) => u.statement.includes('demoted to trip preference')));
});

test('B3: legal/entry facts without authoritative sourcing never become rules', async () => {
  const capability = createSourceIngestionCapability(deps({ context: { tripId: 'trip_1' } }));
  const outcome = okData(
    await capability.ingest({
      kind: 'RESEARCH',
      structured: {
        schema: 'RESEARCH_FINDINGS',
        payload: {
          destinationCountryCode: 'XX',
          findings: [
            {
              statement: 'Visa required for nationality YY',
              kind: 'LEGAL_ENTRY_FACT',
              authority: 'ASSERTED',
              sourceUris: [],
            },
            {
              statement: 'Passport must be valid for six months',
              kind: 'LEGAL_ENTRY_FACT',
              authority: 'AUTHORITATIVE',
              sourceUris: ['https://official.example/entry'],
            },
            {
              statement: 'Immigration queue usually takes 40 minutes',
              kind: 'OPERATIONAL_ESTIMATE',
              authority: 'INFERRED',
              sourceUris: ['https://blog.example/airport'],
              confidence: 0.5,
              uncertainty: 'seasonal variation',
            },
          ],
        },
      },
    }),
  );

  const ruleSet = outcome.ruleSets[0];
  assert.ok(ruleSet, 'entry rule set emitted');
  assert.equal(ruleSet!.kind, 'ENTRY');
  const kinds = ruleSet!.rules.map((r) => r.kind);
  assert.deepEqual(kinds, ['ENTRY_REQUIREMENT', 'OTHER'], 'unsupported legal claim excluded');

  const entryRule = ruleSet!.rules[0]!;
  assert.equal(entryRule.sourceId, outcome.sourceId);
  if (entryRule.kind === 'ENTRY_REQUIREMENT') {
    assert.equal(entryRule.authoritativeSourceId, outcome.sourceId);
  }
  const estimateRule = ruleSet!.rules[1]!;
  if (estimateRule.kind === 'OTHER') {
    assert.ok(estimateRule.statement.includes('Immigration queue'));
    assert.ok(estimateRule.description?.includes('confidence=0.5'));
    assert.ok(estimateRule.description?.includes('seasonal variation'));
  }
  assert.ok(
    outcome.uncertainties.some(
      (u) => u.severity === 'HIGH' && u.statement.includes('lacks authoritative sourcing'),
    ),
  );
});

test('B3: preference conflict resolution is deterministic on the frozen ladder', () => {
  const base = { travellerId: 'trv_1', tripId: 'trip_1', statement: 'same statement', sourceId: 'src_1' };
  const instruction = PreferenceSchema.parse({
    id: 'pref_a',
    ...base,
    origin: { kind: 'EXPLICIT_INSTRUCTION', issuedAt: NOW, issuedBy: 'trv_1' },
  });
  const latent = PreferenceSchema.parse({
    id: 'pref_b',
    ...base,
    origin: { kind: 'LATENT_INFERRED', confidence: 0.9 },
  });
  const resolved = resolvePreferenceConflicts([latent, instruction]);
  assert.equal(resolved.find((p) => p.id === 'pref_a')!.status, 'ACTIVE');
  assert.equal(resolved.find((p) => p.id === 'pref_b')!.status, 'SUPERSEDED');
});

// ---------------------------------------------------------------------------
// Pipeline invariants: no direct Trip mutation, generalisation, anti-hardcoding
// ---------------------------------------------------------------------------

test('pipeline: ingestion never proposes the Trip aggregate itself', async () => {
  const client = new RecordedExtractionClient([
    {
      task: 'ANCHOR_EVENT',
      output: {
        name: 'Conference One',
        startsAt: '2026-09-14T09:00:00+09:00',
        endsAt: '2026-09-16T18:00:00+09:00',
        engagements: [{ title: 'Session', startsAt: '2026-09-14T10:00:00+09:00' }],
      },
    },
  ]);
  const capability = createSourceIngestionCapability(
    deps({ extractionClient: client, context: { tripId: 'trip_1' } }),
  );
  const outcome = okData(await capability.ingest({ kind: 'WEBPAGE', content: 'event page' }));
  const entityTypes = new Set(
    outcome.proposals.flatMap((p) =>
      p.operations.filter((op) => op.op === 'UPSERT_ENTITY').map((op) => op.entityType),
    ),
  );
  assert.ok(!entityTypes.has('TRIP'), 'no TRIP entity proposal may be emitted by ingestion');
});

test('generalisation: identical pipeline code normalizes materially different sources', async () => {
  const makeCapability = (output: unknown) =>
    createSourceIngestionCapability(
      deps({
        extractionClient: new RecordedExtractionClient([{ task: 'ANCHOR_EVENT', output }]),
        context: { tripId: 'trip_1' },
      }),
    );

  const outcomeA = okData(
    await makeCapability({
      name: 'Conference One',
      kind: 'CONFERENCE',
      venue: { name: 'Venue Hall' },
      startsAt: '2026-09-14T09:00:00+09:00',
      endsAt: '2026-09-16T18:00:00+09:00',
    }).ingest({ kind: 'WEBPAGE', content: 'first event page' }),
  );
  const outcomeB = okData(
    await makeCapability({
      name: 'Tournament Two',
      kind: 'TOURNAMENT',
      venue: { name: 'Stadium Grounds' },
      startsAt: '2026-11-02T08:00:00+00:00',
      endsAt: '2026-11-05T20:00:00+00:00',
    }).ingest({ kind: 'WEBPAGE', content: 'second, entirely different event page' }),
  );

  const anchorA = entityData(outcomeA, 'ANCHOR_EVENT');
  const anchorB = entityData(outcomeB, 'ANCHOR_EVENT');
  assert.equal(anchorA['name'], 'Conference One');
  assert.equal(anchorB['name'], 'Tournament Two');
  assert.equal(anchorA['kind'], 'CONFERENCE');
  assert.equal(anchorB['kind'], 'TOURNAMENT');
  assert.notEqual(anchorA['id'], anchorB['id'], 'different content produces different normalized state');
});

test('anti-hardcoding: ingestion source contains no fixture names, cities or scenario switches', () => {
  const forbidden = [
    'DevSummit',
    'Ari Vance',
    'A. Vance',
    'Tokyo',
    'Narita',
    'NRT',
    'Incheon',
    'ICN',
    'Singapore',
    'FL-A-1001',
    'anchor-event-speaker',
    'corporate-tmc',
    'scenarioA',
    'scenarioB',
    'scenario_a',
    'scenario_b',
  ];
  const ingestDir = new URL('../src/ingest/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const files = readdirSync(ingestDir).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 0);
  const blob = files.map((f) => readFileSync(join(ingestDir, f), 'utf8')).join('\n');
  for (const term of forbidden) {
    assert.ok(!blob.includes(term), `forbidden scenario-specific term found in src/ingest: ${term}`);
  }
});

test('pipeline: every emitted artifact keeps source linkage', async () => {
  const capability = createSourceIngestionCapability(
    deps({ context: { tripId: 'trip_1', travellerId: 'trv_1' } }),
  );
  const outcome = okData(
    await capability.ingest({
      kind: 'MANUAL',
      structured: {
        schema: 'TRAVELLER_CONTEXT',
        payload: {
          travellerId: 'trv_1',
          traveller: { name: 'Test Traveller' },
          preferences: [{ statement: 'prefers quiet hotels', scope: 'TRIP' }],
          accessibility: [{ kind: 'MEDICAL', statement: 'needs refrigerated medication storage' }],
        },
      },
    }),
  );
  assert.ok(EntityIdSchema.safeParse(outcome.sourceId).success);
  assert.ok(outcome.proposals.every((p) => p.sourceId === outcome.sourceId));
  assert.ok(outcome.signals.every((s: TripSignal) => s.sourceId === outcome.sourceId));
  assert.ok(outcome.uncertainties.every((u) => u.sourceId === outcome.sourceId));
});
