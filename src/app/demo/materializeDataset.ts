/**
 * Demo/input-boundary materializer: a programme dataset -> normalized
 * PostgreSQL state, through the real M2-M5 command surface only.
 *
 * This module is *at* the input boundary, so it knows the dataset file shape.
 * It knows nothing about any particular programme, person, place, carrier or
 * event: every identifier, time, place reference, rule and obligation comes
 * from the dataset, and every unmappable value raises a loud mapping error
 * rather than being guessed or branched around.
 *
 * Identity: each materialized object gets a deterministic workspace-scoped
 * UUID (see DatasetIdentityMinter) and every source-semantic identifier the
 * dataset states is recorded as an external record linked to that object
 * (see SourceIdentityMap). Nothing downstream needs to know a generated UUID
 * to find "the object this source id means", and a replay of the same
 * dataset produces the same ids rather than a second world.
 *
 * What is deliberately NOT materialized here is listed in the module's
 * `MaterializationReport.notMaterialized`, so a dataset fact that has no
 * truthful target home stays visible instead of silently vanishing.
 */
import { createHash } from 'node:crypto';
import type { Pool } from '../../persistence/postgres/pool.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../../persistence/postgres/pgUnitOfWork.ts';
import type { UnitOfWork } from '../../contracts/v2/command/unitOfWork.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { createOrganisation, recordTraveller } from '../../persistence/postgres/commands/peopleCommands.ts';
import {
  addAreaMembership,
  addAreaVersion,
  addPlaceExternalRef,
  createGeographicArea,
  createJurisdiction,
  addJurisdictionArea,
  createPlace,
} from '../../persistence/postgres/commands/geographyCommands.ts';
import {
  createRuleSet,
  recordConstraintDefinition,
  recordEvidence,
  recordKnowledgeCoverage,
  recordPreference,
  recordRuleAssignment,
  recordSource,
} from '../../persistence/postgres/commands/knowledgeCommands.ts';
import {
  addParticipation,
  addProgrammeItem,
  createEvent,
  createProgramme,
} from '../../persistence/postgres/commands/programmeCommands.ts';
import {
  addJourneyItem,
  createJourney,
  createTrip,
} from '../../persistence/postgres/commands/travelCommands.ts';
import {
  addReservationLine,
  allocateReservationLine,
  createReservation,
  createTransportService,
} from '../../persistence/postgres/commands/arrangementCommands.ts';
import { DatasetIdentityMinter } from './datasetIds.ts';
import type { LoadedDataset } from './datasetLoader.ts';
import type { DatasetDeclaredTravel, DatasetJourneyRequirement, DatasetRule, DatasetTraveller } from './datasetSchema.ts';
import {
  DatasetMappingError,
  externalRefKey,
  externalRefValue,
  indexPlaceAliases,
  orderKey,
  participationObligation,
  policyFamily,
  reservationKey,
  reservationLineStatus,
  reservationStatus,
  resolveDatasetPlace,
  ruleKey,
  ruleParameters,
  rulePredicateId,
  serviceKey,
  serviceOperator,
  statedMinutes,
  stayNights,
  toInstant,
  transportMode,
} from './datasetMapping.ts';
import { SOURCE_RECORD_TYPES, SourceIdentityMap } from './externalIdentity.ts';

export interface MaterializeDatasetParams {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  dataset: LoadedDataset;
}

export interface MaterializationReport {
  datasetKey: string;
  contentHash: string;
  connectionId: string;
  organisationId: string;
  eventId: string;
  programmeId: string;
  counts: Record<string, number>;
  /** Dataset content with no truthful target home in this increment. */
  notMaterialized: string[];
}

/** Registered constraint types this materializer can express from rule data. */
const CONSTRAINT_FROM_RULE: Record<string, { registeredType: string; owner: 'PROGRAMME' | 'ORGANISATION'; operandKey: string }> = {
  MIN_BUFFER: { registeredType: 'programme_arrival_readiness_minutes', owner: 'PROGRAMME', operandKey: 'buffer' },
  CONNECTION_BUFFER: { registeredType: 'minimum_connection_minutes', owner: 'ORGANISATION', operandKey: 'buffer' },
};

function mustOk<T>(outcome: ExecuteOutcome<T>, label: string): T {
  if (!outcome.ok) {
    throw new DatasetMaterializationError(
      `${label} failed: ${outcome.conflict.kind} ${outcome.conflict.message}`,
    );
  }
  return outcome.value;
}

export class DatasetMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetMaterializationError';
  }
}

interface ResolvedStayArrivalRequirement {
  requirement: Extract<DatasetJourneyRequirement, { kind: 'STAY_ARRIVAL_DATE_ALIGNED' }>;
  originalStayIndex: number;
  arrivalTransportIndex: number;
}

/** Resolve source item aliases before any dataset command can write state. */
function resolveStayArrivalRequirements(
  programme: LoadedDataset['programme'],
  requirements: readonly DatasetJourneyRequirement[],
): Map<string, ResolvedStayArrivalRequirement> {
  const resolved = new Map<string, ResolvedStayArrivalRequirement>();
  for (const requirement of requirements) {
    if (requirement.kind !== 'STAY_ARRIVAL_DATE_ALIGNED') continue;
    const traveller = programme.importDraft.travellers.find((candidate) => candidate.draftId === requirement.travellerDraftId);
    if (!traveller) throw new DatasetMaterializationError(`journey requirement ${requirement.id} references unknown traveller draft ${requirement.travellerDraftId}`);
    const resolve = (ref: { system: string; value: string }, label: string): { item: DatasetDeclaredTravel; index: number } => {
      const matches = traveller.declaredTravel.flatMap((item, index) =>
        `journey-item:${traveller.draftId}#${index}` === `${ref.system}:${ref.value}` ? [{ item, index }] : [],
      );
      if (matches.length !== 1) {
        throw new DatasetMaterializationError(
          `journey requirement ${requirement.id} ${label} ${ref.system}:${ref.value} must resolve to exactly one declared item for traveller ${traveller.draftId}`,
        );
      }
      return matches[0]!;
    };
    const original = resolve(requirement.originalStayItemRef, 'original stay item reference');
    const arrival = resolve(requirement.arrivalTransportItemRef, 'arrival transport item reference');
    if (original.item.itemKind !== 'STAY') throw new DatasetMaterializationError(`journey requirement ${requirement.id} original stay item is not a STAY`);
    if (arrival.item.itemKind !== 'TRANSPORT_LEG') throw new DatasetMaterializationError(`journey requirement ${requirement.id} arrival item is not a TRANSPORT_LEG`);
    if (original.index === arrival.index) throw new DatasetMaterializationError(`journey requirement ${requirement.id} references one item twice`);
    resolved.set(requirement.id, { requirement, originalStayIndex: original.index, arrivalTransportIndex: arrival.index });
  }
  return resolved;
}

