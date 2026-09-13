/**
 * NORTHSTAR v2 — people and governance canonical shapes.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.1, DATA_STRUCTURE_LOGICAL_SCHEMA.md §2.
 * Traveller identity is stable and never derived from an event/intake row.
 * Credentials are Traveller-owned, addressable, versioned children with
 * protected identifiers. A guardian relationship, a grant and an assignment
 * are three distinct concepts (F05) — none implies the others.
 */
import { z } from 'zod';
import { SubjectIdSchema, WorkspaceIdSchema, TypedRefSchema } from '../shared/identity.ts';
import { InstantSchema, LocalDateSchema, DateIntervalSchema } from '../shared/time.ts';

export const TravellerSchema = z.strictObject({
  id: SubjectIdSchema,
  workspaceId: WorkspaceIdSchema,
  revision: z.number().int().min(1),
  displayNameRef: SubjectIdSchema, // points at current traveller_names row
  lifecycleStatus: z.enum(['ACTIVE', 'MERGED', 'ARCHIVED']),
  mergedIntoTravellerId: SubjectIdSchema.optional(),
});
export type Traveller = z.infer<typeof TravellerSchema>;

export const ProfileAssertionTypeSchema = z.enum([
  'CITIZENSHIP',
  'RESIDENCY',
  'ACCESSIBILITY_NEED',
  'SUPPORT_NEED',
  'CONTACT_PREFERENCE',
]);
export type ProfileAssertionType = z.infer<typeof ProfileAssertionTypeSchema>;

export const ProfileAssertionSchema = z.strictObject({
  id: SubjectIdSchema,
  travellerId: SubjectIdSchema,
  assertionType: ProfileAssertionTypeSchema,
  effectiveRange: DateIntervalSchema,
  evidenceId: SubjectIdSchema,
  value: z.record(z.string(), z.unknown()),
  supersedesAssertionId: SubjectIdSchema.optional(),
});
export type ProfileAssertion = z.infer<typeof ProfileAssertionSchema>;

export const CredentialKindSchema = z.enum(['PASSPORT', 'VISA', 'E_AUTHORISATION', 'RESIDENCE_PERMIT', 'HEALTH_CREDENTIAL']);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

export const TravelCredentialSchema = z.strictObject({
  id: SubjectIdSchema,
  travellerId: SubjectIdSchema,
  kind: CredentialKindSchema,
  issuerCountry: z.string().length(2),
  currentVersionId: SubjectIdSchema,
});
export type TravelCredential = z.infer<typeof TravelCredentialSchema>;

/** Immutable accepted credential edition. Issuer status and physical availability are separate fields. */
export const CredentialVersionSchema = z.strictObject({
  id: SubjectIdSchema,
  credentialId: SubjectIdSchema,
  issueDate: LocalDateSchema,
  expiryDate: LocalDateSchema.optional(),
  issuerStatus: z.enum(['VALID', 'REVOKED', 'SUSPENDED', 'UNKNOWN']),
  physicallyAvailable: z.boolean().optional(),
  evidenceId: SubjectIdSchema,
  acceptedAt: InstantSchema,
  // Type-discriminated detail lives in a typed sibling table
  // (passport_details / visa_details / ...); not a JSON bag here.
});
export type CredentialVersion = z.infer<typeof CredentialVersionSchema>;

/** e.g. a visa's link to the passport it is stamped in. Both must belong to the same Traveller. */
export const CredentialLinkSchema = z.strictObject({
  travellerId: SubjectIdSchema,
  credentialId: SubjectIdSchema,
  relatedCredentialId: SubjectIdSchema,
  linkType: z.enum(['VISA_TO_PASSPORT', 'PERMIT_TO_PASSPORT']),
  evidenceId: SubjectIdSchema,
  effectiveRange: DateIntervalSchema,
});
export type CredentialLink = z.infer<typeof CredentialLinkSchema>;

export const RelationshipTypeSchema = z.enum(['PARENT_GUARDIAN', 'SPOUSE_PARTNER', 'PEER', 'ASSISTANT']);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

/** A sourced human relationship. Does NOT itself grant authority or define support requirements. */
export const TravellerRelationshipSchema = z.strictObject({
  id: SubjectIdSchema,
  fromTravellerId: SubjectIdSchema,
  toTravellerId: SubjectIdSchema,
  relationshipType: RelationshipTypeSchema,
  effectiveRange: DateIntervalSchema,
  evidenceId: SubjectIdSchema,
});
export type TravellerRelationship = z.infer<typeof TravellerRelationshipSchema>;

/** Operator/arranger/servicer/payer/duty-of-care within a scope. Responsibility is not authority. */
export const ResponsibilityRoleSchema = z.enum(['OPERATOR', 'ARRANGER', 'SERVICER', 'PAYER', 'DUTY_OF_CARE']);
export type ResponsibilityRole = z.infer<typeof ResponsibilityRoleSchema>;

export const ResponsibilityAssignmentSchema = z.strictObject({
  id: SubjectIdSchema,
  organisationId: SubjectIdSchema,
  subjectRef: TypedRefSchema, // e.g. TRIP or JOURNEY or RESERVATION
  role: ResponsibilityRoleSchema,
  effectiveRange: DateIntervalSchema,
});
export type ResponsibilityAssignment = z.infer<typeof ResponsibilityAssignmentSchema>;

/**
 * Who may do which actions for which represented party/subjects/limits.
 * No implicit grant from job title, guardian relationship or booking import.
 */
export const AuthorityGrantSchema = z.strictObject({
  id: SubjectIdSchema,
  principalId: SubjectIdSchema,
  representedPartyRef: TypedRefSchema,
  issuedByPrincipalId: SubjectIdSchema,
  evidenceId: SubjectIdSchema.optional(),
  issuedAt: InstantSchema,
  expiresAt: InstantSchema.optional(),
  revokedAt: InstantSchema.optional(),
  actions: z.array(z.string().min(1)).min(1),
  scopes: z.array(TypedRefSchema).min(1),
  limits: z.record(z.string(), z.unknown()).optional(),
});
export type AuthorityGrant = z.infer<typeof AuthorityGrantSchema>;

export function isGrantCurrentlyEffective(grant: AuthorityGrant, at: string): boolean {
  if (grant.revokedAt !== undefined) return false;
  if (Date.parse(at) < Date.parse(grant.issuedAt)) return false;
  if (grant.expiresAt !== undefined && Date.parse(at) >= Date.parse(grant.expiresAt)) return false;
  return true;
}
