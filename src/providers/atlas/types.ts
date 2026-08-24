/**
 * C2 — Atlas sandbox/direct API raw response shapes (zod-validated views).
 *
 * Schemas model only the fields the normalizer consumes; unknown provider
 * fields pass through untouched in recordings. Provider status `0` denotes
 * success per capability probes; rule letter codes are unmapped provider
 * values handled conservatively by the normalizer.
 */
import { z } from 'zod';

export const AtlasSegmentSchema = z.object({
  carrier: z.string().optional(),
  operatingCarrier: z.string().optional(),
  flightNumber: z.string().optional(),
  depAirport: z.string(),
  arrAirport: z.string(),
  depTime: z.string(),
  arrTime: z.string(),
  duration: z.number().optional(),
  cabin: z.string().optional(),
  cabinClass: z.number().optional(),
  fareFamily: z.string().optional(),
  seatCount: z.number().optional(),
  segmentIndex: z.number().optional(),
});
export type AtlasSegment = z.infer<typeof AtlasSegmentSchema>;

export const AtlasRuleDetailSchema = z.object({
  amount: z.number().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  startMinute: z.number().optional(),
  endMinute: z.number().optional(),
});

export const AtlasChangeRuleSchema = z.object({
  changesFee: z.number().optional(),
  changesStatus: z.string().optional(),
  currency: z.string().optional(),
  revNoshow: z.string().optional(),
  revNoshowFee: z.number().optional(),
  ruleDetailList: z.array(AtlasRuleDetailSchema).optional(),
});
export type AtlasChangeRule = z.infer<typeof AtlasChangeRuleSchema>;

export const AtlasRefundRuleSchema = z.object({
  refundFee: z.number().optional(),
  refundStatus: z.string().optional(),
  refundMethod: z.string().nullable().optional(),
  currency: z.string().optional(),
  refNoshow: z.string().optional(),
  refNoshowFee: z.number().optional(),
  ruleDetailList: z.array(AtlasRuleDetailSchema).optional(),
});
export type AtlasRefundRule = z.infer<typeof AtlasRefundRuleSchema>;

export const AtlasBaggageElementSchema = z.object({
  baggagePiece: z.number().optional(),
  baggageWeight: z.number().optional(),
  baggageSize: z.string().optional(),
  baggageType: z.string().optional(),
  passengerType: z.number().optional(),
  segmentNo: z.number().optional(),
});
export type AtlasBaggageElement = z.infer<typeof AtlasBaggageElementSchema>;

export const AtlasRuleSchema = z.object({
  changesRules: z.array(AtlasChangeRuleSchema).optional(),
  refundRules: z.array(AtlasRefundRuleSchema).optional(),
  baggageElements: z.array(AtlasBaggageElementSchema).optional(),
  hasBaggage: z.number().optional(),
});
export type AtlasRule = z.infer<typeof AtlasRuleSchema>;

export const AtlasRoutingSchema = z.object({
  routingIdentifier: z.string().min(1),
  fid: z.string().optional(),
  currency: z.string().length(3),
  adultPrice: z.number().optional(),
  adultTax: z.number().optional(),
  childPrice: z.number().optional(),
  childTax: z.number().optional(),
  infantPrice: z.number().optional(),
  infantTax: z.number().optional(),
  expireTime: z.string().nullish(),
  refreshTime: z.string().nullish(),
  fromSegments: z.array(AtlasSegmentSchema).default([]),
  retSegments: z.array(AtlasSegmentSchema).default([]),
  riskSellout: z.boolean().optional(),
  rule: AtlasRuleSchema.optional(),
});
export type AtlasRouting = z.infer<typeof AtlasRoutingSchema>;

export const AtlasSearchBodySchema = z.object({
  status: z.number(),
  msg: z.string().nullable().optional(),
  routings: z.array(AtlasRoutingSchema).optional(),
});
export type AtlasSearchBody = z.infer<typeof AtlasSearchBodySchema>;

