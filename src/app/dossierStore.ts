/**
 * Mission 2 — application-owned booking dossiers (compose.ts integration seam).
 *
 * The frozen Traveller ontology carries a display name only — no structured
 * provider booking identity (given/family split, birth date, gender, contact).
 * Real provider booking therefore needs an APPLICATION-OWNED dossier per
 * traveller, persisted beside preferences in the same SQLite database and
 * validated on every read/write.
 *
 * Invariants this store exists to enforce:
 *  - Booking identity NEVER derives from LLM output: dossiers are seeded from
 *    operator/authoritative bundle data through the same generic seed path
 *    every other scenario fact uses, and re-validated on read.
 *  - No scenario-keyed lookup: the composed executor resolves dossiers PER
 *    INTENT via case -> trip -> travellers; this store only knows traveller
 *    ids, never scenario ids.
 *  - Absent dossier => the executor refuses consequential LIVE/RECORD booking
 *    (fail closed) and REPLAY keeps the historic simulation fallback.
 *
 * Like `preferenceStore.ts`, this is deliberately NOT part of the frozen
 * entity registry: booking dossiers are provider-facing identity data, not
 * authoritative graph entities, and the frozen contracts cannot express them.
 */
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { EntityIdSchema, type EntityId } from '../domain/common.ts';

const PassengerSchema = z.strictObject({
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']).optional(),
  nationality: z.string().optional(),
});

const ContactSchema = z.strictObject({
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
});

export const FlightBookingDossierRecordSchema = z.strictObject({
  travellerId: EntityIdSchema,
  passengers: z.array(PassengerSchema).min(1),
  contact: ContactSchema,
  /** Opaque pre-authorised payment handle (e.g. the provider sandbox balance). */
  paymentRef: z.string().min(1),
});
export type FlightBookingDossierRecord = z.infer<typeof FlightBookingDossierRecordSchema>;

export const HotelReplacementDossierRecordSchema = z.strictObject({
  travellerId: EntityIdSchema,
  guestNames: z.array(z.string().min(1)).min(1),
  paymentRef: z.string().optional(),
});
export type HotelReplacementDossierRecord = z.infer<typeof HotelReplacementDossierRecordSchema>;

/** Bundle wire shape for `booking-dossiers.json` inside a scenario directory. */
export const BookingDossierBundleSchema = z.strictObject({
  flight: z.array(FlightBookingDossierRecordSchema).default([]),
  hotel: z.array(HotelReplacementDossierRecordSchema).default([]),
});
export type BookingDossierBundle = z.infer<typeof BookingDossierBundleSchema>;

export interface BookingDossierStore {
  saveFlight(dossier: FlightBookingDossierRecord): Promise<void>;
  saveHotel(dossier: HotelReplacementDossierRecord): Promise<void>;
  flightFor(travellerId: EntityId): Promise<FlightBookingDossierRecord | undefined>;
  hotelFor(travellerId: EntityId): Promise<HotelReplacementDossierRecord | undefined>;
}

export class SqliteBookingDossierStore implements BookingDossierStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    // Application-owned table; the frozen persistence schema is untouched.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS booking_dossiers (
        traveller_id TEXT PRIMARY KEY,
        flight_data TEXT,
        hotel_data TEXT
      );
    `);
  }

  async saveFlight(dossier: FlightBookingDossierRecord): Promise<void> {
    const validated = FlightBookingDossierRecordSchema.parse(dossier);
    this.db
      .prepare(
        `INSERT INTO booking_dossiers (traveller_id, flight_data) VALUES (?, ?)
         ON CONFLICT(traveller_id) DO UPDATE SET flight_data = excluded.flight_data`,
      )
      .run(validated.travellerId, JSON.stringify(validated));
  }

  async saveHotel(dossier: HotelReplacementDossierRecord): Promise<void> {
    const validated = HotelReplacementDossierRecordSchema.parse(dossier);
    this.db
      .prepare(
        `INSERT INTO booking_dossiers (traveller_id, hotel_data) VALUES (?, ?)
         ON CONFLICT(traveller_id) DO UPDATE SET hotel_data = excluded.hotel_data`,
      )
      .run(validated.travellerId, JSON.stringify(validated));
  }

  async flightFor(travellerId: EntityId): Promise<FlightBookingDossierRecord | undefined> {
    const row = this.db
      .prepare('SELECT flight_data FROM booking_dossiers WHERE traveller_id = ?')
      .get(travellerId) as { flight_data: string | null } | undefined;
    if (!row?.flight_data) return undefined;
    return FlightBookingDossierRecordSchema.parse(JSON.parse(row.flight_data));
  }

  async hotelFor(travellerId: EntityId): Promise<HotelReplacementDossierRecord | undefined> {
    const row = this.db
      .prepare('SELECT hotel_data FROM booking_dossiers WHERE traveller_id = ?')
      .get(travellerId) as { hotel_data: string | null } | undefined;
    if (!row?.hotel_data) return undefined;
    return HotelReplacementDossierRecordSchema.parse(JSON.parse(row.hotel_data));
  }
}
