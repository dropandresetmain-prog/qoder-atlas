/**
 * Northstar RV-N5 — generic ChangeRequest / ResolutionTarget resolution.
 *
 * The frozen ChangeRequest contract is element-agnostic on purpose (ADR-036):
 * the SAME function handles ADJUST_TRIP_WINDOW (A1: arrive earlier / self-fund
 * extension), CHANGE_TRANSPORT_SCHEDULE (A2: prefer direct / later) and
 * CHANGE_STAY (A3: closer to venue) — there is no per-variant engine. The
 * variant choice is a routing hint, never a fork.
 *
 * Resolution path:
 *   1. parse with ChangeRequestSchema (boundary zod; invalid -> 400-class);
 *   2. load trip; if request.target has NO deltas at all -> rejected;
 *   3. derive deterministic implications from ResolutionTarget against the
 *      current authoritative trip state (window shifts, transport preferences,
 *      stay proximity), record them as implications + uncertainties (no
 *      provider mutation here);
 *   4. route through the EXISTING signal -> case pipeline: a TRAVELLER_INPUT
 *      signal is saved (frozen vocabulary fits a traveller desire) and the
 *      case service opens a single open case per trip if one does not
 *      already exist. The change request id + the declarative target are
 *      carried via the signal `summary` and the audit record (frozen signal
 *      payload schema does not expose a ChangeRequest field; we never edit
 *      frozen schemas, see comment below);
 *   5. fundingDeclaration is recorded but allocation stays deterministic
 *      downstream (the changeRequest's `arriveBy` is the only anchor the
 *      frozen allocation engine can decide on; absent that, allocation is
 *      UNKNOWN and that uncertainty is explicit, never a silent PASS);
 *   6. urgency HARD_INSTRUCTION vs SOFT_PREFERENCE is recorded on the case
 *      audit trail but does not change the pipeline shape — authority is the
 *      downstream gate, not urgency.
 *
 * No state mutation outside the frozen mutation/repository path: signal
 * saving goes through `SignalRepository`; case opening/transition through
 * `CaseService` over `CaseRepository`; everything else is structured outcome.
 */
import { type EntityId, EntityIdSchema, type EntityRef, type IsoDateTime, type UncertaintyRecord } from '../domain/common.ts';
import { compareInstants, instantMillis, IsoDateTimeSchema } from '../domain/common.ts';
import { ChangeRequestSchema, type ChangeRequest, type ResolutionTarget } from '../contracts/changeRequest.ts';
import type { Trip } from '../domain/trip.ts';
import type { TripElement } from '../domain/elements.ts';
import { TripSignalSchema, type TripSignal } from '../operational/signal.ts';
import type { CaseStatus, RecoveryCase } from '../operational/case.ts';
import type { ImpactAssessment } from '../operational/impact.ts';
import type { RecoveryStrategy } from '../operational/strategy.ts';
import type { AuditRepository, CaseRepository, SignalRepository, TripRepository } from '../contracts/repositories.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { CaseService } from '../engine/case.ts';
import { ImpactEngine } from '../engine/impact.ts';
import type { RuleSet, PolicyRule } from '../domain/rules.ts';
import { allocateCost } from '../engine/funding.ts';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Convert an ISO instant to a deterministic EntityId-safe token. The frozen
 * EntityIdSchema accepts `[A-Za-z0-9_\-:.]` only, but ISO strings include
 * `T`, `+` and (for some zones) other characters. We substitute a stable
 * token so uncertainty ids stay schema-valid even when the request instant
 * embeds a timezone offset.
 */
function idifyInstant(iso: IsoDateTime): string {
  return iso.replace(/[^A-Za-z0-9_\-:.]/g, '-');
}

export interface ChangeRequestDeps {
  trips: TripRepository;
  entities: EntityStore;
  signals: SignalRepository;
  cases: CaseRepository;
  audit: AuditRepository;
}

export interface ChangeRequestResolveRequest {
  request: ChangeRequest;
  at: IsoDateTime;
}

