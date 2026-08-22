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
