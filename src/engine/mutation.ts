/**
 * A1 — validated authoritative mutation (FR-04, ARCHITECTURE.md §8).
 *
 * Only schema-valid MutationProposals reach state; every proposal is applied
 * all-or-nothing inside one transaction; fact conflicts resolve by
 * authority + freshness, never last-write-wins; provenance and audit history
 * are preserved. LLM/origin identity never bypasses validation.
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { compareInstants } from '../domain/common.ts';
import { TripSchema, type Trip } from '../domain/trip.ts';
import { ENTITY_SCHEMA_BY_TYPE, MutationProposalSchema } from '../operational/mutation.ts';
import type { MutationProposal } from '../operational/mutation.ts';
import type { MutationOutcome, MutationService, ValidationIssue } from '../contracts/services.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import type { TripRepository } from '../contracts/repositories.ts';
import { withTransaction } from '../persistence/database.ts';
import {
  applyOperationToState,
  entityKey,
  type AppliedOperation,
  type WorkingState,
} from './applyOperations.ts';

/** Fact payload validation for UPSERT_FACT (provenance fields are mandatory). */
const FactPayloadSchema = z.strictObject({
  value: z.unknown(),
  sourceId: z.string(),
  authority: z.enum(['AUTHORITATIVE', 'CONNECTED', 'ASSERTED', 'INFERRED']),
  confidence: z.number().min(0).max(1).optional(),
  observedAt: z.iso.datetime({ offset: true }),
  verifiedAt: z.iso.datetime({ offset: true }).optional(),
  validUntil: z.iso.datetime({ offset: true }).optional(),
});

export interface MutationServiceDeps {
  db: DatabaseSync;
  trips: TripRepository;
  entities: EntityStore;
}

export class SqlMutationService implements MutationService {
  private readonly deps: MutationServiceDeps;

  constructor(deps: MutationServiceDeps) {
    this.deps = deps;
  }

