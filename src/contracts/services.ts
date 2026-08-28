/**
 * F2 — application service boundaries for the operational loop
 * (ARCHITECTURE.md §2). Implementations belong to lane A / integrator;
 * this seam is frozen at Checkpoint A.
 *
 * Required flow: AI proposal -> validation -> deterministic viability ->
 * authority -> executor -> observe -> state update.
 */
import type { EntityId, EntityRef, Money } from '../domain/common.ts';
import type { ConstraintStatus } from '../domain/constraints.ts';
import type { CaseStatus } from '../operational/case.ts';
import type { ImpactAssessment } from '../operational/impact.ts';
import type {
  ActionIntent,
  AuthorisedExecution,
  AuthorityDecision,
  ExecutionResult,
} from '../operational/intent.ts';
import type { MutationOperation, MutationProposal } from '../operational/mutation.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { TripSnapshot } from '../operational/snapshot.ts';

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

export interface MutationOutcome {
  accepted: boolean;
  appliedOperationCount: number;
  tripVersion?: number;
  issues: ValidationIssue[];
}

/** Only validated proposals mutate authoritative state (FR-04). */
export interface MutationService {
  applyProposal(proposal: MutationProposal): Promise<MutationOutcome>;
}

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

export interface ImpactService {
  assess(tripId: EntityId, signalId?: EntityId): Promise<ImpactAssessment>;
}

// ---------------------------------------------------------------------------
// Viability (scenario overlays)
// ---------------------------------------------------------------------------

export interface OverlayInput {
  baseSnapshot: TripSnapshot;
  /** Candidate mutations applied to an isolated overlay only (FR-09). */
  candidateOperations: MutationOperation[];
  /** Disruption signals in scope for direct-failure assessment on the overlay. */
  triggeringSignals?: TripSignal[];
}

export interface ConstraintEvaluation {
  constraintId: EntityId;
  status: ConstraintStatus;
  evidence?: string;
}

export interface ViabilityResult {
  feasible: boolean;
  constraintResults: ConstraintEvaluation[];
  hardFailureIds: EntityId[];
  /** Soft tradeoffs remain rankable even when the overlay is feasible. */
  softTradeoffs: string[];
  unknownIds: EntityId[];
  /** Element-level direct failures (connection impossibility, INVALID legs, …). */
  directFailureElementIds: EntityId[];
}

export interface ViabilityEngine {
  evaluateOverlay(input: OverlayInput): Promise<ViabilityResult>;
}

// ---------------------------------------------------------------------------
// Authority
// ---------------------------------------------------------------------------

export interface PrincipalRecord {
  ref: EntityRef;
  permissions: string[];
  delegatedSpendLimit?: Money;
}

export interface AuthorityContext {
  tripId: EntityId;
  caseId: EntityId;
  ruleSetIds: EntityId[];
  principals: PrincipalRecord[];
  /**
   * FX evidence available for home-currency normalization of a non-home
   * spend (ADR-052). Optional for backwards compatibility; when absent the
   * authority behaves exactly as before (incomparable currencies fail
   * closed). Evidence is re-validated by the engine.
   */
  fxRates?: unknown[];
  /**
   * Organisation-configured home currency for this trip's policy comparison.
   * Optional: absent means no home currency is derivable, so cross-currency
   * comparisons keep failing closed (ADR-045).
   */
  homeCurrency?: string;
}

/**
 * FX evidence resolution seam (ADR-052): all evidenced base->home rate
 * observations a store holds for one currency pair. Implementations return
 * raw evidence; staleness/trust/effective-period judgement stays with the
 * deterministic engine, never the store. Absence of evidence is normal data:
 * the caller fails closed on it.
 */
export interface FxRateResolver {
  ratesFor(baseCurrency: string, homeCurrency: string): Promise<unknown[]>;
}

/** Deterministic: identical intent + context always yields identical outcome. */
export interface AuthorityEngine {
  decide(intent: ActionIntent, context: AuthorityContext): Promise<AuthorityDecision>;
}

// ---------------------------------------------------------------------------
// Execution + observation
// ---------------------------------------------------------------------------

/**
 * Executes only through an AuthorisedExecution envelope: an intent paired
 * with the deterministic AuthorityDecision that authorised it (FR-10,
 * ADR-025). Implementations MUST validate the pair with
 * `executionGateIssues()` and refuse when any issue is reported; an intent
 * merely marked AUTHORISED by an arbitrary caller is not executable evidence.
 */
export interface ExecutorService {
  execute(execution: AuthorisedExecution): Promise<ExecutionResult>;
}

export interface ObservationOutcome {
  stateUpdated: boolean;
  appliedOperationCount: number;
  reevaluationRequested: boolean;
  suggestedCaseStatus?: CaseStatus;
}

/**
 * Maps execution results back into validated state and requests
 * re-evaluation; API success alone never resolves a case (FR-11).
 */
export interface ObservationService {
  observe(result: ExecutionResult): Promise<ObservationOutcome>;
}
