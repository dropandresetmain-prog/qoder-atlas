/**
 * G09 — load stored PostgreSQL preferences into the planning comparator input.
 *
 * Rules (all deterministic, no model):
 *   - only preferences effective at `now` and not superseded are read;
 *   - EXPLICIT > INFERRED: within one preference kind, if any EXPLICIT row
 *     exists an INFERRED row of that kind is dropped — an inference (AI or
 *     otherwise) can never override or sit beside an explicit statement;
 *   - EXPLICIT owned by a traveller/trip/journey => EXPLICIT_TRAVELLER; any
 *     other owner (programme, organisation, event...) =>
 *     EXPLICIT_ORGANISATION_POLICY; INFERRED => INFERRED_SOFT, inferred:true
 *     (the comparator additionally demotes any inferred input below explicit);
 *   - a row whose value follows `planning-preference/1` may carry a data
 *     matcher; anything else is carried as context and cannot affect ranking.
 * The comparator + `preferenceMatching.ts` decide whether it changes a ranking.
 */
import { z } from 'zod';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { CapturedWorld } from '../../resolution/world/world.ts';
import type { FailingSubject } from '../../resolution/planning/proposer.ts';
import type { ComparatorPreference } from '../../contracts/v2/planning/strategyRecommendation.ts';
import { readEffectivePreferences, type StoredPreferenceRow } from '../../persistence/postgres/repositories/pgKnowledgeRepository.ts';

export const PLANNING_PREFERENCE_SCHEMA_VERSION = 'planning-preference/1';

const PlanningPreferenceValueSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  summary: z.string().min(1).max(400),
  match: z.strictObject({
    domains: z.array(z.string().min(1)).max(16).optional(),
    proposerIds: z.array(z.string().min(1)).max(16).optional(),
    changedRefKinds: z.array(z.string().min(1)).max(16).optional(),
  }).optional(),
});

const TRAVELLER_OWNER_KINDS = new Set(['TRAVELLER', 'TRIP', 'JOURNEY']);

function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(s) ? s : `p_${s}`;
}

/** Pure: stored rows -> ordered comparator preferences (precedence rules above). */
export function comparatorPreferencesFromRows(rows: readonly StoredPreferenceRow[]): ComparatorPreference[] {
  const explicitKinds = new Set(rows.filter((r) => r.source === 'EXPLICIT').map((r) => r.preferenceKind));
  const out: ComparatorPreference[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.source === 'INFERRED' && explicitKinds.has(row.preferenceKind)) continue;
    const parsed = row.valueSchemaVersion === PLANNING_PREFERENCE_SCHEMA_VERSION
      ? PlanningPreferenceValueSchema.safeParse(row.value)
      : undefined;
    const value = parsed?.success ? parsed.data : undefined;
    const inferred = row.source === 'INFERRED';
    const code = value?.key ?? slug(row.preferenceKind);
    const key = `${row.source}|${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      code,
      priority: inferred ? 'INFERRED_SOFT' : TRAVELLER_OWNER_KINDS.has(row.ownerKind) ? 'EXPLICIT_TRAVELLER' : 'EXPLICIT_ORGANISATION_POLICY',
      inferred,
      summary: `${inferred ? 'inferred: ' : ''}${value?.summary ?? `${row.preferenceKind} preference`}`.slice(0, 512),
      subjectRef: { kind: row.ownerKind as never, id: row.ownerId as never },
      ...(value?.match ? { match: value.match } : {}),
    });
  }
  return out;
}

/** The owner ids whose preferences bear on a planning basis (all derived from the captured world). */
export function preferenceOwnerIds(world: CapturedWorld, failing: readonly FailingSubject[], programmeIds: readonly string[]): string[] {
  const ids = new Set<string>(programmeIds);
  const failingJourneyIds = new Set(failing.filter((f) => f.subject.kind === 'JOURNEY').map((f) => f.subject.id as string));
  const failingTripIds = new Set(failing.filter((f) => f.subject.kind === 'TRIP').map((f) => f.subject.id as string));
  for (const journey of world.journeys) {
    if (!failingJourneyIds.has(journey.id) && !failingTripIds.has(journey.tripId)) continue;
    ids.add(journey.id);
    ids.add(journey.travellerId);
    ids.add(journey.tripId);
    if (journey.responsibilityOrganisationId) ids.add(journey.responsibilityOrganisationId);
  }
  return [...ids];
}

export async function loadPlanningPreferences(
  pool: Pool,
  workspaceId: string,
  ownerIds: readonly string[],
  at: string,
): Promise<ComparatorPreference[]> {
  return comparatorPreferencesFromRows(await readEffectivePreferences(pool, workspaceId, ownerIds, at));
}
