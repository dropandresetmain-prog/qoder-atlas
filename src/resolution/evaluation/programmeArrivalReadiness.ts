/**
 * Generic programme arrival readiness — REQUIRED physical-presence commitments.
 *
 * Policy minutes come from RuleSet / constraint / operatingRequirements data.
 * Never hardcode a scenario name or a fixed duration in callers.
 */
import type { Instant } from '../../domain/v2/shared/time.ts';
import { minutesBetween } from './explain.ts';

export const PROGRAMME_ARRIVAL_READINESS_CONSTRAINT = 'programme_arrival_readiness_minutes' as const;

export type ProgrammeArrivalReadinessVerdict = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface ProgrammeArrivalReadinessInput {
  /** Scheduled (or effective) arrival at the commitment place. */
  scheduledArrival: Instant | null | undefined;
  /** Commitment window start. */
  commitmentStart: Instant | null | undefined;
  /** Required minutes between arrival and commitment start (from policy data). */
  requiredMinutes: number | null | undefined;
  /** True when the commitment requires physical presence. */
  requiresPhysicalPresence: boolean;
  /** Participation obligation. */
  obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED';
}

export interface ProgrammeArrivalReadinessResult {
  verdict: ProgrammeArrivalReadinessVerdict;
  reasonCode: string;
  availableMinutes: number | null;
  requiredMinutes: number | null;
  facts: Record<string, unknown>;
}

/** Interpret opaque operatingRequirements without scenario branching. */
export function requiresPhysicalPresenceFromOperatingRequirements(
  operatingRequirements: Record<string, unknown> | null | undefined,
): boolean {
  if (!operatingRequirements) return false;
  const value =
    operatingRequirements.requiresPhysicalPresence
    ?? operatingRequirements.physicalPresence
    ?? operatingRequirements.physical_presence;
  return value === true;
}

/** Optional per-item override minutes from operatingRequirements (scenario/policy data). */
export function readinessMinutesFromOperatingRequirements(
  operatingRequirements: Record<string, unknown> | null | undefined,
): number | undefined {
  if (!operatingRequirements) return undefined;
  const raw =
    operatingRequirements.readinessBufferMinutes
    ?? operatingRequirements.arrivalReadinessMinutes
    ?? operatingRequirements.arrival_readiness_minutes;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.trunc(raw);
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  return undefined;
}

/**
 * Evaluate arrival→commitment readiness.
 *
 * Applies only when obligation is REQUIRED and physical presence is required.
 * Otherwise returns NOT_APPLICABLE so callers keep existing participation logic.
 */
export function evaluateProgrammeArrivalReadiness(
  input: ProgrammeArrivalReadinessInput,
): ProgrammeArrivalReadinessResult {
  if (input.obligation !== 'REQUIRED' || !input.requiresPhysicalPresence) {
    return {
      verdict: 'NOT_APPLICABLE',
      reasonCode: 'readiness_not_applicable',
      availableMinutes: null,
      requiredMinutes: null,
      facts: { obligation: input.obligation, requiresPhysicalPresence: input.requiresPhysicalPresence },
    };
  }

  if (input.requiredMinutes === null || input.requiredMinutes === undefined) {
    return {
      verdict: 'UNKNOWN',
      reasonCode: 'readiness_policy_unknown',
      availableMinutes: null,
      requiredMinutes: null,
      facts: { obligation: input.obligation, requiresPhysicalPresence: true },
    };
  }

  const requiredMinutes = input.requiredMinutes;
  if (!input.scheduledArrival || !input.commitmentStart) {
    return {
      verdict: 'UNKNOWN',
      reasonCode: 'readiness_times_unknown',
      availableMinutes: null,
      requiredMinutes,
      facts: {
        requiredMinutes,
        scheduledArrival: input.scheduledArrival ?? null,
        commitmentStart: input.commitmentStart ?? null,
      },
    };
  }

  const availableMinutes = minutesBetween(input.scheduledArrival, input.commitmentStart);
  const facts = {
    requiredMinutes,
    availableMinutes,
    scheduledArrival: input.scheduledArrival,
    commitmentStart: input.commitmentStart,
  };

  if (availableMinutes < requiredMinutes) {
    return {
      verdict: 'FAIL',
      reasonCode: 'insufficient_arrival_readiness',
      availableMinutes,
      requiredMinutes,
      facts,
    };
  }

  return {
    verdict: 'PASS',
    reasonCode: 'arrival_readiness_satisfied',
    availableMinutes,
    requiredMinutes,
    facts,
  };
}
