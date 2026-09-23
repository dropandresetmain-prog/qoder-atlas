/** Explicit, bounded research composition for recovery that needs an overnight stay. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../config/config.ts';
import type { Pool } from '../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../persistence/postgres/pgUnitOfWork.ts';
import { OfficialDocumentReader } from '../providers/research/officialDocuments.ts';
import { createAppRecordingStore } from '../providers/recordingStoreFactory.ts';
import { HotelPropertyPolicySchema } from '../resolution/planning/hotelPropertyPolicy.ts';
import { ReviewedEntryPolicySchema } from '../resolution/planning/reviewedEntryEvidence.ts';
import { composeTargetHotelResearch } from './targetHotelResearch.ts';
import { createTargetRecoveryContextPreparer } from './targetRecoveryContext.ts';
import { createStayReplacementContextResolver, type StayReplacementBinding } from './targetStayReplacementContext.ts';
import { PlanningToolProvenanceSchema } from '../contracts/v2/planning/planningTool.ts';
import { findAttachedProviderStayBooking } from './demo/providerStayBaseline.ts';

const SourceRef = (kind: string) => z.string().regex(new RegExp(`^SOURCE_${kind}:\\S+$`));
export const RecoveryResearchConfigurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  hotelPoliciesFile: z.string().min(1),
  entryPoliciesFile: z.string().min(1),
  sourceConnectionProviderKind: z.string().min(1),
  overnightTargets: z.array(z.strictObject({
    arrivalAirportSourceRef: SourceRef('PLACE'),
    hotelPolicyId: z.string().min(1),
    jurisdictionSourceRef: SourceRef('JURISDICTION'),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    entryPolicyId: z.string().min(1),
  })).min(1).max(8),
  passportSelections: z.array(z.strictObject({
    travellerSourceRef: SourceRef('TRAVELLER_DRAFT'),
    credentialId: z.uuid().optional(),
    credentialVersionId: z.uuid().optional(),
    guestNationality: z.string().regex(/^[A-Z]{2}$/),
  })).min(1).max(32),
  existingVisitTargets: z.array(z.strictObject({
    visitSourceRef: SourceRef('INTENDED_VISIT'),
    visitId: z.uuid().optional(),
    jurisdictionSourceRef: SourceRef('JURISDICTION'),
    entryPolicyId: z.string().min(1),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
  })).max(8).optional(),
  stayReplacementBinding: z.strictObject({
    reservationId: z.uuid().optional(),
    reservationLineId: z.uuid().optional(),
    /**
     * Source booking reference identifying the canonical stay reservation. The
     * provider stay element is never configured: it is the provider booking
     * attached to that reservation on the working world (see providerStayBaseline).
     */
    sourceBookingReference: z.string().min(1),
    propertyExternalRef: z.strictObject({ system: z.string().min(1), value: z.string().min(1) }),
    areaSearch: z.strictObject({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      radiusKm: z.number().positive().max(50),
    }).optional(),
    passport: z.strictObject({
      credentialId: z.uuid().optional(),
      credentialVersionId: z.uuid().optional(),
      guestNationality: z.string().regex(/^[A-Z]{2}$/),
    }),
    guests: z.strictObject({ adults: z.number().int().positive(), rooms: z.number().int().positive() }),
    visitId: z.uuid().optional(),
    provenance: PlanningToolProvenanceSchema,
  }).optional(),
}).superRefine((value, context) => {
  if (new Set(value.passportSelections.map((selection) => selection.travellerSourceRef)).size !== value.passportSelections.length) {
    context.addIssue({ code: 'custom', path: ['passportSelections'], message: 'Each traveller needs one explicit passport selection' });
  }
  const countries = new Map<string, string>();
  for (const target of [...value.overnightTargets, ...(value.existingVisitTargets ?? [])]) {
    const previous = countries.get(target.jurisdictionSourceRef);
    if (previous && previous !== target.countryCode) {
      context.addIssue({ code: 'custom', message: 'A source jurisdiction cannot be bound to conflicting country codes' });
    }
    countries.set(target.jurisdictionSourceRef, target.countryCode);
  }
});

type ResearchConfiguration = z.infer<typeof RecoveryResearchConfigurationSchema>;

