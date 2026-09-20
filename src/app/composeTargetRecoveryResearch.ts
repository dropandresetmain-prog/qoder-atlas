/** Explicit, bounded research composition for recovery that needs an overnight stay. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../config/config.ts';
import type { Pool } from '../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../persistence/postgres/pgUnitOfWork.ts';
import { OfficialDocumentReader } from '../providers/research/officialDocuments.ts';
import { FileRecordingStore } from '../providers/recordingStore.ts';
import { HotelPropertyPolicySchema } from '../resolution/planning/hotelPropertyPolicy.ts';
import { ReviewedEntryPolicySchema } from '../resolution/planning/reviewedEntryEvidence.ts';
import { composeTargetHotelResearch } from './targetHotelResearch.ts';
import { createTargetRecoveryContextPreparer } from './targetRecoveryContext.ts';
import { createStayReplacementContextResolver } from './targetStayReplacementContext.ts';
import { PlanningToolProvenanceSchema } from '../contracts/v2/planning/planningTool.ts';

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
    credentialId: z.uuid(),
    credentialVersionId: z.uuid(),
    guestNationality: z.string().regex(/^[A-Z]{2}$/),
  })).min(1).max(32),
  stayReplacementBinding: z.strictObject({
    reservationId: z.uuid(),
    reservationLineId: z.uuid(),
    stayElementId: z.string().min(1),
    propertyExternalRef: z.strictObject({ system: z.string().min(1), value: z.string().min(1) }),
    passport: z.strictObject({ credentialId: z.uuid(), credentialVersionId: z.uuid(), guestNationality: z.string().regex(/^[A-Z]{2}$/) }),
    guests: z.strictObject({ adults: z.number().int().positive(), rooms: z.number().int().positive() }),
    visitId: z.uuid(),
    provenance: PlanningToolProvenanceSchema,
  }).optional(),
}).superRefine((value, context) => {
  if (new Set(value.passportSelections.map((selection) => selection.travellerSourceRef)).size !== value.passportSelections.length) {
    context.addIssue({ code: 'custom', path: ['passportSelections'], message: 'Each traveller needs one explicit passport selection' });
  }
});

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
  const hotel = composeTargetHotelResearch(input.config, input.cwd);
  if (!hotel) return undefined;
  const recordingsDir = resolve(input.cwd, input.config.recordingsDir);
  const officialDocuments = new OfficialDocumentReader({
    catalog: [...sources.values()],
    mode: input.config.adapterMode,
    store: new FileRecordingStore({
      readDirs: [recordingsDir, resolve(input.cwd, input.config.fixturesDir, 'recordings')],
      ...(input.config.adapterMode === 'RECORD' ? { writeDir: recordingsDir } : {}),
    }),
  });
  const preparer = createTargetRecoveryContextPreparer({
    pool: input.pool, workspaceId: input.workspaceId, actorPrincipalId: input.actorPrincipalId,
    uow: input.uow, reviewerRef: { kind: 'PRINCIPAL', id: input.reviewerPrincipalId },
    hotelTransport: hotel.transport, officialDocuments, hotelPolicies, entryPolicies, configuration,
    verificationClock: () => new Date().toISOString(),
  });
  const resolveStayReplacement = configuration.stayReplacementBinding
    ? createStayReplacementContextResolver(configuration.stayReplacementBinding) : undefined;
  return {
    hotel,
    async prepare(context: Parameters<typeof preparer.prepare>[0]) {
      const prepared = await preparer.prepare(context);
      return {
        ...prepared,
        ...(prepared.hotelPlanning && resolveStayReplacement ? {
          hotelPlanning: { ...prepared.hotelPlanning, resolveStayReplacement },
        } : {}),
      };
    },
  };
}

