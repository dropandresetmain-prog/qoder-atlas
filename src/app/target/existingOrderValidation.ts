/**
 * R4-F2e (review N3) — is an EXISTING provider order provably the order the current approved intent
 * means?
 *
 * Atlas duplicate detection (order.do status 318) only says "an order for the same passenger +
 * flight already exists". That pointer is not proof the existing order belongs to this intent, this
 * traveller party, this itinerary or this price. Before any consequential step (pay / adopt) the
 * dispatcher retrieves the order READ-ONLY and runs it through `validateExistingOrder`, which
 * compares everything the provider exposes against the terms persisted with the approved intent:
 *
 *   order state · passengers (count, legal names, gender, DOB/nationality where exposed) ·
 *   booking contact e-mail · itinerary (origin, destination, departure and arrival INSTANTS,
 *   via the airport time zones) · currency · amount within the authority-frozen ceiling.
 *
 * Atlas does not echo a merchant/client reference (see atlas-create-idempotency-decision.md), so a
 * client-reference match is impossible; identity is proven from the facts above or not at all.
 *
 * Verdicts: MATCH (safe to adopt) · MISMATCH (provably not this intent's order: never pay, never
 * adopt) · INSUFFICIENT (cannot be proven either way: fail closed to reconciliation / a human).
 * Pure function, no I/O; reasons are structured codes (no passenger data).
 */
import type { FlightOrderStatusView } from '../../contracts/capabilities.ts';
import type { Money } from '../../domain/common.ts';
import { atlasScheduleToIso } from '../../providers/atlas/normalize.ts';

export interface ExpectedOrderTerms {
  passengers: Array<{ givenName: string; familyName: string; gender: 'MALE' | 'FEMALE'; dateOfBirth?: string; nationality?: string }>;
  contactEmail: string;
  origin: { code: string; timeZone: string };
  destination: { code: string; timeZone: string };
  /** Approved itinerary instants (ISO); null means the binding cannot support an itinerary proof. */
  departure: string | null;
  arrival: string | null;
  /** Authority-frozen payment ceiling. */
  ceiling: Money;
  /** Price quoted at research (currency must agree). */
  quoted: Money;
}

export type ExistingOrderVerdict =
  | { verdict: 'MATCH'; orderStatus: 'HELD' | 'PAID' | 'TICKETING' | 'TICKETED' }
  | { verdict: 'MISMATCH'; reasons: string[] }
  | { verdict: 'INSUFFICIENT'; reasons: string[] };

const norm = (value: string): string => value.normalize('NFKD').replace(/[^A-Za-z]/g, '').toUpperCase();

export function validateExistingOrder(view: FlightOrderStatusView, expected: ExpectedOrderTerms): ExistingOrderVerdict {
  const mismatch: string[] = [];
  const insufficient: string[] = [];

  // State.
  if (view.status === 'CANCELLED' || view.status === 'FAILED') mismatch.push('order_state_unusable');
  else if (view.status === 'UNKNOWN') insufficient.push('order_state_unknown');

  // Price.
  if (!view.totalPrice) insufficient.push('price_not_exposed');
  else {
    if (view.totalPrice.currency !== expected.ceiling.currency || view.totalPrice.currency !== expected.quoted.currency) mismatch.push('price_currency_mismatch');
    else if (view.totalPrice.amount > expected.ceiling.amount) mismatch.push('price_exceeds_authorised_ceiling');
  }

  const identity = view.identity;
  if (!identity) {
    insufficient.push('identity_not_exposed');
  } else {
    // Passengers: same party, exactly (multiset of legal names), gender/DOB/nationality where both sides speak.
    if (identity.passengers.length !== expected.passengers.length) mismatch.push('passenger_count_mismatch');
    else {
      const pool = [...identity.passengers];
      for (const want of expected.passengers) {
        const at = pool.findIndex((have) => norm(have.familyName) === norm(want.familyName) && norm(have.givenName) === norm(want.givenName));
        if (at < 0) { mismatch.push('passenger_mismatch'); continue; }
        const have = pool.splice(at, 1)[0]!;
        if (!have.gender) insufficient.push('passenger_gender_not_exposed');
        else if (have.gender !== want.gender) mismatch.push('passenger_gender_mismatch');
        if (have.dateOfBirth && want.dateOfBirth && have.dateOfBirth !== want.dateOfBirth) mismatch.push('passenger_birth_date_mismatch');
        if (have.nationality && want.nationality && have.nationality.toUpperCase() !== want.nationality.toUpperCase()) mismatch.push('passenger_nationality_mismatch');
      }
    }
    // Booking contact.
    if (!identity.contactEmails || identity.contactEmails.length === 0) insufficient.push('contact_not_exposed');
    else if (!identity.contactEmails.some((e) => e.trim().toLowerCase() === expected.contactEmail.trim().toLowerCase())) mismatch.push('contact_mismatch');

    // Itinerary.
    const first = identity.segments[0];
    const last = identity.segments[identity.segments.length - 1];
    if (!first || !last) insufficient.push('itinerary_not_exposed');
    else {
      if (first.originCode.toUpperCase() !== expected.origin.code.toUpperCase()) mismatch.push('origin_mismatch');
      if (last.destinationCode.toUpperCase() !== expected.destination.code.toUpperCase()) mismatch.push('destination_mismatch');
      if (!expected.departure || !expected.arrival) insufficient.push('approved_itinerary_times_missing');
      else {
        try {
          const dep = Date.parse(atlasScheduleToIso(first.departureLocal, expected.origin.timeZone));
          const arr = Date.parse(atlasScheduleToIso(last.arrivalLocal, expected.destination.timeZone));
          if (dep !== Date.parse(expected.departure)) mismatch.push('departure_time_mismatch');
          if (arr !== Date.parse(expected.arrival)) mismatch.push('arrival_time_mismatch');
        } catch {
          insufficient.push('itinerary_time_unparseable');
        }
      }
    }
  }

  if (mismatch.length > 0) return { verdict: 'MISMATCH', reasons: [...new Set(mismatch)] };
  if (insufficient.length > 0) return { verdict: 'INSUFFICIENT', reasons: [...new Set(insufficient)] };
  return { verdict: 'MATCH', orderStatus: view.status as 'HELD' | 'PAID' | 'TICKETING' | 'TICKETED' };
}
