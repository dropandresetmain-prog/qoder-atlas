import { z } from 'zod';
import type { Pool } from '../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../persistence/postgres/pgUnitOfWork.ts';
import type { TypedRef } from '../domain/v2/shared/identity.ts';
import type { CapturedWorld, WJourneyItem } from '../resolution/world/world.ts';
import type { FailingSubject } from '../resolution/planning/proposer.ts';
import type { HotelPlanningOptions, HotelPlanningContext } from './targetHotelCompanionPlanning.ts';
import type { PlanningToolTransport } from '../resolution/planning/researchDispatcher.ts';
import type { PlanningToolProvenance, PlanningToolProvenanceMode } from '../contracts/v2/planning/planningTool.ts';
import { airportResolverFromCapturedWorld, transportCorridors, travellersForJourneyItemPassengers } from '../resolution/planning/transportCorridors.ts';
import { buildHotelPropertyPolicyWindow, HotelPropertyPolicySchema, type HotelPropertyPolicy } from '../resolution/planning/hotelPropertyPolicy.ts';
import { ReviewedEntryPolicySchema, type ReviewedEntryPolicy } from '../resolution/planning/reviewedEntryEvidence.ts';
import { publishReviewedEntryKnowledge } from './target/reviewedEntryPublication.ts';
import type { OfficialDocumentEvidence } from '../providers/research/officialDocuments.ts';
import type { CapabilityResult } from '../contracts/envelope.ts';
import type { PlanningEvidenceRecord } from '../contracts/v2/planning/recoveryPlanningAttempt.ts';
import type { UncoveredOvernightGap } from '../resolution/planning/proposers/overnightCompanions.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './target/deterministicId.ts';

const SourceRefSchema = z.string().regex(/^SOURCE_(?:PLACE|JURISDICTION|TRAVELLER_DRAFT):\S+$/);
const Iso2Schema = z.string().regex(/^[A-Z]{2}$/);

export interface OvernightTargetConfiguration {
  arrivalPlaceSourceRef: string;
  hotelPolicyId: string;
  jurisdictionSourceRef: string;
  countryCode: string;
  entryPolicyId: string;
}

export interface PassportSelectionConfiguration {
  travellerSourceRef: string;
  credentialId: string;
  credentialVersionId: string;
  /** Explicit provider nationality input; passport schema deliberately has no inferred nationality field. */
  guestNationality: string;
}

export interface TargetRecoveryContextConfiguration {
  sourceConnectionProviderKind: string;
  overnightTargets: readonly OvernightTargetConfiguration[];
  passportSelections: readonly PassportSelectionConfiguration[];
}

export interface TargetRecoveryContextDeps {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  reviewerRef: { kind: 'ORGANISATION' | 'PRINCIPAL'; id: string };
  hotelTransport: PlanningToolTransport;
  officialDocuments: { read(sourceId: string): Promise<CapabilityResult<OfficialDocumentEvidence>> };
  hotelPolicies: readonly unknown[];
  entryPolicies: readonly unknown[];
  configuration: TargetRecoveryContextConfiguration;
}

interface ResolvedTarget {
  config: OvernightTargetConfiguration;
  placeId: string;
  jurisdictionId: string;
  placeExternalRef: { system: string; value: string };
  hotelPolicy: HotelPropertyPolicy;
  entryPolicy: ReviewedEntryPolicy;
}

interface PreparedContext {
  target: ResolvedTarget;
  journeyId: string;
  corridorJourneyItemId: string;
  anchorDate: string;
  checkOutDate: string;
  stayWindow: { start: string; end: string };
  proposedJourneyItemId: string;
  proposedVisitId: string;
  proposedSelectionId: string;
  credentialId: string;
  credentialVersionId: string;
  guestNationality: string;
  provenance: PlanningToolProvenance;
}

function sourceParts(ref: string): { recordType: string; externalId: string } | undefined {
  const parsed = SourceRefSchema.safeParse(ref);
  if (!parsed.success) return undefined;
  const separator = ref.indexOf(':');
  return { recordType: ref.slice(0, separator), externalId: ref.slice(separator + 1) };
}

function nextLocalDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function deterministicInsertionOrder(left: string, right?: string): string | undefined {
  const candidate = `${left}.5`;
  return right === undefined || (left < candidate && candidate < right) ? candidate : undefined;
}

