/**
 * A3 — scenario overlay viability engine (FR-09, ARCHITECTURE.md §10).
 *
 * Candidate operations apply to an ISOLATED deep copy of the snapshot; the
 * authoritative Trip and the caller's snapshot objects are never mutated.
 * Candidate application reuses the exact semantics of the authoritative
 * MutationService (applyOperationToState) — with one explicit difference:
 * fact authority is NOT enforced on overlay candidates (ADR-032). Candidates
 * are HELD hypotheses about a replacement booking (CONNECTED evidence at
 * best); the CONNECTED -> AUTHORITATIVE upgrade happens at execution
 * observation via `confirmedData()`. Enforcing the ladder here would reject
 * every delay-replacement candidate against an authoritative delay fact and
 * pressure planners into fabricating provenance. Missing targets and
 * judging-criteria mutation (below) are still rejected loudly.
 *
 * Judging-criteria integrity: a candidate may never mutate the constraints
 * or rule sets that already exist in the base snapshot — those ARE the
 * criteria this engine judges the candidate with (REV-C WP-C1 defence in
 * depth). Downgrading, removing or rewriting an incumbent constraint/rule
 * set to make the candidate pass is rejected deterministically. Adding brand
 * new constraints remains legal: a candidate can only make its own judgement
 * stricter, never looser.
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

/**
 * Structural judging-criteria guard: operations that would mutate a
 * constraint or rule set already present in the base snapshot. Purely
 * id-based against the overlay's starting state — no scenario knowledge.
 */
function judgingCriteriaIssue(
  op: MutationOperation,
  baseConstraintIds: ReadonlySet<string>,
  baseRuleSetIds: ReadonlySet<string>,
): string | undefined {
  if (op.op === 'UPSERT_CONSTRAINT' && baseConstraintIds.has(op.constraint.id)) {
    return (
      `candidate mutates judging criteria: constraint ${op.constraint.id} is part of the evaluation basis ` +
      'and cannot be upserted by a candidate under evaluation'
    );
  }
  if (op.op === 'UPSERT_ENTITY' && op.entityType === 'RULE_SET') {
    const id = op.id ?? (op.data as { id?: string }).id;
    if (id && baseRuleSetIds.has(id)) {
      return (
        `candidate mutates judging criteria: rule set ${id} is part of the evaluation basis ` +
        'and cannot be upserted by a candidate under evaluation'
      );
    }
  }
  return undefined;
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

    // The judging criteria are fixed before any candidate applies:
    // constraints and rule sets present in the base snapshot.
    const baseConstraintIds = new Set(snapshot.constraints.map((c) => c.id));
    const baseRuleSetIds = new Set(snapshot.ruleSets.map((rs) => rs.id));

    for (const op of input.candidateOperations) {
      const issues = validateCandidate(op);
      if (issues.length > 0) {
        throw new Error(`overlay candidate rejected: ${issues.join('; ')}`);
      }
      const criteriaIssue = judgingCriteriaIssue(op, baseConstraintIds, baseRuleSetIds);
      if (criteriaIssue) {
        throw new Error(`overlay candidate rejected: ${criteriaIssue}`);
      }
      // Candidates are hypotheses: fact authority is not enforced here
      // (ADR-032); the authoritative path keeps the ladder.
      const result = applyOperationToState(state, op, snapshot.takenAt, { enforceFactAuthority: false });
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
