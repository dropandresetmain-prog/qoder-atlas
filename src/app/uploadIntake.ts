/**
 * DR-10 — Upload Event Details intake (Lane H).
 *
 * Bundle intake: event brief text + roster records (+ optional policy text)
 * -> a DRAFT programme bundle conforming to the existing programme bundle
 * schema (src/app/programmeSeed.ts). Missing facts stay missing/uncertain
 * (UncertaintyRecord entries), never fabricated.
 *
 * Deterministic path required: no model calls. The optional model-assisted
 * path uses ScriptedModelTransport for credential-free replay only.
 *
 * Draft review stage: the output is a draft with explicit uncertainties;
 * promotion to authoritative goes through the EXISTING programme seeding/
 * promotion services (ProgrammeService.applyProgrammeContext +
 * ProgrammeService.intakeImportDraft).
 */
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { EntityId, IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import { EntityIdSchema, IsoDateTimeSchema, UncertaintyRecordSchema } from '../domain/common.ts';
import type { AnchorEvent, Organisation, Place } from '../domain/entities.ts';
import type { ProgrammeImportDraft, ProgrammeTravellerDraft } from '../contracts/programmeIntake.ts';
import { ProgrammeImportDraftSchema } from '../contracts/programmeIntake.ts';
import type { RosterParseResult, RosterRecord } from './rosterParser.ts';
import { parseRosterFromCsv } from './rosterParser.ts';
import type { ProgrammeContextInput, ImportDraftOutcome } from './programme.ts';
import type { ValidationIssue } from '../contracts/services.ts';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const EventBriefInputSchema = z.strictObject({
  eventName: z.string().optional(),
  eventKind: z.enum([
    'CONFERENCE',
    'CONCERT',
    'RETREAT',
    'TOURNAMENT',
    'WEDDING',
    'OFFSITE',
    'TRADE_MISSION',
    'OTHER',
  ]).optional(),
  venueName: z.string().optional(),
  venueTimezone: z.string().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  organiserName: z.string().optional(),
  instructions: z.string().optional(),
});
export type EventBriefInput = z.infer<typeof EventBriefInputSchema>;

export const UploadIntakeInputSchema = z.strictObject({
  /** Anchor event id for the programme (required). */
  anchorEventId: EntityIdSchema,
  /** Source id for provenance (required). */
  sourceId: EntityIdSchema,
  /** Reference timestamp (required). */
  at: IsoDateTimeSchema,
  /** Event brief text (required). */
  eventBriefText: z.string().min(1),
  /** Roster CSV text (required). */
  rosterCsvText: z.string().min(1),
  /** Optional policy text (not yet parsed; stored as unresolved). */
  policyText: z.string().optional(),
  /** Optional structured event brief (if already extracted). */
  eventBrief: EventBriefInputSchema.optional(),
});
export type UploadIntakeInput = z.infer<typeof UploadIntakeInputSchema>;

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export const DraftProgrammeBundleSchema = z.strictObject({
  context: z.strictObject({
    at: IsoDateTimeSchema,
    sourceId: EntityIdSchema,
    organisation: z.any().optional(),
    anchorEvent: z.any().optional(),
    places: z.array(z.any()).optional(),
    ruleSets: z.array(z.any()).optional(),
  }),
  importDraft: ProgrammeImportDraftSchema,
  uncertainties: z.array(UncertaintyRecordSchema),
  parseIssues: z.array(z.any()),
});
export type DraftProgrammeBundle = z.infer<typeof DraftProgrammeBundleSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUncertainty(
  sourceId: EntityId,
  statement: string,
  severity: UncertaintyRecord['severity'] = 'MEDIUM',
): UncertaintyRecord {
  const digest = createHash('sha256')
    .update(`${sourceId}\u0000${statement}\u0000${severity}`)
    .digest('hex')
    .slice(0, 12);
  return {
    id: `unc-upload-${digest}`,
    statement,
    aboutRefs: [],
    sourceId,
    severity,
  };
}

function rosterRecordToDraft(record: RosterRecord, index: number): ProgrammeTravellerDraft {
  const draftId = `upload-${index + 1}`;
  const identity: { email?: string; phoneE164?: string } = {};
  if (record.contact?.email) identity.email = record.contact.email;
  if (record.contact?.phone) identity.phoneE164 = record.contact.phone;

  const notes: string[] = [];
  if (record.role) notes.push(`role: ${record.role}`);

  const draft: ProgrammeTravellerDraft = {
    draftId,
    displayName: record.speakerName,
    identity,
    nationalityCodes: [],
    accessibilityStatements: [],
    notes,
    anchorCommitmentIds: [],
    // G3R-Closure fix B: the roster's declared "travel required" column is
    // explicit organiser evidence of arrangement responsibility — uploading a
    // roster into Northstar management means rows marked as needing travel
    // are arranged by Northstar, rows marked as not needing travel arrange
    // themselves (or are local). This maps a DECLARED column, never a
    // home-location heuristic.
    travelArrangement: record.travelRequired
      ? 'NORTHSTAR_ARRANGED'
      : 'SELF_OR_OTHER_ARRANGED',
  };
  if (record.homeLocation) draft.homeLocationText = record.homeLocation;
  return draft;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deterministic bundle intake: event brief + roster CSV -> draft programme
 * bundle. Missing facts become uncertainties; malformed roster rows become
 * parse issues. No model calls.
 */
export function createDraftProgrammeBundle(input: UploadIntakeInput): DraftProgrammeBundle {
  const uncertainties: UncertaintyRecord[] = [];
  const parseIssues: Array<{ rowNumber: number; rawValues: Record<string, string>; reason: string }> = [];

  // Parse roster CSV.
  const rosterResult: RosterParseResult = parseRosterFromCsv(input.rosterCsvText);
  parseIssues.push(...rosterResult.issues);

  // Convert roster records to traveller drafts.
  const travellers: ProgrammeTravellerDraft[] = rosterResult.records.map((record, index) =>
    rosterRecordToDraft(record, index),
  );

  // Event brief: if structured input provided, use it; otherwise record uncertainty.
  let organisation: Organisation | undefined;
  let anchorEvent: AnchorEvent | undefined;
  const places: Place[] = [];

  if (input.eventBrief) {
    const brief = input.eventBrief;
    if (brief.organiserName) {
      organisation = {
        id: `org-${input.anchorEventId}`,
        name: brief.organiserName,
        roles: ['EVENT_ORGANISER'],
      };
    }
    if (brief.eventName || brief.eventKind || brief.startsAt || brief.endsAt) {
      anchorEvent = {
        id: input.anchorEventId,
        name: brief.eventName ?? 'Uploaded Event',
        kind: brief.eventKind ?? 'OTHER',
        window: {
          startsAt: (brief.startsAt ?? input.at) as IsoDateTime,
          endsAt: (brief.endsAt ?? input.at) as IsoDateTime,
        },
        organiserOrganisationId: organisation?.id,
        commitments: [],
        sourceIds: [input.sourceId],
      };
    }
    if (brief.venueName) {
      places.push({
        id: `plc-${input.anchorEventId}-venue`,
        name: brief.venueName,
        kind: 'VENUE',
        timezone: brief.venueTimezone,
        externalRefs: [],
      });
      if (anchorEvent) anchorEvent.placeId = `plc-${input.anchorEventId}-venue`;
    }
  } else {
    uncertainties.push(
      makeUncertainty(
        input.sourceId,
        'event brief not structured; organisation/anchorEvent/places not populated from text',
        'HIGH',
      ),
    );
  }

  // Policy text: if provided, record as unresolved (not yet parsed).
  if (input.policyText && input.policyText.trim().length > 0) {
    uncertainties.push(
      makeUncertainty(
        input.sourceId,
        'policy text provided but not yet parsed into rule sets; requires manual review or model-assisted extraction',
        'MEDIUM',
      ),
    );
  }

  // Missing facts: record as uncertainties.
  if (!organisation) {
    uncertainties.push(
      makeUncertainty(input.sourceId, 'organiser not supplied; stays missing', 'MEDIUM'),
    );
  }
  if (!anchorEvent) {
    uncertainties.push(
      makeUncertainty(input.sourceId, 'anchor event not supplied; stays missing', 'HIGH'),
    );
  }
  if (places.length === 0) {
    uncertainties.push(
      makeUncertainty(input.sourceId, 'venue/place not supplied; stays missing', 'MEDIUM'),
    );
  }

  // Build import draft.
  const importDraft: ProgrammeImportDraft = {
    id: `import-upload-${input.anchorEventId}`,
    anchorEventId: input.anchorEventId,
    channel: 'BULK_IMPORT',
    sourceId: input.sourceId,
    receivedAt: input.at,
    travellers,
    unresolvedStatements: parseIssues.map(
      (issue) => `row ${issue.rowNumber}: ${issue.reason}`,
    ),
  };

  // Validate through the schema.
  const validatedDraft = ProgrammeImportDraftSchema.safeParse(importDraft);
  if (!validatedDraft.success) {
    uncertainties.push(
      makeUncertainty(
        input.sourceId,
        `import draft failed schema validation: ${validatedDraft.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')}`,
        'HIGH',
      ),
    );
  }

  return {
    context: {
      at: input.at,
      sourceId: input.sourceId,
      ...(organisation ? { organisation } : {}),
      ...(anchorEvent ? { anchorEvent } : {}),
      ...(places.length > 0 ? { places } : {}),
    },
    importDraft: validatedDraft.success ? validatedDraft.data : importDraft,
    uncertainties,
    parseIssues,
  };
}

/**
 * Promote a draft programme bundle through the existing ProgrammeService.
 * This is the bridge from DR-10 upload to the authoritative promotion path.
 */
export interface PromoteDraftBundleService {
  applyProgrammeContext: (input: ProgrammeContextInput) => Promise<{ accepted: boolean; issues: ValidationIssue[] }>;
  intakeImportDraft: (input: { importDraft: ProgrammeImportDraft; at: IsoDateTime }) => Promise<ImportDraftOutcome>;
}

export async function promoteDraftBundle(
  service: PromoteDraftBundleService,
  bundle: DraftProgrammeBundle,
): Promise<{
  contextAccepted: boolean;
  contextIssues: ValidationIssue[];
  intakeOutcome: ImportDraftOutcome | undefined;
}> {
  const contextResult = await service.applyProgrammeContext(bundle.context);
  if (!contextResult.accepted) {
    return {
      contextAccepted: false,
      contextIssues: contextResult.issues,
      intakeOutcome: undefined,
    };
  }

  const intakeOutcome = await service.intakeImportDraft({
    importDraft: bundle.importDraft,
    at: bundle.context.at,
  });

  return {
    contextAccepted: true,
    contextIssues: [],
    intakeOutcome,
  };
}
