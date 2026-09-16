/**
 * M10 — the single definition of "the old system did not know this".
 *
 * Both the importer and the reconciler need to decide which legacy facts carry
 * unresolved external state. If each kept its own idea of that, reconciliation
 * would eventually bless an import that quietly resolved an unknown, which is
 * precisely the failure this module exists to prevent. The importer uses these
 * predicates to decide what to preserve; the reconciler uses the same
 * predicates to decide what it must find preserved.
 *
 * OFFLINE MIGRATION ONLY. Never reachable from normal app composition.
 */

import type { MigrationBundle } from './legacyExportBundle.ts';

/**
 * Legacy `ReservationState` values whose real-world outcome was unresolved.
 *
 * `CHANGED` means the supplier moved the booking and the legacy runtime never
 * reconciled the new state. `UNKNOWN` is the legacy model's own admission of
 * ignorance. Both must reach the target as UNKNOWN: CONFIRMED and CANCELLED
 * would each assert something never observed.
 *
 * `NONE` is deliberately absent — it means "never booked", which is a known
 * fact, not an uncertain one.
 */
export const UNCERTAIN_RESERVATION_STATES: ReadonlySet<string> = new Set(['CHANGED', 'UNKNOWN']);

/**
 * Legacy provider-inbox statuses that represent a *settled* outcome. Anything
 * else — including an absent status — means the delivery's effect on the world
 * was never established.
 */
export const SETTLED_PROVIDER_STATUSES: ReadonlySet<string> = new Set(['PROCESSED', 'IGNORED', 'FAILED']);

export function isUncertainReservationState(state: string | undefined): boolean {
  return state !== undefined && UNCERTAIN_RESERVATION_STATES.has(state);
}

export function isSettledProviderStatus(status: string | undefined): boolean {
  return status !== undefined && SETTLED_PROVIDER_STATUSES.has(status);
}

export type UncertainFactKind = 'RESERVATION_OUTCOME' | 'PROVIDER_DELIVERY_OUTCOME';

export interface UncertainSourceFact {
  kind: UncertainFactKind;
  /** `sourceType/sourceId` of the record that carries the fact — the key exceptions are filed under. */
  recordKey: string;
  sourceType: string;
  sourceId: string;
  /** Unique within a bundle; an element-level fact is narrower than its record. */
  factId: string;
  /** The legacy value that makes this uncertain, for the report. */
  legacyValue: string;
  detail: string;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Every fact in the bundle that represents unresolved external state.
 *
 * Read from the *source* bundle rather than from target rows on purpose: the
 * reconciler's job is to prove the target accounts for what the source knew it
 * did not know, and only the source can say what that was.
 */
export function collectUncertainSourceFacts(bundle: MigrationBundle): UncertainSourceFact[] {
  const facts: UncertainSourceFact[] = [];

  for (const category of bundle.categories) {
    for (const record of category.records) {
      const payload = asObject(record.payload);
      if (payload === undefined) continue;
      const recordKey = `${record.sourceType}/${record.sourceId}`;

      // Trip elements carry the reservation state, so uncertainty here is
      // element-level even though the exported record is the trip.
      const elements = Array.isArray(payload.elements) ? payload.elements : [];
      for (const raw of elements) {
        const element = asObject(raw);
        if (element === undefined) continue;
        const state = str(element.reservationState);
        if (!isUncertainReservationState(state)) continue;
        const elementId = str(element.id) ?? '(unidentified element)';
        facts.push({
          kind: 'RESERVATION_OUTCOME',
          recordKey,
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          factId: `${recordKey}#${elementId}`,
          legacyValue: state ?? 'UNRECORDED',
          detail:
            `legacy element ${elementId} on ${recordKey} stood at ${state}; its real supplier state was ` +
            'never reconciled',
        });
      }

      // Provider deliveries the legacy inbox never finished processing.
      if (payload.providerEventId !== undefined || payload.processedStatus !== undefined) {
        const status = str(payload.processedStatus);
        if (!isSettledProviderStatus(status)) {
          facts.push({
            kind: 'PROVIDER_DELIVERY_OUTCOME',
            recordKey,
            sourceType: record.sourceType,
            sourceId: record.sourceId,
            factId: recordKey,
            legacyValue: status ?? 'UNRECORDED',
            detail:
              `provider delivery ${recordKey} was never observed to finish processing ` +
              `(${status ?? 'UNRECORDED'})`,
          });
        }
      }
    }
  }

  return facts;
}
