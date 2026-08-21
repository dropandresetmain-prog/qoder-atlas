/**
 * A4 — executor boundary (FR-10, ADR-025, ADR-007).
 *
 * The ONLY entrance to side effects is an AuthorisedExecution envelope
 * validated by executionGateIssues(). An intent merely marked AUTHORISED by
 * an arbitrary caller is refused. Unsupported transactions are simulated at
 * this boundary; the simulation shape is provider-neutral and downstream
 * observation treats it like any other execution evidence.
 */
import {
  executionGateIssues,
  type AuthorisedExecution,
  type ExecutionResult,
} from '../operational/intent.ts';
import type { ExecutorService } from '../contracts/services.ts';

export class BoundaryExecutor implements ExecutorService {
  async execute(execution: AuthorisedExecution): Promise<ExecutionResult> {
    const issues = executionGateIssues(execution);
    const executedAt = execution.intent.createdAt;
    if (issues.length > 0) {
      return {
        id: `exec-${execution.intent.id}-refused`,
        intentId: execution.intent.id,
        executedAt,
        status: 'FAILURE',
        provenance: 'SIMULATED',
        resultSummary: 'execution refused by deterministic authority gate',
        error: { code: 'EXECUTION_REFUSED', message: issues.join('; '), retryable: false },
      };
    }
    // Boundary simulation: no live provider in Lane A. The observed effects
    // carry the validated mutation operations the observation loop maps back
    // into authoritative state.
    return {
      id: `exec-${execution.intent.id}`,
      intentId: execution.intent.id,
      executedAt,
      status: 'SUCCESS',
      provenance: 'SIMULATED',
      resultSummary: `simulated ${execution.intent.operation} at provider boundary`,
      observedEffects: {
        operation: execution.intent.operation,
        parameters: execution.intent.parameters,
        ...(execution.intent.priceDelta ? { priceDelta: execution.intent.priceDelta } : {}),
      },
    };
  }
}