/** Fill reservation, passport and visit ids from source records when a static file cannot name workspace uuids. */
async function completeStayBinding(
  pool: Pool,
  workspaceId: string,
  configuration: ResearchConfiguration,
): Promise<StayReplacementBinding | undefined> {
  const binding = configuration.stayReplacementBinding;
  if (!binding) return undefined;
  let reservationId = binding.reservationId;
  let reservationLineId = binding.reservationLineId;
  if (!reservationId || !reservationLineId) {
    const stay = await pool.query<{ reservation_id: string; line_id: string }>(
      `SELECT rsv.id AS reservation_id, line.id AS line_id
         FROM external_records er
         JOIN external_record_links link
           ON link.workspace_id = er.workspace_id AND link.external_record_id = er.id
          AND link.canonical_subject_kind = 'RESERVATION' AND link.superseded_at IS NULL
         JOIN reservations rsv ON rsv.workspace_id = link.workspace_id AND rsv.id = link.canonical_subject_id
         JOIN reservation_lines line
           ON line.workspace_id = rsv.workspace_id AND line.reservation_id = rsv.id AND line.product_type = 'STAY'
        WHERE er.workspace_id = $1 AND er.record_type = 'SOURCE_BOOKING_REFERENCE' AND er.external_id = $2`,
      [workspaceId, binding.sourceBookingReference],
    );
    if (stay.rows.length !== 1) return undefined;
    reservationId = stay.rows[0]!.reservation_id;
    reservationLineId = stay.rows[0]!.line_id;
  }
  // No attached provider booking means no provider policy/value can be read:
  // replacement economics stay unavailable rather than borrowing another booking.
  const stayElementId = await findAttachedProviderStayBooking(pool, workspaceId, reservationId);
  if (!stayElementId) return undefined;
  let credentialId = binding.passport.credentialId;
  let credentialVersionId = binding.passport.credentialVersionId;
  if (!credentialId || !credentialVersionId) {
    if (configuration.passportSelections.length !== 1) return undefined;
    const externalId = configuration.passportSelections[0]!.travellerSourceRef.slice('SOURCE_TRAVELLER_DRAFT:'.length);
    const passport = await pool.query<{ credential_id: string; version_id: string }>(
      `SELECT tc.id AS credential_id, tc.current_version_id AS version_id
         FROM travel_credentials tc
         JOIN travellers t ON t.workspace_id = tc.workspace_id AND t.id = tc.traveller_id
         JOIN external_record_links l
           ON l.workspace_id = t.workspace_id AND l.canonical_subject_kind = 'TRAVELLER'
          AND l.canonical_subject_id = t.id AND l.superseded_at IS NULL
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE tc.workspace_id = $1 AND tc.kind = 'PASSPORT' AND tc.issuer_country = $2
          AND r.record_type = 'SOURCE_TRAVELLER_DRAFT' AND r.external_id = $3`,
      [workspaceId, binding.passport.guestNationality, externalId],
    );
    if (passport.rows.length !== 1 || !passport.rows[0]!.version_id) return undefined;
    credentialId = passport.rows[0]!.credential_id;
    credentialVersionId = passport.rows[0]!.version_id;
  }
  let visitId = binding.visitId;
  if (!visitId) {
    const targets = configuration.existingVisitTargets ?? [];
    if (targets.length !== 1) return undefined;
    const externalId = targets[0]!.visitSourceRef.slice('SOURCE_INTENDED_VISIT:'.length);
    const visit = await pool.query<{ id: string }>(
      `SELECT iv.id
         FROM intended_visits iv
         JOIN external_record_links l
           ON l.workspace_id = iv.workspace_id AND l.canonical_subject_kind = 'JOURNEY'
          AND l.canonical_subject_id = iv.journey_id AND l.superseded_at IS NULL
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE iv.workspace_id = $1 AND iv.transit_intent = false
          AND r.record_type = 'SOURCE_INTENDED_VISIT' AND r.external_id = $2`,
      [workspaceId, externalId],
    );
    if (visit.rows.length !== 1) return undefined;
    visitId = visit.rows[0]!.id;
  }
  return {
    reservationId, reservationLineId, stayElementId,
    propertyExternalRef: binding.propertyExternalRef,
    ...(binding.areaSearch ? { areaSearch: binding.areaSearch } : {}),
    passport: { credentialId, credentialVersionId, guestNationality: binding.passport.guestNationality },
    guests: binding.guests, visitId, provenance: binding.provenance,
  };
}

