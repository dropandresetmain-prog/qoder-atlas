/**
 * M6 L4 — encounters, m6.credentials, m6.entry, m6.information (pure).
 * docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md §2 L4.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld, effectiveOf, id } from './support/m6World.ts';
import type {
  WCoverage, WCredential, WCredentialSelection, WCredentialVersion,
  WInformationVersion, WJourney, WJourneyItem, WRuleAssignment, WRuleSetVersion,
} from '../src/resolution/world/world.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import type { RuleExpression } from '../src/domain/v2/knowledge/information.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import { credentialsEvaluator } from '../src/resolution/evaluation/evaluators/credentials.ts';
import { coverageFor, entryEvaluator } from '../src/resolution/evaluation/evaluators/entry.ts';
import { informationEvaluator } from '../src/resolution/evaluation/evaluators/information.ts';
import { deriveEncounters, kleeneAll, kleeneAny, kleeneNot, type Encounter } from '../src/resolution/evaluation/encounters.ts';
import { evaluateRuleExpression, type PredicateContext } from '../src/resolution/evaluation/entryPredicates.ts';

const NOW = '2030-01-01T00:00:00.000Z';

function subjectOf(journeyId: string): TypedRef {
  return { kind: 'JOURNEY', id: journeyId };
}

function window(start: string, end: string) {
  return { start, end };
}

function journeyRow(journeyId: string, travellerId: string, over: Partial<WJourney> = {}): WJourney {
  return { id: journeyId, revision: 1, tripId: over.tripId ?? id(), travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null, ...over };
}

function transportItem(journeyId: string, over: Partial<WJourneyItem> = {}): WJourneyItem {
  return {
    id: id(), journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'PLANNED', flexible: false, intendedWindow: null,
    desiredOriginPlaceId: 'place-a', desiredDestinationPlaceId: 'place-b', selectedServiceId: null, intendedPlaceId: null, requiredNights: null,
    participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null, ...over,
  };
}

function visitRow(journeyId: string, jurisdictionId: string, over: Partial<{ purpose: string; intended: { start: string; end: string }; transitIntent: boolean; id: string }> = {}) {
  return {
    id: over.id ?? id(), journeyId, jurisdictionId, purpose: over.purpose ?? 'tourism',
    intended: over.intended ?? window('2030-02-01T00:00:00.000Z', '2030-02-10T00:00:00.000Z'),
    transitIntent: over.transitIntent ?? false,
  };
}

function passportCredential(travellerId: string, over: Partial<WCredentialVersion> = {}): { credential: WCredential; version: WCredentialVersion } {
  const credentialId = id();
  const versionId = id();
  const credential: WCredential = { id: credentialId, travellerId, kind: 'PASSPORT', issuerCountry: 'issuer-country', currentVersionId: versionId };
  const version: WCredentialVersion = {
    id: versionId, credentialId, kind: 'PASSPORT', editionNumber: 1, issueDate: '2025-01-01', expiryDate: '2035-01-01',
    issuerStatus: 'VALID', physicallyAvailable: true, evidenceId: id(), issuingStateCode: 'issuer-state', visaClass: null,
    permittedActivities: [], entriesAllowed: null, permittedStayDays: null, ...over,
  };
  return { credential, version };
}

function visaCredential(travellerId: string, over: Partial<WCredentialVersion> = {}): { credential: WCredential; version: WCredentialVersion } {
  const credentialId = id();
  const versionId = id();
  const credential: WCredential = { id: credentialId, travellerId, kind: 'VISA', issuerCountry: 'issuer-country', currentVersionId: versionId };
  const version: WCredentialVersion = {
    id: versionId, credentialId, kind: 'VISA', editionNumber: 1, issueDate: '2030-01-01', expiryDate: '2035-01-01',
    issuerStatus: 'VALID', physicallyAvailable: true, evidenceId: id(), issuingStateCode: 'issuer-state', visaClass: null,
    permittedActivities: [], entriesAllowed: null, permittedStayDays: null, ...over,
  };
  return { credential, version };
}

function selectionRow(journeyId: string, credentialId: string, credentialVersionId: string, visitIds: string[]): WCredentialSelection {
  return { id: id(), journeyId, credentialId, credentialVersionId, intendedVisitIds: visitIds };
}

function predicateExpr(predicateId: string, parameters: Record<string, unknown> = {}): RuleExpression {
  return { operator: 'PREDICATE', predicateId, parameters };
}
function allExpr(...operands: RuleExpression[]): RuleExpression {
  return { operator: 'ALL', operands };
}
function anyExpr(...operands: RuleExpression[]): RuleExpression {
  return { operator: 'ANY', operands };
}
function notExpr(operand: RuleExpression): RuleExpression {
  return { operator: 'NOT', operand };
}

function ruleSetVersionRow(ruleSetId: string, policyFamily: string, expression: RuleExpression, over: Partial<WRuleSetVersion> = {}): WRuleSetVersion {
  return {
    id: id(), ruleSetId, revision: 1, policyFamily, issuer: { kind: 'ORGANISATION', id: 'issuer-org' }, editionNumber: 1,
    status: 'PUBLISHED', effective: { start: null, end: null }, expression, rules: [], ...over,
  };
}

function ruleAssignmentRow(ruleSetId: string, over: Partial<WRuleAssignment> = {}): WRuleAssignment {
  return {
    id: id(), ruleSetId, ruleSetVersionId: null, selectCurrentEdition: true, organisationId: null, subject: null,
    jurisdictionId: null, populationPredicateId: null, valid: { start: '2020-01-01T00:00:00.000Z', end: null }, ...over,
  };
}

const WIDE_OPEN = window('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z');

function scopeRow(over: Partial<WInformationVersion['scopes'][number]> = {}): WInformationVersion['scopes'][number] {
  return { id: id(), jurisdictionId: null, areaVersionId: null, subject: null, purpose: null, serviceCategory: null, populationPredicateId: null, exposure: WIDE_OPEN, ...over };
}

function informationVersionRow(recordId: string, subtype: WInformationVersion['subtype'], scopes: WInformationVersion['scopes'], over: Partial<WInformationVersion> = {}): WInformationVersion {
  return {
    id: id(), recordId, revision: 1, topic: subtype === 'REGULATORY' ? 'ENTRY_REQUIREMENT' : 'ADVISORY', publisherOrganisationId: null,
    subtype, sequence: 1, issuedAt: NOW, observedAt: NOW, effective: { start: null, end: null }, evidenceId: id(),
    supersedesId: null, retractsId: null, sourceNativeSeverity: null, riskTopics: [], conditionType: null,
    regulatoryRuleSetVersionId: null, regulatoryJurisdictionId: null, scopes, ...over,
  };
}

function responseEdition(ruleSeverity: string, matchSeverities: string[], over: Partial<WRuleSetVersion> = {}): WRuleSetVersion {
  return ruleSetVersionRow(id(), 'advisory_response', predicateExpr('journey.purpose_in', { purposes: ['unused'] }), {
    rules: [{ id: id(), ruleKey: 'severity-rule', severity: ruleSeverity, expression: predicateExpr('advisory.source_severity_in', { severities: matchSeverities }) }],
    ...over,
  });
}

function coverageRow(topic: string, jurisdictionId: string, over: Partial<WCoverage> = {}): WCoverage {
  return { id: id(), topic, queryBounds: { jurisdictionId }, edition: 'edition-1', watermark: null, completeness: 'COMPLETE', limitations: [], expiresAt: null, evidenceId: null, ...over };
}

function baseEncounter(over: Partial<Encounter> = {}): Encounter {
  return {
    id: 'enc', kind: 'ENTRY', origin: 'INTENDED_VISIT', jurisdictionId: 'jurisdiction-a', at: '2030-02-01T00:00:00.000Z',
    exit: '2030-02-10T00:00:00.000Z', purpose: 'tourism', stayDays: 9, visitId: 'visit-1', selections: [], airsideFactsKnown: false,
    placeId: null, arrivingItemId: null, departingItemId: null, ...over,
  };
}

function ctxWith(world: ReturnType<typeof emptyWorld>, journeyId: string, travellerId: string, encounter: Encounter): PredicateContext {
  return { world, now: NOW, journeyId, travellerId, encounter };
}

// ==========================================================================
// Encounters
// ==========================================================================

test('encounters: an intended visit derives an ENTRY encounter with stayDays; transitIntent derives TRANSIT', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { intended: window('2030-02-01T00:00:00.000Z', '2030-02-04T00:00:00.000Z') });
  world.intendedVisits.push(visit);
  const projected = effectiveOf(world).journeys.find((j) => j.journeyRef.id === journeyId)!;
  const encounters = deriveEncounters(world, projected);
  assert.equal(encounters.length, 1);
  assert.equal(encounters[0]?.kind, 'ENTRY');
  assert.equal(encounters[0]?.stayDays, 3);
  assert.equal(encounters[0]?.jurisdictionId, 'jurisdiction-a');

  const transitVisit = visitRow(journeyId, 'jurisdiction-b', { transitIntent: true });
  world.intendedVisits.push(transitVisit);
  const projected2 = effectiveOf(world).journeys.find((j) => j.journeyRef.id === journeyId)!;
  const withTransit = deriveEncounters(world, projected2).find((e) => e.jurisdictionId === 'jurisdiction-b');
  assert.equal(withTransit?.kind, 'TRANSIT');
});

test('encounters: consecutive transport items through an uncovered jurisdiction derive a TRANSIT encounter with unknown airside facts and no selections', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-origin', desiredDestinationPlaceId: 'place-hub', intendedWindow: window('2030-02-01T08:00:00.000Z', '2030-02-01T10:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-hub', desiredDestinationPlaceId: 'place-dest', intendedWindow: window('2030-02-01T11:00:00.000Z', '2030-02-01T14:00:00.000Z') });
  world.journeyItems.push(a, b);
  world.placeJurisdictions.push({ placeId: 'place-hub', jurisdictionId: 'jurisdiction-hub', basis: 'AREA_MEMBERSHIP', areaVersionId: 'area-1', evidenceId: null });
  const projected = effectiveOf(world).journeys.find((j) => j.journeyRef.id === journeyId)!;
  const encounters = deriveEncounters(world, projected);
  const transit = encounters.find((e) => e.origin === 'DERIVED_TRANSIT');
  assert.ok(transit, 'a derived transit encounter must exist for the uncovered hub jurisdiction');
  assert.equal(transit?.kind, 'TRANSIT');
  assert.equal(transit?.jurisdictionId, 'jurisdiction-hub');
  assert.equal(transit?.airsideFactsKnown, false);
  assert.deepEqual(transit?.selections, []);
});

test('encounters/entry: an unresolved connection-place jurisdiction UNKNOWNs encounter_jurisdiction_unresolved, never PASS', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const a = transportItem(journeyId, { orderKey: '010', desiredOriginPlaceId: 'place-origin', desiredDestinationPlaceId: 'place-unresolved', intendedWindow: window('2030-02-01T08:00:00.000Z', '2030-02-01T10:00:00.000Z') });
  const b = transportItem(journeyId, { orderKey: '020', desiredOriginPlaceId: 'place-unresolved', desiredDestinationPlaceId: 'place-dest', intendedWindow: window('2030-02-01T11:00:00.000Z', '2030-02-01T14:00:00.000Z') });
  world.journeyItems.push(a, b);
  const effective = effectiveOf(world);
  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective });
  const transit = out.dimensions.find((d) => d.dimension === 'transit_feasibility');
  assert.equal(transit?.verdict, 'UNKNOWN');
  assert.equal(transit?.explanations[0]?.reasonCode, 'encounter_jurisdiction_unresolved');
});

// ==========================================================================
// m6.credentials
// ==========================================================================

test('credentials: a visit without a selection UNKNOWNs credential_selection_missing', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.ok(dim?.explanations.some((e) => e.reasonCode === 'credential_selection_missing'));
});

test('credentials: a selected credential not owned by the traveller FAILs credential_not_travellers', () => {
  const journeyId = id();
  const travellerId = id();
  const otherTraveller = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a');
  world.intendedVisits.push(visit);
  const { credential, version } = passportCredential(otherTraveller);
  world.credentials.push(credential);
  world.credentialVersions.push(version);
  world.credentialSelections.push(selectionRow(journeyId, credential.id, version.id, [visit.id]));
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.ok(dim?.explanations.some((e) => e.status === 'FAIL' && e.reasonCode === 'credential_not_travellers'));
});

test('credentials: a selected version belonging to a different credential FAILs version_mismatch', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a');
  world.intendedVisits.push(visit);
  const { credential, version } = passportCredential(travellerId);
  const mismatchedVersion: WCredentialVersion = { ...version, id: id(), credentialId: id() };
  world.credentials.push(credential);
  world.credentialVersions.push(mismatchedVersion);
  world.credentialSelections.push(selectionRow(journeyId, credential.id, mismatchedVersion.id, [visit.id]));
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.ok(dim?.explanations.some((e) => e.status === 'FAIL' && e.reasonCode === 'version_mismatch'));
});

test('credentials: a passport must be available to present, with missing possession evidence UNKNOWN', () => {
  for (const physicallyAvailable of [true, false, null] as const) {
    const journeyId = id();
    const travellerId = id();
    const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
    const visit = visitRow(journeyId, 'jurisdiction-a');
    const { credential, version } = passportCredential(travellerId, { physicallyAvailable });
    world.intendedVisits.push(visit);
    world.credentials.push(credential);
    world.credentialVersions.push(version);
    world.credentialSelections.push(selectionRow(journeyId, credential.id, version.id, [visit.id]));
    const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
    const dim = out.dimensions[0];
    assert.equal(dim?.verdict, physicallyAvailable === true ? 'PASS' : physicallyAvailable === false ? 'FAIL' : 'UNKNOWN');
    if (physicallyAvailable !== true) {
      assert.ok(dim?.explanations.some((e) => e.reasonCode === (physicallyAvailable === false ? 'passport_not_available' : 'passport_availability_unknown')));
      assert.ok(!dim?.explanations.some((e) => e.reasonCode === 'credential_valid_for_visit'));
    }
  }
});

test('credentials: a REVOKED credential FAILs credential_not_valid', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a');
  world.intendedVisits.push(visit);
  const { credential, version } = passportCredential(travellerId, { issuerStatus: 'REVOKED' });
  world.credentials.push(credential);
  world.credentialVersions.push(version);
  world.credentialSelections.push(selectionRow(journeyId, credential.id, version.id, [visit.id]));
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.ok(dim?.explanations.some((e) => e.status === 'FAIL' && e.reasonCode === 'credential_not_valid'));
});

test('credentials: a passport expiring before the visit ends FAILs credential_expires_during_visit', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { intended: window('2030-02-01T00:00:00.000Z', '2030-02-10T00:00:00.000Z') });
  world.intendedVisits.push(visit);
  const { credential, version } = passportCredential(travellerId, { expiryDate: '2030-01-15' });
  world.credentials.push(credential);
  world.credentialVersions.push(version);
  world.credentialSelections.push(selectionRow(journeyId, credential.id, version.id, [visit.id]));
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.ok(dim?.explanations.some((e) => e.status === 'FAIL' && e.reasonCode === 'credential_expires_during_visit'));
});

test('credentials: no expiry date UNKNOWNs credential_expiry_unknown (never PASS by absence)', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a');
  world.intendedVisits.push(visit);
  const { credential, version } = passportCredential(travellerId, { expiryDate: null });
  world.credentials.push(credential);
  world.credentialVersions.push(version);
  world.credentialSelections.push(selectionRow(journeyId, credential.id, version.id, [visit.id]));
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.ok(dim?.explanations.some((e) => e.reasonCode === 'credential_expiry_unknown'));
});

test('credentials: two selected passports for one visit FAILs ambiguous_identity_document', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a');
  world.intendedVisits.push(visit);
  const first = passportCredential(travellerId);
  const second = passportCredential(travellerId);
  world.credentials.push(first.credential, second.credential);
  world.credentialVersions.push(first.version, second.version);
  world.credentialSelections.push(
    selectionRow(journeyId, first.credential.id, first.version.id, [visit.id]),
    selectionRow(journeyId, second.credential.id, second.version.id, [visit.id]),
  );
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.ok(dim?.explanations.some((e) => e.status === 'FAIL' && e.reasonCode === 'ambiguous_identity_document'));
});

test('credentials: the same jurisdiction visited twice with different selected passports FAILs inconsistent_passport_across_encounters', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit1 = visitRow(journeyId, 'jurisdiction-a', { intended: window('2030-02-01T00:00:00.000Z', '2030-02-05T00:00:00.000Z') });
  const visit2 = visitRow(journeyId, 'jurisdiction-a', { intended: window('2030-03-01T00:00:00.000Z', '2030-03-05T00:00:00.000Z') });
  world.intendedVisits.push(visit1, visit2);
  const first = passportCredential(travellerId);
  const second = passportCredential(travellerId);
  world.credentials.push(first.credential, second.credential);
  world.credentialVersions.push(first.version, second.version);
  world.credentialSelections.push(
    selectionRow(journeyId, first.credential.id, first.version.id, [visit1.id]),
    selectionRow(journeyId, second.credential.id, second.version.id, [visit2.id]),
  );
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.ok(dim?.explanations.some((e) => e.status === 'FAIL' && e.reasonCode === 'inconsistent_passport_across_encounters'));
});

test('credentials: a visa not linked to the selected passport FAILs visa_not_linked_to_selected_passport', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a');
  world.intendedVisits.push(visit);
  const passport = passportCredential(travellerId);
  const visa = visaCredential(travellerId);
  world.credentials.push(passport.credential, visa.credential);
  world.credentialVersions.push(passport.version, visa.version);
  world.credentialSelections.push(
    selectionRow(journeyId, passport.credential.id, passport.version.id, [visit.id]),
    selectionRow(journeyId, visa.credential.id, visa.version.id, [visit.id]),
  );
  // No WCredentialLink row at all -> the visa cannot be linked to the passport.
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.ok(dim?.explanations.some((e) => e.status === 'FAIL' && e.reasonCode === 'visa_not_linked_to_selected_passport'));
});

test('credentials: a valid passport with a properly linked valid visa PASSes', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { intended: window('2030-02-01T00:00:00.000Z', '2030-02-10T00:00:00.000Z') });
  world.intendedVisits.push(visit);
  const passport = passportCredential(travellerId);
  const visa = visaCredential(travellerId);
  world.credentials.push(passport.credential, visa.credential);
  world.credentialVersions.push(passport.version, visa.version);
  world.credentialLinks.push({ credentialId: visa.credential.id, relatedCredentialId: passport.credential.id, travellerId, linkType: 'VISA_TO_PASSPORT', effectiveFrom: '2029-01-01', effectiveTo: null, evidenceId: id() });
  world.credentialSelections.push(
    selectionRow(journeyId, passport.credential.id, passport.version.id, [visit.id]),
    selectionRow(journeyId, visa.credential.id, visa.version.id, [visit.id]),
  );
  const out = credentialsEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'PASS');
  assert.ok(dim?.explanations.some((e) => e.status === 'PASS' && e.reasonCode === 'visa_linked_to_selected_passport'));
  assert.ok(dim?.explanations.filter((e) => e.reasonCode === 'credential_valid_for_visit').every((e) => e.status === 'PASS'));
});

// ==========================================================================
// m6.entry — Kleene logic
// ==========================================================================

test('kleene: ALL/ANY/NOT truth tables including UNKNOWN', () => {
  assert.equal(kleeneAll(['PASS', 'PASS']), 'PASS');
  assert.equal(kleeneAll(['PASS', 'UNKNOWN']), 'UNKNOWN');
  assert.equal(kleeneAll(['PASS', 'FAIL']), 'FAIL');
  assert.equal(kleeneAll(['UNKNOWN', 'FAIL']), 'FAIL');
  assert.equal(kleeneAll([]), 'UNKNOWN');

  assert.equal(kleeneAny(['FAIL', 'FAIL']), 'FAIL');
  assert.equal(kleeneAny(['FAIL', 'UNKNOWN']), 'UNKNOWN');
  assert.equal(kleeneAny(['FAIL', 'PASS']), 'PASS');
  assert.equal(kleeneAny(['UNKNOWN', 'PASS']), 'PASS');
  assert.equal(kleeneAny([]), 'UNKNOWN');

  assert.equal(kleeneNot('PASS'), 'FAIL');
  assert.equal(kleeneNot('FAIL'), 'PASS');
  assert.equal(kleeneNot('UNKNOWN'), 'UNKNOWN');
});

test('entry expression: an unregistered predicate id UNKNOWNs predicate_unsupported, never PASS', () => {
  const ctx = ctxWith(emptyWorld(), id(), id(), baseEncounter());
  const result = evaluateRuleExpression(predicateExpr('made.up.predicate', {}), ctx);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.leaves[0]?.reasonCode, 'predicate_unsupported');
});

test('entry expression: ALL/ANY/NOT compose predicate leaves with Kleene semantics', () => {
  const travellerId = id();
  const { credential, version } = passportCredential(travellerId);
  const world = emptyWorld({ credentials: [credential], credentialVersions: [version] });
  const selection: WCredentialSelection = { id: id(), journeyId: id(), credentialId: credential.id, credentialVersionId: version.id, intendedVisitIds: [] };
  const withPassport = ctxWith(world, id(), travellerId, baseEncounter({ selections: [selection], purpose: 'tourism' }));
  const withoutPassport = ctxWith(world, id(), travellerId, baseEncounter({ selections: [], purpose: 'tourism' }));

  // ALL(PASS purpose, UNKNOWN nationality-no-passport) -> UNKNOWN
  const allResult = evaluateRuleExpression(allExpr(predicateExpr('journey.purpose_in', { purposes: ['tourism'] }), predicateExpr('traveller.nationality_in', { codes: ['issuer-state'] })), withoutPassport);
  assert.equal(allResult.status, 'UNKNOWN');

  // ALL(PASS purpose, PASS nationality) -> PASS
  const allPass = evaluateRuleExpression(allExpr(predicateExpr('journey.purpose_in', { purposes: ['tourism'] }), predicateExpr('traveller.nationality_in', { codes: ['issuer-state'] })), withPassport);
  assert.equal(allPass.status, 'PASS');

  // ANY(FAIL purpose, PASS nationality) -> PASS
  const anyResult = evaluateRuleExpression(anyExpr(predicateExpr('journey.purpose_in', { purposes: ['study'] }), predicateExpr('traveller.nationality_in', { codes: ['issuer-state'] })), withPassport);
  assert.equal(anyResult.status, 'PASS');

  // NOT(FAIL purpose) -> PASS
  const notResult = evaluateRuleExpression(notExpr(predicateExpr('journey.purpose_in', { purposes: ['study'] })), withPassport);
  assert.equal(notResult.status, 'PASS');
});

// ==========================================================================
// m6.entry — predicate library
// ==========================================================================

test('entry predicate traveller.nationality_in: PASS/FAIL by selected passport issuing state, UNKNOWN with none selected', () => {
  const travellerId = id();
  const { credential, version } = passportCredential(travellerId, { issuingStateCode: 'issuer-state-x' });
  const world = emptyWorld({ credentials: [credential], credentialVersions: [version] });
  const selection: WCredentialSelection = { id: id(), journeyId: id(), credentialId: credential.id, credentialVersionId: version.id, intendedVisitIds: [] };
  const ctx = ctxWith(world, id(), travellerId, baseEncounter({ selections: [selection] }));
  const pass = evaluateRuleExpression(predicateExpr('traveller.nationality_in', { codes: ['issuer-state-x'] }), ctx);
  assert.equal(pass.status, 'PASS');
  assert.equal(pass.leaves[0]?.reasonCode, 'nationality_in_codes');
  const fail = evaluateRuleExpression(predicateExpr('traveller.nationality_in', { codes: ['other-state'] }), ctx);
  assert.equal(fail.status, 'FAIL');
  const noneCtx = ctxWith(world, id(), travellerId, baseEncounter({ selections: [] }));
  const unknown = evaluateRuleExpression(predicateExpr('traveller.nationality_in', { codes: ['issuer-state-x'] }), noneCtx);
  assert.equal(unknown.status, 'UNKNOWN');
  assert.equal(unknown.leaves[0]?.reasonCode, 'passport_not_selected');
});

test('entry predicate credential.passport_valid_days_after_exit: PASS/FAIL by expiry vs exit + required days', () => {
  const travellerId = id();
  const { credential, version } = passportCredential(travellerId, { expiryDate: '2030-03-01' });
  const world = emptyWorld({ credentials: [credential], credentialVersions: [version] });
  const selection: WCredentialSelection = { id: id(), journeyId: id(), credentialId: credential.id, credentialVersionId: version.id, intendedVisitIds: [] };
  const ctx = ctxWith(world, id(), travellerId, baseEncounter({ selections: [selection], exit: '2030-02-01T00:00:00.000Z' }));
  const ok = evaluateRuleExpression(predicateExpr('credential.passport_valid_days_after_exit', { days: 20 }), ctx);
  assert.equal(ok.status, 'PASS');
  const notEnough = evaluateRuleExpression(predicateExpr('credential.passport_valid_days_after_exit', { days: 40 }), ctx);
  assert.equal(notEnough.status, 'FAIL');
});

test('entry predicate credential.linked_visa_valid: FAIL with none selected, PASS when linked and valid', () => {
  const travellerId = id();
  const { credential: passport, version: passportVersion } = passportCredential(travellerId);
  const world = emptyWorld({ credentials: [passport], credentialVersions: [passportVersion] });
  const passportSelection: WCredentialSelection = { id: id(), journeyId: id(), credentialId: passport.id, credentialVersionId: passportVersion.id, intendedVisitIds: [] };
  const noneCtx = ctxWith(world, id(), travellerId, baseEncounter({ selections: [passportSelection] }));
  const none = evaluateRuleExpression(predicateExpr('credential.linked_visa_valid', { issuing_state_codes: ['issuer-state'] }), noneCtx);
  assert.equal(none.status, 'FAIL');
  assert.equal(none.leaves[0]?.reasonCode, 'linked_visa_missing');

  const { credential: visa, version: visaVersion } = visaCredential(travellerId, { issuingStateCode: 'issuer-state', expiryDate: '2030-03-01' });
  world.credentials.push(visa);
  world.credentialVersions.push(visaVersion);
  world.credentialLinks.push({ credentialId: visa.id, relatedCredentialId: passport.id, travellerId, linkType: 'VISA_TO_PASSPORT', effectiveFrom: '2030-01-01', effectiveTo: null, evidenceId: id() });
  const visaSelection: WCredentialSelection = { id: id(), journeyId: id(), credentialId: visa.id, credentialVersionId: visaVersion.id, intendedVisitIds: [] };
  const validCtx = ctxWith(world, id(), travellerId, baseEncounter({ selections: [passportSelection, visaSelection], at: '2030-02-01T00:00:00.000Z', exit: '2030-02-10T00:00:00.000Z' }));
  const valid = evaluateRuleExpression(predicateExpr('credential.linked_visa_valid', { issuing_state_codes: ['issuer-state'] }), validCtx);
  assert.equal(valid.status, 'PASS');
  assert.equal(valid.leaves[0]?.reasonCode, 'linked_visa_valid');
});

test('entry predicate journey.purpose_in: PASS/FAIL by encounter purpose', () => {
  const ctx = ctxWith(emptyWorld(), id(), id(), baseEncounter({ purpose: 'tourism' }));
  assert.equal(evaluateRuleExpression(predicateExpr('journey.purpose_in', { purposes: ['tourism'] }), ctx).status, 'PASS');
  assert.equal(evaluateRuleExpression(predicateExpr('journey.purpose_in', { purposes: ['study'] }), ctx).status, 'FAIL');
});

test('entry predicate journey.stay_days_at_most: PASS/FAIL by stayDays', () => {
  const ctx = ctxWith(emptyWorld(), id(), id(), baseEncounter({ stayDays: 9 }));
  assert.equal(evaluateRuleExpression(predicateExpr('journey.stay_days_at_most', { days: 10 }), ctx).status, 'PASS');
  assert.equal(evaluateRuleExpression(predicateExpr('journey.stay_days_at_most', { days: 5 }), ctx).status, 'FAIL');
});

test('entry predicate history.days_within_window_at_most: no WINDOW_COMPLETE row UNKNOWNs travel_history_incomplete; complete history over the limit FAILs', () => {
  const travellerId = id();
  const journeyId = id();
  const world = emptyWorld();
  const encounter = baseEncounter({ jurisdictionId: 'jurisdiction-a', at: '2030-02-01T00:00:00.000Z', exit: '2030-02-10T00:00:00.000Z', stayDays: 9, visitId: 'visit-1' });
  const noHistory = evaluateRuleExpression(predicateExpr('history.days_within_window_at_most', { days: 10, window_days: 30 }), ctxWith(world, journeyId, travellerId, encounter));
  assert.equal(noHistory.status, 'UNKNOWN');
  assert.equal(noHistory.leaves[0]?.reasonCode, 'travel_history_incomplete');

  world.travelHistory.push({ id: id(), travellerId, jurisdictionId: 'jurisdiction-a', entryDate: '2020-01-01', exitDate: '2035-01-01', coverageClaim: 'WINDOW_COMPLETE', evidenceId: id() });
  const overLimit = evaluateRuleExpression(predicateExpr('history.days_within_window_at_most', { days: 5, window_days: 10 }), ctxWith(world, journeyId, travellerId, encounter));
  assert.equal(overLimit.status, 'FAIL');
  assert.equal(overLimit.leaves[0]?.reasonCode, 'cumulative_stay_exceeds_limit');
});

test('entry predicate transit.airside_confirmed: always UNKNOWN airside_facts_unavailable', () => {
  const ctx = ctxWith(emptyWorld(), id(), id(), baseEncounter({ kind: 'TRANSIT', airsideFactsKnown: false }));
  const result = evaluateRuleExpression(predicateExpr('transit.airside_confirmed', {}), ctx);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.leaves[0]?.reasonCode, 'airside_facts_unavailable');
});

// ==========================================================================
// m6.entry — knowledge applicability, coverage and editions
// ==========================================================================

test('entry: no applicable edition with complete coverage PASSes no_applicable_requirement_complete_coverage', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a'));
  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.reasonCode, 'no_applicable_requirement_complete_coverage');
});

test('entry: scoped complete coverage cannot PASS another journey on the no-edition path', () => {
  const coveredJourneyId = id();
  const evaluatedJourneyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(coveredJourneyId, travellerId), journeyRow(evaluatedJourneyId, travellerId)] });
  world.intendedVisits.push(visitRow(evaluatedJourneyId, 'jurisdiction-a'));
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a', { queryBounds: { jurisdictionId: 'jurisdiction-a', journeyId: coveredJourneyId } }));
  const out = entryEvaluator.evaluate(subjectOf(evaluatedJourneyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'requirement_coverage_incomplete');
});

test('entry: scoped complete coverage matches the exact journey and visit, while direct callers cannot consume it without context', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a');
  world.intendedVisits.push(visit);
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a', { queryBounds: { jurisdictionId: 'jurisdiction-a', journeyId, visitId: visit.id } }));

  assert.equal(coverageFor(world, 'ENTRY_REQUIREMENT', 'jurisdiction-a', NOW).complete, false);
  assert.equal(coverageFor(world, 'ENTRY_REQUIREMENT', 'jurisdiction-a', NOW, { journeyId, visitId: 'different-visit' }).complete, false);
  assert.equal(coverageFor(world, 'ENTRY_REQUIREMENT', 'jurisdiction-a', NOW, { journeyId, visitId: visit.id }).complete, true);

  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.reasonCode, 'no_applicable_requirement_complete_coverage');
});

test('entry: reviewed visit coverage cannot survive a change to purpose or stay dates', () => {
  const journeyId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, id())] });
  const visit = visitRow(journeyId, 'jurisdiction-a');
  world.intendedVisits.push(visit);
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a', {
    queryBounds: { jurisdictionId: 'jurisdiction-a', journeyId, visitId: visit.id,
      purpose: visit.purpose, visitWindow: { ...visit.intended } },
  }));
  const verdict = () => entryEvaluator.evaluate(subjectOf(journeyId), {
    now: NOW, world, effective: effectiveOf(world),
  }).dimensions.find((dimension) => dimension.dimension === 'entry_feasibility')?.verdict;
  assert.equal(verdict(), 'PASS');
  visit.purpose = 'different-purpose';
  assert.equal(verdict(), 'UNKNOWN');
  visit.purpose = world.coverage[0]!.queryBounds.purpose as string;
  visit.intended.end = new Date(Date.parse(visit.intended.end) + 86_400_000).toISOString();
  assert.equal(verdict(), 'UNKNOWN');
});

test('entry: malformed scoped coverage fails closed and unscoped jurisdiction coverage remains usable', () => {
  const journeyId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, id())] });
  const malformed = coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a', { queryBounds: { jurisdictionId: 'jurisdiction-a', journeyId: ' ' } });
  world.coverage.push(malformed);
  assert.equal(coverageFor(world, 'ENTRY_REQUIREMENT', 'jurisdiction-a', NOW, { journeyId, visitId: null }).complete, false);

  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a'));
  assert.equal(coverageFor(world, 'ENTRY_REQUIREMENT', 'jurisdiction-a', NOW, { journeyId, visitId: null }).complete, true);
});

test('entry: no applicable edition and no coverage UNKNOWNs requirement_coverage_incomplete', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'requirement_coverage_incomplete');
});

test('entry: an applicable edition that all-PASSes but lacks complete coverage still UNKNOWNs requirement_coverage_incomplete', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { purpose: 'tourism' });
  world.intendedVisits.push(visit);
  const edition = ruleSetVersionRow(id(), 'entry', predicateExpr('journey.purpose_in', { purposes: ['tourism'] }));
  world.ruleSetVersions.push(edition);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { jurisdictionId: 'jurisdiction-a' }));
  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.ok(dim?.explanations.some((e) => e.reasonCode === 'requirement_coverage_incomplete'));
  assert.ok(!dim?.explanations.some((e) => e.reasonCode === 'requirement_not_met'));
});

test('entry: with complete coverage, an applicable edition that all-PASSes PASSes requirements_met', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { purpose: 'tourism' });
  world.intendedVisits.push(visit);
  const edition = ruleSetVersionRow(id(), 'entry', predicateExpr('journey.purpose_in', { purposes: ['tourism'] }));
  world.ruleSetVersions.push(edition);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { jurisdictionId: 'jurisdiction-a' }));
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a'));
  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'PASS');
  assert.ok(dim?.explanations.some((e) => e.reasonCode === 'requirements_met'));
});

test('entry: a pinned edition is honoured even when it is not the highest-numbered captured edition', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { purpose: 'tourism' });
  world.intendedVisits.push(visit);
  const ruleSetId = id();
  const pinnedEdition = ruleSetVersionRow(ruleSetId, 'entry', predicateExpr('journey.purpose_in', { purposes: ['study'] }), { editionNumber: 1 });
  const laterEdition = ruleSetVersionRow(ruleSetId, 'entry', predicateExpr('journey.purpose_in', { purposes: ['tourism'] }), { editionNumber: 2 });
  world.ruleSetVersions.push(pinnedEdition, laterEdition);
  world.ruleAssignments.push(ruleAssignmentRow(ruleSetId, { jurisdictionId: 'jurisdiction-a', ruleSetVersionId: pinnedEdition.id }));
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a'));
  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'FAIL', 'the pinned edition (purpose study) must be used, not the later edition (purpose tourism)');
  assert.equal(dim?.explanations[0]?.reasonCode, 'requirement_not_met');
  assert.equal(dim?.explanations[0]?.facts.editionId, pinnedEdition.id);
});

test('entry: a future-effective edition does not apply early, but its start feeds nextInvalidationAt', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { purpose: 'tourism' });
  world.intendedVisits.push(visit);
  const ruleSetId = id();
  const currentEdition = ruleSetVersionRow(ruleSetId, 'entry', predicateExpr('journey.purpose_in', { purposes: ['tourism'] }), { editionNumber: 1, effective: { start: '2020-01-01T00:00:00.000Z', end: null } });
  const futureStart = '2031-01-01T00:00:00.000Z';
  const futureEdition = ruleSetVersionRow(ruleSetId, 'entry', predicateExpr('journey.purpose_in', { purposes: ['study'] }), { editionNumber: 2, effective: { start: futureStart, end: null } });
  world.ruleSetVersions.push(currentEdition, futureEdition);
  world.ruleAssignments.push(ruleAssignmentRow(ruleSetId, { jurisdictionId: 'jurisdiction-a' }));
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a'));
  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'PASS', 'the current edition (purpose tourism) applies, not the future one');
  assert.equal(out.nextInvalidationAt, futureStart);
});

test('entry: a retracted REGULATORY information version never applies its referenced edition', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { purpose: 'tourism' });
  world.intendedVisits.push(visit);
  const failingEdition = ruleSetVersionRow(id(), 'entry', predicateExpr('journey.purpose_in', { purposes: ['study'] }));
  world.ruleSetVersions.push(failingEdition);
  const recordId = id();
  const iv = informationVersionRow(recordId, 'REGULATORY', [], { regulatoryJurisdictionId: 'jurisdiction-a', regulatoryRuleSetVersionId: failingEdition.id });
  const retracting = informationVersionRow(recordId, 'REGULATORY', [], { retractsId: iv.id, regulatoryJurisdictionId: 'jurisdiction-a', regulatoryRuleSetVersionId: failingEdition.id, sequence: 2 });
  world.informationVersions.push(iv, retracting);
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a'));
  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'PASS', 'the retracted information version must not apply its referenced (failing) edition');
  assert.ok(!dim?.explanations.some((e) => e.reasonCode === 'requirement_not_met'));
});

test('entry: a superseded REGULATORY information version never applies its referenced (older) edition', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { purpose: 'tourism' });
  world.intendedVisits.push(visit);
  const failingEdition = ruleSetVersionRow(id(), 'entry', predicateExpr('journey.purpose_in', { purposes: ['study'] }));
  const passingEdition = ruleSetVersionRow(id(), 'entry', predicateExpr('journey.purpose_in', { purposes: ['tourism'] }));
  world.ruleSetVersions.push(failingEdition, passingEdition);
  const recordId = id();
  const older = informationVersionRow(recordId, 'REGULATORY', [], { regulatoryJurisdictionId: 'jurisdiction-a', regulatoryRuleSetVersionId: failingEdition.id, sequence: 1 });
  const current = informationVersionRow(recordId, 'REGULATORY', [], { regulatoryJurisdictionId: 'jurisdiction-a', regulatoryRuleSetVersionId: passingEdition.id, sequence: 2, effective: { start: '2020-01-01T00:00:00.000Z', end: null } });
  world.informationVersions.push(older, current);
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a'));
  const out = entryEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions.find((d) => d.dimension === 'entry_feasibility');
  assert.equal(dim?.verdict, 'PASS');
  assert.ok(dim?.explanations.some((e) => e.reasonCode === 'requirements_met'));
  assert.ok(!dim?.explanations.some((e) => e.reasonCode === 'requirement_not_met'));
});

test('AT08: the same itinerary and rule set give two travellers with different passport nationalities different entry verdicts', () => {
  const ruleSetId = id();
  const edition = ruleSetVersionRow(ruleSetId, 'entry', predicateExpr('traveller.nationality_in', { codes: ['issuer-state-allowed'] }));
  const world = emptyWorld({ ruleSetVersions: [edition] });
  world.ruleAssignments.push(ruleAssignmentRow(ruleSetId, { jurisdictionId: 'jurisdiction-a', ruleSetVersionId: edition.id }));
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a'));

  const journeyA = id();
  const travellerA = id();
  const { credential: passA, version: verA } = passportCredential(travellerA, { issuingStateCode: 'issuer-state-allowed' });
  world.journeys.push(journeyRow(journeyA, travellerA));
  const visitA = visitRow(journeyA, 'jurisdiction-a');
  world.intendedVisits.push(visitA);
  world.credentials.push(passA);
  world.credentialVersions.push(verA);
  world.credentialSelections.push(selectionRow(journeyA, passA.id, verA.id, [visitA.id]));

  const journeyB = id();
  const travellerB = id();
  const { credential: passB, version: verB } = passportCredential(travellerB, { issuingStateCode: 'issuer-state-blocked' });
  world.journeys.push(journeyRow(journeyB, travellerB));
  const visitB = visitRow(journeyB, 'jurisdiction-a');
  world.intendedVisits.push(visitB);
  world.credentials.push(passB);
  world.credentialVersions.push(verB);
  world.credentialSelections.push(selectionRow(journeyB, passB.id, verB.id, [visitB.id]));

  const effective = effectiveOf(world);
  const outA = entryEvaluator.evaluate(subjectOf(journeyA), { now: NOW, world, effective });
  const outB = entryEvaluator.evaluate(subjectOf(journeyB), { now: NOW, world, effective });
  assert.equal(outA.dimensions.find((d) => d.dimension === 'entry_feasibility')?.verdict, 'PASS');
  assert.equal(outB.dimensions.find((d) => d.dimension === 'entry_feasibility')?.verdict, 'FAIL');
});

// ==========================================================================
// m6.information
// ==========================================================================

test('information: MANDATORY response severity FAILs policy_requires_avoidance on a matching advisory', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId, { responsibilityOrganisationId: orgId })] });
  const visit = visitRow(journeyId, 'jurisdiction-a');
  world.intendedVisits.push(visit);
  const iv = informationVersionRow(id(), 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'SEVERE' });
  world.informationVersions.push(iv);
  const edition = responseEdition('MANDATORY', ['SEVERE']);
  world.ruleSetVersions.push(edition);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { organisationId: orgId, ruleSetVersionId: edition.id }));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.ok(dim?.explanations.some((e) => e.status === 'FAIL' && e.reasonCode === 'policy_requires_avoidance'));
});

test('information: PROHIBITIVE response severity also FAILs policy_requires_avoidance', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId, { responsibilityOrganisationId: orgId })] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const iv = informationVersionRow(id(), 'CONDITION', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'HIGH' });
  world.informationVersions.push(iv);
  const edition = responseEdition('PROHIBITIVE', ['HIGH']);
  world.ruleSetVersions.push(edition);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { organisationId: orgId, ruleSetVersionId: edition.id }));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'FAIL');
  assert.ok(dim?.explanations.some((e) => e.status === 'FAIL' && e.reasonCode === 'policy_requires_avoidance'));
});

test('information: ADVISORY response severity UNKNOWNs policy_requires_review', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId, { responsibilityOrganisationId: orgId })] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const iv = informationVersionRow(id(), 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'MODERATE' });
  world.informationVersions.push(iv);
  const edition = responseEdition('ADVISORY', ['MODERATE']);
  world.ruleSetVersions.push(edition);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { organisationId: orgId, ruleSetVersionId: edition.id }));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.ok(dim?.explanations.some((e) => e.status === 'UNKNOWN' && e.reasonCode === 'policy_requires_review'));
});

test('information: INFORMATIONAL response severity PASSes advisory_noted', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId, { responsibilityOrganisationId: orgId })] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const iv = informationVersionRow(id(), 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'LOW' });
  world.informationVersions.push(iv);
  const edition = responseEdition('INFORMATIONAL', ['LOW']);
  world.ruleSetVersions.push(edition);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { organisationId: orgId, ruleSetVersionId: edition.id }));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'PASS');
  assert.ok(dim?.explanations.some((e) => e.status === 'PASS' && e.reasonCode === 'advisory_noted'));
});

test('information: an applicable advisory with no matching response rule UNKNOWNs advisory_response_policy_missing', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId, { responsibilityOrganisationId: orgId })] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const iv = informationVersionRow(id(), 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'SEVERE' });
  world.informationVersions.push(iv);
  // An org response edition exists, but its rule only matches a different severity.
  const edition = responseEdition('MANDATORY', ['UNRELATED_SEVERITY']);
  world.ruleSetVersions.push(edition);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { organisationId: orgId, ruleSetVersionId: edition.id }));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.ok(dim?.explanations.some((e) => e.status === 'UNKNOWN' && e.reasonCode === 'advisory_response_policy_missing'));
});

test('information: conflicting publishers are both reported; neither overwrites the other', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId, { responsibilityOrganisationId: orgId })] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const publisherOne = id();
  const publisherTwo = id();
  const ivOne = informationVersionRow(id(), 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'SEVERE', publisherOrganisationId: publisherOne });
  const ivTwo = informationVersionRow(id(), 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'LOW', publisherOrganisationId: publisherTwo });
  world.informationVersions.push(ivOne, ivTwo);
  const edition = responseEdition('MANDATORY', ['SEVERE']);
  const edition2 = responseEdition('INFORMATIONAL', ['LOW'], { ruleSetId: edition.ruleSetId });
  world.ruleSetVersions.push(edition);
  // Both severities are recognised by the same rule set edition's rules (two rules on one edition).
  edition.rules.push(...edition2.rules);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { organisationId: orgId, ruleSetVersionId: edition.id }));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  const forOne = dim?.explanations.filter((e) => e.facts.informationVersionId === ivOne.id);
  const forTwo = dim?.explanations.filter((e) => e.facts.informationVersionId === ivTwo.id);
  assert.ok(forOne && forOne.length > 0, 'publisher one advisory must be reported');
  assert.ok(forTwo && forTwo.length > 0, 'publisher two advisory must be reported');
  assert.ok(forOne?.some((e) => e.status === 'FAIL'));
  assert.ok(forTwo?.some((e) => e.status === 'PASS'));
  assert.equal(dim?.verdict, 'FAIL', 'one publisher FAILing must not be overwritten by the other PASSing');
});

test('information: no applicable advisory with complete coverage PASSes no_applicable_advisory_complete_coverage', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  world.coverage.push(coverageRow('ADVISORY', 'jurisdiction-a'), coverageRow('CONDITION', 'jurisdiction-a'));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.reasonCode, 'no_applicable_advisory_complete_coverage');
});

test('information: no applicable advisory without coverage UNKNOWNs advisory_coverage_incomplete', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.equal(dim?.explanations[0]?.reasonCode, 'advisory_coverage_incomplete');
});

test('information: a retracted advisory is ignored, falling back to the coverage branch', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId, { responsibilityOrganisationId: orgId })] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const recordId = id();
  const iv = informationVersionRow(recordId, 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'SEVERE' });
  const retracting = informationVersionRow(recordId, 'ADVISORY', [], { retractsId: iv.id, sequence: 2 });
  world.informationVersions.push(iv, retracting);
  const edition = responseEdition('MANDATORY', ['SEVERE']);
  world.ruleSetVersions.push(edition);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { organisationId: orgId, ruleSetVersionId: edition.id }));
  world.coverage.push(coverageRow('ADVISORY', 'jurisdiction-a'), coverageRow('CONDITION', 'jurisdiction-a'));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'PASS');
  assert.equal(dim?.explanations[0]?.reasonCode, 'no_applicable_advisory_complete_coverage');
});

test('information: a superseded advisory (by a captured later edition already in effect) is ignored', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId, { responsibilityOrganisationId: orgId })] });
  world.intendedVisits.push(visitRow(journeyId, 'jurisdiction-a'));
  const recordId = id();
  const older = informationVersionRow(recordId, 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'SEVERE', sequence: 1 });
  // The newer edition no longer scopes to jurisdiction-a at all, so once it wins, nothing applies.
  const newer = informationVersionRow(recordId, 'ADVISORY', [], { sequence: 2, effective: { start: '2020-01-01T00:00:00.000Z', end: null } });
  world.informationVersions.push(older, newer);
  const edition = responseEdition('MANDATORY', ['SEVERE']);
  world.ruleSetVersions.push(edition);
  world.ruleAssignments.push(ruleAssignmentRow(edition.ruleSetId, { organisationId: orgId, ruleSetVersionId: edition.id }));
  world.coverage.push(coverageRow('ADVISORY', 'jurisdiction-a'), coverageRow('CONDITION', 'jurisdiction-a'));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'PASS');
  assert.ok(!dim?.explanations.some((e) => e.reasonCode === 'policy_requires_avoidance'));
});

test('AT11: two organisations with different response rules give different verdicts for the same advisory', () => {
  const orgOne = id();
  const orgTwo = id();
  const world = emptyWorld();
  const editionOne = responseEdition('MANDATORY', ['SEVERE']);
  const editionTwo = responseEdition('INFORMATIONAL', ['SEVERE']);
  world.ruleSetVersions.push(editionOne, editionTwo);
  world.ruleAssignments.push(
    ruleAssignmentRow(editionOne.ruleSetId, { organisationId: orgOne, ruleSetVersionId: editionOne.id }),
    ruleAssignmentRow(editionTwo.ruleSetId, { organisationId: orgTwo, ruleSetVersionId: editionTwo.id }),
  );
  const iv = informationVersionRow(id(), 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'SEVERE' });
  world.informationVersions.push(iv);

  const journeyOne = id();
  const travellerOne = id();
  world.journeys.push(journeyRow(journeyOne, travellerOne, { responsibilityOrganisationId: orgOne }));
  world.intendedVisits.push(visitRow(journeyOne, 'jurisdiction-a'));

  const journeyTwo = id();
  const travellerTwo = id();
  world.journeys.push(journeyRow(journeyTwo, travellerTwo, { responsibilityOrganisationId: orgTwo }));
  world.intendedVisits.push(visitRow(journeyTwo, 'jurisdiction-a'));

  const effective = effectiveOf(world);
  const outOne = informationEvaluator.evaluate(subjectOf(journeyOne), { now: NOW, world, effective });
  const outTwo = informationEvaluator.evaluate(subjectOf(journeyTwo), { now: NOW, world, effective });
  assert.equal(outOne.dimensions[0]?.verdict, 'FAIL');
  assert.equal(outTwo.dimensions[0]?.verdict, 'PASS');
  assert.equal(outOne.dimensions[0]?.explanations[0]?.facts.informationVersionId, iv.id);
  assert.equal(outTwo.dimensions[0]?.explanations[0]?.facts.informationVersionId, iv.id);
});

test('information: an active item place with no resolved jurisdiction UNKNOWNs exposure_jurisdiction_unresolved', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  world.journeyItems.push(transportItem(journeyId, { desiredOriginPlaceId: 'place-origin', desiredDestinationPlaceId: 'place-unresolved', intendedWindow: window('2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z') }));
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  const dim = out.dimensions[0];
  assert.equal(dim?.verdict, 'UNKNOWN');
  assert.ok(dim?.explanations.some((e) => e.reasonCode === 'exposure_jurisdiction_unresolved'));
});

test('information: a Journey with no exposure at all is not applicable', () => {
  const journeyId = id();
  const travellerId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId)] });
  const out = informationEvaluator.evaluate(subjectOf(journeyId), { now: NOW, world, effective: effectiveOf(world) });
  assert.equal(out.dimensions[0]?.applicable, false);
});

// ==========================================================================
// Cross-cutting: determinism and full dimension declaration
// ==========================================================================

test('determinism: evaluating the same world twice with all L4 evaluators yields deepEqual output, and every declared dimension surfaces through assessSubject', () => {
  const journeyId = id();
  const travellerId = id();
  const orgId = id();
  const world = emptyWorld({ journeys: [journeyRow(journeyId, travellerId, { responsibilityOrganisationId: orgId })] });
  const visit = visitRow(journeyId, 'jurisdiction-a', { purpose: 'tourism' });
  world.intendedVisits.push(visit);
  const { credential, version } = passportCredential(travellerId, { issuingStateCode: 'issuer-state' });
  world.credentials.push(credential);
  world.credentialVersions.push(version);
  world.credentialSelections.push(selectionRow(journeyId, credential.id, version.id, [visit.id]));

  const entryEdition = ruleSetVersionRow(id(), 'entry', predicateExpr('traveller.nationality_in', { codes: ['issuer-state'] }));
  world.ruleSetVersions.push(entryEdition);
  world.ruleAssignments.push(ruleAssignmentRow(entryEdition.ruleSetId, { jurisdictionId: 'jurisdiction-a', ruleSetVersionId: entryEdition.id }));
  world.coverage.push(coverageRow('ENTRY_REQUIREMENT', 'jurisdiction-a'), coverageRow('ADVISORY', 'jurisdiction-a'), coverageRow('CONDITION', 'jurisdiction-a'));

  const iv = informationVersionRow(id(), 'ADVISORY', [scopeRow({ jurisdictionId: 'jurisdiction-a' })], { sourceNativeSeverity: 'LOW' });
  world.informationVersions.push(iv);
  const responseRuleEdition = responseEdition('INFORMATIONAL', ['LOW']);
  world.ruleSetVersions.push(responseRuleEdition);
  world.ruleAssignments.push(ruleAssignmentRow(responseRuleEdition.ruleSetId, { organisationId: orgId, ruleSetVersionId: responseRuleEdition.id }));

  const registry = createEvaluatorRegistry([credentialsEvaluator, entryEvaluator, informationEvaluator]);
  const run = () => {
    const effective = effectiveOf(world);
    return assessSubject({ registry, world, effective, subject: subjectOf(journeyId), now: NOW, assessmentId: 'fixed-assessment-id' });
  };
  const first = run();
  const second = run();
  assert.deepEqual(first.result, second.result);

  const dimensionNames = first.result.dimensions.map((d) => d.dimension).sort();
  assert.deepEqual(dimensionNames, ['advisories', 'credential_selection', 'entry_feasibility', 'transit_feasibility'].sort());
  assert.equal(first.result.overallVerdict, 'PASS');
});
