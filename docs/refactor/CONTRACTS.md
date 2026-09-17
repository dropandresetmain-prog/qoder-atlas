# NORTHSTAR M0 — materialized contract package

Status: **M0 CONTRACTS MATERIALIZED — NOT WIRED INTO PRODUCTION**.

Base SHA: `8eefd220e031c0abed306305a1628b5e033cc0ef` (branch
`data-structure-refactor`, matching the milestone brief exactly — see "Base
SHA discrepancy" in [`evidence/M0.md`](evidence/M0.md) for a self-corrected
note on why the local clone initially resolved a different, older HEAD).

This document is the exact-path index C0 needs to freeze the contract
package. It records **where** each frozen contract family
(`docs/IMPLEMENTATION_PLAN.md` §3) lives, **what** it materializes from
[`DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md`](../DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md)
and
[`DATA_STRUCTURE_LOGICAL_SCHEMA.md`](../DATA_STRUCTURE_LOGICAL_SCHEMA.md), and
**how** it is verified. It does not reopen ownership, cardinality or lifecycle
decisions — those are frozen (F01–F18) and this package only chooses
executable TypeScript/zod syntax for them.

## 1. Isolation from production composition

Every file under `src/domain/v2/**` and `src/contracts/v2/**` is schema/type
contract only. None of it is imported by `src/app/**`, `src/engine/**`,
`src/operational/**`, `src/server/**`, `src/main.ts` or any other production
composition path. Verified for this package by:

```
grep -rl "domain/v2\|contracts/v2" src/app src/main.ts src/server src/engine \
  src/operational src/intake src/ingest src/intelligence src/providers src/ui \
  src/scenarios src/acceptance src/persistence
```

(zero matches). Re-run this check at C0 and before any lane branches from this
commit — a lane accidentally wiring v2 into runtime composition during
M0/M1 is an Act Now finding, not a style note.

## 2. Domain object contracts — `src/domain/v2/**`

Canonical typed object shapes (zod schemas + inferred TS types). "Domain
lanes implement exact agreed shapes" per the plan — these are the exact
agreed shapes M2–M5 build against.

| Path | Materializes | Closure/schema reference |
|---|---|---|
| `src/domain/v2/shared/identity.ts` | `WorkspaceId`, `SubjectId`, closed `SubjectKind` registry, `TypedRef`, `RootRevision`, `ExpectedRevision`, `ScopeGenerationRef`, `OwnershipBinding`, `ProtectedDataRef` | Closure §4/§5; Schema §1/§2 (`domain_subjects`, `aggregate_heads`, `ownership_bindings`) |
| `src/domain/v2/shared/time.ts` | `Instant`, `LocalDate`, `IanaTimeZone`, `InstantInterval`, `DateInterval` | Schema §1 (timestamptz/date/half-open interval rules) |
| `src/domain/v2/shared/money.ts` | `ExactMoney` (decimal string), `FxObservation`, exact arithmetic helpers | Schema §1 (no floating-point consequential arithmetic) |
| `src/domain/v2/shared/errors.ts` | `TypedConflictKind`, `TypedConflict`, `TypedResult<T>` | Schema §11.1 ("a conflict is a typed stale-revision outcome") |
| `src/domain/v2/people/traveller.ts` | `Traveller`, `ProfileAssertion`, `TravelCredential`/`CredentialVersion`, `CredentialLink`, `TravellerRelationship`, `ResponsibilityAssignment`, `AuthorityGrant` | Closure §4.1; Schema §2 |
| `src/domain/v2/trip/trip.ts` | `Trip`, `Journey`, `JourneyItem` (discriminated TRANSPORT/STAY/ENGAGEMENT/RESOURCE_USE), `IntendedVisit`, `CredentialSelection`, `CoordinationGroup`, `GroupMembership` | Closure §4.2; Schema §3 |
| `src/domain/v2/trip/support.ts` | `AccompanimentConstraintDefinition`, `SupportAssignment`, `assignmentSatisfiesDefinition` | Closure §4.2, §14 ("Support requirement mixed with selected supporter" — Act Now); Schema §3 |
| `src/domain/v2/arrangements/reservation.ts` | `TransportService`, `Resource`, `Reservation`/`ReservationLine`/`ReservationAllocation`, `ServiceEntitlement`, `Offer`, `CommercialAgreement`, `BudgetCommitment` | Closure §4.3; Schema §4 |
| `src/domain/v2/programmes/programme.ts` | `Event`, `Programme`, `ProgrammeItem`, `Participation`/`ParticipationRole`, `ResourceAssignment`, `Place`, `GeographicAreaVersion`, `Jurisdiction`/`JurisdictionArea` | Closure §4.4; Schema §5 |
| `src/domain/v2/knowledge/information.ts` | `Objective`, `ConstraintDefinition`, `RuleSetVersion`/`RuleExpression`, `Preference`, `SourceRecordV2`, `EvidenceRecord`, `InformationRecord`/`InformationVersion`, `InformationScope`, `KnowledgeCoverage` | Closure §4.5/§7; Schema §6 |