/** Missing configuration leaves the capability unavailable; malformed configuration fails boot. */
export async function composeTargetRecoveryResearch(input: {
  config: AppConfig;
  cwd: string;
  configurationFile?: string;
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  reviewerPrincipalId: string;
}) {
  if (!input.configurationFile?.trim()) return undefined;
  const file = resolve(input.cwd, input.configurationFile);
  const parsed = RecoveryResearchConfigurationSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) throw new Error('Recovery research configuration is invalid; check its source references and explicit selections');
  const configuration = parsed.data;
  const hotelPolicies = z.array(HotelPropertyPolicySchema).min(1).max(16).parse(
    JSON.parse(await readFile(resolve(dirname(file), configuration.hotelPoliciesFile), 'utf8')),
  );
  const entryPolicies = z.array(ReviewedEntryPolicySchema).min(1).max(16).parse(
    JSON.parse(await readFile(resolve(dirname(file), configuration.entryPoliciesFile), 'utf8')),
  );
  const sources = new Map<string, { id: string; url: string; publisher: string }>();
  for (const policy of [...hotelPolicies, ...entryPolicies]) {
    for (const source of policy.sources) {
      const previous = sources.get(source.sourceId);
      if (previous && (previous.url !== source.url || previous.publisher !== source.publisher)) {
        throw new Error('Recovery research policies disagree on an official source identity');
      }
      sources.set(source.sourceId, { id: source.sourceId, url: source.url, publisher: source.publisher });
    }
  }
  for (const target of configuration.overnightTargets) {
    if (!hotelPolicies.some((policy) => policy.id === target.hotelPolicyId)
      || !entryPolicies.some((policy) => policy.id === target.entryPolicyId && policy.countryCode === target.countryCode)) {
      throw new Error('Recovery research target references an unavailable reviewed policy');
    }
  }
  for (const target of configuration.existingVisitTargets ?? []) {
    if (!entryPolicies.some((policy) => policy.id === target.entryPolicyId && policy.countryCode === target.countryCode)) {
      throw new Error('Existing visit references an unavailable reviewed entry policy');
    }
  }
  const hotel = composeTargetHotelResearch(input.config, input.cwd);
  if (!hotel) return undefined;
  const officialDocuments = new OfficialDocumentReader({
    catalog: [...sources.values()],
    mode: input.config.adapterMode,
    store: createAppRecordingStore({
      recordingsDir: input.config.recordingsDir,
      fixturesDir: input.config.fixturesDir,
      cwd: input.cwd,
      adapterMode: input.config.adapterMode,
    }),
  });
  const preparer = createTargetRecoveryContextPreparer({
    pool: input.pool, workspaceId: input.workspaceId, actorPrincipalId: input.actorPrincipalId,
    uow: input.uow, reviewerRef: { kind: 'PRINCIPAL', id: input.reviewerPrincipalId },
    hotelTransport: hotel.transport, officialDocuments, hotelPolicies, entryPolicies, configuration,
    // Publication/verification use the planning `now` supplied to prepare(). A
    // wall-clock override makes coverage expire before progressive planningNow
    // and loops STALE_RETRY / requirement_coverage_incomplete for overnight.
    jurisdictionCountryCode: async (jurisdictionId) => {
      // Country codes are explicitly bound to source jurisdiction identities in
      // reviewed configuration, never guessed from a jurisdiction name or UUID.
      const rows = await input.pool.query<{ external_id: string }>(
        `SELECT r.external_id FROM external_record_links l
         JOIN external_records r ON r.workspace_id=l.workspace_id AND r.id=l.external_record_id
         JOIN external_connections c ON c.workspace_id=r.workspace_id AND c.id=r.connection_id
         WHERE l.workspace_id=$1 AND l.canonical_subject_kind='JURISDICTION'
           AND l.canonical_subject_id=$2 AND l.superseded_at IS NULL
           AND r.record_type='SOURCE_JURISDICTION' AND c.provider_kind=$3`,
        [input.workspaceId, jurisdictionId, configuration.sourceConnectionProviderKind],
      );
      if (rows.rows.length !== 1) return undefined;
      return [...configuration.overnightTargets, ...(configuration.existingVisitTargets ?? [])]
        .find((target) => target.jurisdictionSourceRef === `SOURCE_JURISDICTION:${rows.rows[0]!.external_id}`)?.countryCode;
    },
  });
  return {
    hotel,
    async prepare(context: Parameters<typeof preparer.prepare>[0]) {
      const prepared = await preparer.prepare(context);
      const binding = await completeStayBinding(input.pool, input.workspaceId, configuration);
      const resolveStayReplacement = binding ? createStayReplacementContextResolver(binding) : undefined;
      return {
        ...prepared,
        ...(prepared.hotelPlanning && resolveStayReplacement ? {
          hotelPlanning: { ...prepared.hotelPlanning, resolveStayReplacement },
        } : {}),
      };
    },
  };
}

