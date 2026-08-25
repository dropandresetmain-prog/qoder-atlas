/**
 * DR-3 — wire shape for an Atlas flight event delivered to our ingress.
 *
 * Atlas's own documentation gives no signature/HMAC for its outbound
 * webhook POSTs (see docs/reality-validation/WAVE3R_CAPABILITY_REALITY_REPORT.md
 * §5) and no published enum for `eventType`. What IS documented is the
 * incident/reconciliation read schema (`POST /event/getPageList.do`):
 * `eventId, orderNo, eventType, eventStatus, eventTime, createTime, airline,
 * depTime, pnr, paxName, paxEmail` plus optional
 * `confirmedResult/confirmedRemark/confirmTime/notified`. This schema
 * mirrors that record shape — the same shape a genuine webhook push or a
 * documented-shape simulated source event both present to the real
 * ingress endpoint.
 *
 * Atlas wire vocabulary lives ONLY in this file and eventNormalizer.ts —
 * never in generic application code.
 *
 * Reconciliation read: `AtlasIncidentListBodySchema` models the same
 * documented record shape returned by `POST /event/getPageList.do` — the
 * provider's own current-state surface used to reconcile an ASSERTED push
 * into CONNECTED provider truth (DR-3). Atlas's published incident shape
 * documents no arrival instant or flight number; those two optional fields
 * are a declared sandbox extension so a retimed schedule can be reconciled
 * completely. LIVE responses lacking them still parse; the normalizer then
 * simply carries no newArrival evidence.
 */
import { z } from 'zod';

export const AtlasFlightEventSchema = z.strictObject({
  eventId: z.string().min(1),
  orderNo: z.string().min(1),
  eventType: z.string().min(1),
  eventStatus: z.union([z.string(), z.number()]).optional(),
  eventTime: z.string().min(1),
  createTime: z.string().optional(),
  airline: z.string().optional(),
  depTime: z.string().optional(),
  pnr: z.string().optional(),
  paxName: z.string().optional(),
  paxEmail: z.string().optional(),
  confirmedResult: z.string().optional(),
  confirmedRemark: z.string().optional(),
  confirmTime: z.string().optional(),
  notified: z.boolean().optional(),
});
export type AtlasFlightEvent = z.infer<typeof AtlasFlightEventSchema>;

/**
 * One incident/reconciliation record from the documented read surface.
 * Non-strict on purpose: unknown provider fields pass through untouched in
 * recordings (same convention as types.ts wire bodies).
 */
export const AtlasIncidentRecordSchema = z.object({
  eventId: z.string().min(1),
  orderNo: z.string().min(1),
  eventType: z.string().min(1),
  eventStatus: z.union([z.string(), z.number()]).optional(),
  eventTime: z.string().min(1),
  createTime: z.string().optional(),
  airline: z.string().optional(),
  /** Current/new departure instant as published by the provider. */
  depTime: z.string().optional(),
  /** Declared sandbox extension (see header): current/new arrival instant. */
  arrTime: z.string().optional(),
  /** Declared sandbox extension (see header): affected flight number. */
  flightNo: z.string().optional(),
  pnr: z.string().optional(),
  paxName: z.string().optional(),
  paxEmail: z.string().optional(),
  confirmedResult: z.string().optional(),
  confirmedRemark: z.string().optional(),
  confirmTime: z.string().optional(),
  notified: z.boolean().optional(),
});
export type AtlasIncidentRecord = z.infer<typeof AtlasIncidentRecordSchema>;

/** `POST /event/getPageList.do` response envelope (provider status 0 = success). */
export const AtlasIncidentListBodySchema = z.object({
  status: z.number(),
  msg: z.string().nullable().optional(),
  data: z.array(AtlasIncidentRecordSchema).nullable().optional(),
});
export type AtlasIncidentListBody = z.infer<typeof AtlasIncidentListBodySchema>;