/** A content hash per source capture, derived from the dataset bytes it belongs to. */
function sourceContentHash(datasetContentHash: string, sourceId: string): string {
  return createHash('sha256').update(datasetContentHash).update('\0').update(sourceId).digest('hex');
}

export async function materializeDataset(params: MaterializeDatasetParams): Promise<MaterializationReport> {
  const { pool, workspaceId, actorPrincipalId, dataset } = params;
  const programme = dataset.programme;
  const context = programme.context;
  const draft = programme.importDraft;
  const ids = new DatasetIdentityMinter(workspaceId, dataset.datasetKey);
  const stayArrivalRequirements = resolveStayArrivalRequirements(programme, dataset.journeyRequirements?.requirements ?? []);
  const uow = (): UnitOfWork => new PgUnitOfWork(pool, workspaceId);
  const identity = { workspaceId, actorPrincipalId };
  const counts: Record<string, number> = {};
  const bump = (key: string, by = 1): void => {
    counts[key] = (counts[key] ?? 0) + by;
  };

  // ---- Organisation: the first subject, so dataset evidence has a subject to
  // cite (evidence_subjects references domain_subjects). ----------------------
  const organisationId = ids.id('organisation', context.organisation.id);
  mustOk(
    await createOrganisation(uow(), {
      ...identity,
      idempotencyKey: ids.key('organisation', context.organisation.id),
      organisationId,
      legalName: context.organisation.name,
      defaultCurrencyCode: context.organisation.homeCurrency,
      lifecycleStatus: 'ACTIVE',
    }),
    'createOrganisation',
  );
  bump('organisations');

  // ---- Source captures, one per source identity the dataset cites ----------
  const statedSourceIds = new Set<string>([context.sourceId, draft.sourceId]);
  for (const sourceId of context.anchorEvent.sourceIds) statedSourceIds.add(sourceId);
  for (const ruleSet of context.ruleSets) {
    if (ruleSet.sourceId) statedSourceIds.add(ruleSet.sourceId);
    for (const rule of ruleSet.rules) if (rule.sourceId) statedSourceIds.add(rule.sourceId);
  }
  for (const sourceId of dataset.groundTransfers?.sourceIds ?? []) statedSourceIds.add(sourceId);
  if (dataset.jurisdictions) statedSourceIds.add(dataset.jurisdictions.sourceId);
  if (dataset.journeyRequirements) statedSourceIds.add(dataset.journeyRequirements.sourceId);

  const sourceRecordIds = new Map<string, string>();
  for (const statedSourceId of [...statedSourceIds].sort()) {
    const sourceRecordId = ids.id('source', statedSourceId);
    mustOk(
      await recordSource(uow(), {
        ...identity,
        idempotencyKey: ids.key('source', statedSourceId),
        sourceId: sourceRecordId,
        // Dataset-scoped identity: the same stated source id in a different
        // dataset is a different capture, and re-loading this dataset finds
        // this exact row instead of creating a second one.
        sourceIdentity: `northstar:dataset:${dataset.datasetKey}:source:${statedSourceId}`,
        receivedAt: toInstant(draft.receivedAt, 'importDraft.receivedAt'),
        contentHash: sourceContentHash(dataset.contentHash, statedSourceId),
        contentType: 'application/json',
        captureMetadata: { datasetKey: dataset.datasetKey, statedSourceId, files: dataset.contributingFiles },
      }),
      `recordSource(${statedSourceId})`,
    );
    sourceRecordIds.set(statedSourceId, sourceRecordId);
    bump('sources');
  }

  const resolveSources = (stated: readonly string[]): string[] => {
    const resolved = stated.map((id) => sourceRecordIds.get(id)).filter((id): id is string => id !== undefined);
    if (resolved.length === 0) throw new DatasetMaterializationError(`no source capture for ${stated.join(', ')}`);
    return resolved;
  };

  // ---- Evidence, one record per family of assertion the dataset makes ------
  const observedAt = toInstant(context.at, 'context.at');
  const organisationRef: TypedRef = { kind: 'ORGANISATION', id: organisationId };
  const evidenceFamilies: { family: string; assertionType: string; sources: string[]; observedAt?: string }[] = [
    { family: 'programme', assertionType: 'DATASET_PROGRAMME_DECLARATION', sources: [context.sourceId, ...context.anchorEvent.sourceIds] },
    { family: 'roster', assertionType: 'DATASET_ROSTER_DECLARATION', sources: [draft.sourceId] },
    { family: 'policy', assertionType: 'DATASET_POLICY_DECLARATION', sources: context.ruleSets.flatMap((rs) => (rs.sourceId ? [rs.sourceId] : [])) },
    { family: 'geography', assertionType: 'DATASET_GEOGRAPHY_DECLARATION', sources: dataset.jurisdictions ? [dataset.jurisdictions.sourceId] : [] },
    { family: 'transfers', assertionType: 'DATASET_TRANSFER_DECLARATION', sources: dataset.groundTransfers?.sourceIds ?? [] },
    ...(dataset.journeyRequirements
      ? [{ family: 'journeyRequirements', assertionType: 'DATASET_JOURNEY_REQUIREMENT_DECLARATION', sources: [dataset.journeyRequirements.sourceId], observedAt: dataset.journeyRequirements.observedAt }]
      : []),
  ];
  const evidenceIds = new Map<string, string>();
  for (const { family, assertionType, sources, observedAt: familyObservedAt } of evidenceFamilies) {
    const stated = sources.length > 0 ? sources : [context.sourceId];
    const evidenceId = ids.id('evidence', family);
    mustOk(
      await recordEvidence(uow(), {
        ...identity,
        idempotencyKey: ids.key('evidence', family),
        evidenceId,
        assertionType,
        observedAt: familyObservedAt ?? observedAt,
        schemaVersion: `northstar-demo-dataset/${family}/1`,
        sourceIds: resolveSources([...new Set(stated)].sort()),
        subjectRefs: [organisationRef],
        interpretationProvenance: `demo dataset ${dataset.datasetKey} (${family})`,
      }),
      `recordEvidence(${family})`,
    );
    evidenceIds.set(family, evidenceId);
    bump('evidence');
  }
  const evidenceFor = (family: string): string => {
    const id = evidenceIds.get(family);
    if (!id) throw new DatasetMaterializationError(`no evidence record for family ${family}`);
    return id;
  };

  // ---- External identity connection --------------------------------------
  const sourceIdentity = new SourceIdentityMap({
    workspaceId,
    actorPrincipalId,
    uow,
    ids,
    evidenceId: evidenceFor('programme'),
    observedAt,
  });
  await sourceIdentity.open(`demo-dataset:${dataset.datasetKey}`, organisationId);
  await sourceIdentity.map(SOURCE_RECORD_TYPES.ORGANISATION, context.organisation.id, organisationRef);

  // ---- Places -------------------------------------------------------------
  const placeAliases = indexPlaceAliases(context.places);
  const placeIds = new Map<string, string>();
  for (const place of context.places) {
    const placeId = ids.id('place', place.id);
    mustOk(
      await createPlace(uow(), {
        ...identity,
        idempotencyKey: ids.key('place', place.id),
        placeId,
        name: place.name,
        placeType: place.kind,
        timeZone: place.timezone,
        ...(place.coordinates ? { coordinates: { lat: place.coordinates.latitude, lng: place.coordinates.longitude } } : {}),
        evidenceRefs: [evidenceFor('programme')],
      }),
      `createPlace(${place.id})`,
    );
    placeIds.set(place.id, placeId);
    bump('places');
    for (const ref of place.externalRefs) {
      mustOk(
        await addPlaceExternalRef(uow(), {
          ...identity,
          idempotencyKey: ids.key('place-ref', place.id, externalRefKey(ref)),
          refId: ids.id('place-ref', place.id, externalRefKey(ref)),
          placeId,
          providerNamespace: ref.system,
          externalKey: externalRefValue(ref),
          evidenceRefs: [evidenceFor('programme')],
        }),
        `addPlaceExternalRef(${place.id}, ${externalRefKey(ref)})`,
      );
      bump('placeExternalRefs');
    }
    await sourceIdentity.map(SOURCE_RECORD_TYPES.PLACE, place.id, { kind: 'PLACE', id: placeId });
  }
  const placeUuid = (datasetPlaceId: string): string => {
    const id = placeIds.get(datasetPlaceId);
    if (!id) throw new DatasetMaterializationError(`place ${datasetPlaceId} is referenced but not declared`);
    return id;
  };
  const placeTimeZone = new Map(context.places.map((place) => [place.id, place.timezone]));

  // ---- Jurisdictions, areas, place membership and knowledge coverage ------
  if (dataset.jurisdictions) {
    const geography = dataset.jurisdictions;
    const geographyEvidence = evidenceFor('geography');
    for (const jurisdiction of geography.jurisdictions) {
      const jurisdictionId = ids.id('jurisdiction', jurisdiction.id);
      mustOk(
        await createJurisdiction(uow(), {
          ...identity,
          idempotencyKey: ids.key('jurisdiction', jurisdiction.id),
          jurisdictionId,
          name: jurisdiction.name,
          regimeKind: jurisdiction.regimeKind,
          evidenceRefs: [geographyEvidence],
        }),
        `createJurisdiction(${jurisdiction.id})`,
      );
      bump('jurisdictions');
      await sourceIdentity.map(SOURCE_RECORD_TYPES.JURISDICTION, jurisdiction.id, {
        kind: 'JURISDICTION',
        id: jurisdictionId,
      });

      const areaId = ids.id('area', jurisdiction.area.id);
      const area = mustOk(
        await createGeographicArea(uow(), {
          ...identity,
          idempotencyKey: ids.key('area', jurisdiction.area.id),
          areaId,
          name: jurisdiction.area.name,
          areaType: jurisdiction.area.areaType,
          evidenceRefs: [geographyEvidence],
        }),
        `createGeographicArea(${jurisdiction.area.id})`,
      );
      const areaVersionId = ids.id('area-version', jurisdiction.area.id);
      mustOk(
        await addAreaVersion(uow(), {
          ...identity,
          idempotencyKey: ids.key('area-version', jurisdiction.area.id),
          versionId: areaVersionId,
          areaId,
          expectedRevision: area.revision,
          validFrom: geography.validFrom,
          geometryWkt: boundingBoxesToWkt(jurisdiction.area.boundingBoxes),
          evidenceId: geographyEvidence,
        }),
        `addAreaVersion(${jurisdiction.area.id})`,
      );
      bump('areaVersions');
      mustOk(
        await addJurisdictionArea(uow(), {
          ...identity,
          idempotencyKey: ids.key('jurisdiction-area', jurisdiction.id),
          linkId: ids.id('jurisdiction-area', jurisdiction.id),
          jurisdictionId,
          areaVersionId,
          validFrom: geography.validFrom,
          evidenceRefs: [geographyEvidence],
        }),
        `addJurisdictionArea(${jurisdiction.id})`,
      );
      for (const datasetPlaceId of jurisdiction.placeIds) {
        mustOk(
          await addAreaMembership(uow(), {
            ...identity,
            idempotencyKey: ids.key('area-membership', jurisdiction.area.id, datasetPlaceId),
            membershipId: ids.id('area-membership', jurisdiction.area.id, datasetPlaceId),
            memberKind: 'PLACE',
            memberPlaceId: placeUuid(datasetPlaceId),
            containingAreaVersionId: areaVersionId,
            validFrom: geography.validFrom,
            evidenceId: geographyEvidence,
          }),
          `addAreaMembership(${jurisdiction.area.id}, ${datasetPlaceId})`,
        );
        bump('areaMemberships');
      }

      if (geography.coverage) {
        for (const topic of geography.coverage.topics) {
          mustOk(
            await recordKnowledgeCoverage(uow(), {
              ...identity,
              idempotencyKey: ids.key('coverage', jurisdiction.id, topic),
              coverageId: ids.id('coverage', jurisdiction.id, topic),
              queryBounds: { jurisdictionId },
              queryBoundsVersion: geography.coverage.queryBoundsVersion,
              topic,
              edition: geography.coverage.edition,
              completeness: geography.coverage.completeness,
              completenessLimitations: geography.coverage.completenessLimitations,
              ...(geography.coverage.expiresAt
                ? { expiresAt: toInstant(geography.coverage.expiresAt, 'coverage.expiresAt') }
                : {}),
              evidenceId: geographyEvidence,
            }),
            `recordKnowledgeCoverage(${jurisdiction.id}, ${topic})`,
          );
          bump('knowledgeCoverage');
        }
      }
    }
  }

  // ---- Event and Programme -----------------------------------------------
  const anchorEvent = context.anchorEvent;
  const eventId = ids.id('event', anchorEvent.id);
  mustOk(
    await createEvent(uow(), {
      ...identity,
      idempotencyKey: ids.key('event', anchorEvent.id),
      eventId,
      title: anchorEvent.name,
      organiserOrganisationId: organisationId,
      lifecycleStatus: 'ACTIVE',
      evidenceRefs: [evidenceFor('programme')],
    }),
    `createEvent(${anchorEvent.id})`,
  );
  bump('events');
  await sourceIdentity.map(SOURCE_RECORD_TYPES.EVENT, anchorEvent.id, { kind: 'EVENT', id: eventId });

  const programmeId = ids.id('programme', anchorEvent.id);
  let programmeRevision = mustOk(
    await createProgramme(uow(), {
      ...identity,
      idempotencyKey: ids.key('programme', anchorEvent.id),
      programmeId,
      eventId,
      title: anchorEvent.name,
      lifecycleStatus: 'ACTIVE',
      evidenceRefs: [evidenceFor('programme')],
    }),
    `createProgramme(${anchorEvent.id})`,
  ).revision;
  bump('programmes');
  await sourceIdentity.map(SOURCE_RECORD_TYPES.PROGRAMME, anchorEvent.id, { kind: 'PROGRAMME', id: programmeId });

  // ---- Programme items ----------------------------------------------------
  const programmeItemIds = new Map<string, string>();
  const programmeItemWindow = new Map<string, { start: string; end: string }>();
  for (const commitment of anchorEvent.commitments) {
    const programmeItemId = ids.id('programme-item', commitment.id);
    const start = commitment.startsAt ? toInstant(commitment.startsAt.value, `${commitment.id}.startsAt`) : undefined;
    const end = commitment.endsAt ? toInstant(commitment.endsAt.value, `${commitment.id}.endsAt`) : undefined;
    const timeZone = commitment.placeId ? placeTimeZone.get(commitment.placeId) : undefined;
    programmeRevision = mustOk(
      await addProgrammeItem(uow(), {
        ...identity,
        idempotencyKey: ids.key('programme-item', commitment.id),
        programmeId,
        expectedProgrammeRevision: programmeRevision,
        item: {
          id: programmeItemId,
          title: commitment.title,
          itemType: commitment.kind,
          ...(commitment.placeId ? { placeId: placeUuid(commitment.placeId) } : {}),
          ...(start && end ? { window: { start, end } } : {}),
          ...(timeZone ? { timeZone } : {}),
          lifecycleStatus: 'SCHEDULED',
          // Physical presence is a consequence of the dataset having placed
          // the commitment somewhere; it is not a readiness verdict and not a
          // per-scenario flag. Readiness minutes stay in policy data.
          operatingRequirements: { requiresPhysicalPresence: commitment.placeId !== undefined },
        },
        evidenceRefs: [evidenceFor('programme')],
      }),
      `addProgrammeItem(${commitment.id})`,
    ).programmeRevision;
    programmeItemIds.set(commitment.id, programmeItemId);
    if (start && end) programmeItemWindow.set(commitment.id, { start, end });
    bump('programmeItems');
    await sourceIdentity.map(SOURCE_RECORD_TYPES.PROGRAMME_ITEM, commitment.id, {
      kind: 'PROGRAMME_ITEM',
      id: programmeItemId,
    });
  }

  // ---- Rule sets, assignments and the constraints they state --------------
  const policyEvidence = evidenceFor('policy');
  const eventWindowStart = anchorEvent.window
    ? toInstant(anchorEvent.window.startsAt, 'anchorEvent.window.startsAt')
    : observedAt;
  for (const ruleSet of context.ruleSets) {
    const ruleSetId = ids.id('rule-set', ruleSet.id);
    const rules = ruleSet.rules.map((rule) => ({
      id: ids.id('rule', rule.id),
      ruleKey: ruleKey(rule.id),
      statement: rule.description ?? rule.id,
      expression: rulePredicateExpression(rule),
      // Organiser policy of record. Nothing here claims the predicate is
      // executable: an evaluator that has not registered it answers UNKNOWN
      // `predicate_unsupported` rather than treating the rule as satisfied.
      severity: 'MANDATORY' as const,
    }));
    mustOk(
      await createRuleSet(uow(), {
        ...identity,
        idempotencyKey: ids.key('rule-set', ruleSet.id),
        ruleSetId,
        versionId: ids.id('rule-set-version', ruleSet.id),
        issuerRef: { kind: 'ORGANISATION', id: organisationId },
        policyFamily: policyFamily(ruleSet.kind),
        editionNumber: 1,
        status: 'PUBLISHED',
        expression: rules.length > 0
          ? { operator: 'ALL', operands: rules.map((rule) => rule.expression) }
          : { operator: 'PREDICATE', predicateId: 'organiser.rule_set_empty', parameters: {} },
        publishedAt: observedAt,
        publishedByActorId: actorPrincipalId,
        rules,
      }),
      `createRuleSet(${ruleSet.id})`,
    );
    bump('ruleSets');
    bump('rules', rules.length);
    await sourceIdentity.map(SOURCE_RECORD_TYPES.RULE_SET, ruleSet.id, { kind: 'RULE_SET', id: ruleSetId });

    mustOk(
      await recordRuleAssignment(uow(), {
        ...identity,
        idempotencyKey: ids.key('rule-assignment', ruleSet.id),
        assignmentId: ids.id('rule-assignment', ruleSet.id),
        ruleSetId,
        ruleSetVersionId: ids.id('rule-set-version', ruleSet.id),
        organisationId,
        validFrom: eventWindowStart,
      }),
      `recordRuleAssignment(${ruleSet.id})`,
    );
    bump('ruleAssignments');

    for (const rule of ruleSet.rules) {
      const registration = CONSTRAINT_FROM_RULE[rule.kind.toUpperCase()];
      if (!registration) continue;
      const minutes = statedMinutes((rule as Record<string, unknown>)[registration.operandKey]);
      if (minutes === undefined) continue;
      mustOk(
        await recordConstraintDefinition(uow(), {
          ...identity,
          idempotencyKey: ids.key('constraint', rule.id),
          constraintDefinitionId: ids.id('constraint', rule.id),
          registeredType: registration.registeredType,
          hardness: 'HARD',
          ownerRef: registration.owner === 'PROGRAMME'
            ? { kind: 'PROGRAMME', id: programmeId }
            : organisationRef,
          parameterSchemaVersion: 'northstar-demo-dataset/constraint/1',
          provenanceEvidenceId: policyEvidence,
          operands: registration.registeredType === 'programme_arrival_readiness_minutes'
            ? [
              { key: 'minutes', kind: 'NUMBER', value: minutes },
              { key: 'requires_physical_presence', kind: 'BOOLEAN', value: true },
            ]
            : [{ key: 'minutes', kind: 'NUMBER', value: minutes }],
        }),
        `recordConstraintDefinition(${rule.id})`,
      );
      bump('constraints');
    }
  }

  // ---- Ground transfer durations as registered transfer constraints -------
  for (const estimate of dataset.groundTransfers?.estimates ?? []) {
    const minutes = statedMinutes(estimate.estimate);
    if (minutes === undefined) continue;
    mustOk(
      await recordConstraintDefinition(uow(), {
        ...identity,
        idempotencyKey: ids.key('transfer', estimate.from, estimate.to),
        constraintDefinitionId: ids.id('transfer', estimate.from, estimate.to),
        registeredType: 'transfer_minutes',
        hardness: 'HARD',
        // Owned by the place the transfer starts from, which is how the
        // reachability reasoning finds it for a Journey touching that place.
        ownerRef: { kind: 'PLACE', id: placeUuid(estimate.from) },
        parameterSchemaVersion: 'northstar-demo-dataset/constraint/1',
        provenanceEvidenceId: evidenceFor('transfers'),
        operands: [
          { key: 'from_place', kind: 'SUBJECT_REF', value: { kind: 'PLACE', id: placeUuid(estimate.from) } },
          { key: 'to_place', kind: 'SUBJECT_REF', value: { kind: 'PLACE', id: placeUuid(estimate.to) } },
          { key: 'minutes', kind: 'NUMBER', value: minutes },
        ],
      }),
      `recordConstraintDefinition(transfer ${estimate.from}->${estimate.to})`,
    );
    bump('transferConstraints');
  }

  // ---- Transport services: one per published service, however many
  // travellers declare it -----------------------------------------------------
  const legsByService = new Map<string, Extract<DatasetDeclaredTravel, { itemKind: 'TRANSPORT_LEG' }>>();
  for (const traveller of draft.travellers) {
    for (const item of traveller.declaredTravel) {
      if (item.itemKind !== 'TRANSPORT_LEG') continue;
      legsByService.set(serviceKey(item), item);
    }
  }
  const serviceIds = new Map<string, string>();
  const rosterEvidence = evidenceFor('roster');
  // An ObservedValue's `sourceId` is persisted into the `*_evidence_id`
  // provenance column, so it cites the evidence record for the observation,
  // not the raw source capture behind it.
  const rosterObservationEvidence = rosterEvidence;
  const rosterObservedAt = toInstant(draft.receivedAt, 'importDraft.receivedAt');
  for (const [key, leg] of [...legsByService].sort(([a], [b]) => a.localeCompare(b))) {
    const serviceId = ids.id('transport-service', key);
    mustOk(
      await createTransportService(uow(), {
        ...identity,
        idempotencyKey: ids.key('transport-service', key),
        service: {
          id: serviceId,
          mode: transportMode(leg.mode),
          operator: serviceOperator(leg.carrierRef),
          originPlaceId: placeUuid(resolveDatasetPlace(placeAliases, leg.originRef)),
          destinationPlaceId: placeUuid(resolveDatasetPlace(placeAliases, leg.destinationRef)),
          publishedDeparture: {
            value: toInstant(leg.scheduledDeparture, 'scheduledDeparture'),
            observedAt: rosterObservedAt,
            sourceId: rosterObservationEvidence,
          },
          publishedArrival: {
            value: toInstant(leg.scheduledArrival, 'scheduledArrival'),
            observedAt: rosterObservedAt,
            sourceId: rosterObservationEvidence,
          },
        },
        evidenceRefs: [rosterEvidence],
      }),
      `createTransportService(${key})`,
    );
    serviceIds.set(key, serviceId);
    bump('transportServices');
    await sourceIdentity.map(SOURCE_RECORD_TYPES.TRANSPORT_SERVICE, externalRefValue(leg.carrierRef) + '@' + toInstant(leg.scheduledDeparture, 'scheduledDeparture'), {
      kind: 'TRANSPORT_SERVICE',
      id: serviceId,
    });
  }

  // ---- Travellers, Trips, Journeys, Journey items, Participations ---------
  interface PlannedLine {
    reservationKey: string;
    productType: 'TRANSPORT' | 'STAY';
    lineKey: string;
    item: DatasetDeclaredTravel;
    allocations: { travellerId: string; journeyItemId: string }[];
  }
  const plannedLines = new Map<string, PlannedLine>();
  const reservationItems = new Map<string, Set<'TRANSPORT' | 'STAY'>>();

  for (const traveller of draft.travellers) {
    const travellerId = ids.id('traveller', traveller.draftId);
    mustOk(
      await recordTraveller(uow(), {
        ...identity,
        idempotencyKey: ids.key('traveller', traveller.draftId),
        travellerId,
        displayName: {
          id: ids.id('traveller-name', traveller.draftId),
          nameKind: 'DISPLAY',
          displayValue: traveller.displayName,
          ...(traveller.identity.lastName ? { familyName: traveller.identity.lastName } : {}),
          effectiveRange: { start: dateOnly(rosterObservedAt) },
          evidenceId: rosterEvidence,
        },
      }),
      `recordTraveller(${traveller.draftId})`,
    );
    bump('travellers');
    for (const [index, preference] of traveller.preferences.entries()) {
      const from = preference.effectiveFrom ? toInstant(preference.effectiveFrom, 'preference.effectiveFrom') : observedAt;
      const until = preference.effectiveUntil
        ? toInstant(preference.effectiveUntil, 'preference.effectiveUntil')
        : new Date(Date.parse(from) + 3650 * 86_400_000).toISOString();
      mustOk(
        await recordPreference(uow(), {
          ...identity,
          idempotencyKey: ids.key('preference', traveller.draftId, String(index)),
          preferenceId: ids.id('preference', traveller.draftId, String(index)),
          ownerRef: { kind: 'TRAVELLER', id: travellerId },
          preferenceKind: preference.preferenceKind,
          source: preference.source,
          value: { key: preference.key, summary: preference.summary, ...(preference.match ? { match: preference.match } : {}) },
          valueSchemaVersion: 'planning-preference/1',
          effectiveWindow: { start: from, end: until },
          evidenceId: rosterEvidence,
        }),
        `recordPreference(${traveller.draftId}#${index})`,
      );
      bump('preferences');
    }
    await sourceIdentity.map(SOURCE_RECORD_TYPES.TRAVELLER, traveller.draftId, {
      kind: 'TRAVELLER',
      id: travellerId,
    });

    const tripId = ids.id('trip', traveller.draftId);
    const intendedWindow = anchorEvent.window
      ? {
        start: toInstant(anchorEvent.window.startsAt, 'anchorEvent.window.startsAt'),
        end: toInstant(anchorEvent.window.endsAt, 'anchorEvent.window.endsAt'),
      }
      : undefined;
    const trip = mustOk(
      await createTrip(uow(), {
        ...identity,
        idempotencyKey: ids.key('trip', traveller.draftId),
        tripId,
        purpose: anchorEvent.name,
        businessContextOrganisationId: organisationId,
        ...(intendedWindow ? { intendedWindow } : {}),
        evidenceRefs: [rosterEvidence],
      }),
      `createTrip(${traveller.draftId})`,
    );
    bump('trips');
    await sourceIdentity.map(SOURCE_RECORD_TYPES.TRIP, traveller.draftId, { kind: 'TRIP', id: tripId });

    const journeyId = ids.id('journey', traveller.draftId);
    let journeyRevision = mustOk(
      await createJourney(uow(), {
        ...identity,
        idempotencyKey: ids.key('journey', traveller.draftId),
        journeyId,
        tripId,
        travellerId,
        expectedTripRevision: trip.revision,
        // The organiser is the party responsible for this managed
        // participation, which is also how its policy reaches evaluation.
        responsibilityOrganisationId: organisationId,
        ...(intendedWindow ? { intendedWindow } : {}),
        evidenceRefs: [rosterEvidence],
      }),
      `createJourney(${traveller.draftId})`,
    ).revision;
    bump('journeys');
    await sourceIdentity.map(SOURCE_RECORD_TYPES.JOURNEY, traveller.draftId, { kind: 'JOURNEY', id: journeyId });

    // These are explicit source policy statements attached to the Journey
    // represented by this traveller draft. They are typed requirements, not
    // inferred facts and not evaluator verdicts.
    for (const requirement of dataset.journeyRequirements?.requirements.filter((item) => item.travellerDraftId === traveller.draftId) ?? []) {
      if (requirement.kind !== 'OVERNIGHT_ACCOMMODATION') continue;
      mustOk(
        await recordConstraintDefinition(uow(), {
          ...identity,
          idempotencyKey: ids.key('journey-requirement', requirement.id),
          constraintDefinitionId: ids.id('journey-requirement', requirement.id),
          registeredType: 'overnight_accommodation_required',
          hardness: 'HARD',
          ownerRef: { kind: 'JOURNEY', id: journeyId },
          parameterSchemaVersion: 'northstar-demo-dataset/journey-requirement/1',
          provenanceEvidenceId: evidenceFor('journeyRequirements'),
          operands: [{ key: 'minimum_gap_hours', kind: 'NUMBER', value: requirement.minimumGapHours }],
        }),
        `recordConstraintDefinition(${requirement.id})`,
      );
      bump('journeyRequirements');
    }

    // Declared travel, in the order the dataset states it.
    for (const [index, item] of traveller.declaredTravel.entries()) {
      const journeyItemId = ids.id('journey-item', traveller.draftId, index);
      const key = reservationKey(item, traveller.draftId, index);
      if (item.itemKind === 'TRANSPORT_LEG') {
        const service = serviceIds.get(serviceKey(item));
        if (!service) throw new DatasetMaterializationError(`transport service ${serviceKey(item)} was not materialized`);
        journeyRevision = mustOk(
          await addJourneyItem(uow(), {
            ...identity,
            idempotencyKey: ids.key('journey-item', traveller.draftId, index),
            journeyId,
            expectedRevision: journeyRevision,
            item: {
              id: journeyItemId,
              kind: 'TRANSPORT',
              orderKey: orderKey(index),
              lifecycleStatus: 'ACTIVE',
              desiredOriginPlaceId: placeUuid(resolveDatasetPlace(placeAliases, item.originRef)),
              desiredDestinationPlaceId: placeUuid(resolveDatasetPlace(placeAliases, item.destinationRef)),
              selectedServiceId: service,
              intendedWindow: {
                start: toInstant(item.scheduledDeparture, 'scheduledDeparture'),
                end: toInstant(item.scheduledArrival, 'scheduledArrival'),
              },
            },
            evidenceRefs: [rosterEvidence],
          }),
          `addJourneyItem(transport ${traveller.draftId}#${index})`,
        ).journeyRevision;
        bump('transportJourneyItems');
        registerLine(plannedLines, reservationItems, {
          reservationKey: key,
          productType: 'TRANSPORT',
          lineKey: `${key}|service:${serviceKey(item)}`,
          item,
          allocations: [{ travellerId, journeyItemId }],
        });
      } else {
        const stayPlace = resolveDatasetPlace(placeAliases, item.stayPlaceRef);
        journeyRevision = mustOk(
          await addJourneyItem(uow(), {
            ...identity,
            idempotencyKey: ids.key('journey-item', traveller.draftId, index),
            journeyId,
            expectedRevision: journeyRevision,
            item: {
              id: journeyItemId,
              kind: 'STAY',
              orderKey: orderKey(index),
              lifecycleStatus: 'ACTIVE',
              intendedPlaceId: placeUuid(stayPlace),
              requiredNights: stayNights(item.checkIn, item.checkOut),
              intendedWindow: {
                start: toInstant(item.checkIn, 'checkIn'),
                end: toInstant(item.checkOut, 'checkOut'),
              },
            },
            evidenceRefs: [rosterEvidence],
          }),
          `addJourneyItem(stay ${traveller.draftId}#${index})`,
        ).journeyRevision;
        bump('stayJourneyItems');
        registerLine(plannedLines, reservationItems, {
          reservationKey: key,
          productType: 'STAY',
          lineKey: `${key}|stay:${stayPlace}|${toInstant(item.checkIn, 'checkIn')}`,
          item,
          allocations: [{ travellerId, journeyItemId }],
        });
      }
    }

    // Item-referencing requirements are recorded after their canonical
    // JourneyItem rows exist so the typed operand foreign keys remain real.
    for (const requirement of dataset.journeyRequirements?.requirements.filter((item) => item.travellerDraftId === traveller.draftId && item.kind === 'STAY_ARRIVAL_DATE_ALIGNED') ?? []) {
      const aligned = stayArrivalRequirements.get(requirement.id);
      if (!aligned) throw new DatasetMaterializationError(`journey requirement ${requirement.id} was not resolved`);
      mustOk(
        await recordConstraintDefinition(uow(), {
          ...identity,
          idempotencyKey: ids.key('journey-requirement', requirement.id),
          constraintDefinitionId: ids.id('journey-requirement', requirement.id),
          registeredType: 'stay_arrival_date_aligned',
          hardness: 'HARD',
          ownerRef: { kind: 'JOURNEY', id: journeyId },
          parameterSchemaVersion: 'northstar-demo-dataset/journey-requirement/1',
          provenanceEvidenceId: evidenceFor('journeyRequirements'),
          operands: [
            { key: 'original_stay_item', kind: 'SUBJECT_REF', value: { kind: 'JOURNEY_ITEM', id: ids.id('journey-item', traveller.draftId, aligned.originalStayIndex) } },
            { key: 'arrival_item', kind: 'SUBJECT_REF', value: { kind: 'JOURNEY_ITEM', id: ids.id('journey-item', traveller.draftId, aligned.arrivalTransportIndex) } },
          ],
        }),
        `recordConstraintDefinition(${requirement.id})`,
      );
      bump('journeyRequirements');
    }

    // Programme participation, and the engagement item that links this
    // Journey to it.
    for (const [index, engagement] of traveller.engagementImportance.entries()) {
      const programmeItemId = programmeItemIds.get(engagement.commitmentId);
      if (!programmeItemId) {
        throw new DatasetMaterializationError(
          `traveller ${traveller.draftId} is committed to ${engagement.commitmentId}, which the dataset does not declare`,
        );
      }
      const participationId = ids.id('participation', traveller.draftId, engagement.commitmentId);
      programmeRevision = mustOk(
        await addParticipation(uow(), {
          ...identity,
          idempotencyKey: ids.key('participation', traveller.draftId, engagement.commitmentId),
          participationId,
          programmeId,
          programmeItemId,
          travellerId,
          obligation: participationObligation(engagement.importance),
          // Acceptance is the dataset's own commitment list, not an assumption:
          // a commitment the roster states this person is committed to.
          accepted: traveller.anchorCommitmentIds.includes(engagement.commitmentId),
          ...(engagement.role ? { roles: [engagement.role] } : {}),
          expectedProgrammeRevision: programmeRevision,
          evidenceRefs: [rosterEvidence],
        }),
        `addParticipation(${traveller.draftId}, ${engagement.commitmentId})`,
      ).programmeRevision;
      bump('participations');

      // The engagement item mirrors the programme item's own window. A
      // commitment the dataset left unscheduled gets no invented window.
      const commitmentWindow = programmeItemWindow.get(engagement.commitmentId);
      journeyRevision = mustOk(
        await addJourneyItem(uow(), {
          ...identity,
          idempotencyKey: ids.key('engagement-item', traveller.draftId, engagement.commitmentId),
          journeyId,
          expectedRevision: journeyRevision,
          item: {
            id: ids.id('engagement-item', traveller.draftId, engagement.commitmentId),
            kind: 'ENGAGEMENT',
            orderKey: `9${orderKey(index)}`,
            lifecycleStatus: 'ACTIVE',
            participationId,
            ...(commitmentWindow ? { intendedWindow: commitmentWindow } : {}),
          },
          evidenceRefs: [rosterEvidence],
        }),
        `addJourneyItem(engagement ${traveller.draftId}, ${engagement.commitmentId})`,
      ).journeyRevision;
      bump('engagementJourneyItems');
    }
  }

  // ---- Reservations, lines and traveller allocations ----------------------
  const reservationGroups = new Map<string, PlannedLine[]>();
  for (const line of plannedLines.values()) {
    const group = reservationGroups.get(line.reservationKey) ?? [];
    group.push(line);
    reservationGroups.set(line.reservationKey, group);
  }
  for (const [key, lines] of [...reservationGroups].sort(([a], [b]) => a.localeCompare(b))) {
    const kinds = reservationItems.get(key) ?? new Set<'TRANSPORT' | 'STAY'>();
    const reservationType = kinds.size > 1 ? 'MIXED' : [...kinds][0] ?? 'TRANSPORT';
    const stated = lines.map((line) => line.item.reservationState).find((state) => state !== undefined);
    const observedStatus = reservationStatus(stated);
    const reservationId = ids.id('reservation', key);
    const bookingRef = lines.map((line) => line.item.bookingRef).find((ref) => ref !== undefined);
    // A booking reference is provider identity: observe it on the connection
    // first so the reservation can name the record it came from, then bind
    // the record to the reservation with evidence.
    const externalRecordId = bookingRef
      ? await sourceIdentity.observe(SOURCE_RECORD_TYPES.RESERVATION, externalRefValue(bookingRef))
      : undefined;
    let reservationRevision = mustOk(
      await createReservation(uow(), {
        ...identity,
        idempotencyKey: ids.key('reservation', key),
        reservation: {
          id: reservationId,
          reservationType,
          observedStatus,
          ...(observedStatus === 'UNKNOWN' ? {} : { observedStatusAt: rosterObservedAt }),
          responsibleOrganisationId: organisationId,
          externalConnectionId: sourceIdentity.connectionId,
          ...(externalRecordId ? { externalRecordId } : {}),
        },
        evidenceRefs: [rosterEvidence],
      }),
      `createReservation(${key})`,
    ).revision;
    bump('reservations');
    if (bookingRef) {
      await sourceIdentity.link(SOURCE_RECORD_TYPES.RESERVATION, externalRefValue(bookingRef), {
        kind: 'RESERVATION',
        id: reservationId,
      });
    }

    for (const line of lines.sort((a, b) => a.lineKey.localeCompare(b.lineKey))) {
      const lineId = ids.id('reservation-line', line.lineKey);
      const lineStatus = reservationLineStatus(line.item.reservationState);
      const added = mustOk(
        await addReservationLine(uow(), {
          ...identity,
          idempotencyKey: ids.key('reservation-line', line.lineKey),
          reservationId,
          expectedRevision: reservationRevision,
          line: {
            id: lineId,
            productType: line.productType,
            observedStatus: lineStatus,
            ...(lineStatus === 'UNKNOWN'
              ? {}
              : { observedStatusAt: rosterObservedAt, observationEvidenceId: rosterEvidence }),
            ...(line.item.itemKind === 'STAY'
              ? {
                stayInterval: {
                  start: toInstant(line.item.checkIn, 'checkIn'),
                  end: toInstant(line.item.checkOut, 'checkOut'),
                },
              }
              : {}),
          },
          detail: line.item.itemKind === 'TRANSPORT_LEG'
            ? { productType: 'TRANSPORT', transportServiceId: serviceIds.get(serviceKey(line.item))! }
            : {
              productType: 'STAY',
              placeId: placeUuid(resolveDatasetPlace(placeAliases, line.item.stayPlaceRef)),
              stayInterval: {
                start: toInstant(line.item.checkIn, 'checkIn'),
                end: toInstant(line.item.checkOut, 'checkOut'),
              },
            },
          evidenceRefs: [rosterEvidence],
        }),
        `addReservationLine(${line.lineKey})`,
      );
      reservationRevision = added.reservationRevision;
      bump('reservationLines');

      for (const allocation of line.allocations) {
        reservationRevision = mustOk(
          await allocateReservationLine(uow(), {
            ...identity,
            idempotencyKey: ids.key('allocation', line.lineKey, allocation.travellerId),
            reservationId,
            expectedRevision: reservationRevision,
            allocation: {
              id: ids.id('allocation', line.lineKey, allocation.travellerId),
              reservationLineId: lineId,
              travellerId: allocation.travellerId,
              journeyItemId: allocation.journeyItemId,
              allocationRole: 'TRAVELLER',
              // One seat/bed per person per line: the dataset states travel
              // per traveller, never a multi-unit allocation.
              quantity: 1,
            },
            evidenceRefs: [rosterEvidence],
          }),
          `allocateReservationLine(${line.lineKey})`,
        ).reservationRevision;
        bump('reservationAllocations');
      }
    }
  }

  return {
    datasetKey: dataset.datasetKey,
    contentHash: dataset.contentHash,
    connectionId: sourceIdentity.connectionId,
    organisationId,
    eventId,
    programmeId,
    counts,
    notMaterialized: notMaterialized(dataset, draft.travellers),
  };
}

