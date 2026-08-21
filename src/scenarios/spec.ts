/**
 * F3 — ScenarioSpec: the generic acceptance-scenario bundle contract.
 *
 * Both acceptance scenarios load through this ONE schema, composed entirely
 * of frozen F1/F2 contracts. There are no scenario-specific fields or entity
 * types here; a third scenario must also load without changing this file.
 */
import { z } from 'zod';
import {
  AnchorEventSchema,
  ConstraintSchema,
  EntityIdSchema,
  OrganisationSchema,
  PlaceSchema,
  PreferenceSchema,
  RuleSetSchema,
  SourceRecordSchema,
  TravellerSchema,
} from '../domain/index.ts';
import { TripSchema } from '../domain/trip.ts';
import { TripSignalSchema } from '../operational/signal.ts';
import { ImpactSeveritySchema } from '../operational/impact.ts';
import { ResolutionOutcomeSchema } from '../operational/case.ts';
import { AuthorityOutcomeSchema } from '../operational/intent.ts';
import { CapabilityOperationSchema } from '../operational/intent.ts';

export const ScenarioContextSchema = z.strictObject({
  sources: z.array(SourceRecordSchema).default([]),
  organisations: z.array(OrganisationSchema).default([]),
  travellers: z.array(TravellerSchema).default([]),
  /** Optional shared context; empty for trips without an anchor event. */
  anchorEvents: z.array(AnchorEventSchema).default([]),
  places: z.array(PlaceSchema).default([]),
  ruleSets: z.array(RuleSetSchema).default([]),
  preferences: z.array(PreferenceSchema).default([]),
});
export type ScenarioContext = z.infer<typeof ScenarioContextSchema>;

export const ScenarioDisruptionSchema = z.strictObject({
  signal: TripSignalSchema,
  /** Preferences expressed while reacting to the disruption. */
  postDisruptionPreferences: z.array(PreferenceSchema).default([]),
});
export type ScenarioDisruption = z.infer<typeof ScenarioDisruptionSchema>;

export const ScenarioExpectationsSchema = z.strictObject({
  impact: z.strictObject({
    severity: ImpactSeveritySchema,
    directFailureElementIds: z.array(EntityIdSchema).default([]),
    atRiskElementIds: z.array(EntityIdSchema).default([]),
    threatenedObjectiveIds: z.array(EntityIdSchema).default([]),
  }),
  authority: z.strictObject({
    expectedOutcome: AuthorityOutcomeSchema,
    approverDescription: z.string(),
  }),
  recovery: z.strictObject({
    expectedResolution: ResolutionOutcomeSchema,
    remainingLossObjectiveIds: z.array(EntityIdSchema).default([]),
    /** The primary recovery action the case should converge on. */
    actionOperation: CapabilityOperationSchema,
  }),
});
export type ScenarioExpectations = z.infer<typeof ScenarioExpectationsSchema>;

export const ScenarioSpecSchema = z.strictObject({
  scenarioId: z.string(),
  title: z.string(),
  /** Descriptive governance label only; behaviour comes from rules/roles. */
  operatorModel: z.string(),
  context: ScenarioContextSchema,
  trip: TripSchema,
  /** Pre-disruption constraint evaluations. */
  constraints: z.array(ConstraintSchema).default([]),
  disruption: ScenarioDisruptionSchema,
  expectations: ScenarioExpectationsSchema,
});
export type ScenarioSpec = z.infer<typeof ScenarioSpecSchema>;

/**
 * Generic referential-integrity validation. Every id referenced by the
 * scenario must exist inside the scenario bundle. Scenario-neutral: it knows
 * field shapes, never scenario content.
 */
