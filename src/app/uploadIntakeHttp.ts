/**
 * DR-10 — HTTP boundary for programme roster/upload intake:
 *   POST /api/programme/roster/parse    — parse-only (no draft, no state)
 *   POST /api/programme/upload/draft    — event brief + roster -> DRAFT bundle (no mutation)
 *   POST /api/programme/upload/promote  — promote a draft through the existing
 *                                          validated ProgrammeService path
 *
 * Wire JSON -> the EXISTING src/app/rosterParser.ts / uploadIntake.ts
 * implementations. Draft generation never mutates state; promotion goes
 * through the same ProgrammeService.applyProgrammeContext +
 * intakeImportDraft path the programme intake HTTP surface already uses.
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';
import { parseRosterFromCsv } from './rosterParser.ts';
import {
  createDraftProgrammeBundle,
  promoteDraftBundle,
  DraftProgrammeBundleSchema,
  EventBriefInputSchema,
  type PromoteDraftBundleService,
} from './uploadIntake.ts';

export type WireResult = { status: number; body: unknown };

function invalid(error: z.ZodError): WireResult {
  return {
    status: 400,
    body: {
      error: 'invalid_request',
      issues: error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    },
  };
}

const RosterParseBodySchema = z.strictObject({
  rosterCsvText: z.string().min(1),
});

const UploadDraftBodySchema = z.strictObject({
  anchorEventId: EntityIdSchema,
  sourceId: EntityIdSchema,
  at: IsoDateTimeSchema,
  eventBriefText: z.string().min(1),
  rosterCsvText: z.string().min(1),
  policyText: z.string().optional(),
  eventBrief: EventBriefInputSchema.optional(),
});

const UploadPromoteBodySchema = z.strictObject({
  draft: DraftProgrammeBundleSchema,
});

export function createUploadIntakeHandlers(service: PromoteDraftBundleService): {
  rosterParse(body: unknown): Promise<WireResult>;
  uploadDraft(body: unknown): Promise<WireResult>;
  uploadPromote(body: unknown): Promise<WireResult>;
} {
  return {
    async rosterParse(body) {
      const parsed = RosterParseBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      const result = parseRosterFromCsv(parsed.data.rosterCsvText);
      return { status: 200, body: result };
    },

    async uploadDraft(body) {
      const parsed = UploadDraftBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      // Draft generation is deterministic and mutates NO state — this is the
      // preview step; nothing is authoritative until /upload/promote.
      const bundle = createDraftProgrammeBundle(parsed.data);
      return { status: 200, body: bundle };
    },

    async uploadPromote(body) {
      const parsed = UploadPromoteBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      const result = await promoteDraftBundle(service, parsed.data.draft);
      if (!result.contextAccepted) {
        return { status: 409, body: { accepted: false, contextAccepted: false, issues: result.contextIssues } };
      }
      return {
        status: result.intakeOutcome?.accepted ? 200 : 409,
        body: {
          accepted: result.intakeOutcome?.accepted ?? false,
          contextAccepted: true,
          intakeOutcome: result.intakeOutcome,
        },
      };
    },
  };
}