function insertionOrder(world: CapturedWorld, item: WJourneyItem): string | undefined {
  const siblings = world.journeyItems.filter((candidate) => candidate.journeyId === item.journeyId).sort((a, b) => a.orderKey.localeCompare(b.orderKey) || a.id.localeCompare(b.id));
  const index = siblings.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return undefined;
  const left = item.orderKey;
  const right = siblings[index + 1]?.orderKey;
  return deterministicInsertionOrder(left, right);
}

function evidenceRecord(operation: 'research.entry_requirements' | 'research.local_context', evidenceRef: string, documents: readonly OfficialDocumentEvidence[], mode: PlanningToolProvenanceMode, summary: string): PlanningEvidenceRecord {
  const observedAt = documents.reduce((latest, document) => Date.parse(document.observedAt) > Date.parse(latest) ? document.observedAt : latest, documents[0]!.observedAt);
  return {
    evidenceRef,
    requestFingerprint: `${operation}:${evidenceRef}`,
    capability: 'RESEARCH',
    operation,
    status: 'SUCCEEDED',
    summary,
    provenance: { mode, observedAt, sourceRefs: documents.map((document) => document.sourceId) },
    uncertainty: [],
  };
}

export class TargetRecoveryContextPreparer {
  private readonly deps: TargetRecoveryContextDeps;
  private readonly documentCache = new Map<string, { evidence: OfficialDocumentEvidence; maxAgeSeconds: number; mode: PlanningToolProvenanceMode }>();
  private readonly publicationCache = new Set<string>();

  constructor(deps: TargetRecoveryContextDeps) {
    this.deps = deps;
  }

  private async connectionId(): Promise<string | undefined> {
    const result = await this.deps.pool.query<{ id: string }>(
      `SELECT id FROM external_connections WHERE workspace_id = $1 AND provider_kind = $2 ORDER BY id`,
      [this.deps.workspaceId, this.deps.configuration.sourceConnectionProviderKind],
    );
    return result.rows.length === 1 ? result.rows[0]!.id : undefined;
  }

  private async resolveAlias(connectionId: string, sourceRef: string, expectedRecordType: string): Promise<string | undefined> {
    const parsed = sourceParts(sourceRef);
    if (!parsed || parsed.recordType !== expectedRecordType) return undefined;
    const rows = await this.deps.pool.query<{ subject_id: string; subject_kind: string }>(
      `SELECT l.canonical_subject_id AS subject_id, l.canonical_subject_kind AS subject_kind
         FROM external_records r JOIN external_record_links l
           ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id
        WHERE r.workspace_id = $1 AND r.connection_id = $2 AND r.record_type = $3 AND r.external_id = $4 AND l.superseded_at IS NULL`,
      [this.deps.workspaceId, connectionId, parsed.recordType, parsed.externalId],
    );
    return rows.rows.length === 1 ? rows.rows[0]!.subject_id : undefined;
  }

  private async readDocuments(sourceIds: readonly string[], maxAgeSeconds: number, now: string): Promise<{ documents: OfficialDocumentEvidence[]; mode: PlanningToolProvenanceMode } | undefined> {
    const documents: OfficialDocumentEvidence[] = [];
    let mode: PlanningToolProvenanceMode = 'REPLAY';
    for (const sourceId of sourceIds) {
      const cached = this.documentCache.get(sourceId);
      if (cached && Date.parse(cached.evidence.observedAt) + cached.maxAgeSeconds * 1000 > Date.parse(now)) {
        documents.push(cached.evidence);
        mode = cached.mode;
        continue;
      }
      const result = await this.deps.officialDocuments.read(sourceId);
      if (!result.ok) return undefined;
      this.documentCache.set(sourceId, { evidence: result.data, maxAgeSeconds, mode: result.meta.mode });
      mode = result.meta.mode;
      documents.push(result.data);
    }
    return { documents, mode };
  }

