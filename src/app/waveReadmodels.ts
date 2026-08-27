/**
 * Wave 3 Gate 2 — app-layer operational surfaces for the UI lane.
 *
 * These projections extend the frozen read models (src/contracts/readmodels.ts)
 * without modifying them, following the same app-layer pattern as
 * src/ui/case-view-model.ts. Everything is projected from persisted
 * authoritative state — audit, cases, trips, impact assessments, capability
 * descriptors — never re-derived in the frontend:
 *
 *  - approvals:   pending authority decisions across trips, with the amount,
 *                 deterministic funding allocation, and the decision surface
 *                 that must act (traveller decision endpoint or org approval).
 *  - activity:    user-facing copy assembled from REAL audit entries.
 *  - uncertainties: unresolved unknowns per trip (UNKNOWN is first-class,
 *                 never silently mapped to PASS).
 *  - providers:   truthful adapter-mode provenance per capability.
 */
import type { EntityId, IsoDateTime, Money } from '../domain/common.ts';
import { describeAllocation } from '../engine/funding.ts';
import type { AuthorityDecision, ActionIntent, CostAllocation } from '../operational/intent.ts';
import type { AdapterMode } from '../config/config.ts';
import type { CapabilityFamily } from '../operational/strategy.ts';
import type { CapabilityDescriptor } from '../contracts/capabilities.ts';
import { ImpactEngine } from '../engine/impact.ts';
import type { ReadModelDependencies } from './readmodels.ts';
import { latestCaseFor } from './readmodels.ts';
import { presentAction, presentActivity, presentActivityActor, presentApprovalReason, presentUncertainties } from './presentation.ts';

/** The decision surface that must act on a pending approval. */
export type ApprovalRequestedFrom = 'TRAVELLER' | 'ORGANISATION' | 'HUMAN_AGENT';

export interface ApprovalRequestView {
  caseId: EntityId;
  tripId: EntityId;
  /** Traveller names on the trip (resolved, user-facing). */
  travellerNames: string[];
  decisionId: string;
  requestedFrom: ApprovalRequestedFrom;
  requestedAt: IsoDateTime;
  /** User-facing description of the action awaiting approval. */
  action: string;
  /** Incremental cost of the underlying action intent, when priced. */
  amount?: Money;
  /** Deterministic funding allocation (ADR-037), when computed. */
  funding?: { allocation: CostAllocation; summary: string };
  /** Where this request came from (real audit evidence, never guessed). */
  reason: string;
}

export interface ApprovalsQueueView {
  generatedAt: IsoDateTime;
  pending: ApprovalRequestView[];
}

export interface ActivityEventView {
  /** Raw audit action — stable machine identifier for filtering. */
  action: string;
  /** User-facing copy; falls back to the raw action, never empty. */
  summary: string;
  occurredAt: IsoDateTime;
  actor: string;
  /** Entity the event is about (trip, case, event, programme), when known. */
  subject?: string;
}

export interface TripActivityView {
  tripId: EntityId;
  generatedAt: IsoDateTime;
  events: ActivityEventView[];
}

export interface TripUncertaintiesView {
  tripId: EntityId;
  generatedAt: IsoDateTime;
  /** Unresolved unknowns from the deterministic impact assessment. */
  uncertainties: string[];
}

export interface ProviderCapabilityView {
  family: CapabilityFamily;
  providerId: string;
  /** Truthful adapter mode; the UI must render this provenance verbatim. */
  mode: AdapterMode;
  supportedOperations: string[];
  /** Human label for the mode — copy only, never a status judgement. */
  modeLabel: string;
}

export interface ProviderSurfaceView {
  generatedAt: IsoDateTime;
  capabilities: ProviderCapabilityView[];
}

function requestedFromFor(outcome: AuthorityDecision['outcome']): ApprovalRequestedFrom | undefined {
  switch (outcome) {
    case 'REQUIRES_TRAVELLER':
      return 'TRAVELLER';
    case 'REQUIRES_ORGANISATION_APPROVER':
      return 'ORGANISATION';
    case 'REQUIRES_HUMAN_AGENT':
      return 'HUMAN_AGENT';
    default:
      return undefined;
  }
}

/**
 * Pending authority decisions across ALL trips — the programme-scale approval
 * queue. Projected from persisted cases; amounts and funding come from the
 * action intent the authority stage produced (never re-derived here).
 */
