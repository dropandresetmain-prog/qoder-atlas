import { z } from 'zod';
import type { Pool } from '../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../persistence/postgres/pgUnitOfWork.ts';
import type { CapturedWorld, WIntendedVisit, WJourneyItem } from '../resolution/world/world.ts';
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
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './target/deterministicId.ts';
import { projectEffectiveWorld } from '../resolution/world/effectiveItinerary.ts';
import { selectCredential } from '../persistence/postgres/commands/travelCommands.ts';

const SourceRefSchema = z.string().regex(/^SOURCE_(?:PLACE|JURISDICTION|TRAVELLER_DRAFT|INTENDED_VISIT):\S+$/);
const Iso2Schema = z.string().regex(/^[A-Z]{2}$/);

export interface OvernightTargetConfiguration {
  /** The airport/place at which the failed onward connection originates. */
  arrivalAirportSourceRef: string;
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

/** An existing canonical visit to research; this never creates a visit. */
export interface ExistingVisitTargetConfiguration {
  visitSourceRef: string;
  /** Canonical child id supplied by the source materializer; never recomputed here. */
  visitId: string;
  entryPolicyId: string;
  countryCode: string;
}

export interface TargetRecoveryContextConfiguration {
  sourceConnectionProviderKind: string;
  overnightTargets: readonly OvernightTargetConfiguration[];
  passportSelections: readonly PassportSelectionConfiguration[];
  existingVisitTargets?: readonly ExistingVisitTargetConfiguration[];
}

export interface TargetRecoveryContextDeps {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  reviewerRef: { kind: 'ORGANISATION' | 'PRINCIPAL'; id: string };
  /** Captured/source-owned country code for an existing visit jurisdiction. */
  jurisdictionCountryCode?: (jurisdictionId: string) => Promise<string | undefined>;
  hotelTransport: PlanningToolTransport;
  officialDocuments: { read(sourceId: string): Promise<CapabilityResult<OfficialDocumentEvidence>> };
  /** Live composition supplies wall-clock verification after provider reads; tests may pin it. */
  verificationClock?: () => string;
  hotelPolicies: readonly unknown[];
  entryPolicies: readonly unknown[];
  configuration: TargetRecoveryContextConfiguration;
}

interface ResolvedTarget {
  config: OvernightTargetConfiguration;
  arrivalAirportId: string;
  hotelPlaceId: string;
  jurisdictionId: string;
  placeExternalRef: { system: string; value: string };
  hotelPolicy: HotelPropertyPolicy;
  entryPolicy: ReviewedEntryPolicy;
}

interface PreparedContext {
  target: ResolvedTarget;
  journeyId: string;
  corridorJourneyItemId: string;
  upstreamJourneyItemId: string;
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

interface ResolvedExistingVisit {
  config: ExistingVisitTargetConfiguration;
  visitId: string;
  journeyId: string;
  travellerId: string;
  jurisdictionId: string;
  purpose: string;
  visitWindow: { start: string; end: string };
  entryPolicy: ReviewedEntryPolicy;
  passport: PassportSelectionConfiguration;
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

export interface ConnectionRecoveryContext {
  upstreamJourneyItemId: string;
  downstreamJourneyItemId: string;
  upstreamArrival: string;
  downstreamDeparture: string;
  anchorDate: string;
  checkOutDate: string;
}

function localDateAtTimeZone(instant: string, timeZone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
    const values = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value] as const));
    const year = values.get('year'); const month = values.get('month'); const day = values.get('day');
    return year && month && day ? `${year}-${month}-${day}` : undefined;
  } catch { return undefined; }
}

