/**
 * Wave 3 triage — fail-closed traveller identity resolution.
 *
 * Root cause under test: `ProgrammeService.resolveExistingTraveller` used to
 * accept a single case-insensitive display-name hit across ALL persisted
 * travellers as identity, silently merging unrelated people — including
 * across programmes. The fix reconciles a draft with an existing Traveller
 * ONLY through the stable deterministic identifier
 * `trv-{anchorEventId}-{draftId}`; display-name similarity is never identity
 * evidence. Fresh intake with a coincidental name collision creates a
 * distinct Traveller; a LATER_UPDATE that cannot identify its subject
 * refuses instead of guessing.
 *
 * Regressions:
 *  1. same display name in two different programmes does NOT merge;
 *  2. two people with the same display name in one programme do NOT
 *     silently merge;
 *  3. repeat/promote flow with a stable deterministic identifier stays
 *     idempotent (same Traveller, same Trip, existing state kept);
 *  4. an ambiguous LATER_UPDATE cannot mutate somebody else's Trip;
 *  5. Wave 3 Case A/B/C files run green alongside this file (full suite).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/persistence/database.ts';
import {
  SqliteAuditRepository,
  SqliteSourceRepository,
  SqliteTripRepository,
} from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { ProgrammeService } from '../src/app/programme.ts';
import type { ProgrammeImportDraft, ProgrammeTravellerDraft } from '../src/contracts/programmeIntake.ts';
import type { AnchorEvent, Organisation, Place, Traveller } from '../src/domain/entities.ts';
import type { RuleSet } from '../src/domain/rules.ts';

const AT = '2026-09-01T00:00:00+00:00';

function createService() {
  const db = openDatabase(':memory:');
  const trips = new SqliteTripRepository(db);
  const entities = new SqliteEntityStore(db);
  const sources = new SqliteSourceRepository(db);
  const audit = new SqliteAuditRepository(db);
  const mutations = new SqlMutationService({ db, trips, entities });
  return {
    db,
    trips,
    entities,
    service: new ProgrammeService({ mutations, entities, trips, sources, audit }),
  };
}

function programmeContext(eventId: string) {
  const organisation: Organisation = {
    id: `org-${eventId}`,
    name: 'Synthetic Identity Organiser',
    roles: ['EVENT_ORGANISER', 'PAYER'],
  };
  const venue: Place = {
    id: `plc-${eventId}-venue`,
    name: 'Synthetic Venue',
    kind: 'VENUE',
    timezone: 'Asia/Singapore',
    externalRefs: [],
  };
  const airport: Place = {
    id: `plc-${eventId}-airport`,
    name: 'Synthetic Airport',
    kind: 'AIRPORT',
    timezone: 'Asia/Singapore',
    externalRefs: [{ system: 'airport-code', value: 'SYN' }],
  };
  const anchorEvent: AnchorEvent = {
    id: eventId,
    name: `Synthetic Identity Event ${eventId}`,
    kind: 'CONFERENCE',
    placeId: venue.id,
    window: { startsAt: '2026-09-07T00:00:00+08:00', endsAt: '2026-09-11T23:59:00+08:00' },
    organiserOrganisationId: organisation.id,
    commitments: [
      {
        id: `cmt-${eventId}-opening`,
        anchorEventId: eventId,
        title: 'Opening Session',
        kind: 'SESSION',
        placeId: venue.id,
        startsAt: {
          value: '2026-09-08T15:00:00+08:00',
          sourceId: `src-${eventId}`,
          authority: 'AUTHORITATIVE',
          observedAt: AT,
        },
        sourceId: `src-${eventId}`,
      },
    ],
    sourceIds: [],
  };
  const ruleSets: RuleSet[] = [];
  return { organisation, anchorEvent, places: [venue, airport], ruleSets };
}

function traveller(overrides: Partial<ProgrammeTravellerDraft> & { draftId: string; displayName: string }): ProgrammeTravellerDraft {
  return {
    identity: {},
    nationalityCodes: ['SG'],
    accessibilityStatements: [],
    notes: [],
    anchorCommitmentIds: [],
    ...overrides,
  };
}

function importOne(eventId: string, importId: string, channel: ProgrammeImportDraft['channel'], draft: ProgrammeTravellerDraft): ProgrammeImportDraft {
  return {
    id: importId,
    anchorEventId: eventId,
    channel,
    sourceId: `src-${eventId}`,
    receivedAt: AT,
    travellers: [draft],
    unresolvedStatements: [],
  };
}

test('identity 1: same display name in two different programmes does NOT merge', async () => {
  const { db, entities, service } = createService();
  try {
    for (const eventId of ['evt-idA', 'evt-idB']) {
      const context = programmeContext(eventId);
      await service.applyProgrammeContext({
        at: AT,
        sourceId: `src-${eventId}`,
        organisation: context.organisation,
        anchorEvent: context.anchorEvent,
        places: context.places,
        ruleSets: context.ruleSets,
      });
      const result = await service.intakeImportDraft({
        importDraft: importOne(eventId, `import-${eventId}`, 'BULK_IMPORT',
          traveller({ draftId: 'draft-1', displayName: 'Alex Chen' })),
        at: AT,
      });
      assert.equal(result.outcomes[0]?.promoted, true, `promotion in ${eventId} must succeed`);
    }

    const all = (await entities.list('TRAVELLER'))
      .filter((entry): entry is { entityType: 'TRAVELLER'; entity: Traveller } => entry.entityType === 'TRAVELLER')
      .map((entry) => entry.entity);
    const alexes = all.filter((t) => t.name === 'Alex Chen');
    assert.equal(alexes.length, 2, 'two distinct authoritative Travellers, one per programme');
    assert.notEqual(alexes[0]?.id, alexes[1]?.id);
    assert.deepEqual(
      [alexes[0]?.id, alexes[1]?.id].sort(),
      ['trv-evt-idA-draft-1', 'trv-evt-idB-draft-1'],
      'each traveller keeps its own programme-scoped deterministic identity',
    );
  } finally {
    db.close();
  }
});

test('identity 2: two people with the same display name in ONE programme do NOT silently merge', async () => {
  const { db, entities, trips, service } = createService();
  try {
    const context = programmeContext('evt-idC');
    await service.applyProgrammeContext({
      at: AT,
      sourceId: 'src-evt-idC',
      organisation: context.organisation,
      anchorEvent: context.anchorEvent,
      places: context.places,
      ruleSets: context.ruleSets,
    });
    const result = await service.intakeImportDraft({
      importDraft: {
        id: 'import-collide',
        anchorEventId: 'evt-idC',
        channel: 'BULK_IMPORT',
        sourceId: 'src-evt-idC',
        receivedAt: AT,
        travellers: [
          traveller({ draftId: 'draft-senior', displayName: 'Alex Chen' }),
          traveller({ draftId: 'draft-junior', displayName: 'Alex Chen' }),
        ],
        unresolvedStatements: [],
      },
      at: AT,
    });
    assert.equal(result.outcomes.filter((o) => o.promoted).length, 2, 'both promote');

    const all = (await entities.list('TRAVELLER'))
      .filter((entry): entry is { entityType: 'TRAVELLER'; entity: Traveller } => entry.entityType === 'TRAVELLER')
      .map((entry) => entry.entity);
    assert.equal(all.length, 2, 'no merge — two distinct Travellers');
    const tripIds = (await trips.listTrips()).map((s) => s.tripId).sort();
    assert.deepEqual(tripIds, ['trip-trv-evt-idC-draft-junior', 'trip-trv-evt-idC-draft-senior'], 'distinct trips, one per person');
  } finally {
    db.close();
  }
});

test('identity 3: repeat promote with the stable deterministic identifier is idempotent', async () => {
  const { db, trips, service } = createService();
  try {
    const context = programmeContext('evt-idD');
    await service.applyProgrammeContext({
      at: AT,
      sourceId: 'src-evt-idD',
      organisation: context.organisation,
      anchorEvent: context.anchorEvent,
      places: context.places,
      ruleSets: context.ruleSets,
    });
    const draft = traveller({
      draftId: 'draft-stable',
      displayName: 'Robin Idempotent',
      anchorCommitmentIds: ['cmt-evt-idD-opening'],
    });
    const first = await service.intakeImportDraft({
      importDraft: importOne('evt-idD', 'import-d1', 'BULK_IMPORT', draft),
      at: AT,
    });
    assert.equal(first.outcomes[0]?.promoted, true);
    const firstTripId = first.outcomes[0]?.tripId;
    const firstTrip = await trips.getTrip(firstTripId!);
    const elementCountBefore = firstTrip!.elements.length;

    // Same draft re-submitted through the update channel: the deterministic
    // identifier `trv-evt-idD-draft-stable` establishes identity exactly, so
    // promotion reconciles onto the SAME traveller and trip — no second trip,
    // no renamed traveller, existing state preserved.
    const second = await service.intakeImportDraft({
      importDraft: importOne('evt-idD', 'import-d2', 'LATER_UPDATE', draft),
      at: AT,
    });
    assert.equal(second.outcomes[0]?.promoted, true, second.outcomes[0]?.issues.join('; '));
    assert.equal(second.outcomes[0]?.travellerId, 'trv-evt-idD-draft-stable');
    assert.equal(second.outcomes[0]?.tripId, firstTripId, 'identity continuity keeps the existing trip');
    const tripAfter = await trips.getTrip(firstTripId!);
    assert.equal(tripAfter!.elements.length, elementCountBefore, 'no duplicate engagements on re-promotion');
    assert.equal((await trips.listTrips()).length, 1, 'still exactly one trip');
  } finally {
    db.close();
  }
});

test('identity 4: an ambiguous LATER_UPDATE cannot mutate somebody else\'s Trip', async () => {
  const { db, trips, entities, service } = createService();
  try {
    const context = programmeContext('evt-idE');
    await service.applyProgrammeContext({
      at: AT,
      sourceId: 'src-evt-idE',
      organisation: context.organisation,
      anchorEvent: context.anchorEvent,
      places: context.places,
      ruleSets: context.ruleSets,
    });
    const first = await service.intakeImportDraft({
      importDraft: importOne('evt-idE', 'import-e1', 'BULK_IMPORT',
        traveller({ draftId: 'draft-original', displayName: 'Sam Duplicate', anchorCommitmentIds: ['cmt-evt-idE-opening'] })),
      at: AT,
    });
    assert.equal(first.outcomes[0]?.promoted, true);
    const victimTripId = first.outcomes[0]!.tripId!;
    const victimTripBefore = await trips.getTrip(victimTripId);
    const travellerBefore = JSON.stringify((await entities.get('TRAVELLER', 'trv-evt-idE-draft-original')));

    // Same display name, DIFFERENT draftId: no deterministic identifier can
    // establish which existing traveller this update is about. Fail closed.
    const ambiguous = await service.intakeImportDraft({
      importDraft: importOne('evt-idE', 'import-e2', 'LATER_UPDATE',
        traveller({ draftId: 'draft-impostor', displayName: 'Sam Duplicate', nationalityCodes: ['MY'] })),
      at: AT,
    });
    assert.equal(ambiguous.outcomes[0]?.promoted, false, 'ambiguous update must refuse');
    assert.match(ambiguous.outcomes[0]?.issues.join(' ') ?? '', /could not safely identify/, 'surfaces the ambiguity honestly');

    // The other person's Trip and Traveller are untouched — no merge, no
    // nationality overwrite, no re-labelling.
    const victimTripAfter = await trips.getTrip(victimTripId);
    assert.deepEqual(
      victimTripAfter!.elements.map((e) => ({ id: e.id, kind: e.elementKind })),
      victimTripBefore!.elements.map((e) => ({ id: e.id, kind: e.elementKind })),
      'victim trip elements unchanged',
    );
    assert.deepEqual(
      JSON.stringify(await entities.get('TRAVELLER', 'trv-evt-idE-draft-original')),
      travellerBefore,
      'victim traveller record unchanged',
    );
    assert.equal(
      ((await entities.list('TRAVELLER')).filter((e) => e.entityType === 'TRAVELLER')).length,
      1,
      'no impostor traveller was created by a refused update',
    );

    // Unknown-subject LATER_UPDATE (no name collision either) also refuses.
    const unknown = await service.intakeImportDraft({
      importDraft: importOne('evt-idE', 'import-e3', 'LATER_UPDATE',
        traveller({ draftId: 'draft-unknown', displayName: 'Nobody Known' })),
      at: AT,
    });
    assert.equal(unknown.outcomes[0]?.promoted, false);
    assert.match(unknown.outcomes[0]?.issues.join(' ') ?? '', /unknown subject/);
  } finally {
    db.close();
  }
});
