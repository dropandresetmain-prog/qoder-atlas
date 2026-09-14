/**
 * NORTHSTAR M6 — effective Journey / Programme / Service projection types.
 *
 * Closure §6: "Effective itinerary selects applicable observation explicitly;
 * do not overwrite published with estimate." These are derived views, never
 * persisted as editable copies. Each projected value names its owner and basis
 * so a consumer can tell intent from supplier observation from programme truth.
 */
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';

/** Which owner's value was selected for an effective time. */
export type TimeBasis = 'ACTUAL' | 'ESTIMATED' | 'PUBLISHED' | 'PROGRAMME_SCHEDULE' | 'STANDALONE_APPOINTMENT' | 'SUPPLIER_INTERVAL' | 'INTENDED' | 'UNKNOWN';

export interface EffectiveInstant {
  value: Instant | null;
  basis: TimeBasis;
  /** The owning subject the value came from (service, programme item, journey item, reservation line). */
  source: TypedRef;
  evidenceId: string | null;
}

/** Supplier-side validity of what is booked, independent of whether the Journey still works. */
export interface BookingState {
  reservationRef: TypedRef;
  lineRef: TypedRef;
  reservationStatus: string;
  lineStatus: string;
  entitlementStatuses: string[];
  /** CONFIRMED line (and reservation not cancelled) on a service that is not observed cancelled. */
  bookingValid: 'VALID' | 'INVALID' | 'UNKNOWN';
  reasonCodes: string[];
}

export interface EffectiveItem {
  itemRef: TypedRef;
  journeyRef: TypedRef;
  travellerId: string;
  kind: 'TRANSPORT' | 'STAY' | 'ENGAGEMENT' | 'RESOURCE_USE';
  orderKey: string;
  active: boolean;
  start: EffectiveInstant;
  end: EffectiveInstant;
  /** Where the traveller is at start / end of the item (origin/destination for transport). */
  startPlaceId: string | null;
  endPlaceId: string | null;
  serviceRef: TypedRef | null;
  bookings: BookingState[];
  programmeItemRef: TypedRef | null;
  participationRef: TypedRef | null;
  programmeItemStatus: string | null;
  /** Intent vs supplier/programme disagreement worth surfacing (e.g. booked service differs from desired endpoints). */
  divergences: string[];
}

export interface EffectiveJourney {
  journeyRef: TypedRef;
  tripRef: TypedRef;
  travellerId: string;
  revision: number;
  lifecycleStatus: string;
  /** Active items ordered by effective start (ties: orderKey, then id). Items with UNKNOWN start keep orderKey position. */
  items: EffectiveItem[];
}

export interface EffectiveWorld {
  journeys: EffectiveJourney[];
}
