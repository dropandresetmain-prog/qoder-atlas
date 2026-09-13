/**
 * NORTHSTAR v2 — shared time semantics.
 *
 * DATA_STRUCTURE_LOGICAL_SCHEMA.md §1: instants use `timestamptz`; date-only
 * document validity remains `date`; local schedules keep an explicit IANA
 * timezone; intervals are half-open and validated start < end. Never
 * silently convert a local-midnight validity rule into a UTC instant.
 */
import { z } from 'zod';

/** An instant with explicit UTC offset — never a naive/ambiguous timestamp. */
export const InstantSchema = z.iso.datetime({ offset: true });
export type Instant = z.infer<typeof InstantSchema>;

/** A calendar date with no time-of-day component (e.g. date of birth, document validity). */
export const LocalDateSchema = z.iso.date();
export type LocalDate = z.infer<typeof LocalDateSchema>;

export const IanaTimeZoneSchema = z.string().regex(/^[A-Za-z0-9_+-]+\/[A-Za-z0-9_+-/]+$|^UTC$/);
export type IanaTimeZone = z.infer<typeof IanaTimeZoneSchema>;

/** A local wall-clock instant paired with its owning IANA zone. */
export const ZonedInstantSchema = z.strictObject({
  localDateTime: z.string(), // ISO local datetime without offset, e.g. 2026-09-13T09:00:00
  timeZone: IanaTimeZoneSchema,
});
export type ZonedInstant = z.infer<typeof ZonedInstantSchema>;

function instantMillis(iso: Instant): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`invalid Instant: ${iso}`);
  return t;
}

export function compareInstants(a: Instant, b: Instant): -1 | 0 | 1 {
  const diff = instantMillis(a) - instantMillis(b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/** Half-open instant interval [start, end). Validated start < end. */
export const InstantIntervalSchema = z
  .strictObject({
    start: InstantSchema,
    end: InstantSchema,
  })
  .refine((v) => compareInstants(v.start, v.end) < 0, {
    message: 'interval start must be strictly before end',
  });
export type InstantInterval = z.infer<typeof InstantIntervalSchema>;

/** Half-open date interval, used for document/rule/publication effective ranges. */
export const DateIntervalSchema = z
  .strictObject({
    start: LocalDateSchema,
    end: LocalDateSchema.optional(),
  })
  .refine((v) => v.end === undefined || v.start < v.end, {
    message: 'date interval start must be strictly before end',
  });
export type DateInterval = z.infer<typeof DateIntervalSchema>;

export function instantWithin(instant: Instant, interval: InstantInterval): boolean {
  return compareInstants(instant, interval.start) >= 0 && compareInstants(instant, interval.end) < 0;
}
