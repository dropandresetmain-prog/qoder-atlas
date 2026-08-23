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
import type { Constraint } from '../domain/constraints.ts';
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
    const governingRuleSetIds = await this.governingRuleSetIdsFor(anchorEvent);
    const commitmentById = new Map((anchorEvent?.commitments ?? []).map((commitment) => [commitment.id, commitment]));

    const outcomes: PromotionOutcome[] = [];
    for (const traveller of draft.travellers) {
      outcomes.push(await this.promoteOne({ draft, traveller, at: input.at, commitmentById, governingRuleSetIds }));
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
    governingRuleSetIds: EntityId[];
  }): Promise<PromotionOutcome> {
    const { draft, traveller, at } = input;
    const issues: string[] = [];

    // Fail-closed identity resolution: a draft may only be reconciled with an
    // existing Traveller through the stable deterministic identifier
    // `trv-{anchorEventId}-{draftId}`. Display-name similarity is never
    // identity evidence — fresh intake with a coincidental name collision
    // simply creates a distinct Traveller (no merge is possible by
    // construction), while an UPDATE that cannot identify its subject refuses.
    const existing = await this.resolveExistingTraveller(traveller, draft.anchorEventId);
    if (!existing && draft.channel === 'LATER_UPDATE') {
      const collision = await this.sameProgrammeNameCollision(traveller, draft.anchorEventId);
      return {
        draftId: traveller.draftId,
        promoted: false,
        issues: [
          collision > 0
            ? `LATER_UPDATE could not safely identify the traveller: display name matches ${collision} existing traveller(s) in this programme and no deterministic identifier was supplied; refusing to guess — no existing trip was modified`
            : 'LATER_UPDATE could not identify an existing traveller: no deterministic identifier matches a persisted Traveller; refusing to apply an update with an unknown subject',
        ],
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
          // Binding strength is per traveller (ADR-034: commitments carry no
          // global hardness) and intake evidence offers none — SOFT is the
          // derived outcome of that absence, recorded explicitly below, never
          // a silent constant.
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
        // Programme policy applicability is derived from evidence: rule sets
        // owned by the event's organiser. Element-level governing stays empty
        // at intake — no rule-set-to-element evidence exists yet.
        governedByRuleSetIds: input.governingRuleSetIds,
        viability: 'UNKNOWN',
        version: 0,
        updatedAt: at,
      };
      operations.push({ op: 'UPSERT_ENTITY', entityType: 'TRIP', id: resolvedTripId, data: tripEntity });

      // Judgeability (REV-2 WP-R2): every commitment-linked engagement gains
      // a deterministic TEMPORAL HARD constraint binding arrival evidence to
      // the commitment start. Arrival evidence arrives later via recovery
      // proposals, so the constraint references the trip's shared arrival
      // slot — a promotion-known element id the planner fills. Until some
      // evidence fills it the constraint stays HARD UNKNOWN, so no candidate
      // ignoring the arrival requirement can ever be feasible.
      const arrivalSlotId = `el-${resolvedTripId}-arrival`;
      for (const engagement of engagements) {
        const constraint: Constraint = {
          id: `c-${resolvedTripId}-arrival-before-${engagement.id}`,
          kind: 'TEMPORAL',
          hardness: 'HARD',
          evaluator: 'DETERMINISTIC',
          status: 'UNKNOWN',
          description: 'arrival evidence must precede the linked commitment start',
          refs: [
            { entityType: 'TRIP_ELEMENT', id: arrivalSlotId },
            { entityType: 'TRIP_ELEMENT', id: engagement.id },
          ],
          // Programme intake carries no arrival-buffer evidence: the
          // minBufferMinutes parameter is deliberately ABSENT (evaluator
          // default zero applies), recorded as a decision — never fabricated.
          sourceId: draft.sourceId,
        };
        operations.push({ op: 'UPSERT_CONSTRAINT', constraint });
      }

      // Absent evidence is a recorded decision, not a silent constant.
      issues.push(
        'recorded decision: objective hardness SOFT — intake carries no binding-strength evidence (ADR-034); reprioritisation remains an approval-gated state change',
      );
      issues.push(
        'recorded decision: arrival-buffer parameter absent — programme intake carries no buffer evidence; zero buffer is a recorded absence, not a fabricated default',
      );
      if (input.governingRuleSetIds.length === 0) {
        issues.push(
          'recorded decision: no governing rule sets attached — no rule set owned by the event organiser exists at promotion time',
        );
      }
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

  /**
   * Fail-closed identity resolution (Wave 3 triage). The ONLY evidence strong
   * enough to reconcile a draft with an existing Traveller is the stable
   * deterministic promotion identifier `trv-{anchorEventId}-{draftId}` — the
   * same derivation `promoteOne` uses at creation. Display-name similarity is
   * NEVER identity evidence here: two different people may share a name, and
   * the frozen Traveller entity carries no stored hint (email/phone/DoB) that
   * could corroborate one. What this method does not establish, no other code
   * guesses away — the caller surfaces the collision instead.
   */
  private async resolveExistingTraveller(
    traveller: ProgrammeTravellerDraft,
    anchorEventId: EntityId,
  ): Promise<Traveller | undefined> {
    const deterministicId = `trv-${anchorEventId}-${traveller.draftId}`;
    const entry = await this.deps.entities.get('TRAVELLER', deterministicId);
    return entry?.entityType === 'TRAVELLER' ? entry.entity : undefined;
  }

  /**
   * Count persisted travellers in the SAME programme whose display name equals
   * the draft's (case-insensitive, trimmed). Cross-programme names are
   * unrelated by construction — intake never scopes identity beyond the draft's
   * own anchor event. A non-zero count means promotion must fail closed unless
   * the deterministic identifier already resolved the draft.
   */
  private async sameProgrammeNameCollision(traveller: ProgrammeTravellerDraft, anchorEventId: EntityId): Promise<number> {
    const wanted = traveller.displayName.trim().toLowerCase();
    if (wanted.length === 0) return 0;
    return (await this.deps.entities.list('TRAVELLER'))
      .filter((entry): entry is { entityType: 'TRAVELLER'; entity: Traveller } => entry.entityType === 'TRAVELLER')
      .map((entry) => entry.entity)
      .filter((candidate) => candidate.id.startsWith(`trv-${anchorEventId}-`))
      .filter((candidate) => candidate.name.trim().toLowerCase() === wanted).length;
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

  /**
   * Rule sets applicable to a programme trip: those owned by the anchor
   * event's organiser organisation. Generic ownership derivation only — no
   * scenario knowledge. Sorted for deterministic promotion output.
   */
  private async governingRuleSetIdsFor(anchorEvent: AnchorEvent | undefined): Promise<EntityId[]> {
    if (!anchorEvent?.organiserOrganisationId) return [];
    const organiserOrganisationId = anchorEvent.organiserOrganisationId;
    return (await this.deps.entities.list('RULE_SET'))
      .filter((entry): entry is { entityType: 'RULE_SET'; entity: RuleSet } => entry.entityType === 'RULE_SET')
      .map((entry) => entry.entity)
      .filter((ruleSet) => ruleSet.ownerOrganisationId === organiserOrganisationId)
      .map((ruleSet) => ruleSet.id)
      .sort();
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
    // Recorded decisions (promotion-time derivations where intake evidence is
    // absent) are honest unknowns for downstream consumers — surfaced as
    // uncertainties, identical wording, in outcome order.
    outcome.issues
      .filter((issue) => issue.startsWith('recorded decision:'))
      .forEach((decision, index) => {
        records.push({
          id: `unc-intake-${importDraft.id}-${outcome.draftId}-decision-${index + 1}`,
          statement: decision,
          aboutRefs: [],
          sourceId: importDraft.sourceId,
          severity: 'MEDIUM',
        });
      });
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
