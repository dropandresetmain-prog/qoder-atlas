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
import { z } from 'zod';
import type { Pool } from '../../persistence/postgres/pool.ts';
import { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { canonicalPayloadHash } from '../../persistence/postgres/canonicalHash.ts';
import { InstantSchema, compareInstants } from '../../domain/v2/shared/time.ts';
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
  windowStart: InstantSchema,
  windowEnd: InstantSchema,
}).refine((item) => compareInstants(item.windowStart, item.windowEnd) < 0, {
  path: ['windowEnd'],
  message: 'windowStart must be strictly before windowEnd',
});

export const ProgrammeImportTravellerSchema = z.strictObject({
  displayName: z.string().min(1),
  /** Indices into `items[]` this traveller participates in. */
  participatesInItemIndices: z.array(z.number().int().min(0)).min(1),
  obligation: z.enum(['REQUIRED', 'OPTIONAL']).default('REQUIRED'),
});

export const ProgrammeImportBundleSchema = z.strictObject({
  /** Caller supplied key for intentional re-imports; content hash is the fallback. */
  importKey: z.string().trim().min(1).max(256).optional(),
  organisationLegalName: z.string().min(1),
  eventTitle: z.string().min(1),
  programmeTitle: z.string().min(1),
  items: z.array(ProgrammeImportItemSchema).min(1),
  travellers: z.array(ProgrammeImportTravellerSchema).min(1),
}).superRefine((bundle, ctx) => {
  for (const [travellerIndex, traveller] of bundle.travellers.entries()) {
    const seen = new Set<number>();
    for (const itemIndex of traveller.participatesInItemIndices) {
      if (seen.has(itemIndex)) {
        ctx.addIssue({
          code: 'custom',
          path: ['travellers', travellerIndex, 'participatesInItemIndices'],
          message: `references item index ${itemIndex} more than once`,
        });
      }
      seen.add(itemIndex);
      if (itemIndex >= bundle.items.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['travellers', travellerIndex, 'participatesInItemIndices'],
          message: `references item index ${itemIndex}, but only ${bundle.items.length} item(s) exist`,
        });
      }
    }
  }
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

