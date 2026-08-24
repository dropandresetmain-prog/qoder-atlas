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