/** Extract only the exact current m6.connection break that names the downstream item. */
export function connectionRecoveryContext(
  world: CapturedWorld,
  failing: readonly FailingSubject[],
  downstreamItem: WJourneyItem,
  originPlace: { timeZone: string },
): ConnectionRecoveryContext | undefined {
  const effective = projectEffectiveWorld(world).journeys.find((journey) => journey.journeyRef.id === downstreamItem.journeyId);
  const downstream = effective?.items.find((item) => item.itemRef.id === downstreamItem.id);
  if (!effective || !downstream) return undefined;
  for (const failed of failing) {
    if (failed.subject.kind !== 'JOURNEY' || failed.subject.id !== downstreamItem.journeyId) continue;
    for (const dimension of failed.assessment.dimensions) {
      if (!dimension.applicable || !dimension.blocking || dimension.verdict !== 'FAIL' || dimension.dimension !== 'connection_feasibility') continue;
      for (const explanation of dimension.explanations) {
        if (explanation.evaluatorId !== 'm6.connection' || explanation.status !== 'FAIL') continue;
        if (!explanation.relatedSubjects.some((ref) => ref.kind === 'JOURNEY_ITEM' && ref.id === downstreamItem.id)) continue;
        const upstreamArrival = explanation.facts.upstreamArrival;
        const downstreamDeparture = explanation.facts.downstreamDeparture;
        if (typeof upstreamArrival !== 'string' || typeof downstreamDeparture !== 'string' || downstream.start.value !== downstreamDeparture) continue;
        const upstream = explanation.relatedSubjects
          .filter((ref) => ref.kind === 'JOURNEY_ITEM' && ref.id !== downstreamItem.id)
          .map((ref) => effective.items.find((item) => item.itemRef.id === ref.id))
          .find((item) => item?.end.value === upstreamArrival);
        if (!upstream) continue;
        const upstreamDate = localDateAtTimeZone(upstreamArrival, originPlace.timeZone);
        const downstreamDate = localDateAtTimeZone(downstreamDeparture, originPlace.timeZone);
        if (!upstreamDate || !downstreamDate) continue;
        const anchorDate = upstreamDate > downstreamDate ? upstreamDate : downstreamDate;
        return { upstreamJourneyItemId: upstream.itemRef.id, downstreamJourneyItemId: downstream.itemRef.id, upstreamArrival, downstreamDeparture, anchorDate, checkOutDate: nextLocalDate(anchorDate) };
      }
    }
  }
  return undefined;
}

export function deterministicInsertionOrder(left: string, right?: string): string | undefined {
  const candidate = `${left}.5`;
  return right === undefined || (left < candidate && candidate < right) ? candidate : undefined;
}

function insertionOrder(world: CapturedWorld, upstreamJourneyItemId: string, downstreamJourneyItemId: string): string | undefined {
  const downstreamItem = world.journeyItems.find((candidate) => candidate.id === downstreamJourneyItemId);
  if (!downstreamItem) return undefined;
  const siblings = world.journeyItems.filter((candidate) => candidate.journeyId === downstreamItem.journeyId).sort((a, b) => a.orderKey.localeCompare(b.orderKey) || a.id.localeCompare(b.id));
  const upstream = siblings.find((candidate) => candidate.id === upstreamJourneyItemId);
  const downstream = siblings.find((candidate) => candidate.id === downstreamJourneyItemId);
  if (!upstream || !downstream || upstream.orderKey >= downstream.orderKey) return undefined;
  return deterministicInsertionOrder(upstream.orderKey, downstream.orderKey);
}

function evidenceRecord(operation: 'research.entry_requirements' | 'research.local_context', evidenceRef: string, documents: readonly OfficialDocumentEvidence[], mode: PlanningToolProvenanceMode, summary: string, operationalNotes: readonly string[] = []): PlanningEvidenceRecord {
  const observedAt = documents.reduce((latest, document) => Date.parse(document.observedAt) > Date.parse(latest) ? document.observedAt : latest, documents[0]!.observedAt);
  return {
    evidenceRef,
    requestFingerprint: `${operation}:${evidenceRef}`,
    capability: 'RESEARCH',
    operation,
    status: 'SUCCEEDED',
    summary,
    provenance: { providerId: 'official-documents', mode, observedAt, sourceRefs: documents.map((document) => document.sourceId) },
    uncertainty: operationalNotes.map((summary) => ({ code: 'remaining_arrival_formality', summary })),
    sourceLinks: documents.slice(0, 8).map(({ publisher, url, observedAt }) => ({ publisher, url, observedAt })),
  };
}

function unavailableEvidenceRecord(
  operation: 'research.entry_requirements' | 'research.local_context',
  evidenceRef: string,
  observedAt: string,
  code: string,
  summary: string,
): PlanningEvidenceRecord {
  return {
    evidenceRef,
    requestFingerprint: `${operation}:${evidenceRef}`,
    capability: 'RESEARCH',
    operation,
    status: 'UNAVAILABLE',
    summary,
    provenance: { mode: 'INTERNAL', observedAt, sourceRefs: [] },
    uncertainty: [{ code, summary }],
  };
}