function stableUuid(seed: string): string {
  const hex = canonicalPayloadHash(seed).slice(0, 32);
  const variantByte = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variantByte}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export async function importProgrammeBundle(
  pool: Pool,
  workspaceId: string,
  actorPrincipalId: string,
  bundleInput: unknown,
): Promise<ProgrammeImportResult> {
  const bundle = ProgrammeImportBundleSchema.parse(bundleInput);
  // Stable replay identity is workspace-scoped. The same bundle or import key
  // may legitimately be admitted into two workspaces, but those imports are
  // separate aggregate roots and must not mint the same cross-workspace IDs.
  const importIdentity = bundle.importKey
    ? canonicalPayloadHash({ workspaceId, importKey: bundle.importKey })
    : canonicalPayloadHash({ workspaceId, bundle });
  const importContentHash = canonicalPayloadHash(bundle);
  const commandKey = (step: string) => `programme-import:${importIdentity}:${step}`;
  const organisationId = stableUuid(`${importIdentity}:organisation`);
  const sourceId = stableUuid(`${importIdentity}:source`);
  const evidenceId = stableUuid(`${importIdentity}:evidence`);
  const eventId = stableUuid(`${importIdentity}:event`);
  const programmeId = stableUuid(`${importIdentity}:programme`);
  const itemIds = bundle.items.map((_, index) => stableUuid(`${importIdentity}:item:${index}`));
  const travellerIds = bundle.travellers.map((_, index) => stableUuid(`${importIdentity}:traveller:${index}`));
  const tripIds = bundle.travellers.map((_, index) => stableUuid(`${importIdentity}:trip:${index}`));
  const journeyIds = bundle.travellers.map((_, index) => stableUuid(`${importIdentity}:journey:${index}`));
  const participationIds = bundle.travellers.flatMap((traveller, travellerIndex) =>
    traveller.participatesInItemIndices.map((itemIndex) => stableUuid(`${importIdentity}:participation:${travellerIndex}:${itemIndex}`)));

  // A retry after SOURCE_RECORDED must reuse the first receipt's timestamp;
  // otherwise the stable key would correctly reject a changed provenance
  // payload. This read is admission-only and does not create a new contract.
  const existingSource = await pool.query<{ received_at: Date }>(
    'SELECT received_at FROM source_records WHERE workspace_id = $1 AND id = $2',
    [workspaceId, sourceId],
  );
  const now = existingSource.rows[0]?.received_at?.toISOString() ?? new Date().toISOString();
  const uow = () => new PgUnitOfWork(pool, workspaceId);

  const org = mustOk(
    await createOrganisation(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: commandKey('organisation'),
      organisationId,
      legalName: bundle.organisationLegalName,
      defaultCurrencyCode: 'USD',
    }),
    'createOrganisation',
  );

  const source = mustOk(
    await recordSource(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: commandKey('source'),
      sourceId,
      sourceIdentity: `programme-import:${importIdentity}`,
      receivedAt: now,
      contentHash: importContentHash,
      contentType: 'application/x-northstar-programme-import',
    }),
    'recordSource',
  );

  const evidence = mustOk(
    await recordEvidence(uow(), {
      workspaceId,
      actorPrincipalId,
      idempotencyKey: commandKey('evidence'),
      evidenceId,
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
      idempotencyKey: commandKey('event'),
      eventId,
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
      idempotencyKey: commandKey('programme'),
      programmeId,
      eventId: event.eventId,
      title: bundle.programmeTitle,
      lifecycleStatus: 'ACTIVE',
    }),
    'createProgramme',
  );

  let programmeRevision = programme.revision;
  let itemIndex = 0;
  for (const item of bundle.items) {
    const added = mustOk(
      await addProgrammeItem(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: commandKey(`item:${itemIndex}`),
        programmeId: programme.programmeId,
        expectedProgrammeRevision: programmeRevision,
        item: {
          id: itemIds[itemIndex],
          title: item.title,
          itemType: item.itemType,
          window: { start: item.windowStart, end: item.windowEnd },
        },
      }),
      `addProgrammeItem(${item.title})`,
    );
    programmeRevision = added.programmeRevision;
    itemIndex += 1;
  }

  const travellers: ProgrammeImportResult['travellers'] = [];
  let participationOffset = 0;
  for (const [travellerIndex, travellerSpec] of bundle.travellers.entries()) {
    const traveller = mustOk(
      await recordTraveller(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: commandKey(`traveller:${travellerIndex}`),
        travellerId: travellerIds[travellerIndex],
        displayName: {
          id: stableUuid(`${importIdentity}:traveller:${travellerIndex}:display-name`),
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
        idempotencyKey: commandKey(`trip:${travellerIndex}`),
        tripId: tripIds[travellerIndex],
        purpose: `${bundle.programmeTitle} attendance`,
        businessContextOrganisationId: org.organisationId,
      }),
      `createTrip(${travellerSpec.displayName})`,
    );
    const journey = mustOk(
      await createJourney(uow(), {
        workspaceId,
        actorPrincipalId,
        idempotencyKey: commandKey(`journey:${travellerIndex}`),
        journeyId: journeyIds[travellerIndex],
        tripId: trip.tripId,
        travellerId: traveller.travellerId,
        lifecycleStatus: 'ACTIVE',
      }),
      `createJourney(${travellerSpec.displayName})`,
    );
    for (const itemIndex of travellerSpec.participatesInItemIndices) {
      const itemId = itemIds[itemIndex];
      const participation = mustOk(
        await addParticipation(uow(), {
          workspaceId,
          actorPrincipalId,
          idempotencyKey: commandKey(`participation:${participationOffset}`),
          participationId: participationIds[participationOffset]!,
          programmeId: programme.programmeId,
          programmeItemId: itemId!,
          travellerId: traveller.travellerId,
          obligation: travellerSpec.obligation,
          expectedProgrammeRevision: programmeRevision,
          accepted: true,
        }),
        `addParticipation(${travellerSpec.displayName})`,
      );
      programmeRevision = participation.programmeRevision;
      participationOffset += 1;
    }
    travellers.push({ travellerId: traveller.travellerId, tripId: trip.tripId, journeyId: journey.journeyId });
  }

  return { organisationId: org.organisationId, eventId: event.eventId, programmeId: programme.programmeId, itemIds, travellers };
}