  async applyProposal(proposal: MutationProposal): Promise<MutationOutcome> {
    const parsed = MutationProposalSchema.safeParse(proposal);
    if (!parsed.success) {
      const issues = issuesFromZod(parsed.error, 'PROPOSAL_SCHEMA_INVALID');
      await this.audit(safeProposalSummary(proposal).id as string, 'MUTATION_REJECTED', undefined, {
        proposal: safeProposalSummary(proposal),
        issues,
      });
      return { accepted: false, appliedOperationCount: 0, issues };
    }
    const valid = parsed.data;

    const validationIssues = await this.validateOperations(valid);
    if (validationIssues.length > 0) {
      await this.audit(valid.id, 'MUTATION_REJECTED', firstTripHint(valid), {
        proposalId: valid.id,
        origin: valid.origin,
        issues: validationIssues,
      });
      return { accepted: false, appliedOperationCount: 0, issues: validationIssues };
    }

    // Build the working state: all trips (targets may live in any trip) plus
    // every incumbent entity referenced by fact or entity operations, so
    // UPSERT_FACT and UPSERT_ENTITY conflict checks see the existing evidence.
    const trips = new Map<string, Trip>();
    for (const summary of await this.deps.trips.listTrips()) {
      const trip = await this.deps.trips.getTrip(summary.tripId);
      if (trip) trips.set(summary.tripId, structuredClone(trip));
    }
    const state: WorkingState = { trips, entities: new Map() };
    const preloadEntity = async (entityType: string, id: string): Promise<void> => {
      if (entityType !== 'ORGANISATION' && entityType !== 'TRAVELLER' && entityType !== 'ANCHOR_EVENT' && entityType !== 'PLACE' && entityType !== 'RULE_SET') {
        return;
      }
      const key = entityKey(entityType, id);
      if (state.entities.has(key)) return;
      const existing = await this.deps.entities.get(entityType, id);
      if (existing) state.entities.set(key, structuredClone(existing));
    };
    for (const op of valid.operations) {
      if (op.op === 'UPSERT_FACT') {
        const { entityType, id } = op.target;
        await preloadEntity(entityType, id);
      }
      if (op.op === 'UPSERT_ENTITY') {
        const dataId = op.id ?? (op.data as { id?: string }).id;
        if (dataId) await preloadEntity(op.entityType, dataId);
      }
    }

    const applied: AppliedOperation[] = [];
    for (const op of valid.operations) {
      // Authoritative mutation: the fact-authority ladder is enforced
      // explicitly here (never implicit; overlays opt out — ADR-032).
      const result = applyOperationToState(state, op, valid.requestedAt, { enforceFactAuthority: true });
      if (!result.ok) {
        await this.audit(valid.id, 'MUTATION_REJECTED', firstTripHint(valid), {
          proposalId: valid.id,
          origin: valid.origin,
          issues: result.issues,
        });
        return { accepted: false, appliedOperationCount: 0, issues: result.issues };
      }
      if (!result.superseded) applied.push(result.applied);
    }

    // Coherent version bump: one increment per affected trip per proposal.
    const affectedTripIds = [...new Set(applied.map((a) => a.affectedTripId).filter(Boolean))] as string[];
    for (const tripId of affectedTripIds) {
      const trip = state.trips.get(tripId);
      if (!trip) continue;
      trip.version += 1;
      trip.updatedAt = valid.requestedAt;
    }

    const actor =
      valid.origin + (valid.actorRef ? `:${valid.actorRef.entityType}:${valid.actorRef.id}` : '');

    withTransaction(this.deps.db, () => {
      for (const tripId of affectedTripIds) {
        const trip = state.trips.get(tripId);
        if (!trip) continue;
        const validatedTrip = TripSchema.parse(trip);
        this.deps.db
          .prepare(
            `INSERT INTO trips (id, version, data, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
          )
          .run(validatedTrip.id, validatedTrip.version, JSON.stringify(validatedTrip), validatedTrip.updatedAt);
      }
      for (const [key, entry] of state.entities) {
        const entityType = key.slice(0, key.indexOf(':'));
        this.deps.db
          .prepare(
            `INSERT INTO entities (entity_type, id, data) VALUES (?, ?, ?)
             ON CONFLICT(entity_type, id) DO UPDATE SET data = excluded.data`,
          )
          .run(entityType, entry.entity.id, JSON.stringify(entry.entity));
      }
      this.deps.db
        .prepare(
          'INSERT INTO audit (occurred_at, actor, action, subject, payload) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          valid.requestedAt,
          actor,
          'MUTATION_APPLIED',
          affectedTripIds[0] ?? valid.id,
          JSON.stringify({
            proposalId: valid.id,
            origin: valid.origin,
            rationale: valid.rationale,
            sourceId: valid.sourceId,
            appliedOperationCount: applied.length,
            details: applied.map((a) => a.detail),
            tripVersions: Object.fromEntries(
              affectedTripIds.map((id) => [id, state.trips.get(id)?.version ?? 0]),
            ),
          }),
        );
    });

    return {
      accepted: true,
      appliedOperationCount: applied.length,
      tripVersion: affectedTripIds.length > 0 ? state.trips.get(affectedTripIds[0] as string)?.version : undefined,
      issues: [],
    };
  }

  private async validateOperations(proposal: MutationProposal): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    for (const [index, op] of proposal.operations.entries()) {
      const path = `operations[${index}]`;
      switch (op.op) {
        case 'UPSERT_ENTITY': {
          const schema = ENTITY_SCHEMA_BY_TYPE[op.entityType];
          if (!schema) {
            issues.push({ code: 'UNKNOWN_ENTITY_TYPE', message: `unknown entity type ${op.entityType}`, path });
            break;
          }
          const parsed = (schema as z.ZodType).safeParse(op.data);
          if (!parsed.success) {
            issues.push(...issuesFromZod(parsed.error, 'ENTITY_SCHEMA_INVALID', path));
            break;
          }
          const dataId = (parsed.data as { id?: string }).id;
          if (op.id !== undefined && dataId !== undefined && op.id !== dataId) {
            issues.push({
              code: 'ENTITY_ID_MISMATCH',
              message: `operation id ${op.id} does not match payload id ${dataId}`,
              path,
            });
          }
          break;
        }
        case 'UPSERT_FACT': {
          const parsed = FactPayloadSchema.safeParse(op.value);
          if (!parsed.success) {
            issues.push(...issuesFromZod(parsed.error, 'FACT_SCHEMA_INVALID', `${path}.value`));
            break;
          }
          if (parsed.data.validUntil && compareInstants(parsed.data.validUntil, proposal.requestedAt) < 0) {
            issues.push({
              code: 'FACT_ALREADY_EXPIRED',
              message: `incoming fact at ${op.factPath} expired before the proposal was requested`,
              path,
            });
          }
          break;
        }
        case 'WAIVE_OR_REPRIORITIZE_OBJECTIVE': {
          if (op.action === 'REPRIORITY' && op.newHardness === undefined) {
            issues.push({
              code: 'REPRIORITY_REQUIRES_HARDNESS',
              message: `REPRIORITY for objective ${op.objectiveId} requires newHardness`,
              path,
            });
          }
          break;
        }
        default:
          break;
      }
    }
    return issues;
  }

  private async audit(
    proposalId: string,
    action: string,
    subject: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.deps.db
      .prepare(
        'INSERT INTO audit (occurred_at, actor, action, subject, payload) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        // Audit instants use the current clock; they record when the engine acted.
        new Date().toISOString(),
        'mutation-service',
        action,
        subject ?? proposalId,
        JSON.stringify(payload),
      );
  }
}

function issuesFromZod(error: z.ZodError, code: string, pathPrefix?: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code,
    message: `${issue.path.join('.')}: ${issue.message}`,
    path: pathPrefix ? `${pathPrefix}.${issue.path.join('.')}` : issue.path.join('.'),
  }));
}

function firstTripHint(proposal: MutationProposal): string | undefined {
  for (const op of proposal.operations) {
    if (op.op === 'ADD_RELATION' || op.op === 'REMOVE_RELATION') return op.tripId;
    if (op.op === 'UPSERT_ENTITY' && op.entityType === 'TRIP') return op.id;
  }
  return undefined;
}

function safeProposalSummary(proposal: MutationProposal | undefined): Record<string, unknown> {
  return {
    id: typeof proposal?.id === 'string' ? proposal.id : 'unknown',
    origin: typeof proposal?.origin === 'string' ? proposal.origin : undefined,
    operationCount: Array.isArray(proposal?.operations) ? proposal.operations.length : 0,
  };
}
