/**
 * Direct-SQL world-building fixtures for the M6 suites.
 *
 * Generic building blocks only: places inside jurisdictions, supplier services
 * with observed times, intent items that select them, bookings, programme
 * participation, visits and knowledge. Every value a scenario needs is a
 * parameter — there is no scenario, traveller, city, supplier or date baked
 * into this file (AGENTS.md anti-hardcoding). Scenario facts live in each
 * test's own fixture data.
 *
 * Knowledge (rule sets, information editions, coverage, objectives,
 * constraints) is written through the M5/M7 commands so its subtype/revision
 * rules stay real; objective targets use `recordObjective` /
 * `recordObjectiveTargets` (I-7 closed in M7).
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { seedChildSubject, seedJourney, seedRootSubject, seedTraveller, seedTrip, takeSeedEvidence, type SeedSession } from './m2Seed.ts';
import { seedGeographicArea, seedJurisdiction, seedJurisdictionArea } from './m4Seed.ts';
import {
  createRuleSet,
  ingestInformationVersion,
  recordConstraintDefinition,
  recordInformationRecord,
  recordInformationScope,
  recordKnowledgeCoverage,
  recordObjective,
  recordRuleAssignment,
} from '../src/persistence/postgres/commands/knowledgeCommands.ts';
import { createOrganisation } from '../src/persistence/postgres/commands/peopleCommands.ts';

export { seedJourney, seedTraveller, seedTrip, takeSeedEvidence };

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

/** A jurisdiction whose area edition contains the given places by explicit membership. */
export async function seedJurisdictionWithPlaces(
  seed: SeedSession,
  params: { name: string; places: { name: string; placeType: string; timeZone?: string }[]; validFrom?: string },
): Promise<{ jurisdictionId: string; areaVersionId: string; placeIds: string[] }> {
  const jurisdictionId = await seedJurisdiction(seed, { name: params.name });
  const { areaVersionId } = await seedGeographicArea(seed, { name: `${params.name} area`, validFrom: params.validFrom ?? '2000-01-01' });
  await seedJurisdictionArea(seed, { jurisdictionId, areaVersionId, validFrom: params.validFrom ?? '2000-01-01' });
  const placeIds: string[] = [];
  for (const place of params.places) {
    const placeId = await seedRootSubject(seed, { kind: 'PLACE' });
    await seed.client.query(
      `INSERT INTO places (workspace_id, id, name, place_type, time_zone, created_by_actor_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [seed.workspaceId, placeId, place.name, place.placeType, place.timeZone ?? 'UTC', seed.actorId],
    );
    await seed.client.query(
      `INSERT INTO area_memberships (workspace_id, id, member_kind, member_place_id, containing_area_version_id, valid_from, evidence_id, created_by_actor_id)
       VALUES ($1, $2, 'PLACE', $3, $4, $5, $6, $7)`,
      [seed.workspaceId, randomUUID(), placeId, areaVersionId, params.validFrom ?? '2000-01-01', takeSeedEvidence(seed), seed.actorId],
    );
    placeIds.push(placeId);
  }
  return { jurisdictionId, areaVersionId, placeIds };
}

/** A place with no geography (no coordinates, no membership): jurisdiction is genuinely unknown. */
export async function seedUnlocatedPlace(seed: SeedSession, name: string, placeType = 'VENUE'): Promise<string> {
  const placeId = await seedRootSubject(seed, { kind: 'PLACE' });
  await seed.client.query(
    `INSERT INTO places (workspace_id, id, name, place_type, time_zone, created_by_actor_id) VALUES ($1, $2, $3, $4, 'UTC', $5)`,
    [seed.workspaceId, placeId, name, placeType, seed.actorId],
  );
  return placeId;
}

export interface ObservedTimes {
  departure: string;
  arrival: string;
  observedAt?: string;
}

/** A supplier transport service with a published schedule and optional estimated/actual observations. */
export async function seedService(
  seed: SeedSession,
  params: { mode?: 'AIR' | 'RAIL' | 'ROAD' | 'SEA'; operator: string; originPlaceId: string; destinationPlaceId: string; published: ObservedTimes; estimated?: ObservedTimes; actual?: ObservedTimes },
): Promise<string> {
  const id = await seedRootSubject(seed, { kind: 'TRANSPORT_SERVICE' });
  const group = (t: ObservedTimes | undefined) => (t ? [t.departure, t.arrival, t.observedAt ?? t.departure, takeSeedEvidence(seed)] : [null, null, null, null]);
  await seed.client.query(
    `INSERT INTO transport_services
       (workspace_id, id, mode, operator, origin_place_id, destination_place_id,
        published_departure, published_arrival, published_observed_at, published_evidence_id,
        estimated_departure, estimated_arrival, estimated_observed_at, estimated_evidence_id,
        actual_departure, actual_arrival, actual_observed_at, actual_evidence_id, created_by_actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [seed.workspaceId, id, params.mode ?? 'AIR', params.operator, params.originPlaceId, params.destinationPlaceId,
      ...group(params.published), ...group(params.estimated), ...group(params.actual), seed.actorId],
  );
  return id;
}

/** A TRANSPORT JourneyItem (intent) optionally selecting a supplier service. */
export async function seedTransportIntent(
  seed: SeedSession,
  params: { journeyId: string; orderKey: string; originPlaceId: string; destinationPlaceId: string; selectedServiceId?: string; window?: { start: string; end: string }; lifecycleStatus?: string },
): Promise<string> {
  const id = randomUUID();
  await seedChildSubject(seed, { id, kind: 'JOURNEY_ITEM', aggregateId: params.journeyId });
  await seed.client.query(
    `INSERT INTO journey_items (workspace_id, id, journey_id, kind, order_key, lifecycle_status, intended_window_start, intended_window_end, created_by_actor_id)
     VALUES ($1, $2, $3, 'TRANSPORT', $4, $5, $6, $7, $8)`,
    [seed.workspaceId, id, params.journeyId, params.orderKey, params.lifecycleStatus ?? 'PLANNED', params.window?.start ?? null, params.window?.end ?? null, seed.actorId],
  );
  await seed.client.query(
    `INSERT INTO transport_item_details (workspace_id, journey_item_id, kind, desired_origin_place_id, desired_destination_place_id, selected_service_id)
     VALUES ($1, $2, 'TRANSPORT', $3, $4, $5)`,
    [seed.workspaceId, id, params.originPlaceId, params.destinationPlaceId, params.selectedServiceId ?? null],
  );
  return id;
}

/** A STAY JourneyItem at a place for an intended window. */
export async function seedStayIntent(
  seed: SeedSession,
  params: { journeyId: string; orderKey: string; placeId: string; window: { start: string; end: string }; requiredNights: number },
): Promise<string> {
  const id = randomUUID();
  await seedChildSubject(seed, { id, kind: 'JOURNEY_ITEM', aggregateId: params.journeyId });
  await seed.client.query(
    `INSERT INTO journey_items (workspace_id, id, journey_id, kind, order_key, lifecycle_status, intended_window_start, intended_window_end, created_by_actor_id)
     VALUES ($1, $2, $3, 'STAY', $4, 'PLANNED', $5, $6, $7)`,
    [seed.workspaceId, id, params.journeyId, params.orderKey, params.window.start, params.window.end, seed.actorId],
  );
  await seed.client.query(
    `INSERT INTO stay_item_details (workspace_id, journey_item_id, kind, intended_place_id, required_nights) VALUES ($1, $2, 'STAY', $3, $4)`,
    [seed.workspaceId, id, params.placeId, params.requiredNights],
  );
  return id;
}

/** An ENGAGEMENT JourneyItem that reflects a programme Participation (the schedule stays on the ProgrammeItem). */
export async function seedEngagementIntent(seed: SeedSession, params: { journeyId: string; orderKey: string; participationId: string }): Promise<string> {
  const id = randomUUID();
  await seedChildSubject(seed, { id, kind: 'JOURNEY_ITEM', aggregateId: params.journeyId });
  await seed.client.query(
    `INSERT INTO journey_items (workspace_id, id, journey_id, kind, order_key, lifecycle_status, created_by_actor_id)
     VALUES ($1, $2, $3, 'ENGAGEMENT', $4, 'PLANNED', $5)`,
    [seed.workspaceId, id, params.journeyId, params.orderKey, seed.actorId],
  );
  await seed.client.query(
    `INSERT INTO engagement_item_details (workspace_id, journey_item_id, kind, participation_id) VALUES ($1, $2, 'ENGAGEMENT', $3)`,
    [seed.workspaceId, id, params.participationId],
  );
  return id;
}

export async function seedIntendedVisit(
  seed: SeedSession,
  params: { journeyId: string; jurisdictionId: string; purpose: string; start: string; end: string; transit?: boolean },
): Promise<string> {
  const id = randomUUID();
  await seed.client.query(
    `INSERT INTO intended_visits (workspace_id, id, journey_id, jurisdiction_id, purpose, intended_start, intended_end, transit_intent, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [seed.workspaceId, id, params.journeyId, params.jurisdictionId, params.purpose, params.start, params.end, params.transit ?? false, seed.actorId],
  );
  return id;
}

/** A booked reservation with one line on a service, allocated to a traveller's JourneyItem, with an observed line status. */
export async function seedBooking(
  seed: SeedSession,
  params: { travellerId: string; serviceId: string; journeyItemId?: string; lineStatus?: string; reservationId?: string; responsibleOrganisationId?: string },
): Promise<{ reservationId: string; lineId: string; allocationId: string }> {
  let reservationId = params.reservationId;
  if (!reservationId) {
    reservationId = await seedRootSubject(seed, { kind: 'RESERVATION' });
    await seed.client.query(
      `INSERT INTO reservations (workspace_id, id, reservation_type, observed_status, observed_status_at, responsible_organisation_id, responsible_traveller_id, created_by_actor_id)
       VALUES ($1, $2, 'TRANSPORT', 'CONFIRMED', '2000-01-01T00:00:00Z', $3, $4, $5)`,
      [seed.workspaceId, reservationId, params.responsibleOrganisationId ?? null, params.responsibleOrganisationId ? null : params.travellerId, seed.actorId],
    );
  }
  let lineId: string;
  const existing = await seed.client.query<{ line_id: string }>(
    `SELECT t.line_id FROM transport_line_details t JOIN reservation_lines l ON l.workspace_id = t.workspace_id AND l.id = t.line_id
      WHERE t.workspace_id = $1 AND t.transport_service_id = $2 AND l.reservation_id = $3`,
    [seed.workspaceId, params.serviceId, reservationId],
  );
  if (existing.rows[0]) {
    lineId = existing.rows[0].line_id;
  } else {
    lineId = randomUUID();
    await seedChildSubject(seed, { id: lineId, kind: 'RESERVATION_LINE', aggregateId: reservationId });
    const status = params.lineStatus ?? 'CONFIRMED';
    await seed.client.query(
      `INSERT INTO reservation_lines (workspace_id, id, reservation_id, product_type, observed_status, observed_status_at, observation_evidence_id, created_by_actor_id)
       VALUES ($1, $2, $3, 'TRANSPORT', $4, $5, $6, $7)`,
      [seed.workspaceId, lineId, reservationId, status, status === 'UNKNOWN' ? null : '2000-01-01T00:00:00Z', status === 'UNKNOWN' ? null : takeSeedEvidence(seed), seed.actorId],
    );
    await seed.client.query(
      `INSERT INTO transport_line_details (workspace_id, line_id, product_type, transport_service_id) VALUES ($1, $2, 'TRANSPORT', $3)`,
      [seed.workspaceId, lineId, params.serviceId],
    );
  }
  const allocationId = randomUUID();
  await seed.client.query(
    `INSERT INTO reservation_allocations (workspace_id, id, reservation_id, line_id, traveller_id, journey_item_id, allocation_role, quantity, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'PASSENGER', 1, $7)`,
    [seed.workspaceId, allocationId, reservationId, lineId, params.travellerId, params.journeyItemId ?? null, seed.actorId],
  );
  return { reservationId, lineId, allocationId };
}

export async function seedCoordinationGroup(seed: SeedSession, params: { name: string; journeyIds: string[] }): Promise<{ groupId: string; membershipIds: string[] }> {
  const groupId = await seedRootSubject(seed, { kind: 'COORDINATION_GROUP' });
  await seed.client.query(
    `INSERT INTO coordination_groups (workspace_id, id, name, lifecycle_status, created_by_actor_id) VALUES ($1, $2, $3, 'ACTIVE', $4)`,
    [seed.workspaceId, groupId, params.name, seed.actorId],
  );
  const membershipIds: string[] = [];
  for (const journeyId of params.journeyIds) membershipIds.push(await addGroupMember(seed, { groupId, journeyId }));
  return { groupId, membershipIds };
}

export async function addGroupMember(seed: SeedSession, params: { groupId: string; journeyId: string }): Promise<string> {
  const id = randomUUID();
  await seed.client.query(
    `INSERT INTO group_memberships (workspace_id, id, coordination_group_id, journey_id, created_by_actor_id) VALUES ($1, $2, $3, $4, $5)`,
    [seed.workspaceId, id, params.groupId, params.journeyId, seed.actorId],
  );
  return id;
}

/** Objective target rows (no M5 command exists for targets; see file header). */
export async function seedObjectiveTarget(
  pool: Pool,
  params: { workspaceId: string; objectiveId: string; label: string; targetKind: 'SUBJECT' | 'PLACE' | 'TIME' | 'MONEY' | 'QUANTITY'; subject?: { kind: string; id: string }; placeId?: string; atOrBefore?: string; amountMinor?: number; currencyCode?: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO objective_targets (workspace_id, objective_id, target_kind, subject_kind, subject_id, place_id, at_or_before, amount_minor, currency_code, label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [params.workspaceId, params.objectiveId, params.targetKind, params.subject?.kind ?? null, params.subject?.id ?? null, params.placeId ?? null,
      params.atOrBefore ?? null, params.amountMinor ?? null, params.currencyCode ?? null, params.label],
  );
}

/** Knowledge written through the real M5 commands. */
export class KnowledgeFixture {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly actorPrincipalId: string;
  private readonly evidence: () => string;

  constructor(pool: Pool, seed: SeedSession) {
    this.pool = pool;
    this.workspaceId = seed.workspaceId;
    this.actorPrincipalId = seed.actorId;
    this.evidence = () => takeSeedEvidence(seed);
  }

  private ctx() {
    return { workspaceId: this.workspaceId, actorPrincipalId: this.actorPrincipalId, idempotencyKey: `m6:${randomUUID()}` };
  }

  private uow(): PgUnitOfWork {
    return new PgUnitOfWork(this.pool, this.workspaceId);
  }

  async organisation(legalName: string, currency: string): Promise<string> {
    const organisationId = randomUUID();
    mustOk(await createOrganisation(this.uow(), { ...this.ctx(), organisationId, legalName, defaultCurrencyCode: currency }));
    return organisationId;
  }

  async publishedRuleSet(params: { issuerOrganisationId: string; policyFamily: string; expression: unknown; effectiveWindow?: { start: string; end: string }; rules?: { ruleKey: string; statement: string; expression: unknown; severity?: 'INFORMATIONAL' | 'ADVISORY' | 'MANDATORY' | 'PROHIBITIVE' }[] }): Promise<{ ruleSetId: string; versionId: string }> {
    const result = mustOk(await createRuleSet(this.uow(), {
      ...this.ctx(), issuerRef: { kind: 'ORGANISATION', id: params.issuerOrganisationId }, policyFamily: params.policyFamily, editionNumber: 1,
      status: 'PUBLISHED', ...(params.effectiveWindow ? { effectiveWindow: params.effectiveWindow } : {}), expression: params.expression,
      publishedAt: '2000-01-01T00:00:00Z', publishedByActorId: this.actorPrincipalId, rules: params.rules ?? [],
    })) as { ruleSetId: string; versionId: string };
    return result;
  }

  async assignRule(params: { ruleSetId: string; ruleSetVersionId?: string; jurisdictionId?: string; organisationId?: string; subject?: { kind: 'TRAVELLER' | 'JOURNEY' | 'TRIP'; id: string }; validFrom: string; validUntil?: string }): Promise<string> {
    return mustOk(await recordRuleAssignment(this.uow(), {
      ...this.ctx(), ruleSetId: params.ruleSetId, ...(params.ruleSetVersionId ? { ruleSetVersionId: params.ruleSetVersionId } : { selectCurrentEdition: true }),
      ...(params.jurisdictionId ? { jurisdictionId: params.jurisdictionId } : {}), ...(params.organisationId ? { organisationId: params.organisationId } : {}),
      ...(params.subject ? { subjectRef: params.subject } : {}), validFrom: params.validFrom, ...(params.validUntil ? { validUntil: params.validUntil } : {}),
    })).assignmentId;
  }

  async advisory(params: { publisherOrganisationId: string; topic: string; severity: string; jurisdictionId: string; issuedAt: string; effective: { start: string; end: string }; sequence?: number; recordId?: string; supersedesId?: string; retractsId?: string }): Promise<{ recordId: string; versionId: string }> {
    let recordId = params.recordId;
    let revision = 1;
    if (!recordId) {
      recordId = randomUUID();
      mustOk(await recordInformationRecord(this.uow(), { ...this.ctx(), informationRecordId: recordId, publisherOrganisationId: params.publisherOrganisationId, externalPublicationKey: `pub:${recordId}`, topic: params.topic }));
    } else {
      const head = await this.pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [this.workspaceId, recordId]);
      revision = Number(head.rows[0]?.revision ?? 1);
    }
    const version = mustOk(await ingestInformationVersion(this.uow(), {
      ...this.ctx(), informationRecordId: recordId, subtype: 'ADVISORY', externalEditionSequence: params.sequence ?? 1,
      issuedAt: params.issuedAt, receivedAt: params.issuedAt, observedAt: params.issuedAt, effectiveWindow: params.effective, evidenceId: this.evidence(),
      normalizationVersion: 'm6-fixture/1', payloadHash: randomUUID().replace(/-/g, '').padEnd(64, '0'), sourceNativeSeverity: params.severity,
      ...(params.supersedesId ? { supersedesInformationVersionId: params.supersedesId } : {}), ...(params.retractsId ? { retractsInformationVersionId: params.retractsId } : {}),
      detail: { sourceNativeSeverity: params.severity, riskTopics: [], publisherMeanings: [], sourceNativeDetail: {}, detailSchemaVersion: 'advisory/1' },
      expectedRevision: revision,
    }));
    mustOk(await recordInformationScope(this.uow(), {
      ...this.ctx(), informationRecordId: recordId, informationVersionId: version.informationVersionId, jurisdictionId: params.jurisdictionId,
      effectiveExposure: params.effective, expectedRevision: revision + 1,
    }));
    return { recordId, versionId: version.informationVersionId };
  }

  async coverage(params: { topic: string; completeness: 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN' | 'UNSUPPORTED_CATEGORY' | 'SOURCE_UNAVAILABLE'; jurisdictionId?: string; limitations?: string[]; expiresAt?: string; edition?: string }): Promise<string> {
    return mustOk(await recordKnowledgeCoverage(this.uow(), {
      ...this.ctx(), queryBounds: params.jurisdictionId ? { jurisdictionId: params.jurisdictionId } : {}, queryBoundsVersion: 'knowledge-coverage/1',
      topic: params.topic, edition: params.edition ?? `edition:${randomUUID()}`, completeness: params.completeness,
      completenessLimitations: params.limitations ?? [], ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}), evidenceId: this.evidence(),
    })).coverageId;
  }

  async objective(params: { ownerKind: 'TRIP' | 'JOURNEY' | 'COORDINATION_GROUP' | 'PROGRAMME'; ownerId: string; hardness: 'HARD' | 'SOFT'; statement: string; priority?: number; disposition?: 'ACTIVE' | 'WAIVED' | 'CLOSED_WITH_LOSS' | 'ACHIEVED' }): Promise<string> {
    const disposition = params.disposition ?? 'ACTIVE';
    return mustOk(await recordObjective(this.uow(), {
      ...this.ctx(), ownerKind: params.ownerKind, ownerId: params.ownerId, successPredicate: params.statement, hardness: params.hardness,
      priority: params.priority ?? 1, disposition, ...(disposition === 'ACTIVE' ? {} : { dispositionEvidenceId: this.evidence() }),
    })).objectiveId;
  }

  async constraint(params: { registeredType: string; hardness: 'HARD' | 'SOFT'; owner: { kind: string; id: string }; operands: { key: string; kind: 'SUBJECT_REF' | 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'INSTANT' | 'LOCAL_DATE'; value: unknown }[] }): Promise<string> {
    return mustOk(await recordConstraintDefinition(this.uow(), {
      ...this.ctx(), registeredType: params.registeredType, hardness: params.hardness, ownerRef: params.owner, parameterSchemaVersion: 'm6-constraint/1', operands: params.operands,
    })).constraintDefinitionId;
  }
}
