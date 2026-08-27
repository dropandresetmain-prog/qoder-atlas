/**
 * Shared presentation context for journey-chain state.
 *
 * Provider reservation status and trip viability are distinct: a confirmed
 * rebooking may still fail hard commitment buffers on an open case.
 */
import type { TripElement } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';
import type { ChainLinkState } from '../ui/case-view-model.ts';
import { isTransportLeg, selectRecoveryCommitment } from './chainProjection.ts';

export interface ChainPresentationContext {
  caseOpen: boolean;
  /** Trip remainder viability from read model (e.g. NOT_VIABLE). */
  tripNotViable?: boolean;
  /** At least one HARD constraint evaluation failed on the current snapshot. */
  hardConstraintFailed?: boolean;
  /** Engagement id for the recovery-relevant commitment, when known. */
  recoveryCommitmentId?: string;
  affectedElementIds: ReadonlySet<string>;
}

export function buildChainPresentationContext(input: {
  recoveryCase?: RecoveryCase;
  tripNotViable?: boolean;
  hardConstraintFailed?: boolean;
  recoveryCommitmentId?: string;
}): ChainPresentationContext {
  const caseOpen = Boolean(input.recoveryCase && input.recoveryCase.status !== 'RESOLVED');
  return {
    caseOpen,
    tripNotViable: input.tripNotViable,
    hardConstraintFailed: input.hardConstraintFailed,
    recoveryCommitmentId: input.recoveryCommitmentId,
    affectedElementIds: new Set(input.recoveryCase?.affectedElementIds ?? []),
  };
}

function tripRecoveryUnderThreat(ctx: ChainPresentationContext): boolean {
  return Boolean(ctx.caseOpen && (ctx.tripNotViable || ctx.hardConstraintFailed));
}

function isRecoveryCommitment(element: TripElement, ctx: ChainPresentationContext): boolean {
  return Boolean(ctx.recoveryCommitmentId && element.id === ctx.recoveryCommitmentId);
}

function isJourneyTransport(element: TripElement): boolean {
  return isTransportLeg(element);
}

/**
 * Derive chain link presentation state from reservation health, case blast
 * radius, and trip-level viability. Generic — no scenario branches.
 */
export function presentationLinkState(
  element: TripElement,
  ctx: ChainPresentationContext,
): ChainLinkState {
  const isAffected = ctx.affectedElementIds.has(element.id);
  const underThreat = tripRecoveryUnderThreat(ctx);

  if (element.elementKind === 'ENGAGEMENT') {
    if (element.status === 'INVALID') return 'BROKEN';
    if (element.status === 'AT_RISK' || isAffected) return 'AT_RISK';
    if (underThreat && isRecoveryCommitment(element, ctx)) return 'AT_RISK';
    return 'CONFIRMED';
  }

  if (element.status === 'INVALID') return 'BROKEN';
  if (element.status === 'AT_RISK') return 'AT_RISK';

  switch (element.reservationState) {
    case 'CANCELLED':
      return 'BROKEN';
    case 'NONE':
      return 'UNBOOKED';
    case 'UNKNOWN':
      return ctx.caseOpen && isAffected ? 'UNKNOWN' : 'CONFIRMED';
    case 'HELD':
      return ctx.caseOpen && isAffected ? 'PROPOSED' : 'AT_RISK';
    case 'CHANGED':
      if (ctx.caseOpen && (isAffected || underThreat) && isJourneyTransport(element)) return 'AT_RISK';
      return ctx.caseOpen && isAffected ? 'AT_RISK' : 'CONFIRMED';
    case 'CONFIRMED':
    case 'COMPLETED':
      if (ctx.caseOpen && underThreat && isJourneyTransport(element)) return 'AT_RISK';
      return ctx.caseOpen && isAffected ? 'AT_RISK' : 'CONFIRMED';
    default:
      return ctx.caseOpen && isAffected ? 'UNKNOWN' : 'CONFIRMED';
  }
}

export function recoveryCommitmentIdFor(
  trip: Pick<Trip, 'elements'>,
  recoveryCase?: RecoveryCase,
): string | undefined {
  return selectRecoveryCommitment(trip as Trip, recoveryCase)?.id;
}