export const AtlasPriceChangeSchema = z.object({
  isPriceChange: z.boolean().optional(),
  newAdultPrice: z.number().optional(),
  newAdultTax: z.number().optional(),
  newChildPrice: z.number().optional(),
  newChildTax: z.number().optional(),
  newInfantPrice: z.number().optional(),
  newInfantTax: z.number().optional(),
  originalAdultPrice: z.number().optional(),
  originalAdultTax: z.number().optional(),
  originalChildPrice: z.number().optional(),
  originalChildTax: z.number().optional(),
  originalInfantPrice: z.number().optional(),
  originalInfantTax: z.number().optional(),
});
export type AtlasPriceChange = z.infer<typeof AtlasPriceChangeSchema>;

export const AtlasRequirementFieldSchema = z.object({
  required: z.boolean().optional(),
  type: z.string().optional(),
});

export const AtlasVerifyBodySchema = z.object({
  status: z.number(),
  msg: z.string().nullable().optional(),
  sessionId: z.string().optional(),
  maxSeats: z.number().optional(),
  priceChange: AtlasPriceChangeSchema.optional(),
  bookingRequirement: z
    .record(z.string(), z.record(z.string(), AtlasRequirementFieldSchema))
    .optional(),
  routing: AtlasRoutingSchema.optional(),
});
export type AtlasVerifyBody = z.infer<typeof AtlasVerifyBodySchema>;

// ---------------------------------------------------------------------------
// Transaction wire shapes (DR-2 / G3R-R1): order create/pay/query and the
// void (cancellation) lifecycle. Schemas model only the fields the
// normalizer consumes; statuses are provider-private numbers interpreted
// exclusively inside the Atlas adapter.
// ---------------------------------------------------------------------------

export const AtlasPaxTicketInfoSchema = z.object({
  passengerName: z.string().optional(),
  ticketNos: z.array(z.string()).optional(),
});
export type AtlasPaxTicketInfo = z.infer<typeof AtlasPaxTicketInfoSchema>;

/**
 * order.do response (held order creation).
 *
 * Wire reality: Atlas serializes absent fields as explicit JSON null (error
 * bodies null every payload field), so every field is nullable.
 */
export const AtlasOrderBodySchema = z.object({
  status: z.number(),
  msg: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  orderNo: z.string().nullable().optional(),
  pnrCode: z.string().nullable().optional(),
  totalPrice: z.number().nullable().optional(),
  totalTransactionFee: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  /** Payment/ticketing deadline for the held order, provider-local time. */
  tktLimitTime: z.string().nullable().optional(),
  paxTicketInfos: z.array(AtlasPaxTicketInfoSchema).nullable().optional(),
  /**
   * Returned with duplicate-detection status: the existing order(s).
   * Wire reality: observed BOTH as plain order-number strings and as objects
   * carrying orderNo, depending on the duplicate-detection response.
   */
  duplicateOrders: z
    .array(
      z.union([z.object({ orderNo: z.string().nullable().optional() }).catchall(z.unknown()), z.string()]),
    )
    .nullable()
    .optional(),
});
export type AtlasOrderBody = z.infer<typeof AtlasOrderBodySchema>;

/** pay.do response (absent fields arrive as explicit JSON null). */
export const AtlasPayBodySchema = z.object({
  status: z.number(),
  msg: z.string().nullable().optional(),
  orderNo: z.string().nullable().optional(),
  paymentMethod: z.number().nullable().optional(),
});
export type AtlasPayBody = z.infer<typeof AtlasPayBodySchema>;

/** queryOrderDetails.do response (order observation). */
export const AtlasOrderDetailsBodySchema = z.object({
  status: z.number(),
  msg: z.string().nullable().optional(),
  orderNo: z.string().nullable().optional(),
  /** Observed provider values: "0" held, "1" paid, "2" ticketed. */
  orderStatus: z.union([z.string(), z.number()]).nullable().optional(),
  ticketStatus: z.union([z.string(), z.number()]).nullable().optional(),
  totalPrice: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  payTime: z.string().nullable().optional(),
  tktLimitTime: z.string().nullable().optional(),
  pnrCode: z.string().nullable().optional(),
  paxTicketInfos: z.array(AtlasPaxTicketInfoSchema).nullable().optional(),
  airlineBookings: z
    .array(z.object({ airlinePnr: z.string().nullable().optional() }).catchall(z.unknown()))
    .nullable()
    .optional(),
});
export type AtlasOrderDetailsBody = z.infer<typeof AtlasOrderDetailsBodySchema>;