## 3. Protocol/interaction contracts — `src/contracts/v2/**`

Cross-cutting command/interaction contracts. Consumed by command handlers,
planners, authority and execution — not by any single domain lane.

| Path | Materializes | Owner / consumers (plan §3) |
|---|---|---|
| `src/contracts/v2/command/domainCommand.ts` | `DomainCommandEnvelope`, `CommandReceipt`, `DomainCommandResult` (COMMITTED\|CONFLICT\|REJECTED) | Architect/persistence; all command handlers |
| `src/contracts/v2/command/unitOfWork.ts` | `UnitOfWork`, `AggregateHeadReader`, `IdempotencyLedger`, `ScopeGenerationLedger` (behavioural interfaces; M1 supplies the PostgreSQL implementation) | Architect/persistence |
| `src/contracts/v2/scope/readScope.ts` | `ReadScopeRequest`, `CoverageRecord`, `MissingCoverage`, `WorldSnapshotManifest`, `WorldSnapshot`, `isSnapshotCurrent` | M6 owner; readers from all lanes |
| `src/contracts/v2/assessment/assessmentManifest.ts` | `AssessmentResult`, `AssessmentDimension`, `overallVerdictFromDimensions`, `isAssessmentCurrent` | M6; planner/authority/UI |
| `src/contracts/v2/ingestion/informationIngestion.ts` | `IngestionEnvelope`, `ingestionIsAcceptable` | M5; adapters/M6 |
| `src/contracts/v2/scenario/scenarioChange.ts` | `ScenarioChange`, closed `ScenarioEffect` union | M7; planner/overlay/viability |
| `src/contracts/v2/action/actionPlan.ts` | `ActionPlan`, `ActionIntent`, `ActionDependency`, `validateActionPlanAcyclic` | M7/M8 jointly; integration primary owns amendments |
| `src/contracts/v2/authority/authorityEnvelope.ts` | `AuthorityEnvelope`, `AuthorityDecision`, `Approval`/`ApprovalRevocation`, `approvalCoversEnvelope`, `authorityIsSatisfied` | M8; UI/planner/executor |
| `src/contracts/v2/execution/execution.ts` | `ExecutionAttempt`, `ExecutionObservation` (discriminated EXTERNAL_PROVIDER\|INTERNAL_COMMAND_RECEIPT), `canDispatchNewAttempt` | M8; provider adapters/inbox |
| `src/contracts/v2/migration/migrationEnvelope.ts` | `MigrationEnvelope`, `LegacyIdMapEntry`, `migrationImportOutcome` | Migration owner; M2–M5/M10 |
| `src/contracts/v2/extension/extensionRegistration.ts` | `ExtensionRegistration` (answers the closure §12 ten-question protocol), `extensionRegistrationIsAcceptable` | Architect/M6; future category authors |

## 4. Enforcement points worth calling out at C0

These are the places a reviewer should specifically try to break, because
they encode a specific F-decision as a type/refinement rather than a comment:

- **Support cannot be relaxed by assignment** — `support.ts`
  `assignmentSatisfiesDefinition` re-derives coverage/eligibility/handoff-gap
  from the *governing* `AccompanimentConstraintDefinition` every time; the
  assignment shape itself carries no status field it could use to claim
  satisfaction.
- **Candidate cannot become supplier fact** — `execution.ts`
  `ExecutionObservationSchema` is a discriminated union with exactly two
  origins (`EXTERNAL_PROVIDER` with a mandatory `externalRecordId`, or
  `INTERNAL_COMMAND_RECEIPT` with a mandatory `commandReceiptRef`); there is
  no third variant a scenario/candidate value could populate.
- **Scenarios cannot rewrite judging rules** — `scenarioChange.ts`
  `ScenarioEffectSchema` is a closed `discriminatedUnion`; only six effect
  kinds exist and none of them touches a `RuleSetVersion`, an
  `AssessmentResult`, or an `ExecutionObservation`.
- **REQUIRES/dependency executability** — `RuleExpressionSchema` in
  `knowledge/information.ts` is a bounded recursive ALL/ANY/NOT/PREDICATE
  grammar; there is no `eval`/string-script variant to parse.
- **PASS/FAIL/UNKNOWN never collapse** — `overallVerdictFromDimensions` in
  `assessmentManifest.ts`: any `FAIL` wins over `UNKNOWN`, and any `UNKNOWN`
  wins over an all-`PASS` reading; an empty dimension list is `UNKNOWN`, not
  `PASS` by default.
