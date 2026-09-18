/**
 * Read-only PlanningToolTransport that fulfils C2 planning requests through the
 * EXISTING dispatchToolRequest (src/app/dispatch.ts). No second engine, no
 * direct provider call, no consequential operation reachable — the closed
 * ToolOperation vocabulary and dispatchToolRequest already forbid it.
 *
 * In Cloud this transport is wired over REPLAY Atlas adapters backed by
 * checked-in recordings; locally the same code is wired over LIVE or RECORD
 * adapters with identical normalisation. The only thing that changes is the
 * injected ToolDispatchCapabilities; the bridge itself is mode-agnostic.
 */
import type { ToolDispatchCapabilities } from '../../app/dispatch.ts';
import { dispatchToolRequest } from '../../app/dispatch.ts';
import type { PlanningToolRequest, PlanningToolResult } from '../../contracts/v2/planning/planningTool.ts';
import { PlanningToolResultSchema } from '../../contracts/v2/planning/planningTool.ts';
import type { PlanningToolTransport } from './researchDispatcher.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import { ToolRequestSchema } from '../../operational/strategy.ts';

export interface PlanningToolTransportOpts {
  capabilities: ToolDispatchCapabilities;
  /** Provenance clock for observedAt. Injected for determinism; never reads a real clock inside if a value is supplied. */
  observedAt: Instant | (() => Instant);
}

function resolveObservedAt(observedAt: Instant | (() => Instant)): Instant {
  return typeof observedAt === 'function' ? observedAt() : observedAt;
}

type ProvenanceMode = 'LIVE' | 'RECORD' | 'REPLAY' | 'INTERNAL';

/**
 * Map the provider adapter mode string to the PlanningToolProvenanceMode
 * vocabulary. AdapterMode is 'LIVE' | 'RECORD' | 'REPLAY' (src/config/config.ts);
 * anything else (defensive — the runner only emits those three) falls back to
 * INTERNAL so provenance stays honest rather than lying about an unknown mode.
 */
function mapMode(dispatchedMode: string): ProvenanceMode {
  switch (dispatchedMode) {
    case 'LIVE':
    case 'RECORD':
    case 'REPLAY':
      return dispatchedMode;
    default:
      return 'INTERNAL';
  }
}

function buildFailedResult(
  request: PlanningToolRequest,
  observedAt: Instant,
  category: string,
  code: string,
  message: string,
): PlanningToolResult {
  return PlanningToolResultSchema.parse({
    requestId: request.id,
    capability: request.capability,
    operation: request.operation,
    status: 'FAILED',
    provenance: {
      mode: 'INTERNAL',
      observedAt,
      sourceRefs: [],
    },
    uncertainty: [],
    error: { category, code, message },
  });
}

/**
 * Build the read-only PlanningToolTransport that fulfils planning requests
 * through the EXISTING dispatchToolRequest against injected capabilities.
 * Proposal/research-only: it can never perform a consequential operation
 * because dispatchToolRequest + the closed ToolOperation vocabulary already
 * forbid it.
 */
export function createPlanningToolTransport(opts: PlanningToolTransportOpts): PlanningToolTransport {
  return async (request: PlanningToolRequest): Promise<PlanningToolResult> => {
    const observedAt = resolveObservedAt(opts.observedAt);

    // Bridge the C2 PlanningToolRequest to the dispatch-level ToolRequest by
    // extracting the four shared fields. The PlanningToolRequest carries two
    // extras (evidenceGapCode, round) that the dispatch layer does not know.
    const toolRequestParse = ToolRequestSchema.safeParse({
      id: request.id,
      capability: request.capability,
      operation: request.operation,
      parameters: request.parameters,
      purpose: request.purpose,
    });

    if (!toolRequestParse.success) {
      return buildFailedResult(
        request,
        observedAt,
        'INVALID_REQUEST',
        'invalid_tool_request',
        `planning request failed dispatch ToolRequest validation: ${toolRequestParse.error.issues.length} issue(s)`,
      );
    }

    const dispatched = await dispatchToolRequest(opts.capabilities, toolRequestParse.data);

    if (dispatched.ok) {
      const result: PlanningToolResult = PlanningToolResultSchema.parse({
        requestId: request.id,
        capability: request.capability,
        operation: request.operation,
        status: 'SUCCEEDED',
        normalizedEvidence: dispatched.data,
        provenance: {
          providerId: dispatched.providerId,
          mode: mapMode(dispatched.mode),
          observedAt,
          sourceRefs: [],
          ...(dispatched.recordingId !== undefined ? { recordingRef: dispatched.recordingId } : {}),
        },
        uncertainty: [],
      });
      return result;
    }

    // External failure stays VISIBLE data — never swallowed, never fabricated.
    const status = dispatched.error.category === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'FAILED';
    const result: PlanningToolResult = PlanningToolResultSchema.parse({
      requestId: request.id,
      capability: request.capability,
      operation: request.operation,
      status,
      provenance: {
        mode: 'INTERNAL',
        observedAt,
        sourceRefs: [],
      },
      uncertainty: [],
      error: {
        category: dispatched.error.category,
        code: dispatched.error.code,
        message: dispatched.error.message,
        ...(dispatched.error.retryable !== undefined ? { retryable: dispatched.error.retryable } : {}),
      },
    });
    return result;
  };
}
