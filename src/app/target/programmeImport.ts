/**
 * M10 — target PostgreSQL programme/traveller intake.
 *
 * Real product capability (programme import/upload): commits an external
 * bundle — organisation, an Event+Programme with items, and Travellers each
 * participating in named items — through the real M2-M4 command surface.
 * No SQLite, no scenario-specific hardcoding: the bundle shape is generic;
 * callers (HTTP intake, demo seeding, migration importer) supply the data.
 *
 * Evidence ordering is load-bearing (see demoSeed.ts's header for why): a
 * source + evidence record citing the seeded Organisation must commit
 * before any Traveller identity can cite that evidence.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from '../../persistence/postgres/pool.ts';
import { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { createOrganisation, recordTraveller } from '../../persistence/postgres/commands/peopleCommands.ts';
import { recordSource, recordEvidence } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import { createTrip, createJourney } from '../../persistence/postgres/commands/travelCommands.ts';
import {
  createEvent,
  createProgramme,
  addProgrammeItem,
  addParticipation,
} from '../../persistence/postgres/commands/programmeCommands.ts';

export const ProgrammeImportItemSchema = z.strictObject({
  title: z.string().min(1),
  itemType: z.string().min(1),
  windowStart: z.string().min(1),
  windowEnd: z.string().min(1),
});

export const ProgrammeImportTravellerSchema = z.strictObject({
  displayName: z.string().min(1),
  /** Indices into `items[]` this traveller participates in. */
  participatesInItemIndices: z.array(z.number().int().min(0)).min(1),
  obligation: z.enum(['REQUIRED', 'OPTIONAL']).default('REQUIRED'),
});

export const ProgrammeImportBundleSchema = z.strictObject({
  organisationLegalName: z.string().min(1),
  eventTitle: z.string().min(1),
  programmeTitle: z.string().min(1),
  items: z.array(ProgrammeImportItemSchema).min(1),
  travellers: z.array(ProgrammeImportTravellerSchema).min(1),
});
export type ProgrammeImportBundle = z.infer<typeof ProgrammeImportBundleSchema>;

export interface ProgrammeImportResult {
  organisationId: string;
  eventId: string;
  programmeId: string;
  itemIds: string[];
  travellers: { travellerId: string; tripId: string; journeyId: string }[];
}

function mustOk<T>(outcome: { ok: boolean; value?: T; conflict?: unknown }, label: string): T {
  if (!outcome.ok) {
    throw new Error(`programme import step "${label}" failed: ${JSON.stringify(outcome.conflict)}`);
  }
  return outcome.value as T;
}

export async function importProgrammeBundle(
  pool: Pool,
  workspaceId: string,
  actorPrincipalId: string,
  bundleInput: unknown,
): Promise<ProgrammeImportResult> {
  const bundle = ProgrammeImportBundleSchema.parse(bundleInput);
  const uow = () => new PgUnitOfWork(pool, workspaceId);
  const now = new Date().toISOString();

  const org = mustOk(
    await createOrganisation(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `programme-import:org:${randomUUID()}`,
      legalName: bundle.organisationLegalName,
      defaultCurrencyCode: 'USD',
    }),
    'createOrganisation',
  );

  const source = mustOk(
    await recordSource(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `programme-import:source:${randomUUID()}`,
      sourceIdentity: `programme-import:${org.organisationId}:${randomUUID()}`,
      receivedAt: now,
      contentHash: `programme-import-${org.organisationId}`,
      contentType: 'application/x-northstar-programme-import',
    }),
    'recordSource',
  );

  const evidence = mustOk(
    await recordEvidence(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `programme-import:evidence:${randomUUID()}`,
      assertionType: 'PROGRAMME_IMPORT_PROVENANCE',
      observedAt: now,
      schemaVersion: '1',
      sourceIds: [source.sourceId],
      subjectRefs: [{ kind: 'ORGANISATION', id: org.organisationId }],
    }),
    'recordEvidence',
  );

  const event = mustOk(
    await createEvent(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `programme-import:event:${randomUUID()}`,
      title: bundle.eventTitle,
      organiserOrganisationId: org.organisationId,
      lifecycleStatus: 'ACTIVE',
    }),
    'createEvent',
  );

  const programme = mustOk(
    await createProgramme(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: `programme-import:programme:${randomUUID()}`,
      eventId: event.eventId,
      title: bundle.programmeTitle,
      lifecycleStatus: 'ACTIVE',
    }),
    'createProgramme',
  );

  let programmeRevision = programme.revision;
  const itemIds: string[] = [];
  for (const item of bundle.items) {
    const added = mustOk(
      await addProgrammeItem(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: `programme-import:item:${randomUUID()}`,
        programmeId: programme.programmeId,
        expectedProgrammeRevision: programmeRevision,
        item: {
          title: item.title,
          itemType: item.itemType,
          window: { start: item.windowStart, end: item.windowEnd },
        },
      }),
      `addProgrammeItem(${item.title})`,
    );
    programmeRevision = added.programmeRevision;
    itemIds.push(added.programmeItemId);
  }

  const travellers: ProgrammeImportResult['travellers'] = [];
  for (const travellerSpec of bundle.travellers) {
    const traveller = mustOk(
      await recordTraveller(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: `programme-import:traveller:${randomUUID()}`,
        displayName: {
          nameKind: 'DISPLAY',
          displayValue: travellerSpec.displayName,
          effectiveRange: { start: now.slice(0, 10) },
          evidenceId: evidence.evidenceId,
        },
      }),
      `recordTraveller(${travellerSpec.displayName})`,
    );
    const trip = mustOk(
      await createTrip(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: `programme-import:trip:${randomUUID()}`,
        purpose: `${bundle.programmeTitle} attendance`,
        businessContextOrganisationId: org.organisationId,
      }),
      `createTrip(${travellerSpec.displayName})`,
    );
    const journey = mustOk(
      await createJourney(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: `programme-import:journey:${randomUUID()}`,
        tripId: trip.tripId,
        travellerId: traveller.travellerId,
        lifecycleStatus: 'ACTIVE',
      }),
      `createJourney(${travellerSpec.displayName})`,
    );
    for (const itemIndex of travellerSpec.participatesInItemIndices) {
      const itemId = itemIds[itemIndex];
      if (!itemId) {
        throw new Error(
          `programme import: traveller "${travellerSpec.displayName}" references item index ${itemIndex}, but only ${itemIds.length} item(s) exist`,
        );
      }
      const participation = mustOk(
        await addParticipation(uow(), {
          workspaceId,
          actorPrincipalId,
          idempotencyKey: `programme-import:participation:${randomUUID()}`,
          programmeId: programme.programmeId,
          programmeItemId: itemId,
          travellerId: traveller.travellerId,
          obligation: travellerSpec.obligation,
          expectedProgrammeRevision: programmeRevision,
          accepted: true,
        }),
        `addParticipation(${travellerSpec.displayName})`,
      );
      programmeRevision = participation.programmeRevision;
    }
    travellers.push({ travellerId: traveller.travellerId, tripId: trip.tripId, journeyId: journey.journeyId });
  }

  return { organisationId: org.organisationId, eventId: event.eventId, programmeId: programme.programmeId, itemIds, travellers };
}