export interface ChangeRequestResolveOutcome {
  accepted: boolean;
  caseId?: EntityId;
  caseStatus?: CaseStatus;
  tripId: EntityId;
  intentKind: ChangeRequest['intentKind'];
  urgency: ChangeRequest['urgency'];
  /**
   * Deterministic statements derived from ResolutionTarget against the
   * current authoritative trip state. Strings only — they are the evidence
   * for downstream operators/read models.
   */
  implications: string[];
  uncertainties: UncertaintyRecord[];
  issues: string[];
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Single generic resolver for every ChangeRequest variant. The same function
 * is reached by A1/A2/A3; the only per-variant difference is the
 * `intentKind` and the shape of `request.target`, both of which the engine
 * reads from the frozen contract.
 */
export async function resolveChangeRequest(
  deps: ChangeRequestDeps,
  input: ChangeRequestResolveRequest,
): Promise<ChangeRequestResolveOutcome> {
  // 1. Frozen-schema boundary. Anything not parseable here is a 400-class
  //    rejection — the engine never sees a malformed request.
  let request: ChangeRequest;
  try {
    request = ChangeRequestSchema.parse(input.request);
  } catch (error) {
    return {
      accepted: false,
      tripId: '',
      intentKind: 'OTHER',
      urgency: 'SOFT_PREFERENCE',
      implications: [],
      uncertainties: [],
      issues: [`ChangeRequest schema invalid: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  // 2. Trip must exist (404-class) and target must carry at least one delta
  //    (409-class). A target with every optional field absent is a
  //    no-op: the resolver does not invent deltas.
  const trip = await deps.trips.getTrip(request.tripId);
  if (!trip) {
    return {
      accepted: false,
      tripId: request.tripId,
      intentKind: request.intentKind,
      urgency: request.urgency,
      implications: [],
      uncertainties: [],
      issues: [`unknown trip ${request.tripId}`],
    };
  }
  if (isTargetEmpty(request.target)) {
    return {
      accepted: false,
      tripId: request.tripId,
      intentKind: request.intentKind,
      urgency: request.urgency,
      implications: [],
      uncertainties: [],
      issues: ['request target carries no deltas; nothing for the engine to derive implications from'],
    };
  }

  const at = IsoDateTimeSchema.parse(input.at);

  // 3. Deterministic implications: pure functions of (target, trip). No
  //    provider calls, no mutation.
  const { implications, uncertainties: derivationUncertainties } = deriveImplications(
    request.target,
    trip,
    at,
  );

  // 4. Funding allocation. The frozen allocateCost needs a temporal anchor
  //    for the priceDelta to decide; we anchor on `arriveBy` when the target
  //    carries one (typical A1 case: arrive earlier / self-fund extension).
  //    Without that anchor, allocation stays UNKNOWN and the uncertainty is
  //    surfaced explicitly.
  const fundingRules = await collectFundingRules(deps.entities, trip);
  const costAccruesAt = request.target.arriveBy ?? request.target.departAfter;
  const funding = allocateCost({
    rules: fundingRules,
    priceDelta: { amount: 0, currency: 'USD' },
    ...(costAccruesAt ? { costAccruesAt } : {}),
    ...(request.fundingDeclaration ? { fundingDeclaration: request.fundingDeclaration } : {}),
  });
  if (costAccruesAt && !funding && request.fundingDeclaration && request.fundingDeclaration !== 'UNKNOWN') {
    // No FUNDED_WINDOW rule governs the temporal anchor — the declaration is
    // recorded as evidence, not as allocation. Surfacing the gap is the
    // honest answer.
    implications.push(
      `funding declaration ${request.fundingDeclaration} recorded but no FUNDED_WINDOW rule governs ${costAccruesAt}; allocation unresolved`,
    );
  } else if (funding) {
    implications.push(
      funding.coveredBy
        ? `funding allocation: covered by ${funding.coveredBy} per rule(s) ${funding.derivedFromRuleIds.join(', ')}`
        : `funding allocation: incremental payer ${funding.incrementalPayer} per rule(s) ${funding.derivedFromRuleIds.join(', ')}`,
    );
  } else if (request.fundingDeclaration && request.fundingDeclaration !== 'UNKNOWN') {
    implications.push(
      `funding declaration ${request.fundingDeclaration} recorded; no temporal anchor derivable from target, allocation left to authority`,
    );
  }
  const uncertainties: UncertaintyRecord[] = [...derivationUncertainties];
  if (!funding && request.fundingDeclaration && request.fundingDeclaration !== 'UNKNOWN' && !costAccruesAt) {
    uncertainties.push({
      id: EntityIdSchema.parse(`unc-fund-${request.id}`),
      statement: `funding allocation UNKNOWN: no temporal anchor in target; declaration ${request.fundingDeclaration} is evidence only`,
      aboutRefs: [{ entityType: 'TRIP', id: request.tripId }],
      ...(request.sourceId ? { sourceId: request.sourceId } : {}),
      severity: 'MEDIUM',
    });
  }

  // 5. Route through the existing signal -> case pipeline. The frozen
  //    signal payload schema is closed (it does NOT include a ChangeRequest
  //    field — we never edit frozen schemas); the change-request id +
  //    intentKind + target are carried in the signal `summary` and through
  //    a dedicated audit record. The signal itself is what the audit chain
  //    uses to join the request to the case.
  const signal: TripSignal = TripSignalSchema.parse({
    id: `sig-cr-${request.id}`,
    kind: 'TRAVELLER_INPUT',
    occurredAt: request.issuedAt,
    receivedAt: at,
    sourceId: request.sourceId,
    authority: request.authority,
    tripId: request.tripId,
    ...(request.travellerId
      ? { subjectRef: { entityType: 'TRAVELLER', id: request.travellerId } satisfies EntityRef }
      : {}),
    summary: `ChangeRequest ${request.id} (${request.intentKind}/${request.urgency}): ${request.utterance ?? 'declarative target deltas'}`,
    payload: {
      changeRequestId: request.id,
      intentKind: request.intentKind,
      // The COMPLETE declarative ResolutionTarget travels into the shared
      // planning loop (REV-2 WP-R3): every dimension — window shifts,
      // transport attributes, stay proximity, objective effects — reaches
      // the planner, which acts on what it can and records explicit
      // uncertainty for the rest. Partial forwarding silently dropped the
      // non-window dimensions; silence is the defect.
      target: request.target,
    },
  });
  await deps.signals.saveSignal(signal);

  // 6. Open or reuse the trip's open case. A trip typically carries one
  //    open change-request case at a time; we re-use an existing DETECTED /
  //    ASSESSING / PLANNING case for the same trip, otherwise we open a
  //    RECOVERY case because a change request always implies re-evaluation
  //    (the planner and downstream stages are identical to the recovery
  //    path; intentKind is a routing hint, not a different lifecycle).
  const caseService = new CaseService({ cases: deps.cases });
  const caseId = `case-cr-${request.tripId}-${request.id}`;
  const existing = await findOpenCaseForTrip(deps, request.tripId);
  let recoveryCase: RecoveryCase | undefined = existing;
  if (!recoveryCase) {
    recoveryCase = await caseService.open({
      id: caseId,
      tripId: request.tripId,
      openedAt: at,
      caseKind: 'RECOVERY',
      triggeredBySignalIds: [signal.id],
      affectedElementIds: [],
      failedConstraintIds: [],
    });
  }
  if (recoveryCase.status === 'DETECTED') {
    recoveryCase = await caseService.transition(recoveryCase.id, 'ASSESSING', at);
  }

  // 7. Reassess impact through the SAME ImpactEngine; the new signal
  //    participates like any other. (The plain signal pipeline writes
  //    per-trip impact through the mutation path, but a change request
  //    carries NO mutation by design — implications only. We assess the
  //    trip and rely on the planner/authority stages to act on it.)
  const impactEngine = new ImpactEngine({
    trips: deps.trips,
    signals: deps.signals,
    entities: deps.entities,
  });
  const impact: ImpactAssessment = await impactEngine.assess(request.tripId, signal.id);

  // 8. Audit the resolution with full evidence. The case audit trail stays
  //    the single source of truth that joins the request to its
  //    downstream case status and strategy decisions.
  await deps.audit.append({
    occurredAt: at,
    actor: 'app:change-request',
    action: 'CHANGE_REQUEST_RESOLVED',
    subject: request.tripId,
    payload: {
      requestId: request.id,
      intentKind: request.intentKind,
      urgency: request.urgency,
      authority: request.authority,
      fundingDeclaration: request.fundingDeclaration,
      caseId: recoveryCase.id,
      caseKind: recoveryCase.caseKind,
      signalId: signal.id,
      implications,
      uncertainties: uncertainties.map((u) => u.statement),
      impactId: impact.id,
      impactSeverity: impact.severity,
    },
  });

  const after = await deps.cases.getCase(recoveryCase.id);

  return {
    accepted: true,
    caseId: recoveryCase.id,
    caseStatus: after?.status,
    tripId: request.tripId,
    intentKind: request.intentKind,
    urgency: request.urgency,
    implications,
    uncertainties,
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// Implications derivation
// ---------------------------------------------------------------------------

/**
 * Deterministic derivation of implications from a ResolutionTarget against
 * the current authoritative trip state. Pure: no I/O, no provider calls.
 *
 * Variant hints (A1/A2/A3) live on `target` shapes; the SAME code path
 * inspects them all and emits ordered evidence strings. Anything missing
 * becomes an explicit uncertainty rather than a guessed value.
 */
function deriveImplications(
  target: ResolutionTarget,
  trip: Trip,
  at: IsoDateTime,
): { implications: string[]; uncertainties: UncertaintyRecord[] } {
  const implications: string[] = [];
  const uncertainties: UncertaintyRecord[] = [];

  // Window shifts (A1 territory: arriveBy / departAfter).
  if (target.arriveBy) {
    const transportElements = trip.elements.filter((e) => e.elementKind === 'TRANSPORT_LEG');
    if (transportElements.length === 0) {
      uncertainties.push({
        id: EntityIdSchema.parse(`unc-arb-${trip.id}`),
        statement: 'arriveBy requested but trip has no TRANSPORT_LEG; cannot derive a window shift',
        aboutRefs: [{ entityType: 'TRIP', id: trip.id }],
        severity: 'MEDIUM',
      });
    } else {
      const earliest = earliestArrival(trip);
      if (earliest) {
        const cmp = compareInstants(earliest, target.arriveBy);
        if (cmp === 0) {
          implications.push(`arriveBy ${target.arriveBy} matches current earliest arrival exactly`);
        } else if (cmp > 0) {
          implications.push(
            `arriveBy ${target.arriveBy} is ${describeDelta(earliest, target.arriveBy)} earlier than current earliest arrival ${earliest}`,
          );
        } else {
          implications.push(
            `arriveBy ${target.arriveBy} is later than current earliest arrival ${earliest}; the request is a relaxation, not a tightening`,
          );
        }
      } else {
        uncertainties.push({
          id: EntityIdSchema.parse(`unc-arb-ev-${trip.id}`),
          statement: 'arriveBy requested but no TRANSPORT_LEG carries a known scheduled arrival; window shift not derivable',
          aboutRefs: [{ entityType: 'TRIP', id: trip.id }],
          severity: 'MEDIUM',
        });
      }
    }
  }
  if (target.departAfter) {
    const latest = latestDeparture(trip);
    if (latest) {
      const cmp = compareInstants(latest, target.departAfter);
      if (cmp === 0) {
        implications.push(`departAfter ${target.departAfter} matches current latest departure exactly`);
      } else if (cmp < 0) {
        implications.push(
          `departAfter ${target.departAfter} is ${describeDelta(target.departAfter, latest)} later than current latest departure ${latest}`,
        );
      } else {
        implications.push(
          `departAfter ${target.departAfter} is earlier than current latest departure ${latest}; the request is a tightening`,
        );
      }
    } else {
      uncertainties.push({
        id: EntityIdSchema.parse(`unc-dep-${trip.id}`),
        statement: 'departAfter requested but no TRANSPORT_LEG carries a known scheduled departure; window shift not derivable',
        aboutRefs: [{ entityType: 'TRIP', id: trip.id }],
        severity: 'MEDIUM',
      });
    }
  }

  // Transport preferences (A2 territory: preferDirect, earliest/latest).
  if (target.transport) {
    if (target.transport.preferDirect !== undefined) {
      implications.push(
        target.transport.preferDirect
          ? 'transport preference: prefer direct flights (declarative; planner decides feasibility)'
          : 'transport preference: connections are acceptable (declarative; planner decides feasibility)',
      );
    }
    if (target.transport.earliestDeparture || target.transport.latestDeparture) {
      implications.push(
        `transport preference: depart ${target.transport.earliestDeparture ?? 'unconstrained'}..${target.transport.latestDeparture ?? 'unconstrained'}`,
      );
    }
  }

  // Stay proximity (A3 territory).
  if (target.preferredStayProximityRef) {
    const place = target.preferredStayProximityRef;
    implications.push(
      `stay preference: nearer to ${place.entityType} ${place.id} (declarative; no hotel capability context in the change-request path)`,
    );
    uncertainties.push({
      id: EntityIdSchema.parse(`unc-prox-${trip.id}-${place.id}`),
      statement: 'preferredStayProximityRef recorded; no live hotel-search capability context is attached to change-request resolution',
      aboutRefs: [place],
      severity: 'MEDIUM',
    });
  }

  // Objective effects (always possible; authority gates the actual waiver).
  for (const effect of target.objectiveEffects) {
    implications.push(
      `objective ${effect.objectiveId}: ${effect.effect}${effect.newHardness ? ` (new hardness ${effect.newHardness})` : ''}${effect.reason ? ` — ${effect.reason}` : ''}`,
    );
  }

  // At least one element touched: keep the record honest. We never fabricate
  // an implication.
  if (implications.length === 0) {
    uncertainties.push({
      id: EntityIdSchema.parse(`unc-empty-${trip.id}-${idifyInstant(at)}`),
      statement: 'no derivable implications for the supplied target shape',
      aboutRefs: [{ entityType: 'TRIP', id: trip.id }],
      severity: 'LOW',
    });
  }
  return { implications, uncertainties };
}

function isTargetEmpty(target: ResolutionTarget): boolean {
  if (target.arriveBy || target.departAfter) return false;
  if (target.preferredStayProximityRef) return false;
  if (target.transport) {
    if (
      target.transport.preferDirect !== undefined ||
      target.transport.earliestDeparture ||
      target.transport.latestDeparture
    ) {
      return false;
    }
  }
  if (target.objectiveEffects.length > 0) return false;
  return true;
}

function earliestArrival(trip: Trip): IsoDateTime | undefined {
  let earliest: IsoDateTime | undefined;
  for (const element of trip.elements) {
    if (element.elementKind !== 'TRANSPORT_LEG') continue;
    const arrival = element.data.scheduledArrival?.value;
    if (!arrival) continue;
    if (!earliest || compareInstants(arrival, earliest) < 0) earliest = arrival;
  }
  return earliest;
}

function latestDeparture(trip: Trip): IsoDateTime | undefined {
  let latest: IsoDateTime | undefined;
  for (const element of trip.elements) {
    if (element.elementKind !== 'TRANSPORT_LEG') continue;
    const departure = element.data.scheduledDeparture?.value;
    if (!departure) continue;
    if (!latest || compareInstants(departure, latest) > 0) latest = departure;
  }
  return latest;
}

function describeDelta(earlier: IsoDateTime, later: IsoDateTime): string {
  const diffMs = instantMillis(later) - instantMillis(earlier);
  if (diffMs === 0) return '0s';
  const minutes = Math.round(Math.abs(diffMs) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

async function collectFundingRules(
  entities: EntityStore,
  trip: Trip,
): Promise<PolicyRule[]> {
  const ruleSetIds = new Set<EntityId>(trip.governedByRuleSetIds);
  for (const element of trip.elements as readonly TripElement[]) {
    for (const id of element.governedByRuleSetIds) ruleSetIds.add(id);
  }
  const rules: PolicyRule[] = [];
  for (const id of [...ruleSetIds].sort()) {
    const entry = await entities.get('RULE_SET', id);
    if (entry && entry.entityType === 'RULE_SET') {
      const rs = entry.entity as RuleSet;
      for (const rule of rs.rules) rules.push(rule);
    }
  }
  return rules;
}

async function findOpenCaseForTrip(
  deps: ChangeRequestDeps,
  tripId: EntityId,
): Promise<RecoveryCase | undefined> {
  const cases = await deps.cases.listCasesForTrip(tripId);
  for (const c of cases) {
    if (c.status !== 'RESOLVED') return c;
  }
  return undefined;
}

/**
 * Convenience: map the resolver outcome's `strategies` shape over the
 * persisted case strategies. The change-request resolution itself does NOT
 * build ActionIntents; the planner + authority path does. The helper exists
 * so read models can join the request's evidence to the strategies the
 * planner eventually produces.
 */
export function mapPersistedStrategies(
  outcome: ChangeRequestResolveOutcome,
  persisted: readonly RecoveryStrategy[],
): Array<{ id: EntityId; summary: string }> {
  if (outcome.accepted) return persisted.map((s) => ({ id: s.id, summary: s.summary }));
  return [];
}