function registerLine(
  lines: Map<string, { reservationKey: string; productType: 'TRANSPORT' | 'STAY'; lineKey: string; item: DatasetDeclaredTravel; allocations: { travellerId: string; journeyItemId: string }[] }>,
  kinds: Map<string, Set<'TRANSPORT' | 'STAY'>>,
  planned: { reservationKey: string; productType: 'TRANSPORT' | 'STAY'; lineKey: string; item: DatasetDeclaredTravel; allocations: { travellerId: string; journeyItemId: string }[] },
): void {
  const existing = lines.get(planned.lineKey);
  if (existing) existing.allocations.push(...planned.allocations);
  else lines.set(planned.lineKey, planned);
  const set = kinds.get(planned.reservationKey) ?? new Set<'TRANSPORT' | 'STAY'>();
  set.add(planned.productType);
  kinds.set(planned.reservationKey, set);
}

/** `effectiveRange` bounds are local dates, not instants. */
function dateOnly(instant: string): string {
  return instant.slice(0, 10);
}

/**
 * Bounding boxes -> a single MULTIPOLYGON, which `area_versions` requires.
 *
 * `area_versions` also enforces `ST_IsValid`, and a MultiPolygon whose parts
 * overlap or touch along an edge is invalid — so a dataset that states such
 * boxes is rejected here with the offending pair named, rather than at the
 * database with a bare constraint name.
 */