- **Idempotent replay vs. conflict** — `domainCommand.ts`
  `idempotentReplayIsSafe` plus `unitOfWork.ts` `IdempotencyLedger.claim`
  return `NEW | REPLAY | HASH_MISMATCH`, matching Schema §11.1 exactly.
- **Reconciliation before redispatch** — `execution.ts`
  `canDispatchNewAttempt` refuses a new attempt for the same
  `logicalOperationKey` while a prior attempt is `DISPATCHED` or
  `OUTCOME_UNKNOWN`.

## 5. Contract examples and fixtures

`test/northstar-v2-contracts.test.ts` is the M0 acceptance fixture set. It
covers, with both a positive and at least one invalid example, all seven
families required by `docs/IMPLEMENTATION_PLAN.md` §3:

1. Family split / support handoff.
2. Shared booking across Trips.
3. One programme move affecting two travellers differently.
4. Conflicting advisories.
5. Multi-passport transit evaluation.
6. Supplier timeout after dispatch.
7. Additive new condition/information type (EV-charger-outage extension).

Plus cross-cutting registry/acyclic-graph/migration-conflict/command-result
proofs. See [`evidence/M0.md`](evidence/M0.md) for the exact test run result.

## 6. AT01–AT24 mapping

See [`MIGRATION_MAPPING.md`](MIGRATION_MAPPING.md) §3 for the full
acceptance-test-to-package/fixture map required by the plan's C0 acceptance
criterion ("AT01-AT24 each map to packages/fixtures").

## 7. Naming/versioning convention for later lanes

- All M0 contract modules are versioned as `v2` at the path level (no
  per-file `schemaVersion` suffix yet); `DomainCommandEnvelope.schemaVersion`
  and `contractVersion` fields on individual contracts (e.g.
  `ExtensionRegistration.contractVersion`) carry semantic versions once a
  contract changes after C0.
- Additive-only after C0: a lane needing a new field adds an optional field
  or a new discriminated variant; it does not repurpose an existing field or
  change a closed enum's existing members without an architecture decision.
- New `SubjectKind` values are added to `src/domain/v2/shared/identity.ts`
  only by the architect/M6 owner (plan §2 "Contract freeze package" row
  "Identity and ownership").

## 8. Accepted post-C0 clarification — `CommandReceipt.resultRef` is the replay value

Approved at C1 and now implemented in M2. This is the **only** change to frozen
contract *semantics* since the C0 freeze; no field, enum member or discriminated
variant was added, removed or repurposed.

`resultRef` keeps its C0 name and its `z.string()` shape, but it is explicitly
**not** an opaque pointer to state elsewhere. It is the JSON serialization of the
command's committed result, and an equal-key replay decodes that value rather
than re-running the handler.

- Schema: `CommandReceiptSchema.resultRef` in
  `src/contracts/v2/command/domainCommand.ts` carries a `refine` requiring valid
  JSON, so a receipt that cannot be replayed is not a valid receipt.
- Helpers: `serializeCommandResult` / `parseCommandResult` (same file) are the
  only encode/decode pair. `buildReceipt` in
  `src/persistence/postgres/commandSupport.ts` encodes on the committed path;
  `PgUnitOfWork.execute` decodes on the `REPLAY` branch of
  `IdempotencyLedger.claim` and returns without invoking the handler.
- Consequences for every command handler in M2-M11: the returned value must be
  JSON-compatible (no `Date`, `BigInt`, `Map`, class instances or provider
  handles), and every identifier a result reports must be generated *before* the
  retryable `execute` callback, because a replay never re-executes it.

Evidence and the exact test that pins replay-without-re-execution:
[`evidence/M2.md`](evidence/M2.md) and `postgres-integration/idempotency.pgtest.ts`.

## 9. Additive post-C5 runtime-closure contracts (R0/T3)

Recorded per §7 (additive only; no existing field, enum member or variant
repurposed). Evidence: `postgres-integration/changeSignals.pgtest.ts`,
`postgres-integration/caseEscalation.pgtest.ts`, `test/runtime-services.test.ts`.

- **`CHANGE_SIGNAL` subject activation (migration 0124).** The kind was
  pre-registered at M0/M1; 0124 installs its subtype checker and the tables the
  logical schema §7 already named (`change_signals`, `signal_subjects`) plus
  `change_signal_completions`. A signal is immutable; "applied" is a separate
  durable row. `case_signals.change_signal_id` gains its FK.
