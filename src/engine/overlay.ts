/**
 * A3 — scenario overlay viability engine (FR-09, ARCHITECTURE.md §10).
 *
 * Candidate operations apply to an ISOLATED deep copy of the snapshot; the
 * authoritative Trip and the caller's snapshot objects are never mutated.
 * Candidate application reuses the exact semantics of the authoritative
 * MutationService (applyOperationToState), so an overlay that violates fact
 * authority or references missing targets is rejected loudly — never
 * silently "evaluated" into false feasibility.
 *
 * Feasibility rule: feasible iff no HARD constraint FAILs and no HARD
 * constraint stays UNKNOWN. Soft failures/trade-offs never block feasibility
 * but remain reported and rankable. UNKNOWN is never coerced to PASS.
 */
import type {
  ConstraintEvaluation,
  OverlayInput,
  ViabilityEngine,
  ViabilityResult,
} from '../contracts/services.ts';
import {
  ENTITY_SCHEMA_BY_TYPE,
  MutationOperationSchema,
  type MutationOperation,
} from '../operational/mutation.ts';
import type { Constraint } from '../domain/constraints.ts';
import type { RuleSet } from '../domain/rules.ts';
import {
  applyOperationToState,
  entityKey,
  type ContextEntity,
  type WorkingState,
} from './applyOperations.ts';
import { evaluateConstraints, type EvaluationContext } from './evaluators.ts';

function validateCandidate(op: MutationOperation): string[] {
  const issues: string[] = [];
  if (!MutationOperationSchema.safeParse(op).success) {
    issues.push('operation failed schema validation');
    return issues;
  }
  if (op.op === 'UPSERT_ENTITY') {
    const schema = ENTITY_SCHEMA_BY_TYPE[op.entityType];
    if (!schema.safeParse(op.data).success) {
      issues.push(`UPSERT_ENTITY payload for ${op.entityType} is schema-invalid`);
    }
  }
  return issues;
}

function stateFromSnapshot(snapshot: OverlayInput['baseSnapshot']): WorkingState {
  const entities = new Map<string, ContextEntity>();
  for (const constraint of snapshot.constraints) {
    entities.set(entityKey('CONSTRAINT', constraint.id), { entityType: 'CONSTRAINT', entity: constraint });
  }
  for (const ruleSet of snapshot.ruleSets) {
    entities.set(entityKey('RULE_SET', ruleSet.id), { entityType: 'RULE_SET', entity: ruleSet });
  }
  for (const place of snapshot.places) {
    entities.set(entityKey('PLACE', place.id), { entityType: 'PLACE', entity: place });
  }
  for (const traveller of snapshot.travellers) {
    entities.set(entityKey('TRAVELLER', traveller.id), { entityType: 'TRAVELLER', entity: traveller });
  }
  if (snapshot.anchorEvent) {
    entities.set(entityKey('ANCHOR_EVENT', snapshot.anchorEvent.id), {
      entityType: 'ANCHOR_EVENT',
      entity: snapshot.anchorEvent,
    });
  }
  return { trips: new Map([[snapshot.trip.id, snapshot.trip]]), entities };
}

export class OverlayViabilityEngine implements ViabilityEngine {
  async evaluateOverlay(input: OverlayInput): Promise<ViabilityResult> {
    // Isolation: everything below operates on this clone only.
    const snapshot = structuredClone(input.baseSnapshot);
    const state = stateFromSnapshot(snapshot);

    for (const op of input.candidateOperations) {
      const issues = validateCandidate(op);
      if (issues.length > 0) {
        throw new Error(`overlay candidate rejected: ${issues.join('; ')}`);
      }
      const result = applyOperationToState(state, op, snapshot.takenAt);
      if (!result.ok) {
        throw new Error(
          `overlay candidate rejected: ${result.issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`,
        );
      }
    }

    const trip = state.trips.get(snapshot.tripId);
    if (!trip) throw new Error(`overlay snapshot has no trip ${snapshot.tripId}`);

    const constraints: Constraint[] = [...state.entities.values()]
      .filter((entry) => entry.entityType === 'CONSTRAINT')
      .map((entry) => entry.entity);
    const ruleSets = new Map<string, RuleSet>(
      [...state.entities.values()]
        .filter((entry) => entry.entityType === 'RULE_SET')
        .map((entry) => [entry.entity.id, entry.entity]),
    );
    const anchorEntry = snapshot.anchorEvent
      ? state.entities.get(entityKey('ANCHOR_EVENT', snapshot.anchorEvent.id))
      : undefined;
    const ctx: EvaluationContext = {
      trip,
      places: new Map(
        [...state.entities.values()]
          .filter((entry) => entry.entityType === 'PLACE')
          .map((entry) => [entry.entity.id, entry.entity]),
      ),
      ruleSets,
      travellers: [...state.entities.values()]
        .filter((entry) => entry.entityType === 'TRAVELLER')
        .map((entry) => entry.entity),
      anchorEvent: anchorEntry?.entityType === 'ANCHOR_EVENT' ? anchorEntry.entity : undefined,
      now: snapshot.takenAt,
    };

    const constraintResults: ConstraintEvaluation[] = evaluateConstraints(constraints, ctx);
    const hardnessById = new Map(constraints.map((c) => [c.id, c.hardness]));

    const hardFailureIds = constraintResults
      .filter((r) => hardnessById.get(r.constraintId) === 'HARD' && r.status === 'FAIL')
      .map((r) => r.constraintId);
    const unknownIds = constraintResults
      .filter((r) => hardnessById.get(r.constraintId) === 'HARD' && r.status === 'UNKNOWN')
      .map((r) => r.constraintId);
    const softTradeoffs = constraintResults
      .filter((r) => hardnessById.get(r.constraintId) === 'SOFT' && r.status !== 'PASS')
      .map((r) => `soft constraint ${r.constraintId} is ${r.status}${r.evidence ? ` (${r.evidence})` : ''}`);

    return {
      feasible: hardFailureIds.length === 0 && unknownIds.length === 0,
      constraintResults,
      hardFailureIds,
      softTradeoffs,
      unknownIds,
    };
  }
}
