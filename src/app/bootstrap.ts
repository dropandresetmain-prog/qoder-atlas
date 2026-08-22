/**
 * I1 — generalized scenario bootstrap.
 *
 * Loads any ScenarioSpec bundle through the frozen loader and seeds
 * authoritative state through the SAME validated mutation path every other
 * state change uses (FR-02/FR-04): bundle objects become one all-or-nothing
 * MutationProposal applied by the MutationService. Sources are persisted with
 * raw content; preferences go to the application-owned preference store.
 *
 * Scenario-neutral by construction: this code knows the bundle schema, never
 * scenario content. A third scenario seeds through this unchanged.
 */
import { readFileSync } from 'node:fs';
import type { EntityId } from '../domain/common.ts';
import type { MutationOperation, MutationProposal } from '../operational/mutation.ts';
import type { ScenarioSpec } from '../scenarios/spec.ts';
import {
  loadScenario,
  missingSourceFiles,
  sourceContentPath,
} from '../scenarios/loader.ts';
import type {
  AuditRepository,
  SourceRepository,
} from '../contracts/repositories.ts';
import type { MutationService } from '../contracts/services.ts';
import type { PreferenceStore } from './preferenceStore.ts';

export interface SeedDependencies {
  mutations: MutationService;
  sources: SourceRepository;
  preferences: PreferenceStore;
  audit: AuditRepository;
}

export interface SeedOutcome {
  scenarioId: string;
  tripId: EntityId;
  appliedOperationCount: number;
  tripVersion: number | undefined;
  sourceIds: EntityId[];
  preferenceCount: number;
}

/** Seed one scenario bundle directory into authoritative persistent state. */
export async function seedScenarioBundle(
  deps: SeedDependencies,
  scenarioDir: string,
): Promise<SeedOutcome> {
  const spec = loadScenario(scenarioDir);

  const missing = missingSourceFiles(scenarioDir, spec);
  if (missing.length > 0) {
    throw new Error(`scenario bundle incomplete: missing source files: ${missing.join(', ')}`);
  }

  // 1. Source evidence first: facts reference these ids, and provenance must
  //    exist before state that cites it.
  for (const source of spec.context.sources) {
    await deps.sources.saveSource(source);
    if (source.contentRef) {
      const content = readFileSync(sourceContentPath(scenarioDir, source.contentRef), 'utf8');
      await deps.sources.saveSourceContent(source.id, content);
    }
  }

  // 2. Authoritative state via the frozen mutation path — all-or-nothing,
  //    schema-validated, audited. No direct repository writes here.
  const proposal: MutationProposal = {
    id: `prop-seed-${spec.scenarioId}`,
    origin: 'SYSTEM',
    requestedAt: spec.trip.updatedAt,
    rationale: `seed scenario bundle ${spec.scenarioId} into authoritative state`,
    operations: buildSeedOperations(spec),
  };
  const outcome = await deps.mutations.applyProposal(proposal);
  if (!outcome.accepted) {
    const detail = outcome.issues.map((i) => `${i.code}: ${i.message}`).join('; ');
    throw new Error(`seed proposal for ${spec.scenarioId} rejected: ${detail}`);
  }

  // 3. Preferences (application-owned store; not part of the entity registry).
  for (const preference of spec.context.preferences) {
    await deps.preferences.save(preference);
  }

  // 4. Bootstrap audit entry complementing the mutation-service audit trail.
  await deps.audit.append({
    occurredAt: spec.trip.updatedAt,
    actor: 'app:bootstrap',
    action: 'SCENARIO_SEEDED',
    subject: spec.trip.id,
    payload: {
      scenarioId: spec.scenarioId,
      proposalId: proposal.id,
      sourceCount: spec.context.sources.length,
      preferenceCount: spec.context.preferences.length,
      appliedOperationCount: outcome.appliedOperationCount,
    },
  });

  return {
    scenarioId: spec.scenarioId,
    tripId: spec.trip.id,
    appliedOperationCount: outcome.appliedOperationCount,
    tripVersion: outcome.tripVersion,
    sourceIds: spec.context.sources.map((source) => source.id),
    preferenceCount: spec.context.preferences.length,
  };
}

/**
 * Bundle objects -> mutation operations. Context entities and constraints
 * first, then the trip aggregate; the mutation service validates every
 * payload against the frozen entity registry.
 */
export function buildSeedOperations(spec: ScenarioSpec): MutationOperation[] {
  const operations: MutationOperation[] = [];
  for (const organisation of spec.context.organisations) {
    operations.push({ op: 'UPSERT_ENTITY', entityType: 'ORGANISATION', id: organisation.id, data: organisation });
  }
  for (const traveller of spec.context.travellers) {
    operations.push({ op: 'UPSERT_ENTITY', entityType: 'TRAVELLER', id: traveller.id, data: traveller });
  }
  for (const anchorEvent of spec.context.anchorEvents) {
    operations.push({ op: 'UPSERT_ENTITY', entityType: 'ANCHOR_EVENT', id: anchorEvent.id, data: anchorEvent });
  }
  for (const place of spec.context.places) {
    operations.push({ op: 'UPSERT_ENTITY', entityType: 'PLACE', id: place.id, data: place });
  }
  for (const ruleSet of spec.context.ruleSets) {
    operations.push({ op: 'UPSERT_ENTITY', entityType: 'RULE_SET', id: ruleSet.id, data: ruleSet });
  }
  for (const constraint of spec.constraints) {
    operations.push({ op: 'UPSERT_CONSTRAINT', constraint });
  }
  operations.push({ op: 'UPSERT_ENTITY', entityType: 'TRIP', id: spec.trip.id, data: spec.trip });
  return operations;
}
