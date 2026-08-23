/**
 * Northstar RV-N1/RV-N2 — HTTP-facing programme surface.
 *
 * Wire JSON -> validated programme service calls, following the runtimeHttp
 * discipline: Zod validates at the boundary; engine outcomes come back as
 * structured responses, never crashes. Every mutation-capable route goes
 * through the frozen draft/validated path — a draft can never bypass
 * promotion, and commitment changes fan out through the ordinary signal
 * pipeline.
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';
import { TripSignalSchema } from '../operational/signal.ts';
import { ProgrammeImportDraftSchema } from '../contracts/programmeIntake.ts';
import { AnchorEventSchema, OrganisationSchema, PlaceSchema } from '../domain/entities.ts';
import { RuleSetSchema } from '../domain/rules.ts';
import type { ProgrammeService } from './programme.ts';
import { processCommitmentChange, intakeUncertainties } from './programme.ts';
import { projectProgrammeView } from './programmeReadmodel.ts';
import type { ReadModelDependencies } from './readmodels.ts';
import type { SignalRepository, CaseRepository, TripRepository } from '../contracts/repositories.ts';
import type { MutationService } from '../contracts/services.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import type { AuditRepository } from '../contracts/repositories.ts';

export interface ProgrammeHandlerDeps {
  service: ProgrammeService;
  readDeps: ReadModelDependencies;
  mutations: MutationService;
  entities: EntityStore;
  trips: TripRepository;
  signals: SignalRepository;
  cases: CaseRepository;
  audit: AuditRepository;
}

type WireResult = { status: number; body: unknown };

const ProgrammeViewParamsSchema = z.strictObject({
  anchorEventId: EntityIdSchema,
  at: IsoDateTimeSchema,
});

const ProgrammeContextBodySchema = z.strictObject({
  at: IsoDateTimeSchema,
  sourceId: EntityIdSchema,
  organisation: OrganisationSchema.optional(),
  anchorEvent: AnchorEventSchema.optional(),
  places: z.array(PlaceSchema).optional(),
  ruleSets: z.array(RuleSetSchema).optional(),
});

const IntakeBodySchema = z.strictObject({
  importDraft: ProgrammeImportDraftSchema,
  at: IsoDateTimeSchema,
});

const CommitmentChangeBodySchema = z.strictObject({
  signal: TripSignalSchema,
});

function invalid(error: z.ZodError): WireResult {
  return {
    status: 400,
    body: {
      error: 'invalid_request',
      issues: error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    },
  };
}

export function createProgrammeHandlers(deps: ProgrammeHandlerDeps): {
  view(params: { anchorEventId: string; at: string }): Promise<WireResult>;
  applyContext(body: unknown): Promise<WireResult>;
  intakeImport(body: unknown): Promise<WireResult>;
  commitmentChange(body: unknown): Promise<WireResult>;
} {
  return {
    async view(params) {
      const parsed = ProgrammeViewParamsSchema.safeParse(params);
      if (!parsed.success) return invalid(parsed.error);
      const view = await projectProgrammeView(deps.readDeps, parsed.data.anchorEventId, parsed.data.at);
      if (!view) {
        return { status: 404, body: { error: 'unknown_anchor_event', anchorEventId: parsed.data.anchorEventId } };
      }
      return { status: 200, body: view };
    },

    async applyContext(body) {
      const parsed = ProgrammeContextBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      const outcome = await deps.service.applyProgrammeContext(parsed.data);
      return {
        status: outcome.accepted ? 200 : 409,
        body: { accepted: outcome.accepted, issues: outcome.issues },
      };
    },

    async intakeImport(body) {
      const parsed = IntakeBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      const outcome = await deps.service.intakeImportDraft({
        importDraft: parsed.data.importDraft,
        at: parsed.data.at,
      });
      const uncertainties = intakeUncertainties(parsed.data.importDraft, outcome.outcomes);
      return {
        status: outcome.accepted ? 200 : 409,
        body: {
          importDraftId: outcome.importDraftId,
          accepted: outcome.accepted,
          outcomes: outcome.outcomes,
          promotedCount: outcome.outcomes.filter((entry) => entry.promoted).length,
          uncertaintyCount: uncertainties.length,
          uncertainties,
        },
      };
    },

    async commitmentChange(body) {
      const parsed = CommitmentChangeBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      const outcome = await processCommitmentChange(
        {
          mutations: deps.mutations,
          entities: deps.entities,
          trips: deps.trips,
          signals: deps.signals,
          cases: deps.cases,
          audit: deps.audit,
        },
        parsed.data.signal,
      );
      return {
        status: outcome.accepted ? 200 : 409,
        body: {
          accepted: outcome.accepted,
          ...(outcome.anchorEventId ? { anchorEventId: outcome.anchorEventId } : {}),
          ...(outcome.commitmentId ? { commitmentId: outcome.commitmentId } : {}),
          ...(outcome.changeKind ? { changeKind: outcome.changeKind } : {}),
          linkedTripCount: outcome.linkedTripCount,
          unlinkedTripCount: outcome.unlinkedTripCount,
          processedSignals: outcome.processed.map((processed) => ({
            signalId: processed.signalId,
            tripId: processed.tripId,
            caseId: processed.caseId,
            caseStatus: processed.caseStatus,
          })),
          issues: outcome.issues,
        },
      };
    },
  };
}