  private async resolveTargets(connectionId: string): Promise<ResolvedTarget[]> {
    const out: ResolvedTarget[] = [];
    for (const config of this.deps.configuration.overnightTargets) {
      const placeId = await this.resolveAlias(connectionId, config.arrivalPlaceSourceRef, 'SOURCE_PLACE');
      const jurisdictionId = await this.resolveAlias(connectionId, config.jurisdictionSourceRef, 'SOURCE_JURISDICTION');
      const hotelPolicy = HotelPropertyPolicySchema.safeParse(this.deps.hotelPolicies.find((policy) => (policy as { id?: string })?.id === config.hotelPolicyId));
      const entryPolicy = ReviewedEntryPolicySchema.safeParse(this.deps.entryPolicies.find((policy) => (policy as { id?: string })?.id === config.entryPolicyId));
      const country = Iso2Schema.safeParse(config.countryCode);
      if (!placeId || !jurisdictionId || !hotelPolicy.success || !entryPolicy.success || !country.success) continue;
      const placeRows = await this.deps.pool.query<{ system: string; value: string }>(
        `SELECT er.provider_namespace AS system, er.external_key AS value FROM place_external_refs er WHERE er.workspace_id = $1 AND er.place_id = $2`,
        [this.deps.workspaceId, placeId],
      );
      const alias = hotelPolicy.data.sourcePlaceAliases.find((candidate) => placeRows.rows.some((row) => row.system === candidate.system && row.value === candidate.value));
      if (!alias) continue;
      out.push({ config, placeId, jurisdictionId, placeExternalRef: alias, hotelPolicy: hotelPolicy.data, entryPolicy: entryPolicy.data });
    }
    return out;
  }