export function boundingBoxesToWkt(boxes: readonly (readonly [number, number, number, number])[]): string {
  if (boxes.length === 0) throw new DatasetMappingError('an area must state at least one bounding box');
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const separated = a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1];
      if (!separated) {
        throw new DatasetMappingError(
          `bounding boxes [${a.join(',')}] and [${b.join(',')}] overlap or touch; ` +
            'multipolygon parts must be strictly disjoint to form a valid geometry',
        );
      }
    }
  }
  const polygons = boxes.map(([west, south, east, north]) => {
    if (!(east > west) || !(north > south)) {
      throw new DatasetMappingError(`bounding box [${west},${south},${east},${north}] is not a positive-area box`);
    }
    const ring = [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ].map(([lon, lat]) => `${lon} ${lat}`).join(', ');
    return `((${ring}))`;
  });
  return `MULTIPOLYGON(${polygons.join(', ')})`;
}

function rulePredicateExpression(rule: DatasetRule): { operator: 'PREDICATE'; predicateId: string; parameters: Record<string, unknown> } {
  return {
    operator: 'PREDICATE',
    predicateId: rulePredicateId(rule.kind),
    parameters: ruleParameters(rule),
  };
}

/**
 * Dataset content this increment deliberately does not turn into domain
 * state, with the reason. Reported rather than dropped.
 */
