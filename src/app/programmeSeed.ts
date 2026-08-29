/**
 * Wave 3 Gate 7 — deterministic programme-scale seed/reseed.
 *
 * A programme bundle is a fixture directory containing one `programme.json`
 * with a programme context body and an import draft. Seeding runs through
 * the SAME application services the HTTP surface uses (applyProgrammeContext
 * + intakeImportDraft) — no state surgery, fully deterministic, and the
 * bundle carries all demo facts (production logic stays content-free).
 *
 * Optional companion `fx-rates.json` seeds organisation budget FX evidence
 * through the same application-owned store scenario bundles use (ADR-052).
 *
 * Optional companion `booking-dossiers.json` seeds provider-facing booking
 * identity through the SAME application-owned store scenario bundles use,
 * with the same referential-integrity rule: every dossier must name a
 * traveller this bundle promotes (deterministic `trv-{anchorEventId}-{draftId}`).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateTimeSchema, EntityIdSchema, type EntityId } from '../domain/common.ts';
import { OrganisationSchema, AnchorEventSchema, PlaceSchema } from '../domain/entities.ts';
import { RuleSetSchema } from '../domain/rules.ts';
import { ProgrammeImportDraftSchema } from '../contracts/programmeIntake.ts';
import type { ProgrammeService } from './programme.ts';
import { BookingDossierBundleSchema, type BookingDossierStore } from './dossierStore.ts';
import { FxRateBundleSchema, type FxRateStore } from './fxStore.ts';

/** Frozen bundle shape for programme seeding (context + import draft). */
export const ProgrammeBundleSchema = z.strictObject({
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
  /** FX rates seeded from an optional companion file. */
  fxRateCount: number;
  /** Booking dossiers seeded from an optional companion file. */
  dossierCount: number;
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
  options?: { fxRates?: FxRateStore; dossiers?: BookingDossierStore },
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

  let fxRateCount = 0;
  if (options?.fxRates) {
    const fxPath = join(bundleDir, 'fx-rates.json');
    if (existsSync(fxPath)) {
      const fxBundle = FxRateBundleSchema.parse(JSON.parse(readFileSync(fxPath, 'utf8')));
      for (const rate of fxBundle.rates) {
        await options.fxRates.save(rate);
        fxRateCount += 1;
      }
    }
  }

  // Booking dossiers (application-owned store; provider-facing identity, never
  // part of the frozen entity registry). Same referential-integrity rule the
  // scenario bootstrap applies: every dossier must name a traveller THIS
  // bundle actually promoted — the deterministic promoted ids are the only
  // identity evidence, never display names or scenario keys.
  let dossierCount = 0;
  if (options?.dossiers) {
    const dossierPath = join(bundleDir, 'booking-dossiers.json');
    if (existsSync(dossierPath)) {
      const dossierBundle = BookingDossierBundleSchema.parse(JSON.parse(readFileSync(dossierPath, 'utf8')));
      const knownTravellerIds = new Set<EntityId>(
        intake.outcomes
          .map((outcome) => outcome.travellerId)
          .filter((travellerId): travellerId is EntityId => travellerId !== undefined),
      );
      for (const dossier of dossierBundle.flight) {
        if (!knownTravellerIds.has(dossier.travellerId)) {
          throw new Error(`programme booking dossier references unknown traveller ${dossier.travellerId}`);
        }
        await options.dossiers.saveFlight(dossier);
        dossierCount += 1;
      }
      for (const dossier of dossierBundle.hotel) {
        if (!knownTravellerIds.has(dossier.travellerId)) {
          throw new Error(`programme booking dossier references unknown traveller ${dossier.travellerId}`);
        }
        await options.dossiers.saveHotel(dossier);
        dossierCount += 1;
      }
    }
  }

  return {
    anchorEventId: bundle.importDraft.anchorEventId,
    promotedCount: intake.outcomes.filter((outcome) => outcome.promoted).length,
    travellerCount: bundle.importDraft.travellers.length,
    tripIds: intake.outcomes
      .map((outcome) => outcome.tripId)
      .filter((tripId): tripId is EntityId => tripId !== undefined),
    fxRateCount,
    dossierCount,
  };
}