export async function projectApprovalsQueue(
  deps: ReadModelDependencies,
  generatedAt: IsoDateTime,
): Promise<ApprovalsQueueView> {
  const pending: ApprovalRequestView[] = [];
  const summaries = await deps.snapshot.trips.listTrips();

  for (const summary of summaries) {
    const recoveryCase = await latestCaseFor(deps.cases, summary.tripId);
    if (!recoveryCase) continue;

    const travellerNames: string[] = [];
    const trip = await deps.snapshot.trips.getTrip(summary.tripId);
    if (trip) {
      for (const travellerId of trip.travellerIds) {
        const entry = await deps.snapshot.entities.get('TRAVELLER', travellerId);
        if (entry?.entityType === 'TRAVELLER') travellerNames.push(entry.entity.name);
      }
    }

    for (const decision of recoveryCase.authorityDecisions) {
      const requestedFrom = requestedFromFor(decision.outcome);
      if (!requestedFrom || decision.approval !== undefined) continue;
      const intent: ActionIntent | undefined = recoveryCase.actionIntents.find((i) => i.id === decision.intentId);
      pending.push({
        caseId: recoveryCase.id,
        tripId: recoveryCase.tripId,
        travellerNames,
        decisionId: decision.id,
        requestedFrom,
        requestedAt: decision.decidedAt,
        action: intent ? presentAction(intent.operation) : 'Recovery action',
        ...(intent?.priceDelta ? { amount: intent.priceDelta } : {}),
        ...(intent?.costAllocation
          ? { funding: { allocation: intent.costAllocation, summary: describeAllocation(intent.costAllocation) } }
          : {}),
        reason: presentApprovalReason(),
      });
    }
  }

  // Most urgent first: requested most recently surfaces last in audit order,
  // so sort by request time ascending — longest-waiting first.
  pending.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return { generatedAt, pending };
}

/** Activity stream for one trip: real audit entries with user-facing copy. */
export async function projectTripActivity(
  deps: ReadModelDependencies,
  tripId: EntityId,
  generatedAt: IsoDateTime,
  limit = 50,
): Promise<TripActivityView | undefined> {
  const trip = await deps.snapshot.trips.getTrip(tripId);
  if (!trip) return undefined;
  // Fetch extra raw rows so low-value duplicate noise can be filtered without
  // starving the feed of meaningful state/action evidence.
  const entries = await deps.audit.query({ subject: tripId, limit: Math.max(limit * 2, 40) });
  const seen = new Set<string>();
  const events: ActivityEventView[] = [];
  for (const entry of entries) {
    const summary = presentActivity(entry.action, entry.payload as Record<string, unknown> | undefined);
    const actor = presentActivityActor(entry.actor, entry.payload as Record<string, unknown> | undefined);
    // De-emphasize duplicate consecutive identical audit noise.
    const dedupeKey = `${entry.action}|${summary}|${actor}`;
    if (seen.has(dedupeKey) && entry.action === 'SIGNAL_PROCESSED') continue;
    seen.add(dedupeKey);
    events.push({
      action: entry.action,
      summary,
      occurredAt: entry.occurredAt,
      actor,
      ...(entry.subject ? { subject: entry.subject } : {}),
    });
    if (events.length >= limit) break;
  }
  return { tripId, generatedAt, events };
}

/** Unresolved unknowns for one trip — UNKNOWN stays UNKNOWN (never PASS). */
export async function projectTripUncertainties(
  deps: ReadModelDependencies,
  tripId: EntityId,
  generatedAt: IsoDateTime,
): Promise<TripUncertaintiesView | undefined> {
  const trip = await deps.snapshot.trips.getTrip(tripId);
  if (!trip) return undefined;
  const assessment = await new ImpactEngine({
    trips: deps.snapshot.trips,
    signals: deps.signals,
    entities: deps.snapshot.entities,
  }).assess(tripId);
  return { tripId, generatedAt, uncertainties: presentUncertainties(assessment.unresolvedUnknowns) };
}

/** Truthful adapter provenance per capability — from live descriptors. */
export function projectProviderSurface(
  descriptors: CapabilityDescriptor[],
  generatedAt: IsoDateTime,
): ProviderSurfaceView {
  const MODE_LABEL: Record<AdapterMode, string> = {
    LIVE: 'Live provider connection',
    RECORD: 'Recording live provider responses',
    REPLAY: 'Replaying recorded provider responses',
  };
  return {
    generatedAt,
    capabilities: descriptors.map((descriptor) => ({
      family: descriptor.family,
      providerId: descriptor.providerId,
      mode: descriptor.mode,
      supportedOperations: [...descriptor.supportedOperations],
      modeLabel: MODE_LABEL[descriptor.mode] ?? descriptor.mode,
    })),
  };
}