function notMaterialized(dataset: LoadedDataset, travellers: readonly DatasetTraveller[]): string[] {
  const out: string[] = [];
  const files = dataset.contributingFiles.filter((file) => file !== 'programme.json' && file !== 'ground-transfers.json' && file !== 'jurisdictions.json');
  for (const file of files) {
    out.push(`${file}: money/custody-shaped content whose target home (cost allocations, protected data refs) is not built in this increment`);
  }
  if (travellers.some((t) => t.identity.email !== undefined)) {
    out.push('traveller contact detail: a contact edition needs a ProtectedDataRef custody target, which this increment does not provision');
  }
  if (travellers.some((t) => t.nationalityCodes.length > 0)) {
    out.push('traveller nationality: a citizenship profile assertion needs credential/custody evidence this dataset does not carry');
  }
  if (travellers.some((t) => t.notes.length > 0 || t.accessibilityStatements.length > 0)) {
    out.push('traveller notes / accessibility statements: free prose with no typed target module in this increment');
  }
  if (dataset.programme.importDraft.unresolvedStatements.length > 0) {
    out.push('import-draft unresolved statements: genuinely unresolved source uncertainty, preserved as UNKNOWN rather than resolved');
  }
  out.push('intended visits: the dataset declares no visit/transit intent, so ENTRY encounters are not derivable and entry_feasibility stays NOT_APPLICABLE');
  return out;
}
