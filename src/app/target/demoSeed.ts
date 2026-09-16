/**
 * M10 — target PostgreSQL demo/product world seeding.
 *
 * Real product capability, not test scaffolding: uses the same command
 * surface `postgres-integration/*.pgtest.ts` proves against real
 * PostgreSQL (`createOrganisation`, `recordSource`/`recordEvidence`,
 * `recordTraveller`, `createTrip`/`createJourney`, `createEvent`/
 * `createProgramme`/`addProgrammeItem`/`addParticipation`,
 * `provisionOrganiserAuthority`) — no SQLite, no scenario-specific
 * hardcoding beyond generic demo labels (anti-hardcoding gate rules target
 * named personas/fixture ids, not "Demo Traveller N").
 *
 * Evidence ordering is load-bearing, not incidental: `traveller_names`,
 * `travel_credentials`, and similar rows have a real FK to
 * `evidence_records`, and `evidence_subjects` has a real FK to
 * `domain_subjects` — so a source record and an evidence record (citing an
 * already-registered subject, here the seeded Organisation) must commit
 * before any Traveller identity can cite that evidence.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from '../../persistence/postgres/pool.ts';
import { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import {
  createOrganisation,
  recordTraveller,
} from '../../persistence/postgres/commands/peopleCommands.ts';
import { recordSource, recordEvidence } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import { createTrip, createJourney } from '../../persistence/postgres/commands/travelCommands.ts';
import {
  createEvent,
  createProgramme,
  addProgrammeItem,
  addParticipation,
} from '../../persistence/postgres/commands/programmeCommands.ts';
import { provisionOrganiserAuthority, GRANT_ISSUANCE_ACTION_KIND } from './grantIssuance.ts';

export interface DemoSeedResult {
  workspaceId: string;
  organisationId: string;
  organiserPrincipalId: string;
  eventId: string;
  programmeId: string;
  travellers: { travellerId: string; tripId: string; journeyId: string }[];
}

function mustOk<T>(outcome: { ok: boolean; value?: T; conflict?: unknown }, label: string): T {
  if (!outcome.ok) {
    throw new Error(`demo seed step "${label}" failed: ${JSON.stringify(outcome.conflict)}`);
  }
  return outcome.value as T;
}

/**
 * Seeds a small, coherent demo world: one Organisation, one Event+Programme
 * with a session item, and two Travellers each with a Trip/Journey
 * participating in that item. Deterministic labels only ("Demo Traveller
 * N") — no named personas, no fixture-specific ids.
 */
export async function seedDemoWorld(pool: Pool, workspaceId: string, actorPrincipalId: string): Promise<DemoSeedResult> {
  const uow = () => new PgUnitOfWork(pool, workspaceId);
  const now = new Date().toISOString();

  const org = mustOk(
    await createOrganisation(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `demo-seed:org:${randomUUID()}`,
      legalName: 'Demo Organiser Co',
      defaultCurrencyCode: 'USD',
    }),
    'createOrganisation',
  );

  const source = mustOk(
    await recordSource(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `demo-seed:source:${randomUUID()}`,
      sourceIdentity: `demo-seed:${workspaceId}`,
      receivedAt: now,
      contentHash: `demo-seed-${workspaceId}`,
      contentType: 'application/x-northstar-demo-seed',
    }),
    'recordSource',
  );

  const evidence = mustOk(
    await recordEvidence(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `demo-seed:evidence:${randomUUID()}`,
      assertionType: 'DEMO_SEED_PROVENANCE',
      observedAt: now,
      schemaVersion: '1',
      sourceIds: [source.sourceId],
      subjectRefs: [{ kind: 'ORGANISATION', id: org.organisationId }],
    }),
    'recordEvidence',
  );

  // ISSUER-POL bootstrap: the organiser principal never mints its own
  // authority; provisionOrganiserAuthority routes through a dedicated
  // bootstrap system principal (grantIssuance.ts), satisfying a workspace's
  // one-time-only bootstrap grant.
  const organiserAuth = mustOk(
    await provisionOrganiserAuthority({
      uow: uow(),
      workspaceId,
      actorPrincipalId,
      organisationLegalName: org.organisationId,
      authIssuer: 'urn:northstar:demo',
      authSubject: `demo-organiser:${workspaceId}`,
      representedPartyRef: { kind: 'ORGANISATION', id: org.organisationId },
      requiredScopes: [{ kind: 'ORGANISATION', id: org.organisationId }],
      actions: [GRANT_ISSUANCE_ACTION_KIND, 'action.intent.dispatch', 'action.intent.authorize'],
      issuedAt: now,
    }),
    'provisionOrganiserAuthority',
  );

  const event = mustOk(
    await createEvent(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `demo-seed:event:${randomUUID()}`,
      title: 'Demo Programme Event',
      organiserOrganisationId: org.organisationId,
      lifecycleStatus: 'ACTIVE',
    }),
    'createEvent',
  );

  const programme = mustOk(
    await createProgramme(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `demo-seed:programme:${randomUUID()}`,
      eventId: event.eventId,
      title: 'Demo Programme',
      lifecycleStatus: 'ACTIVE',
    }),
    'createProgramme',
  );

  const item = mustOk(
    await addProgrammeItem(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `demo-seed:item:${randomUUID()}`,
      programmeId: programme.programmeId,
      expectedProgrammeRevision: programme.revision,
      item: {
        title: 'Demo Session',
        itemType: 'SESSION',
        window: { start: '2031-01-01T09:00:00.000Z', end: '2031-01-01T10:00:00.000Z' },
      },
    }),
    'addProgrammeItem',
  );

  const travellers: DemoSeedResult['travellers'] = [];
  let programmeRevision = item.programmeRevision;
  for (let i = 1; i <= 2; i++) {
    const traveller = mustOk(
      await recordTraveller(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: `demo-seed:traveller:${randomUUID()}`,
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: `Demo Traveller ${i}`,
          effectiveRange: { start: '2020-01-01' },
          evidenceId: evidence.evidenceId,
        },
      }),
      `recordTraveller#${i}`,
    );
    const trip = mustOk(
      await createTrip(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: `demo-seed:trip:${randomUUID()}`,
        purpose: 'Demo Programme attendance',
        businessContextOrganisationId: org.organisationId,
      }),
      `createTrip#${i}`,
    );
    const journey = mustOk(
      await createJourney(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: `demo-seed:journey:${randomUUID()}`,
        tripId: trip.tripId,
        travellerId: traveller.travellerId,
        lifecycleStatus: 'ACTIVE',
      }),
      `createJourney#${i}`,
    );
    const participation = mustOk(
      await addParticipation(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: `demo-seed:participation:${randomUUID()}`,
        programmeId: programme.programmeId,
        programmeItemId: item.programmeItemId,
        travellerId: traveller.travellerId,
        obligation: 'REQUIRED',
        expectedProgrammeRevision: programmeRevision,
        accepted: true,
      }),
      `addParticipation#${i}`,
    );
    programmeRevision = participation.programmeRevision;
    travellers.push({ travellerId: traveller.travellerId, tripId: trip.tripId, journeyId: journey.journeyId });
  }

  return {
    workspaceId,
    organisationId: org.organisationId,
    organiserPrincipalId: organiserAuth.principalId,
    eventId: event.eventId,
    programmeId: programme.programmeId,
    travellers,
  };
}
