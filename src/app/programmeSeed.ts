/**
 * Wave 3 Gate 7 — deterministic programme-scale seed/reseed.
 *
 * A programme bundle is a fixture directory containing one `programme.json`
 * with a programme context body and an import draft. Seeding runs through
 * the SAME application services the HTTP surface uses (applyProgrammeContext
 * + intakeImportDraft) — no state surgery, fully deterministic, and the
 * bundle carries all demo facts (production logic stays content-free).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateTimeSchema, EntityIdSchema, type EntityId } from '../domain/common.ts';
import { OrganisationSchema, AnchorEventSchema, PlaceSchema } from '../domain/entities.ts';
import { RuleSetSchema } from '../domain/rules.ts';
import { ProgrammeImportDraftSchema } from '../contracts/programmeIntake.ts';
import type { ProgrammeService } from './programme.ts';

const ProgrammeBundleSchema = z.strictObject({
  context: z.strictObject({
    at: IsoDateTimeSchema,
    sourceId: EntityIdSchema,
    organisation: OrganisationSchema.optional(),
    anchorEvent: AnchorEventSchema.optional(),
    places: z.array(PlaceSchema).optional(),
    ruleSets: z.array(RuleSetSchema).optional(),
  }),
  importDraft: ProgrammeImportDraftSchema,
});

export interface ProgrammeSeedOutcome {
  /** Anchor event id the bundle seeds (the programme's identity). */
  anchorEventId: EntityId;
  promotedCount: number;
  travellerCount: number;
  /** Trip ids created by promotion (deterministic per draft). */
  tripIds: EntityId[];
}

/** List programme bundle directories under a root (empty when absent). */
export function listProgrammeDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .sort();
}

/** Seed one programme bundle through the validated programme services. */
export async function seedProgrammeBundle(
  service: ProgrammeService,
  bundleDir: string,
): Promise<ProgrammeSeedOutcome> {
  const bundle = ProgrammeBundleSchema.parse(JSON.parse(readFileSync(join(bundleDir, 'programme.json'), 'utf8')));

  const context = await service.applyProgrammeContext(bundle.context);
  if (!context.accepted) {
    const detail = context.issues.map((issue) => `${issue.code}: ${issue.message}`).join('; ');
    throw new Error(`programme context seed rejected for ${bundleDir}: ${detail}`);
  }

  const intake = await service.intakeImportDraft({ importDraft: bundle.importDraft, at: bundle.context.at });
  if (!intake.accepted) {
    throw new Error(`programme intake seed rejected for ${bundleDir}`);
  }

  return {
    anchorEventId: bundle.importDraft.anchorEventId,
    promotedCount: intake.outcomes.filter((outcome) => outcome.promoted).length,
    travellerCount: bundle.importDraft.travellers.length,
    tripIds: intake.outcomes
      .map((outcome) => outcome.tripId)
      .filter((tripId): tripId is EntityId => tripId !== undefined),
  };
}