- **Consequence provenance.** `PgUnitOfWork.underChangeSignal(id)` sets the
  transaction-local setting `northstar.change_signal_id`; `change_records`
  and `scheduled_reassessments` record it (`change_signal_id`, nullable).
  Coalescing of open reassessment work is unchanged (first signal owns the
  unit). The `DomainCommandEnvelope` is untouched.
- **Manifest binding rule.** An assessment's `aggregateReads`/`scopeReads` are
  the closure of its own subject. Batch capture may only be an optimisation
  when the manifest is projected per subject; the baseline captures per
  Journey (`evaluateImpact({ assessFocusOnly: true })`).
- **Information topics.** Application bookkeeping never goes through
  `information_records`; an unregistered topic advances the workspace-wide
  sentinel scope and invalidates every assessment, by design.
- **Escalation policy port.** `decideEscalation(assessment, status, cases)`
  (`src/resolution/escalation/policy.ts`) is pure: CURRENT + overall FAIL +
  an applicable blocking FAIL dimension escalates; UNKNOWN never opens; an
  open non-terminal case ATTACHes. Applied by the reconcile-from-state pass
  `runCaseEscalation` with deterministic case identity and idempotency key
  `escalation:<kind>:<subjectId>:<assessmentId>`.
- **Case linkage command.** `attachCaseSubjects` (`RECOVERY_CASE_LINKED`) is
  the only writer of `case_subjects`/`case_signals`; tests must not insert
  those rows directly.
- **Runtime services.** `src/app/runtimeServices.ts` is the one composition
  root for background workers (`start/stop/health`); `/api/v2/health` reports
  `runtimeServices`.
- **`RecoveryCaseView` additive fields.** `cause?: CaseCauseView` (the linked
  change signal) and `causalPath: CausalPathStep[]` (the evaluator's own
  blocking FAIL explanations); the focused graph gains a `DISRUPTION` node
  `CHANGE_SIGNAL:<id>` with `AFFECTED_BY` edges from each subject.
- **StrategyProposer port (B1).** `src/resolution/planning/proposer.ts`:
  `propose(ProposerInput) -> ProposalCandidate[]`; output is re-validated by
  `validateProposalCandidates` against the closed `ScenarioEffectSchema`
  before evaluation; a proposer never asserts viability, authority or
  observed truth. First implementation: `programmeTimeSwapProposer`.
- **Planning/approval composition (B1).** `POST /api/v2/cases/:id/strategies`
  (`recoveryPlanning.ts`) persists VIABLE strategies only and reports the
  rest with failing subjects + reason codes;
  `POST /api/v2/cases/:id/strategies/:sid/approve` (`recoveryApproval.ts`)
  compiles the plan at approval time (deterministic plan id), issues the
  decision with the envelope `storedExecutionGate.buildEnvelopeInput`
  rebuilds, and records the approval by the request principal
  (`x-northstar-principal`, else the workspace operator). Costed intents are
  refused (`BUDGET_HOLD_REQUIRED`) until budget holds are composed.
- **Case phase transitions (B1).** `transitionRecoveryCase`
  (`RECOVERY_CASE_PHASE_CHANGED`) permits OPEN→PLANNING→AWAITING_AUTHORITY→
  EXECUTING with backward steps to PLANNING/AWAITING_AUTHORITY; terminal
  states only through their own commands.
- **Workspace authority (B1).** `workspaceAuthority.ts` provisions
  root/issuer/operator/executor principals (deterministic ids) with
  enumerated coverage over PROGRAMME/PROGRAMME_ITEM/TRIP/JOURNEY; exact
  TypedRef authority, no inheritance. Coverage is fixed at provisioning.
- **`ApplicationErrorCode` additive members (B1):** CASE_NOT_FOUND,
  CASE_NOT_OPEN, STRATEGY_NOT_FOUND, STRATEGY_NOT_VIABLE, STRATEGY_BASE_STALE,
  PLAN_COMPILE_FAILED, PLAN_PERSIST_FAILED, BUDGET_HOLD_REQUIRED,
  AUTHORITY_SCOPE_UNRESOLVED, APPROVER_UNAUTHORIZED, DISPATCHER_UNAUTHORIZED,
  INTENT_MISSING, AUTHORITY_DECISION_FAILED, APPROVAL_FAILED,
  PRINCIPAL_UNRESOLVED.
- **Strategy viability (RC-6).** `strategyViabilityFromSubjectVerdicts`
  compares overlay assessments to the same subjects on the un-overlaid
  captured world. A candidate is VIABLE when every blocking (case FAIL)
  subject is PASS, no reached subject's overall verdict worsens, and no
  required/newly introduced UNKNOWN remains. Unchanged pre-existing
  FAIL/UNKNOWN does not veto and is not treated as healed. Closure still
  decides who is reassessed; it does not require every reached subject to
  PASS.