export class TargetRecoveryContextPreparer {
  private readonly deps: TargetRecoveryContextDeps;
  private readonly documentCache = new Map<string, { evidence: OfficialDocumentEvidence; maxAgeSeconds: number; mode: PlanningToolProvenanceMode }>();
  private readonly publicationCache = new Map<string, string>();

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

  private async resolveAlias(connectionId: string, sourceRef: string, expectedRecordType: string, expectedSubjectKind: string): Promise<string | undefined> {
    const parsed = sourceParts(sourceRef);
    if (!parsed || parsed.recordType !== expectedRecordType) return undefined;
    const rows = await this.deps.pool.query<{ subject_id: string; subject_kind: string }>(
      `SELECT l.canonical_subject_id AS subject_id, l.canonical_subject_kind AS subject_kind
         FROM external_records r JOIN external_record_links l
           ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id
        WHERE r.workspace_id = $1 AND r.connection_id = $2 AND r.record_type = $3 AND r.external_id = $4 AND l.superseded_at IS NULL`,
      [this.deps.workspaceId, connectionId, parsed.recordType, parsed.externalId],
    );
    return rows.rows.length === 1 && rows.rows[0]!.subject_kind === expectedSubjectKind ? rows.rows[0]!.subject_id : undefined;
  }

  private async authoritativeNationality(travellerId: string, configured: string): Promise<boolean> {
    const result = await this.deps.pool.query<{ nationality: string | null }>(
      `SELECT nationality FROM traveller_booking_identities WHERE workspace_id = $1 AND traveller_id = $2`,
      [this.deps.workspaceId, travellerId],
    );
    return result.rows.length === 1 && result.rows[0]!.nationality === configured;
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
      const arrivalAirportId = await this.resolveAlias(connectionId, config.arrivalAirportSourceRef, 'SOURCE_PLACE', 'PLACE');
      const jurisdictionId = await this.resolveAlias(connectionId, config.jurisdictionSourceRef, 'SOURCE_JURISDICTION', 'JURISDICTION');
      const hotelPolicy = HotelPropertyPolicySchema.safeParse(this.deps.hotelPolicies.find((policy) => (policy as { id?: string })?.id === config.hotelPolicyId));
      const entryPolicy = ReviewedEntryPolicySchema.safeParse(this.deps.entryPolicies.find((policy) => (policy as { id?: string })?.id === config.entryPolicyId));
      const country = Iso2Schema.safeParse(config.countryCode);
      if (!arrivalAirportId || !jurisdictionId || !hotelPolicy.success || !entryPolicy.success || !country.success) continue;
      const hotelPlaceId = await this.resolveAlias(connectionId, `SOURCE_PLACE:${hotelPolicy.data.canonicalPlaceId}`, 'SOURCE_PLACE', 'PLACE');
      if (!hotelPlaceId) continue;
      const placeRows = await this.deps.pool.query<{ system: string; value: string }>(
        `SELECT er.provider_namespace AS system, er.external_key AS value FROM place_external_refs er WHERE er.workspace_id = $1 AND er.place_id = $2`,
        [this.deps.workspaceId, hotelPlaceId],
      );
      const alias = hotelPolicy.data.sourcePlaceAliases.find((candidate) => placeRows.rows.some((row) => row.system === candidate.system && row.value === candidate.value));
      if (!alias) continue;
      out.push({ config, arrivalAirportId, hotelPlaceId, jurisdictionId, placeExternalRef: alias, hotelPolicy: hotelPolicy.data, entryPolicy: entryPolicy.data });
    }
    return out;
  }

  private async resolvePassportSelections(connectionId: string, world: CapturedWorld): Promise<Map<string, PassportSelectionConfiguration>> {
    const selections = new Map<string, PassportSelectionConfiguration>();
    for (const configured of this.deps.configuration.passportSelections) {
      const travellerId = await this.resolveAlias(connectionId, configured.travellerSourceRef, 'SOURCE_TRAVELLER_DRAFT', 'TRAVELLER');
      if (!travellerId || selections.has(travellerId) || !Iso2Schema.safeParse(configured.guestNationality).success) continue;
      const credential = world.credentials.find((candidate) => candidate.id === configured.credentialId
        && candidate.travellerId === travellerId && candidate.kind === 'PASSPORT');
      const version = world.credentialVersions.find((candidate) => candidate.id === configured.credentialVersionId
        && candidate.credentialId === configured.credentialId && candidate.kind === 'PASSPORT');
      if (!credential || !version || version.issuingStateCode !== configured.guestNationality) continue;
      if (!await this.authoritativeNationality(travellerId, configured.guestNationality)) continue;
      selections.set(travellerId, configured);
    }
    return selections;
  }

  /**
   * Intended visits are Journey-owned rows and deliberately are not registry
   * subjects. The source link therefore names the owning Journey; the source
   * boundary supplies the canonical child id and this module only verifies
   * that the captured child belongs to that Journey.
   */
  private async resolveExistingVisitAlias(
    connectionId: string,
    sourceRef: string,
    expectedVisitId: string,
    world: CapturedWorld,
  ): Promise<WIntendedVisit | undefined> {
    const journeyId = await this.resolveAlias(connectionId, sourceRef, 'SOURCE_INTENDED_VISIT', 'JOURNEY');
    if (!journeyId) return undefined;
    const visit = world.intendedVisits.find((candidate) => candidate.id === expectedVisitId);
    return visit?.journeyId === journeyId ? visit : undefined;
  }

  private async resolveExistingVisits(connectionId: string, world: CapturedWorld): Promise<ResolvedExistingVisit[]> {
    const resolved: ResolvedExistingVisit[] = [];
    for (const config of this.deps.configuration.existingVisitTargets ?? []) {
      const visit = await this.resolveExistingVisitAlias(connectionId, config.visitSourceRef, config.visitId, world);
      const journey = visit ? world.journeys.find((candidate) => candidate.id === visit.journeyId) : undefined;
      const jurisdiction = visit ? world.jurisdictions.find((candidate) => candidate.id === visit.jurisdictionId) : undefined;
      const entryPolicy = ReviewedEntryPolicySchema.safeParse(this.deps.entryPolicies.find((policy) => (policy as { id?: string })?.id === config.entryPolicyId));
      const country = Iso2Schema.safeParse(config.countryCode);
      const capturedCountryCode = visit ? await this.deps.jurisdictionCountryCode?.(visit.jurisdictionId) : undefined;
      if (!visit || !journey || !jurisdiction || jurisdiction.regimeKind !== 'COUNTRY' || !capturedCountryCode
        || capturedCountryCode !== config.countryCode || !entryPolicy.success || !country.success || entryPolicy.data.countryCode !== config.countryCode) continue;
      const passport = (await this.resolvePassportSelections(connectionId, world)).get(journey.travellerId);
      if (!passport) continue;
      if (!entryPolicy.data.purposes.includes(visit.purpose) || entryPolicy.data.nationalityCodes.includes(passport.guestNationality) === false) continue;
      resolved.push({
        config, visitId: visit.id, journeyId: visit.journeyId, travellerId: journey.travellerId,
        jurisdictionId: visit.jurisdictionId, purpose: visit.purpose, visitWindow: visit.intended,
        entryPolicy: entryPolicy.data, passport,
      });
    }
    return resolved;
  }

  private async ensureExistingVisitCredentialSelection(
    target: ResolvedExistingVisit,
    world: CapturedWorld,
  ): Promise<boolean> {
    const selections = world.credentialSelections.filter((selection) => selection.journeyId === target.journeyId);
    const conflicting = selections.find((selection) => selection.intendedVisitIds.includes(target.visitId)
      && selection.credentialId !== target.passport.credentialId);
    if (conflicting) return false;
    const exact = selections.find((selection) => selection.credentialId === target.passport.credentialId
      && selection.credentialVersionId === target.passport.credentialVersionId
      && selection.intendedVisitIds.includes(target.visitId));
    if (exact) return true;
    const sameCredential = selections.find((selection) => selection.credentialId === target.passport.credentialId);
    const journey = world.journeys.find((candidate) => candidate.id === target.journeyId);
    if (!journey) return false;
    const selectionId = deterministicUuid(
      RUNTIME_ID_NAMESPACES.planning,
      `${this.deps.workspaceId}|existing-visit-credential|${target.journeyId}|${target.visitId}|${target.passport.credentialVersionId}`,
    );
    const result = await selectCredential(this.deps.uow(), {
      workspaceId: this.deps.workspaceId,
      actorPrincipalId: this.deps.actorPrincipalId,
      idempotencyKey: `existing-visit-credential:${target.journeyId}:${target.visitId}:${target.passport.credentialVersionId}`,
      journeyId: target.journeyId,
      expectedRevision: journey.revision,
      credentialId: target.passport.credentialId,
      credentialVersionId: target.passport.credentialVersionId,
      scopeIntendedVisitIds: [...new Set([...(sameCredential?.intendedVisitIds ?? []), target.visitId])],
      selectionId,
    });
    return result.ok;
  }

  private async prepareExistingVisits(
    connectionId: string,
    input: { now: string; world: CapturedWorld },
    evidence: PlanningEvidenceRecord[],
  ): Promise<void> {
    const configured = this.deps.configuration.existingVisitTargets ?? [];
    if (configured.length === 0) return;
    const targets = await this.resolveExistingVisits(connectionId, input.world);
    for (const config of configured) {
      const target = targets.find((candidate) => candidate.config === config);
      const evidenceRef = `entry-policy:${config.entryPolicyId}:existing:${config.visitSourceRef}`;
      if (!target) {
        evidence.push(unavailableEvidenceRecord('research.entry_requirements', evidenceRef, input.now, 'existing_visit_context_unavailable', 'Configured existing visit or its explicit passport context could not be resolved.'));
        continue;
      }
      const selected = await this.ensureExistingVisitCredentialSelection(target, input.world);
      if (!selected) {
        evidence.push(unavailableEvidenceRecord('research.entry_requirements', evidenceRef, input.now, 'credential_selection_unavailable', 'The configured passport could not be bound to the existing visit without a conflicting or invalid selection.'));
        continue;
      }
      const documents = await this.readDocuments(target.entryPolicy.sources.map((source) => source.sourceId), target.entryPolicy.maxEvidenceAgeSeconds, input.now);
      if (!documents) {
        evidence.push(unavailableEvidenceRecord('research.entry_requirements', evidenceRef, input.now, 'entry_sources_unavailable', 'Reviewed entry source observations were unavailable for the existing visit.'));
        continue;
      }
      const publicationKey = `${target.visitId}|${target.entryPolicy.id}|${target.passport.guestNationality}|${documents.documents.map((document) => `${document.sourceId}:${document.contentSha256}:${document.observedAt}`).sort().join(',')}`;
      const publicationNow = this.deps.verificationClock?.() ?? input.now;
      const cachedPublicationExpiry = this.publicationCache.get(publicationKey);
      if (!cachedPublicationExpiry || Date.parse(cachedPublicationExpiry) <= Date.parse(publicationNow)) {
        const publication = await publishReviewedEntryKnowledge({
          pool: this.deps.pool, workspaceId: this.deps.workspaceId, actorPrincipalId: this.deps.actorPrincipalId,
          reviewerRef: this.deps.reviewerRef, uow: this.deps.uow,
        }, {
          policy: target.entryPolicy,
          actualOfficialDocumentEvidence: documents.documents,
          now: publicationNow,
          context: {
            journeyId: target.journeyId,
            visitId: target.visitId,
            jurisdictionId: target.jurisdictionId,
            countryCode: target.config.countryCode,
            purpose: target.purpose,
            nationalityCode: target.passport.guestNationality,
            visitWindow: target.visitWindow,
          },
        });
        if (!publication.ok) {
          evidence.push(unavailableEvidenceRecord('research.entry_requirements', evidenceRef, publicationNow, 'entry_publication_refused', `Reviewed entry evidence was refused for the existing visit (${publication.reason}).`));
          continue;
        }
        this.publicationCache.set(publicationKey, publication.expiresAt);
      }
      evidence.push(evidenceRecord('research.entry_requirements', evidenceRef, documents.documents, documents.mode, `Verified reviewed entry policy ${target.entryPolicy.id} for the configured existing visit.`, target.entryPolicy.operationalNotes));
    }
  }

  async prepare(input: { recoveryCaseId: string; now: string; world: CapturedWorld; failing: readonly FailingSubject[] }): Promise<{ additionalPlaceIds?: readonly string[]; hotelPlanning?: HotelPlanningOptions; evidence?: readonly PlanningEvidenceRecord[] }> {
    const connectionId = await this.connectionId();
    if (!connectionId) {
      const configured = this.deps.configuration.existingVisitTargets ?? [];
      return configured.length > 0 ? {
        evidence: configured.map((target) => unavailableEvidenceRecord(
          'research.entry_requirements',
          `entry-policy:${target.entryPolicyId}:existing:${target.visitSourceRef}`,
          input.now,
          'source_connection_unavailable',
          'The configured source connection was unavailable for the existing visit.',
        )),
      } : {};
    }
    const evidence: PlanningEvidenceRecord[] = [];
    await this.prepareExistingVisits(connectionId, input, evidence);
    const targets = await this.resolveTargets(connectionId);
    if (targets.length === 0) return evidence.length > 0 ? { evidence } : {};
    const resolveAirport = airportResolverFromCapturedWorld(input.world);
    const corridors = transportCorridors(input.world, input.failing, {
      resolveAirport,
      passengersFor: ({ journeyId, journeyItemId, world }) => travellersForJourneyItemPassengers(world, journeyItemId, journeyId),
    }).corridors;
    const passportSelections = await this.resolvePassportSelections(connectionId, input.world);
    const prepared: PreparedContext[] = [];
    for (const target of targets) {
      for (const corridor of corridors.filter((candidate) => candidate.originPlaceId === target.arrivalAirportId)) {
        const journey = input.world.journeys.find((candidate) => candidate.id === corridor.journeyId);
        const item = input.world.journeyItems.find((candidate) => candidate.id === corridor.journeyItemId);
        if (!journey || !item) continue;
        const originPlace = input.world.places.find((place) => place.id === target.arrivalAirportId);
        const recovery = originPlace ? connectionRecoveryContext(input.world, input.failing, item, originPlace) : undefined;
        if (!recovery || corridor.departureDate !== recovery.anchorDate) continue;
        const targetSelection = passportSelections.get(journey.travellerId);
        if (!targetSelection) continue;
        const passengerProof = travellersForJourneyItemPassengers(input.world, item.id, journey.id);
        if ('unknown' in passengerProof || passengerProof.adults !== 1 || passengerProof.children !== undefined || passengerProof.infants !== undefined) continue;
        const travellerId = journey.travellerId;
        const credential = input.world.credentials.find((candidate) => candidate.id === targetSelection.credentialId && candidate.travellerId === travellerId && candidate.kind === 'PASSPORT');
        const version = input.world.credentialVersions.find((candidate) => candidate.id === targetSelection.credentialVersionId && candidate.credentialId === targetSelection.credentialId && candidate.kind === 'PASSPORT');
        if (!credential || !version || credential.currentVersionId !== version.id || version.issuingStateCode !== targetSelection.guestNationality) continue;
        const anchorDate = recovery.anchorDate;
        const checkOutDate = recovery.checkOutDate;
        const hotelDocs = await this.readDocuments(target.hotelPolicy.sources.map((source) => source.sourceId), target.hotelPolicy.maxEvidenceAgeSeconds, input.now);
        if (!hotelDocs) continue;
        const verificationNow = this.deps.verificationClock?.() ?? input.now;
        const window = buildHotelPropertyPolicyWindow({ policy: target.hotelPolicy, actualOfficialDocumentEvidence: hotelDocs.documents, quotedLocalDates: { checkInDate: anchorDate, checkOutDate }, now: verificationNow });
        if (!window.ok) continue;
        const orderKey = insertionOrder(input.world, recovery.upstreamJourneyItemId, recovery.downstreamJourneyItemId);
        if (!orderKey) continue;
        const proposedVisitId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${input.recoveryCaseId}|visit|${corridor.journeyId}|${target.hotelPlaceId}|${anchorDate}`);
        const proposedJourneyItemId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${input.recoveryCaseId}|stay|${corridor.journeyId}|${target.hotelPlaceId}|${anchorDate}`);
        const proposedSelectionId = deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${proposedVisitId}|credential-selection|${targetSelection.credentialVersionId}`);
        const entryDocs = await this.readDocuments(target.entryPolicy.sources.map((source) => source.sourceId), target.entryPolicy.maxEvidenceAgeSeconds, input.now);
        if (!entryDocs) continue;
        const publicationKey = `${proposedVisitId}|${target.entryPolicy.id}|${targetSelection.guestNationality}|${entryDocs.documents.map((document) => `${document.sourceId}:${document.contentSha256}:${document.observedAt}`).sort().join(',')}`;
        const cachedPublicationExpiry = this.publicationCache.get(publicationKey);
        const publicationNow = this.deps.verificationClock?.() ?? input.now;
        if (!cachedPublicationExpiry || Date.parse(cachedPublicationExpiry) <= Date.parse(publicationNow)) {
          const publication = await publishReviewedEntryKnowledge({ pool: this.deps.pool, workspaceId: this.deps.workspaceId, actorPrincipalId: this.deps.actorPrincipalId, reviewerRef: this.deps.reviewerRef, uow: this.deps.uow }, {
            policy: target.entryPolicy, actualOfficialDocumentEvidence: entryDocs.documents, now: publicationNow,
            context: { journeyId: corridor.journeyId, visitId: proposedVisitId, jurisdictionId: target.jurisdictionId, countryCode: target.config.countryCode, purpose: 'transit_overnight', nationalityCode: targetSelection.guestNationality, visitWindow: window.stayWindow },
          });
          if (!publication.ok) continue;
          this.publicationCache.set(publicationKey, publication.expiresAt);
        }
        const provenance: PlanningToolProvenance = { mode: hotelDocs.mode, observedAt: window.sourceProvenance.reduce((latest, source) => Date.parse(source.observedAt) > Date.parse(latest) ? source.observedAt : latest, window.sourceProvenance[0]!.observedAt), sourceRefs: window.sourceProvenance.map((source) => source.sourceId) };
        prepared.push({ target, journeyId: corridor.journeyId, corridorJourneyItemId: corridor.journeyItemId, upstreamJourneyItemId: recovery.upstreamJourneyItemId, anchorDate, checkOutDate, stayWindow: window.stayWindow, proposedJourneyItemId, proposedVisitId, proposedSelectionId, credentialId: credential.id, credentialVersionId: version.id, guestNationality: targetSelection.guestNationality, provenance });
        evidence.push(evidenceRecord('research.local_context', `hotel-policy:${target.hotelPolicy.id}:${corridor.journeyId}:${anchorDate}`, hotelDocs.documents, hotelDocs.mode, `Verified hotel policy ${target.hotelPolicy.id} for the configured arrival place and bounded local window.`));
        evidence.push(evidenceRecord('research.entry_requirements', `entry-policy:${target.entryPolicy.id}:${corridor.journeyId}:${anchorDate}`, entryDocs.documents, entryDocs.mode, `Verified reviewed entry policy ${target.entryPolicy.id} for the configured journey visit scope.`, target.entryPolicy.operationalNotes));
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
          placeId: context.target.hotelPlaceId,
          query: { location: { externalRef: context.target.placeExternalRef }, checkInDate: context.anchorDate, checkOutDate: context.checkOutDate, guests: { adults: 1 }, rooms: 1, guestNationality: context.guestNationality },
          stayWindow: context.stayWindow,
          proposedJourneyItemId: context.proposedJourneyItemId,
          orderKey: insertionOrder(world, context.upstreamJourneyItemId, context.corridorJourneyItemId) ?? '',
          visit: { kind: 'PROPOSED', proposedVisitId: context.proposedVisitId, jurisdictionId: context.target.jurisdictionId, purpose: 'transit_overnight', intendedWindow: context.stayWindow, credentialSelections: [{ proposedSelectionId: context.proposedSelectionId, credentialId: context.credentialId, credentialVersionId: context.credentialVersionId }] },
          provenance: context.provenance,
        };
      },
    };
    return { additionalPlaceIds: [...new Set(prepared.map((context) => context.target.hotelPlaceId))], hotelPlanning, evidence };
  }
}

export function createTargetRecoveryContextPreparer(deps: TargetRecoveryContextDeps): TargetRecoveryContextPreparer {
  return new TargetRecoveryContextPreparer(deps);
}