export function validateScenarioReferences(spec: ScenarioSpec): string[] {
  const violations: string[] = [];
  const sourceIds = new Set(spec.context.sources.map((s) => s.id));
  const placeIds = new Set(spec.context.places.map((p) => p.id));
  const ruleSetIds = new Set(spec.context.ruleSets.map((r) => r.id));
  const elementIds = new Set(spec.trip.elements.map((e) => e.id));
  const objectiveIds = new Set(spec.trip.objectives.map((o) => o.id));
  const anchorEventIds = new Set(spec.context.anchorEvents.map((a) => a.id));
  const organisationIds = new Set(spec.context.organisations.map((o) => o.id));

  const checkSource = (what: string, id: string | undefined): void => {
    if (id !== undefined && !sourceIds.has(id)) violations.push(`${what}: unknown source ${id}`);
  };

  for (const source of spec.context.sources) checkSource(`source ${source.id} contentRef`, undefined);
  for (const traveller of spec.context.travellers) {
    checkSource(`traveller ${traveller.id} nationalityCodes`, traveller.nationalityCodes?.sourceId);
    checkSource(`traveller ${traveller.id} passports`, traveller.passports?.sourceId);
    for (const req of traveller.accessibilityRequirements) {
      checkSource(`accessibility ${req.id}`, req.sourceId);
    }
    for (const rsId of traveller.insuranceRuleSetIds) {
      if (!ruleSetIds.has(rsId)) violations.push(`traveller ${traveller.id}: unknown insurance rule set ${rsId}`);
    }
  }
  for (const anchor of spec.context.anchorEvents) {
    checkSource(`anchor event ${anchor.id} instructions`, anchor.instructions?.sourceId);
    for (const sid of anchor.sourceIds) checkSource(`anchor event ${anchor.id}`, sid);
    if (anchor.organiserOrganisationId && !organisationIds.has(anchor.organiserOrganisationId)) {
      violations.push(`anchor event ${anchor.id}: unknown organiser ${anchor.organiserOrganisationId}`);
    }
  }
  for (const ruleSet of spec.context.ruleSets) {
    checkSource(`rule set ${ruleSet.id}`, ruleSet.sourceId);
    for (const rule of ruleSet.rules) checkSource(`rule ${rule.id}`, rule.sourceId);
  }
  for (const preference of [...spec.context.preferences, ...spec.disruption.postDisruptionPreferences]) {
    checkSource(`preference ${preference.id}`, preference.sourceId);
  }
  for (const element of spec.trip.elements) {
    for (const rsId of element.governedByRuleSetIds) {
      if (!ruleSetIds.has(rsId)) violations.push(`element ${element.id}: unknown rule set ${rsId}`);
    }
    if (element.elementKind === 'TRANSPORT_LEG') {
      if (!placeIds.has(element.data.originPlaceId)) violations.push(`element ${element.id}: unknown origin place`);
      if (!placeIds.has(element.data.destinationPlaceId)) violations.push(`element ${element.id}: unknown destination place`);
      checkSource(`element ${element.id} departure`, element.data.scheduledDeparture?.sourceId);
      checkSource(`element ${element.id} arrival`, element.data.scheduledArrival?.sourceId);
    }
    if (element.elementKind === 'STAY') {
      if (!placeIds.has(element.data.placeId)) violations.push(`element ${element.id}: unknown stay place`);
      checkSource(`element ${element.id} checkIn`, element.data.checkIn.sourceId);
      checkSource(`element ${element.id} checkOut`, element.data.checkOut.sourceId);
      for (const rsId of element.data.policyRuleSetIds) {
        if (!ruleSetIds.has(rsId)) violations.push(`element ${element.id}: unknown policy rule set ${rsId}`);
      }
    }
    if (element.elementKind === 'ENGAGEMENT') {
      checkSource(`element ${element.id} startsAt`, element.data.startsAt.sourceId);
      if (element.data.anchorEventId && !anchorEventIds.has(element.data.anchorEventId)) {
        violations.push(`element ${element.id}: unknown anchor event ${element.data.anchorEventId}`);
      }
    }
  }
  for (const objective of spec.trip.objectives) {
    for (const elId of objective.linkedElementIds) {
      if (!elementIds.has(elId)) violations.push(`objective ${objective.id}: unknown element ${elId}`);
    }
    checkSource(`objective ${objective.id}`, objective.sourceId);
  }
  for (const rsId of spec.trip.governedByRuleSetIds) {
    if (!ruleSetIds.has(rsId)) violations.push(`trip: unknown rule set ${rsId}`);
  }
  for (const constraint of spec.constraints) {
    for (const ref of constraint.refs) {
      if (ref.entityType === 'TRIP_ELEMENT' && !elementIds.has(ref.id)) {
        violations.push(`constraint ${constraint.id}: unknown element ref ${ref.id}`);
      }
      if (ref.entityType === 'TRIP_OBJECTIVE' && !objectiveIds.has(ref.id)) {
        violations.push(`constraint ${constraint.id}: unknown objective ref ${ref.id}`);
      }
    }
    if (constraint.ruleSetId && !ruleSetIds.has(constraint.ruleSetId)) {
      violations.push(`constraint ${constraint.id}: unknown rule set ${constraint.ruleSetId}`);
    }
  }
  const signal = spec.disruption.signal;
  checkSource('disruption signal', signal.sourceId);
  if (signal.subjectRef?.entityType === 'TRIP_ELEMENT' && !elementIds.has(signal.subjectRef.id)) {
    violations.push(`disruption signal: unknown subject element ${signal.subjectRef.id}`);
  }
  for (const id of spec.expectations.impact.directFailureElementIds) {
    if (!elementIds.has(id)) violations.push(`expectations: unknown direct-failure element ${id}`);
  }
  for (const id of spec.expectations.impact.atRiskElementIds) {
    if (!elementIds.has(id)) violations.push(`expectations: unknown at-risk element ${id}`);
  }
  for (const id of spec.expectations.impact.threatenedObjectiveIds) {
    if (!objectiveIds.has(id)) violations.push(`expectations: unknown threatened objective ${id}`);
  }
  for (const id of spec.expectations.recovery.remainingLossObjectiveIds) {
    if (!objectiveIds.has(id)) violations.push(`expectations: unknown loss objective ${id}`);
  }
  return violations;
}