  async prepare(input: { recoveryCaseId: string; now: string; world: CapturedWorld; failing: readonly FailingSubject[] }): Promise<{ additionalPlaceIds?: readonly string[]; hotelPlanning?: HotelPlanningOptions; evidence?: readonly PlanningEvidenceRecord[] }> {
    const connectionId = await this.connectionId();
    if (!connectionId) return {};
    const targets = await this.resolveTargets(connectionId);
    if (targets.length === 0) return {};
    const resolveAirport = airportResolverFromCapturedWorld(input.world);
    const corridors = transportCorridors(input.world, input.failing, {
      resolveAirport,
      passengersFor: ({ journeyId, journeyItemId, world }) => travellersForJourneyItemPassengers(world, journeyItemId, journeyId),
    }).corridors;
    const passportSelections = new Map<string, PassportSelectionConfiguration>();
    for (const configured of this.deps.configuration.passportSelections) {
      const travellerId = await this.resolveAlias(connectionId, configured.travellerSourceRef, 'SOURCE_TRAVELLER_DRAFT');
      if (travellerId && !passportSelections.has(travellerId) && Iso2Schema.safeParse(configured.guestNationality).success) {
        passportSelections.set(travellerId, configured);
      }
    }
    const prepared: PreparedContext[] = [];
    const evidence: PlanningEvidenceRecord[] = [];
    for (const target of targets) {
      for (const corridor of corridors.filter((candidate) => candidate.destinationPlaceId === target.placeId)) {
        const journey = input.world.journeys.find((candidate) => candidate.id === corridor.journeyId);
        const item = input.world.journeyItems.find((candidate) => candidate.id === corridor.journeyItemId);
        if (!journey || !item) continue;
        const targetSelection = passportSelections.get(journey.travellerId);
        if (!targetSelection) continue;
        const travellerId = journey.travellerId;
        const credential = input.world.credentials.find((candidate) => candidate.id === targetSelection.credentialId && candidate.travellerId === travellerId && candidate.kind === 'PASSPORT');
        const version = input.world.credentialVersions.find((candidate) => candidate.id === targetSelection.credentialVersionId && candidate.credentialId === targetSelection.credentialId && candidate.kind === 'PASSPORT');
        if (!credential || !version || credential.currentVersionId !== version.id) continue;
        const anchorDate = corridor.departureDate;
        const checkOutDate = nextLocalDate(anchorDate);
        const hotelDocs = await this.readDocuments(target.hotelPolicy.sources.map((source) => source.sourceId), target.hotelPolicy.maxEvidenceAgeSeconds, input.now);
        if (!hotelDocs) continue;
        const window = buildHotelPropertyPolicyWindow({ policy: target.hotelPolicy, actualOfficialDocumentEvidence: hotelDocs.documents, quotedLocalDates: { checkInDate: anchorDate, checkOutDate }, now: input.now });
        if (!window.ok) continue;
        const orderKey = insertionOrder(input.world, item);
        if (!orderKey) continue;
        const proposedVisitId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${input.recoveryCaseId}|visit|${corridor.journeyId}|${target.placeId}|${anchorDate}`);
        const proposedJourneyItemId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${input.recoveryCaseId}|stay|${corridor.journeyId}|${target.placeId}|${anchorDate}`);
        const proposedSelectionId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${proposedVisitId}|credential-selection|${targetSelection.credentialVersionId}`);
        const entryDocs = await this.readDocuments(target.entryPolicy.sources.map((source) => source.sourceId), target.entryPolicy.maxEvidenceAgeSeconds, input.now);
        if (!entryDocs) continue;
        const publicationKey = `${proposedVisitId}|${target.entryPolicy.id}|${targetSelection.guestNationality}`;
        if (!this.publicationCache.has(publicationKey)) {
          const publication = await publishReviewedEntryKnowledge({ pool: this.deps.pool, workspaceId: this.deps.workspaceId, actorPrincipalId: this.deps.actorPrincipalId, reviewerRef: this.deps.reviewerRef, uow: this.deps.uow }, {
            policy: target.entryPolicy, actualOfficialDocumentEvidence: entryDocs.documents, now: input.now,
            context: { journeyId: corridor.journeyId, visitId: proposedVisitId, jurisdictionId: target.jurisdictionId, countryCode: target.config.countryCode, purpose: 'transit_overnight', nationalityCode: targetSelection.guestNationality, visitWindow: window.stayWindow },
          });
          if (!publication.ok) continue;
          this.publicationCache.add(publicationKey);
        }
        const provenance: PlanningToolProvenance = { mode: hotelDocs.mode, observedAt: window.sourceProvenance.reduce((latest, source) => Date.parse(source.observedAt) > Date.parse(latest) ? source.observedAt : latest, window.sourceProvenance[0]!.observedAt), sourceRefs: window.sourceProvenance.map((source) => source.sourceId) };
        prepared.push({ target, journeyId: corridor.journeyId, corridorJourneyItemId: corridor.journeyItemId, anchorDate, checkOutDate, stayWindow: window.stayWindow, proposedJourneyItemId, proposedVisitId, proposedSelectionId, credentialId: credential.id, credentialVersionId: version.id, guestNationality: targetSelection.guestNationality, provenance });
        evidence.push(evidenceRecord('research.local_context', `hotel-policy:${target.hotelPolicy.id}:${corridor.journeyId}:${anchorDate}`, hotelDocs.documents, hotelDocs.mode, `Verified hotel policy ${target.hotelPolicy.id} for the configured arrival place and bounded local window.`));
        evidence.push(evidenceRecord('research.entry_requirements', `entry-policy:${target.entryPolicy.id}:${corridor.journeyId}:${anchorDate}`, entryDocs.documents, entryDocs.mode, `Verified reviewed entry policy ${target.entryPolicy.id} for the configured journey visit scope.`));
      }
    }
    if (prepared.length === 0) return { evidence };
    const contexts = prepared;
    const hotelPlanning: HotelPlanningOptions = {
      transport: this.deps.hotelTransport,
      resolveContext: ({ candidate, gap, world, now }): HotelPlanningContext | undefined => {
        const selected = candidate.effects.find((effect) => effect.effectKind === 'SELECT_OFFER');
        if (!selected || selected.effectKind !== 'SELECT_OFFER') return undefined;
        const context = contexts.find((preparedContext) => preparedContext.journeyId === gap.journeyId && preparedContext.corridorJourneyItemId === selected.journeyItemId);
        const capturedItem = world.journeyItems.find((item) => item.id === context?.corridorJourneyItemId);
        if (!context || !capturedItem || world.journeys.find((journey) => journey.id === context.journeyId)?.travellerId === undefined) return undefined;
        return {
          baseCandidateKey: candidate.key,
          journeyId: context.journeyId,
          placeId: context.target.placeId,
          query: { location: { externalRef: context.target.placeExternalRef }, checkInDate: context.anchorDate, checkOutDate: context.checkOutDate, guests: { adults: 1 }, rooms: 1, guestNationality: context.guestNationality },
          stayWindow: context.stayWindow,
          proposedJourneyItemId: context.proposedJourneyItemId,
          orderKey: insertionOrder(world, capturedItem) ?? '',
          visit: { kind: 'PROPOSED', proposedVisitId: context.proposedVisitId, jurisdictionId: context.target.jurisdictionId, purpose: 'transit_overnight', intendedWindow: context.stayWindow, credentialSelections: [{ proposedSelectionId: context.proposedSelectionId, credentialId: context.credentialId, credentialVersionId: context.credentialVersionId }] },
          provenance: context.provenance,
        };
      },
    };
    return { additionalPlaceIds: [...new Set(prepared.map((context) => context.target.placeId))], hotelPlanning, evidence };
  }
}

export function createTargetRecoveryContextPreparer(deps: TargetRecoveryContextDeps): TargetRecoveryContextPreparer {
  return new TargetRecoveryContextPreparer(deps);
}
