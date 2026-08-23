/**
 * Northstar RV-N1 / RV-N2 / Case C foundation — programme coordination.
 *
 * AnchorEvent is the shared programme context; Trip remains the
 * per-traveller operational aggregate. This service contains NO second
 * recovery engine: drafts become state only through the frozen
 * MutationService, and a shared commitment change fans out into ordinary
 * per-Trip signals processed by the existing signal pipeline.
 *
 * Anti-fabrication discipline: promotion never invents airports,
 * nationalities, passports, bookings or dates. Anything missing stays
 * missing and is recorded as an issue/uncertainty on the promotion outcome
 * and in the audit trail.
 */
import type { EntityId, IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import {
  AnchorCommitmentChangePayloadSchema,
  type AnchorCommitmentChangePayload,
} from '../operational/signal.ts';
import { TripSignalSchema, type TripSignal } from '../operational/signal.ts';
import type { MutationOperation, MutationProposal } from '../operational/mutation.ts';
import type {
  AnchorEvent,
  Organisation,
  Place,
  Traveller,
} from '../domain/entities.ts';
import type { RuleSet } from '../domain/rules.ts';
import type { Trip } from '../domain/trip.ts';
import type { Engagement } from '../domain/elements.ts';
import {
  ProgrammeImportDraftSchema,
  type ProgrammeImportDraft,
  type ProgrammeTravellerDraft,
  type PromotionOutcome,
} from '../contracts/programmeIntake.ts';
import type { MutationService, ValidationIssue } from '../contracts/services.ts';
import type { AuditRepository, CaseRepository, SignalRepository, SourceRepository, TripRepository } from '../contracts/repositories.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { processSignal, type ProcessedSignal } from './signalPipeline.ts';

export interface ProgrammeServiceDeps {
  mutations: MutationService;
  entities: EntityStore;
  trips: TripRepository;
  sources: SourceRepository;
  audit: AuditRepository;
}

export interface ProgrammeContextInput {
  at: IsoDateTime;
  sourceId: EntityId;
  organisation?: Organisation;
  anchorEvent?: AnchorEvent;
  places?: Place[];
  ruleSets?: RuleSet[];
}

export interface ImportDraftOutcome {
  importDraftId: EntityId;
  outcomes: PromotionOutcome[];
  accepted: boolean;
}

export interface CommitmentFanOutOutcome {
  accepted: boolean;
  anchorEventId?: EntityId;
  commitmentId?: EntityId;
  changeKind?: AnchorCommitmentChangePayload['changeKind'];
  /** Trips linked to the changed commitment via Engagement.anchorCommitmentId. */
  linkedTripCount: number;
  /** Trips of the same event whose engagements do NOT reference the commitment. */
  unlinkedTripCount: number;
  processed: ProcessedSignal[];
  issues: ValidationIssue[];
}

export class ProgrammeService {
  private readonly deps: ProgrammeServiceDeps;

  constructor(deps: ProgrammeServiceDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // Programme context (event/organisation/policy creation via validated path)
  // -------------------------------------------------------------------------

  async applyProgrammeContext(input: ProgrammeContextInput): Promise<{ accepted: boolean; issues: ValidationIssue[] }> {
    const operations: MutationOperation[] = [];
    if (input.organisation) {
      operations.push({ op: 'UPSERT_ENTITY', entityType: 'ORGANISATION', id: input.organisation.id, data: input.organisation });
    }
    for (const place of input.places ?? []) {
      operations.push({ op: 'UPSERT_ENTITY', entityType: 'PLACE', id: place.id, data: place });
    }
    for (const ruleSet of input.ruleSets ?? []) {
      operations.push({ op: 'UPSERT_ENTITY', entityType: 'RULE_SET', id: ruleSet.id, data: ruleSet });
    }
    if (input.anchorEvent) {
      operations.push({ op: 'UPSERT_ENTITY', entityType: 'ANCHOR_EVENT', id: input.anchorEvent.id, data: input.anchorEvent });
    }
    if (operations.length === 0) return { accepted: true, issues: [] };

    const outcome = await this.deps.mutations.applyProposal({
      id: `prop-programme-context-${input.anchorEvent?.id ?? input.organisation?.id ?? input.sourceId}`,
      origin: 'SYSTEM',
      sourceId: input.sourceId,
      requestedAt: input.at,
      rationale: 'create/update programme context entities from validated intake context',
      operations,
    });
    return { accepted: outcome.accepted, issues: outcome.issues };
  }

  // -------------------------------------------------------------------------
  // Intake promotion — the ONLY draft -> authoritative state path (RV-N2)
  // -------------------------------------------------------------------------

  async intakeImportDraft(input: { importDraft: ProgrammeImportDraft; at: IsoDateTime }): Promise<ImportDraftOutcome> {
    const draft = ProgrammeImportDraftSchema.parse(input.importDraft);
    const anchorEvent = await this.getAnchorEvent(draft.anchorEventId);
    const commitmentById = new Map((anchorEvent?.commitments ?? []).map((commitment) => [commitment.id, commitment]));

    const outcomes: PromotionOutcome[] = [];
    for (const traveller of draft.travellers) {
      outcomes.push(await this.promoteOne({ draft, traveller, at: input.at, commitmentById }));
    }

    await this.deps.audit.append({
      occurredAt: input.at,
      actor: 'app:programme-intake',
      action: 'INTAKE_IMPORT_PROCESSED',
      subject: draft.anchorEventId,
      payload: {
        importDraftId: draft.id,
        channel: draft.channel,
        sourceId: draft.sourceId,
        travellerCount: draft.travellers.length,
        promotedCount: outcomes.filter((outcome) => outcome.promoted).length,
        unresolvedStatements: draft.unresolvedStatements,
        outcomes: outcomes.map((outcome) => ({
          draftId: outcome.draftId,
          promoted: outcome.promoted,
          ...(outcome.travellerId ? { travellerId: outcome.travellerId } : {}),
          ...(outcome.tripId ? { tripId: outcome.tripId } : {}),
          issues: outcome.issues,
        })),
      },
    });

    return {
      importDraftId: draft.id,
      outcomes,
      accepted: outcomes.length > 0 ? outcomes.some((outcome) => outcome.promoted) : true,
    };
  }

  private async promoteOne(input: {
    draft: ProgrammeImportDraft;
    traveller: ProgrammeTravellerDraft;
    at: IsoDateTime;
    commitmentById: Map<EntityId, AnchorEvent['commitments'][number]>;
  }): Promise<PromotionOutcome> {
    const { draft, traveller, at } = input;
    const issues: string[] = [];

    // Deterministic identity resolution against persisted travellers. The
    // ontology carries name + passport evidence; ambiguity is recorded,
    // never guessed away.
    const existing = await this.resolveExistingTraveller(traveller);
    if (existing === 'AMBIGUOUS') {
      return {
        draftId: traveller.draftId,
        promoted: false,
        issues: ['identity hints match more than one existing traveller; refusing to guess which one'],
      };
    }

    const travellerId = existing?.id ?? `trv-${draft.anchorEventId}-${traveller.draftId}`;
    const tripId = existing
      ? await this.findTripForTraveller(travellerId)
      : undefined;

    // Missing facts stay missing: nationality/passport/home are only present
    // when the draft actually carries them.
    const travellerEntity: Traveller = {
      id: travellerId,
      name: traveller.displayName,
      ...(traveller.nationalityCodes.length > 0
        ? {
            nationalityCodes: {
              value: traveller.nationalityCodes,
              sourceId: draft.sourceId,
              authority: 'ASSERTED',
              observedAt: at,
            },
          }
        : {}),
      accessibilityRequirements: traveller.accessibilityStatements.map((statement, index) => ({
        id: `acc-${travellerId}-${index + 1}`,
        kind: 'OTHER',
        statement,
        sourceId: draft.sourceId,
      })),
      insuranceRuleSetIds: [],
      loyaltyContext: [],
      ...(traveller.notes.length > 0 ? { communicationPreference: traveller.notes.join('; ') } : {}),
    };

    // Home-airport linkage (Northstar initial planning evidence): an exact,
    // unambiguous match between homeLocationText and an authoritative AIRPORT
    // place (airport-code ref or place name) links the traveller home.
    // Anything else stays missing — never guessed.
    if (traveller.homeLocationText) {
      const home = await this.resolveHomeAirport(traveller.homeLocationText);
      if (home === 'AMBIGUOUS') {
        issues.push('home location matches more than one known airport; refusing to guess which one');
      } else if (home) {
        travellerEntity.homePlaceId = home;
      }
    }

    // Commitment linkage: draft ids must exist on the programme's event.
    const validCommitmentIds: EntityId[] = [];
    for (const commitmentId of traveller.anchorCommitmentIds) {
      if (input.commitmentById.has(commitmentId)) {
        validCommitmentIds.push(commitmentId);
      } else {
        issues.push(`anchor commitment ${commitmentId} is not part of event ${draft.anchorEventId}; not linked`);
      }
    }

    const resolvedTripId = tripId ?? `trip-${travellerId}`;
    const operations: MutationOperation[] = [
      { op: 'UPSERT_ENTITY', entityType: 'TRAVELLER', id: travellerId, data: travellerEntity },
    ];

    if (!tripId) {
      const engagements: Engagement[] = validCommitmentIds.map((commitmentId, index) => {
        const commitment = input.commitmentById.get(commitmentId);
        if (!commitment) throw new Error('unreachable: commitment validated above');
        return {
          id: `el-${resolvedTripId}-eng-${index + 1}`,
          tripId: resolvedTripId,
          elementKind: 'ENGAGEMENT',
          importance: 'PREFERRED',
          flexibility: 'FIXED',
          reservationState: 'NONE',
          status: 'UNKNOWN',
          dependsOn: [],
          governedByRuleSetIds: [],
          data: {
            title: commitment.title,
            ...(commitment.placeId ? { placeId: commitment.placeId } : {}),
            startsAt: {
              value: commitment.startsAt.value,
              sourceId: draft.sourceId,
              authority: 'CONNECTED',
              observedAt: at,
            },
            ...(commitment.endsAt
              ? {
                  endsAt: {
                    value: commitment.endsAt.value,
                    sourceId: draft.sourceId,
                    authority: 'CONNECTED',
                    observedAt: at,
                  },
                }
              : {}),
            anchorEventId: draft.anchorEventId,
            anchorCommitmentId: commitmentId,
          },
        };
      });

      const objectives = validCommitmentIds.map((commitmentId, index) => {
        const commitment = input.commitmentById.get(commitmentId);
        return {
          id: `obj-${resolvedTripId}-${index + 1}`,
          tripId: resolvedTripId,
          statement: `Participate in “${commitment?.title ?? commitmentId}”`,
          // Binding strength is per traveller and unconfirmed at intake:
          // soft until the traveller or operator confirms otherwise.
          hardness: 'SOFT' as const,
          status: 'ACTIVE' as const,
          linkedElementIds: [`el-${resolvedTripId}-eng-${index + 1}`],
          sourceId: draft.sourceId,
        };
      });

      const tripEntity: Trip = {
        id: resolvedTripId,
        label: traveller.displayName,
        travellerIds: [travellerId],
        anchorEventId: draft.anchorEventId,
        elements: engagements,
        objectives,
        relations: [],
        governedByRuleSetIds: [],
        viability: 'UNKNOWN',
        version: 0,
        updatedAt: at,
      };
      operations.push({ op: 'UPSERT_ENTITY', entityType: 'TRIP', id: resolvedTripId, data: tripEntity });
    } else {
      // LATER_UPDATE path: keep the existing trip; only traveller facts move.
      issues.push(...(validCommitmentIds.length > 0 && draft.channel === 'LATER_UPDATE'
        ? ['commitment linkage updates are handled by recovery, not intake; existing trip kept']
        : []));
    }

    if (traveller.nationalityCodes.length === 0) {
      issues.push('nationality not supplied — stays missing until provided');
    }
    if (!traveller.homeLocationText) {
      issues.push('home location not supplied — stays missing until provided');
    }

    const proposal: MutationProposal = {
      id: `prop-intake-${draft.id}-${traveller.draftId}`,
      origin: 'SYSTEM',
      sourceId: draft.sourceId,
      requestedAt: at,
      rationale: `promote programme intake draft ${traveller.draftId} (channel ${draft.channel})`,
      operations,
    };
    const outcome = await this.deps.mutations.applyProposal(proposal);
    return {
      draftId: traveller.draftId,
      promoted: outcome.accepted,
      ...(outcome.accepted ? { travellerId, tripId: resolvedTripId } : {}),
      issues: [...issues, ...outcome.issues.map((issue) => `${issue.code}: ${issue.message}`)],
    };
  }

  /**
   * Match free-form home location text against authoritative AIRPORT places.
   * Exact case-insensitive match on an airport-code external ref or the place
   * name. Ambiguous matches refuse; no match stays missing (anti-fabrication).
   */
  private async resolveHomeAirport(homeLocationText: string): Promise<EntityId | 'AMBIGUOUS' | undefined> {
    const wanted = homeLocationText.trim().toLowerCase();
    if (wanted === '') return undefined;
    const airports = (await this.deps.entities.list('PLACE'))
      .filter((entry): entry is { entityType: 'PLACE'; entity: Place } => entry.entityType === 'PLACE')
      .map((entry) => entry.entity)
      .filter((place) => place.kind === 'AIRPORT');
    const matches = airports.filter((place) => {
      if (place.name && place.name.trim().toLowerCase() === wanted) return true;
      return place.externalRefs.some(
        (ref) => ref.system === 'airport-code' && ref.value.trim().toLowerCase() === wanted,
      );
    });
    if (matches.length === 0) return undefined;
    if (matches.length > 1) return 'AMBIGUOUS';
    return matches[0]?.id;
  }

  private async resolveExistingTraveller(
    traveller: ProgrammeTravellerDraft,
  ): Promise<Traveller | 'AMBIGUOUS' | undefined> {
    const all = (await this.deps.entities.list('TRAVELLER'))
      .filter((entry) => entry.entityType === 'TRAVELLER')
      .map((entry) => entry.entity);
    const normalizedName = traveller.displayName.trim().toLowerCase();
    const passport = traveller.identity.passportNumber;
    const matches = all.filter((candidate) => {
      if (candidate.name.trim().toLowerCase() === normalizedName) return true;
      if (passport) {
        const passportValues = candidate.passports?.value ?? [];
        if (passportValues.some((value) => value.countryCode && passport.startsWith(value.countryCode))) {
          return false; // weak prefix is not a match
        }
      }
      return false;
    });
    if (matches.length === 0) return undefined;
    if (matches.length > 1) return 'AMBIGUOUS';
    return matches[0];
  }

  private async findTripForTraveller(travellerId: EntityId): Promise<EntityId | undefined> {
    for (const summary of await this.deps.trips.listTrips()) {
      const trip = await this.deps.trips.getTrip(summary.tripId);
      if (trip?.travellerIds.includes(travellerId)) return trip.id;
    }
    return undefined;
  }

  private async getAnchorEvent(anchorEventId: EntityId): Promise<AnchorEvent | undefined> {
    const entry = await this.deps.entities.get('ANCHOR_EVENT', anchorEventId);
    return entry?.entityType === 'ANCHOR_EVENT' ? entry.entity : undefined;
  }
}

// ---------------------------------------------------------------------------
// RV-N1 fan-out: shared commitment change -> per-Trip normalized processing
// ---------------------------------------------------------------------------

/**
 * Validate an ANCHOR_COMMITMENT_CHANGE signal payload and update the shared
 * commitment through the validated mutation path. Returns the per-Trip
 * signals that the existing pipeline must process — fan-out is linkage by
 * `Engagement.data.anchorCommitmentId`, never title matching. Unrelated
 * trips produce no signals at all.
 */
export async function prepareCommitmentFanOut(
  deps: { mutations: MutationService; entities: EntityStore; trips: TripRepository; audit: AuditRepository },
  signal: TripSignal,
): Promise<{ anchorEventId: EntityId; payload: AnchorCommitmentChangePayload; perTripSignals: TripSignal[]; issues: ValidationIssue[] }> {
  const parsedPayload = AnchorCommitmentChangePayloadSchema.safeParse(signal.payload);
  if (!parsedPayload.success) {
    const issues: ValidationIssue[] = parsedPayload.error.issues.map((issue) => ({
      code: 'COMMITMENT_CHANGE_PAYLOAD_INVALID',
      message: `${issue.path.join('.') || '<root>'}: ${issue.message}`,
    }));
    return { anchorEventId: '', payload: { anchorEventId: '', commitmentId: '', changeKind: 'OTHER' }, perTripSignals: [], issues };
  }
  const payload = parsedPayload.data;

  const entry = await deps.entities.get('ANCHOR_EVENT', payload.anchorEventId);
  if (!entry || entry.entityType !== 'ANCHOR_EVENT') {
    return {
      anchorEventId: payload.anchorEventId,
      payload,
      perTripSignals: [],
      issues: [{ code: 'UNKNOWN_ANCHOR_EVENT', message: `anchor event ${payload.anchorEventId} not found` }],
    };
  }
  const anchorEvent = entry.entity;
  const commitment = anchorEvent.commitments.find((candidate) => candidate.id === payload.commitmentId);
  if (!commitment) {
    return {
      anchorEventId: payload.anchorEventId,
      payload,
      perTripSignals: [],
      issues: [{ code: 'UNKNOWN_COMMITMENT', message: `commitment ${payload.commitmentId} not found on event ${payload.anchorEventId}` }],
    };
  }

  // Shared programme truth moves through the frozen mutation path: the
  // commitment's fact fields are replaced under the fact-authority ladder.
  const updatedCommitment = {
    ...commitment,
    ...(payload.newStartsAt
      ? {
          startsAt: {
            value: payload.newStartsAt,
            sourceId: signal.sourceId,
            authority: signal.authority,
            observedAt: signal.receivedAt ?? signal.occurredAt,
          },
        }
      : {}),
    ...(payload.newEndsAt
      ? {
          endsAt: {
            value: payload.newEndsAt,
            sourceId: signal.sourceId,
            authority: signal.authority,
            observedAt: signal.receivedAt ?? signal.occurredAt,
          },
        }
      : {}),
    ...(payload.newPlaceId ? { placeId: payload.newPlaceId } : {}),
  };
  const updatedEvent: AnchorEvent = {
    ...anchorEvent,
    commitments: anchorEvent.commitments.map((candidate) =>
      candidate.id === commitment.id ? updatedCommitment : candidate,
    ),
  };
  const outcome = await deps.mutations.applyProposal({
    id: `prop-commitment-change-${payload.commitmentId}-${signal.id}`,
    origin: 'SYSTEM',
    sourceId: signal.sourceId,
    requestedAt: signal.receivedAt ?? signal.occurredAt,
    rationale: `apply ${payload.changeKind} change to shared commitment ${payload.commitmentId}`,
    operations: [
      { op: 'UPSERT_ENTITY', entityType: 'ANCHOR_EVENT', id: anchorEvent.id, data: updatedEvent },
    ],
  });
  if (!outcome.accepted) {
    return { anchorEventId: payload.anchorEventId, payload, perTripSignals: [], issues: outcome.issues };
  }

  // Fan out: only trips of THIS event whose engagement references the
  // commitment receive an ordinary per-Trip signal.
  const perTripSignals: TripSignal[] = [];
  for (const summary of await deps.trips.listTrips()) {
    const trip = await deps.trips.getTrip(summary.tripId);
    if (!trip || trip.anchorEventId !== payload.anchorEventId) continue;
    const engagements = trip.elements.filter(
      (element): element is Engagement =>
        element.elementKind === 'ENGAGEMENT' && element.data.anchorCommitmentId === payload.commitmentId,
    );
    for (const engagement of engagements) {
      perTripSignals.push(
        TripSignalSchema.parse({
          id: `sig-fanout-${signal.id}-${trip.id}-${engagement.id}`,
          kind: 'ANCHOR_COMMITMENT_CHANGE',
          occurredAt: signal.occurredAt,
          ...(signal.receivedAt ? { receivedAt: signal.receivedAt } : {}),
          sourceId: signal.sourceId,
          authority: signal.authority,
          tripId: trip.id,
          subjectRef: { entityType: 'TRIP_ELEMENT', id: engagement.id },
          summary: payload.summary ?? `shared commitment ${payload.changeKind.toLowerCase()} affecting engagement ${engagement.id}`,
          payload: {
            commitmentId: payload.commitmentId,
            changeKind: payload.changeKind,
            ...(payload.newStartsAt ? { newStartsAt: payload.newStartsAt } : {}),
            ...(payload.newEndsAt ? { newEndsAt: payload.newEndsAt } : {}),
            ...(payload.newPlaceId ? { newPlaceId: payload.newPlaceId } : {}),
          },
        }),
      );
    }
  }

  await deps.audit.append({
    occurredAt: signal.receivedAt ?? signal.occurredAt,
    actor: 'app:programme',
    action: 'COMMITMENT_CHANGE_FANOUT',
    subject: payload.anchorEventId,
    payload: {
      signalId: signal.id,
      commitmentId: payload.commitmentId,
      changeKind: payload.changeKind,
      perTripSignalIds: perTripSignals.map((tripSignal) => tripSignal.id),
    },
  });

  return { anchorEventId: payload.anchorEventId, payload, perTripSignals, issues: [] };
}

/**
 * Full Case-C foundation path: commitment change -> authoritative shared
 * truth update -> per-trip fan-out through the existing signal pipeline
 * (mutation -> impact -> case). No second engine anywhere in this flow.
 */
export async function processCommitmentChange(
  deps: {
    mutations: MutationService;
    entities: EntityStore;
    trips: TripRepository;
    signals: SignalRepository;
    cases: CaseRepository;
    audit: AuditRepository;
  },
  signal: TripSignal,
): Promise<CommitmentFanOutOutcome> {
  const prepared = await prepareCommitmentFanOut(deps, signal);
  if (prepared.issues.length > 0 || prepared.perTripSignals.length === 0) {
    return {
      accepted: prepared.issues.length === 0,
      anchorEventId: prepared.anchorEventId || undefined,
      commitmentId: prepared.payload.commitmentId || undefined,
      changeKind: prepared.payload.changeKind,
      linkedTripCount: 0,
      unlinkedTripCount: 0,
      processed: [],
      issues: prepared.issues,
    };
  }

  const processed: ProcessedSignal[] = [];
  for (const tripSignal of prepared.perTripSignals) {
    processed.push(
      await processSignal(
        {
          trips: deps.trips,
          signals: deps.signals,
          entities: deps.entities,
          cases: deps.cases,
          mutations: deps.mutations,
          audit: deps.audit,
        },
        tripSignal,
      ),
    );
  }

  const linkedTripIds = new Set(processed.map((result) => result.tripId));
  let eventTripCount = 0;
  for (const summary of await deps.trips.listTrips()) {
    const trip = await deps.trips.getTrip(summary.tripId);
    if (trip?.anchorEventId === prepared.anchorEventId) eventTripCount += 1;
  }

  return {
    accepted: true,
    anchorEventId: prepared.anchorEventId,
    commitmentId: prepared.payload.commitmentId,
    changeKind: prepared.payload.changeKind,
    linkedTripCount: linkedTripIds.size,
    unlinkedTripCount: Math.max(0, eventTripCount - linkedTripIds.size),
    processed,
    issues: [],
  };
}

/** Uncertainty helper for intake surfaces: honest statements, never guesses. */
export function intakeUncertainties(importDraft: ProgrammeImportDraft, outcomes: PromotionOutcome[]): UncertaintyRecord[] {
  const records: UncertaintyRecord[] = [];
  importDraft.unresolvedStatements.forEach((statement, index) => {
    records.push({
      id: `unc-intake-${importDraft.id}-${index + 1}`,
      statement,
      aboutRefs: [],
      sourceId: importDraft.sourceId,
      severity: 'MEDIUM',
    });
  });
  for (const outcome of outcomes) {
    if (outcome.promoted) continue;
    records.push({
      id: `unc-intake-${importDraft.id}-${outcome.draftId}`,
      statement: `draft ${outcome.draftId} could not be promoted: ${outcome.issues.join('; ') || 'unknown reason'}`,
      aboutRefs: [],
      sourceId: importDraft.sourceId,
      severity: 'HIGH',
    });
  }
  return records;
}