export const AtlasVoidFareAmountSchema = z.object({
  currency: z.string().nullable().optional(),
  originalFareAmount: z.number().nullable().optional(),
  estimatedRefundAmount: z.number().nullable().optional(),
});
export type AtlasVoidFareAmount = z.infer<typeof AtlasVoidFareAmountSchema>;

export const AtlasVoidWindowSchema = z.object({
  supportVoid: z.boolean().nullable().optional(),
  allowVoid: z.boolean().nullable().optional(),
  voidTimeAfterIssure: z.string().nullable().optional(),
  voidTimeBeforeDepature: z.string().nullable().optional(),
  sameDayDeadlineTime: z.string().nullable().optional(),
  sameDayTimezone: z.string().nullable().optional(),
});
export type AtlasVoidWindow = z.infer<typeof AtlasVoidWindowSchema>;

/** voidQuotation.do response (pre-action cancellation quote). */
export const AtlasVoidQuotationBodySchema = z.object({
  status: z.number(),
  msg: z.string().nullable().optional(),
  orderNo: z.string().nullable().optional(),
  isVoidable: z.boolean().nullable().optional(),
  voidOfferId: z.string().nullable().optional(),
  voidMethod: z.string().nullable().optional(),
  fastConfirmation: z.number().nullable().optional(),
  expectedConfirmationDate: z.string().nullable().optional(),
  expectedRefundDate: z.string().nullable().optional(),
  /**
   * Wire reality: observed as an array of ticket OBJECTS (not strings) on a
   * real voidQuotation.do response; the adapter never interprets it, so it is
   * accepted as opaque entries.
   */
  voidTickets: z.array(z.unknown()).nullable().optional(),
  voidFareAmount: AtlasVoidFareAmountSchema.nullable().optional(),
  serviceFee: z
    .object({ currency: z.string().nullable().optional(), transactionFee: z.number().nullable().optional() })
    .nullable()
    .optional(),
  voidWindow: AtlasVoidWindowSchema.nullable().optional(),
});
export type AtlasVoidQuotationBody = z.infer<typeof AtlasVoidQuotationBodySchema>;

/** void.do response (cancellation submission). */
export const AtlasVoidBodySchema = z.object({
  status: z.number(),
  msg: z.string().nullable().optional(),
  orderNo: z.string().nullable().optional(),
  voidCode: z.string().nullable().optional(),
  /** Provider-private processing state; mapped inside the adapter only. */
  voidStatus: z.number().nullable().optional(),
  cancelReason: z.string().nullable().optional(),
});
export type AtlasVoidBody = z.infer<typeof AtlasVoidBodySchema>;

export const AtlasVoidOrderEntrySchema = z.object({
  orderNo: z.string().nullable().optional(),
  voidCode: z.string().nullable().optional(),
  voidStatus: z.number().nullable().optional(),
  voidOfferId: z.string().nullable().optional(),
  voidMethod: z.string().nullable().optional(),
  cancelReason: z.string().nullable().optional(),
  expectedConfirmationDate: z.string().nullable().optional(),
  expectedRefundDate: z.string().nullable().optional(),
  voidFareAmount: AtlasVoidFareAmountSchema.nullable().optional(),
});
export type AtlasVoidOrderEntry = z.infer<typeof AtlasVoidOrderEntrySchema>;

/** queryVoidOrders.do response (cancellation status observation). */
export const AtlasVoidOrdersBodySchema = z.object({
  status: z.number(),
  msg: z.string().nullable().optional(),
  voidOrders: z.array(AtlasVoidOrderEntrySchema).nullable().optional(),
});
export type AtlasVoidOrdersBody = z.infer<typeof AtlasVoidOrdersBodySchema>;
