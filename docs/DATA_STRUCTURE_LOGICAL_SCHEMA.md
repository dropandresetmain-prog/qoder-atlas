# Northstar target logical schema and transaction contracts

Status: **APPROVED TARGET — NOT IMPLEMENTED**. Baseline main:
`8b03934dadee20ec7ec271a45c5769de676dc3e7`.

This is the implementation-level persistence companion to the approved
[architecture closure](DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md). Execute through
[the implementation plan](IMPLEMENTATION_PLAN.md), not by applying this document
directly to an existing database. No SQL migrations or runtime changes are included
in the documentation commit.

The table families, ownership, integrity and concurrency requirements are frozen.
M0 settles exact DDL/contract syntax and migration allocation without changing those
semantics. Do not reduce this design to mutable aggregate JSON documents.

## 1. Physical conventions

- Use PostgreSQL and PostGIS. Every business row is scoped to `workspace_id`.
  Domain identity uses UUIDs, not provider locators or fixture names.
- Keys below omit repeated `workspace_id` for readability. Every domain FK includes
  it, so database integrity prevents cross-workspace associations. Default domain
  PK is `(workspace_id, id)`. Immutable version tables have an immutable version ID
  and a unique `(workspace_id, root_id, edition_number)` where sequential editions
  are controlled internally.
- `domain_subjects(workspace_id, id, kind, aggregate_id)` is a narrow identity and
  ownership registry for legitimate cross-kind references such as case subjects,
  evidence subjects and assessment inputs. It has **no business payload**. Concrete
  relations still use concrete typed tables/FKs. It is not the legacy `entities`
  JSON table, EAV store or universal object repository.
- `aggregate_heads(workspace_id, aggregate_id, revision)` is the single current
  revision counter per mutable aggregate. Domain roots reference that identity;
  do not introduce independently advancing duplicate version fields on children.
  An aggregate root is its own aggregate identity. Registration of a subject,
  root head and typed row is atomic, with deferred constraints for their circular
  identity relationship if needed.
- Enforce registry kind/subtype and aggregate-owner consistency using declared
  typed FKs/checks and deferred constraint triggers where ordinary FKs cannot
  express the cross-table rule. Maintain these in versioned migrations with tests.
  Application validation improves error messages but cannot be the only guard.
- Timestamps for instants use `timestamptz`; date-only document validity remains
  `date`. Keep IANA timezone for local schedules. Model half-open intervals
  consistently and validate start before end. Date-of-birth is date-only. Never
  convert local midnight validity rules silently into a UTC instant.
- Use exact decimal amounts and currency codes; define rounding per operation.
  Integer minor units are acceptable for settled amounts where currency exponent
  is known. FX rates use sufficient exact decimal precision and dated evidence.
  No floating-point JS arithmetic for consequential monetary decisions.
- Ordinary mutable roots record creation/update metadata; change history is
  immutable. Credentials, identity assertions and commercial records require
  field-level access/redaction. Raw files are in protected content storage with
  hash and access-controlled reference, not public URLs or prompt-visible blobs.
- Default retention is restrict/no hard cascade for obligations, approvals,
  executions and evidence. Removal is a lifecycle/retention command with audit.
  Do not cascade-delete a Traveller's live booking or execution history.
- Use ordered, checksummed migrations and a `schema_migrations` ledger. Never
  overwrite a global version number to pretend all migrations ran.

Table notation below: **root** owns a revision; **child** mutates under the stated
root; **immutable** is append-only after acceptance/publication; **association** has
the explicit owner indicated. `?` means nullable for the stated reason, not an
invitation to omit known domain links. All tables have their applicable creation,
actor/provenance and tenant metadata even when omitted from the compact columns.

## 2. People, identity and governance tables

| Table | Owner / significant columns | Foreign keys, uniqueness and rules |
|---|---|---|
| `workspaces` | Root: id, name, operational status, configuration references | Security partition, not one business transaction aggregate. |
| `domain_subjects` | Registry: id, kind, aggregate_id | FK aggregate identity; exactly one matching typed subject row; root/child owner verified. |
| `aggregate_heads` | Infrastructure: aggregate_id, revision bigint | One head per mutable root; revision >= 1; only command UoW advances it. |
| `organisations` | Root: identity, legal/display name, default currency | Roles are assignments, not a string that grants powers. |
| `principals` | Root: authentication namespace/external subject, actor type, status | Unique auth issuer+subject within intended identity scope; never store credentials/tokens here. |
| `organisation_memberships` | Organisation/access association: principal_id, organisation_id, role, effective range | FKs both; policy defines nonoverlapping duplicate role grants; membership alone is not execution permission. |
| `travellers` | Root: stable identity, preferred display name reference, lifecycle metadata | No event-derived identity; dedup requires explicit verified mapping. |
| `traveller_names`, `traveller_contacts` | Traveller children: type, protected value/reference, validity, evidence_id | FK traveller; support legal names and multiple contact channels without duplicated provider dossier truth. |
| `profile_assertions` | Traveller child: assertion_type, effective range, evidence_id, typed value | Typed citizenship/residency/accessibility details; conflict/supersession links. Immutable assertion editions, current acceptance under Traveller revision. |
| `travel_credentials` | Traveller child: kind, issuer, protected identifier/reference, current accepted version reference | FK traveller; type discriminator checked against detail table. Do not use plaintext identifier as public identity. |
| `credential_versions` | Immutable: credential_id, issue/validity dates, issuer_status, availability, evidence_id | Accepted version history. Current version selection under Traveller revision; expiry computed. |
| `passport_details`, `visa_details`, `residence_credential_details`, `health_credential_details` | Typed credential-version children | FK version; fields include issuer jurisdiction, restrictions, entries/uses and relevant permitted activity. No arbitrary passport/visa JSON array. |
| `credential_links` | Traveller-owned association: credential_id, related_credential_id, link_type, effective range | Both credentials must belong to same Traveller where semantics require, e.g. visa tied to passport; source evidence mandatory. |
| `travel_history` | Traveller-owned sourced records: jurisdiction_id, entry/exit dates, evidence_id, uncertainty | Partial history explicit; do not claim dataset completeness from row existence. |
| `traveller_relationships` | Root: from_traveller_id, to_traveller_id, relationship_type, effective range, evidence_id | Two distinct valid people; directional guardian relationship remains directional; no automatic grants. |
| `responsibility_assignments` | Root/association: organisation_id, subject_id, role, effective range | Subject kind whitelist for each role; multiple roles/parties permitted. |
| `authority_grants` | Root: principal_id, represented_party_id, issuer, validity, revoked_at, evidence_id | Grant issuer must have issuance authority; subject registry reference is kind-restricted. |
| `grant_actions`, `grant_scopes` | Grant children: registered action kind, scope subject/population, limits | Unique grant+action and explicit scopes; unsupported action kinds rejected, not interpreted as wildcard. |

Profile updates must say whether they correct an assertion, accept an observed
edition or change an intention. A provider-specific passenger DTO is built from
authorized credential/name versions and carries their revision references. It is
not a second canonical table of mutable passport facts.

## 3. Trip, Journey and group tables

| Table | Owner / significant columns | Foreign keys, uniqueness and rules |
|---|---|---|
| `trips` | Root: purpose, lifecycle, intended overall window, business context | Active requires at least one Journey; collective objectives separately owned children. |
| `journeys` | Root: trip_id, traveller_id, lifecycle, intended window | Unique `(trip_id, traveller_id)`; one person cannot have two independently authoritative Journeys in same Trip. |
| `journey_items` | Journey child: kind, order key, lifecycle, flexibility, intended interval | FK Journey; unique stable identity. Typed detail mandatory. Order is not an implicit executable dependency. |
| `transport_item_details` | Journey child: desired origin/destination, selected service_id?, intended time constraints | Service reference is observed fulfilment context, not copied supplier schedule ownership. |
| `stay_item_details` | Journey child: intended place/area, required nights/windows and occupancy needs | Booked dates/room status live on reservation line. |
| `engagement_item_details` | Journey child: participation_id? OR standalone appointment fields | Exclusive choice; referenced participation's Traveller equals Journey's Traveller. Programme time must not also be edited locally. |
| `resource_use_item_details` | Journey child: resource/type, intended location/window, use requirements | Car hire/other asset use; no fake flight-style schedule requirement. |
| `intended_visits` | Journey child: jurisdiction_id, purpose, intended dates, transit intent | Intention distinct from computed encounter; legal applicability is evaluated. |
| `credential_selections`, `credential_selection_scopes` | Journey child: credential_id/version and itinerary/encounter scope | Selected credentials belong to Journey Traveller; selection version participates in manifest. |
| `coordination_groups` | Root: name, purpose, lifecycle, effective range | May span Trips; no duplicate identity hierarchy or main traveller. |
| `group_memberships` | Group child: journey_id, effective range, item-scope links | Unique active equivalent membership; range/item scope permits partial-route coordination. |
| `support_assignments` | Root: constraint_definition_id, supported_traveller_id, assignment lifecycle, evidence | References the governing accompaniment requirement; owns selected fulfilment, not mandatory coverage or eligibility. |
| `support_assignees`, `support_scopes`, `support_handoffs` | Assignment children: selected supporter references, assigned intervals/items and handoffs | Explicit FKs and valid intervals. ConstraintDefinition/operands own required coverage, minimum count, eligible alternatives and separation/handoff limits. Assignment cannot relax them. |

Journey completion is independent from Trip completion; a Trip command closes the
undertaking only with the relevant member/obligation checks. Membership changes
advance the Trip/group scope generation even though Journey is an independent root.
Changing accompaniment affects every covered person and coordination scope.

## 4. Services, arrangements and accounting tables

| Table | Owner / significant columns | Foreign keys, uniqueness and rules |
|---|---|---|
| `transport_services` | Root: mode, operator, origin/destination, published/estimated/actual instants, observation references | Times remain separate field groups. Identity correlated from provider/service occurrence evidence, not route+day alone. |
| `resources`, typed resource details | Root: type, place/location, capacity and operating properties | Resource identity not an allocation; additive types for vehicles/rooms/equipment. |
| `reservations` | Root: reservation type, parties/responsibility links, observed aggregate context | External identity through verified links; canonical booking not owned by first Trip to import. |
| `reservation_lines`, typed line details | Reservation child: product type, observed status, terms/evidence, service/resource/place references | Store product-specific stay dates/transport references/asset use. No Journey status masquerading as supplier state. |
| `reservation_allocations` | Reservation child: line_id, traveller_id, journey_item_id?, allocation role/quantity | FKs line/person; item optional only before assignment or where no Journey exists. If present item person matches allocation person. Unique equivalent allocation tuple. |
| `service_entitlements` | Root: issuer, type, observed status, protected identifier, evidence | Separate ticket/coupon/voucher right from booking confirmation. |
| `entitlement_components`, `entitlement_line_links`, `entitlement_person_links` | Entitlement children: reservation_line_id, traveller_id, use/exchange linkage | Preserve exchange predecessor/successor identity and component status; no overwriting old ticket as new. |
| `offers`, `offer_items`, `offer_eligibility` | Immutable quote: account, source, price/currency, terms, expires_at, eligible party/agreement | Quote fingerprint includes eligible context; expired/stale quote not execution authorization. |
| `commercial_agreements`, `agreement_versions`, `agreement_scopes` | Root with immutable published terms and eligibility/account associations | Negotiated/private availability requires valid agreement scope, not Trip membership. |
| `accounting_dimensions` | Organisation-owned: namespace, external key, display name, validity | Unique organisation+namespace+external key. |
| `accounting_assignments` | Scoped association: dimension_id, subject_id, allocation basis | Subject kind validated; intended assignment distinct from actual transaction evidence. |
| `cost_allocations` | Financial association: action/obligation, payer_id, exact amount/currency, accounting refs, evidence | Intended and actual entries distinguished; explicit external reconciliation. |
| `budgets`, `budget_commitments`, `budget_entries` | Budget root and action-linked hold/settlement/release records | Unique action+budget hold identity; exact sums serialized for authorization. Unknown execution cannot release funds as if failed. |
| `fx_observations` | Immutable quote/rate evidence: currencies, rate, as_of, source, expiry | Unique source+pair+edition; use explicit rate and rounding in assessment/approval manifest. |

Shared reservations require allocation-level queries and line-level observation.
Group split capability is an adapter contract: schema support must not imply the
supplier can split. Refund/credit or compensation remains observed financial state,
never inferred from an HTTP success alone.

## 5. Programmes, places and spatial scope tables

| Table | Owner / significant columns | Foreign keys, uniqueness and rules |
|---|---|---|
| `events` | Root: title, organiser, lifecycle | Organisation responsibility references; independent Programmes. |
| `programmes` | Root: event_id, title, lifecycle, scheduling configuration references | FK Event; several Programmes allowed. |
| `programme_items` | Programme child: title/type, place_id, start/end/timezone, lifecycle, operating properties | Valid schedule when scheduled; cancellation persisted here. Child mutation advances Programme head. |
| `participations` | Programme child: programme_item_id, traveller_id, obligation, preparation/release windows, acceptance, attendance | Unique item+Traveller. At most one authoritative association with multiple role children; no Journey required. |
| `participation_roles` | Programme child: participation_id, registered role | Unique participation+role. |
| `resource_assignments` | Scheduling-owner association: activity_id, resource_id, quantity, allocation lifecycle | Activity kind checked; references schedule owner, not a second editable time. Capacity/exclusivity checks serialized. |
| `places`, `place_external_refs`, `place_associations` | Root: name/type, timezone, coordinates; provider refs; parent/operational association | Unique provider namespace+external key in scope; associations do not automatically imply legal jurisdiction. |
| `geographic_areas`, `area_versions` | Root with immutable geometry editions: valid range, geometry, evidence | PostGIS geometry and CRS contract fixed in M0; validate geometry; editions preserve geography history. |
| `area_memberships` | Versioned geographic association: place/area, containing_area, valid range | Explicit FK/kind checks; point matching can be derived but curated legal memberships remain sourced. |
| `jurisdictions`, `jurisdiction_areas` | Root and effective m:n association to area editions | Distinguish legal regime from geographic country and operational airport. |

For an internally mutable schedule, concurrent allocation and rescheduling must
validate resource capacity and participation constraints against the same invariant
transaction. Lock the relevant scheduling/resource roots in stable order or use
SERIALIZABLE predicate protection and bounded retries. For external observations,
record an actual conflict rather than rejecting reality because a desired invariant
has become false; mark impacted assessments and recover. Admission commands and
observation acceptance have different duties.

## 6. Requirements, provenance and external information tables

| Table | Owner / significant columns | Foreign keys, uniqueness and rules |
|---|---|---|
| `objectives`, `objective_targets`, `objective_dispositions` | Trip/Journey/group/Programme children: typed success, priority/hardness, target refs; immutable waiver/loss evidence | Owner kind restricted. Disposition requires authority; no assessment PASS/FAIL field. |
| `constraint_definitions`, `constraint_operands` | Requirement-owner children: registered type, hardness, parameter schema, subject operands, provenance | Type validates operand kinds and bounded expression. Definition does not own evaluation status. |
| `dependencies` | Explicit scoped association: from_subject, to_subject, CONNECTS_TO or REQUIRES, constraint_id | Owner explicit. Unique semantic edge; REQUIRES references executable predicate, not arbitrary text. Index both directions. |
| `rule_sets`, `rule_set_versions`, `rules` | Root and immutable published editions: issuer, kind, effective interval, typed expressions | Published bodies append-only; correction/new edition required. Version selection/effectiveness not blindly latest. |
| `rule_assignments` | Root/association: policy family/edition rule, subject/org/population/geography scope, validity | Add/remove changes applicability generation; exact matching rules registered. |
| `preferences` | Traveller/scoped owner: kind, explicit/inferred source, value, precedence, validity | Explicit instructions outrank inferred preferences; schema-bound values. |
| `source_records`, `source_content_refs` | Immutable capture: source identity, received time, hash, content type, protected location, retention/access | No secret raw content in general audit or logs; raw revision history preserved by content hash. |
| `evidence_records`, `evidence_subjects`, `evidence_sources` | Immutable normalization: assertion/observation type, observed/issued times, schema version, interpretation provenance | M:n subjects and captures; no silent evidence rewrite. Typed indexed fields extracted for evaluation. |
| `information_records` | Publisher-lineage root: source/connection, external publication key, topic | Unique publisher+publication key; current accepted knowledge is source-specific. |
| `information_versions` | Immutable edition: record_id, external edition/sequence, issued/received/observed/effective times, evidence, supersedes/retracts | Duplicate same key+different payload is conflict, not overwrite. Out-of-order receipt cannot win automatically. |
| `advisory_details` | InformationVersion subtype: source-native severity, risk topics and meanings | No universal normalized authoritative severity replacing original meaning. |
| `condition_details`, typed condition extension tables | InformationVersion subtype: condition type, forecast target, uncertainty model/schema | Add typed weather/other details where needed; raw payload alone does not implement consequence semantics. |
| `regulatory_publications` | InformationVersion subtype: exact external rule_set_version_id | Publication owns metadata/provenance, rule version owns executable obligations; no two mutable rule copies. |
| `information_scopes` | Version child: area/jurisdiction/population/subject, effective exposure interval | Typed scope operands and geometry/time queries; broad scope not expanded into canonical traveller edges. |
| `knowledge_coverage` | Immutable: query/feed bounds, topic/jurisdiction/population, edition/watermark, completeness/limitations, expiry | Evidence for what was checked; incomplete coverage cannot produce unqualified PASS. |
| `source_sync_state` | Root: connection/feed identity, accepted cursor/watermark, last successful coverage ref | Update atomically with accepted editions/work; sync success is not a claim that real world is safe. |

Authority and freshness are not one numeric rank. Preserve source authority for
the topic and legal/operational scope, observation time, effective time, uncertainty
and coverage separately. Information can be captured even when its interpretation
is unsupported; it must remain explicitly unassessed/UNKNOWN where relevant.

## 7. External ownership and resolution tables

| Table | Owner / significant columns | Foreign keys, uniqueness and rules |
|---|---|---|
| `external_connections` | Root: organisation/account, provider kind, protected auth reference, capability configuration | No secrets in ordinary rows; capability does not replace grant. |
| `external_records` | Root: connection_id, record_type, external_id, observed ordering metadata | Unique connection+record_type+external_id; locators alone across systems do not merge records. |
| `external_record_links` | Versioned association: external_record_id, canonical_subject_id, evidence_id | Verified correlation; preserve multiple systems of record without duplicate canonical ownership. |
| `ownership_bindings` | Root/association: subject_id, field_group, owner_kind internal/external, connection/source, validity, binding_state proposed/current/historical | Partial unique `(subject_id, field_group)` WHERE binding_state = current, independent of wall clock. A transfer command reconciles and atomically makes old binding historical and proposed binding current. Future proposals never activate automatically. |
| `change_requests`, `change_request_targets` | Root: requester, desired typed change/constraints, lifecycle, target links | Immutable request revisions; accepted for planning is not observed fulfilment. |
| `change_signals`, `signal_subjects` | Immutable: causal origin/key, change type, evidence and subject/scope links | Causation and correlation IDs; idempotency identity defined per origin. |
| `recovery_cases`, `case_subjects`, `case_signals` | Root: lifecycle, resolution, scope and signals | Multi-subject. Open-case lookup by subject; overlap policy coordinates work rather than pretending all cases are disjoint. |
| `recovery_strategies`, `strategy_changes` | Case-owned immutable candidates: version, typed scenario effects, evaluation refs, selection disposition | New content = new version; no mutable current-world entities inside strategy. |
| `assessments`, `assessment_results` | Immutable: kind, evaluated_at, evaluator versions, expiry, typed verdicts/reasons | PASS/FAIL/UNKNOWN and explicit loss/policy dimensions; not canonical profile/Trip health. |
| `assessment_subjects` | Immutable: assessment_id, assessed_subject_id, result scope/role | Names whose eligibility/support/viability was evaluated, distinct from input dependencies. Results link to these target scopes. |
| `assessment_inputs` | Immutable manifest rows: aggregate revision, scope generation, evidence/coverage edition | Uniqueness assessment+input kind+identity; reverse lookup supports invalidation. |
| `action_plans`, `action_intents`, `action_dependencies` | Case-owned versioned plan: typed command/capability, preconditions, costs, observations, failure/compensation and dependency links. Intent owns immutable operation_namespace, logical_operation_key and request_fingerprint once dispatch is prepared | Dependencies same plan and acyclic. Unique workspace+operation_namespace+logical_operation_key on Intent; namespace identifies external connection or internal executor. Different request cannot reuse key. |
| `case_action_links` | Association: referencing_case_id, action_intent_id, role | Unique case+intent. Intent remains owned by one plan/case; reference grants no extra authority and does not duplicate execution. |
| `authority_decisions`, `approval_requirements` | Immutable decision: exact plan/intent version, actor/represented party, required scopes, AND/OR grouping, limits | Multiple simultaneous requirements; currentness from manifest/grants/time. |
| `approvals`, `approval_revocations` | Immutable: authenticated approver, requirement, envelope/fingerprint, amount/scope, evidence/time | Approval matches exact envelope. Revocation is a new record; cannot silently widen original authority. |
| `execution_attempts` | Action-owned durable per-dispatch workflow: action_intent_id, attempt_number, claim/lease/fencing token, status, request/response refs | Unique intent+attempt_number. All attempts reference the same Intent-owned logical operation key/fingerprint. One active dispatch claim per intent; uncertain prior outcome must reconcile before resend. |
| `execution_observations` | Immutable: attempt/action, accepted evidence, external record, observed outcome | Success scoped to accepted observed fields; internal command receipt can be observation. |

Keep external attempts distinct from business intent. A second network dispatch is
not automatically a new logical operation. A lease expiry after dispatch requires
reconciliation, not a fresh purchase key. Conditional unique indexes and state
guards prevent concurrent workers from claiming the same action. Two separate
actions trying to modify the same reservation also require conflict checks on the
reservation/operation scope, not just per-intent deduplication.

No current binding, or a current binding outside its validity range, means no
supported mutation owner for that field group. It does not imply internal ownership.
Include ownership-binding revisions and validity boundaries in assessment/action
manifests. A future transfer remains proposed until an authorized reconciliation
command activates it; this avoids a time-dependent uniqueness race.

## 8. Durability, audit and derived storage tables

| Table | Significant columns / mutability | Required rules |
|---|---|---|
| `inbox_deliveries` | source connection, delivery key, payload hash, source ref, received time; immutable capture | Unique source+delivery key. Same key/different hash is quarantined conflict. |
| `inbox_work` | delivery_id, handler/target key, state, attempts, lease, next_run_at, error | Unique delivery+handler+target. Receipt does not mark work done. A leased worker resumes unfinished processing. |
| `outbox` | committed signal/command publication, destination kind, payload ref, ready/claim/delivery metadata | Created in same transaction as state mutation. Delivery at least once; consumers idempotent. |
| `command_receipts` | workspace, command namespace/key, payload hash, result ref, committed revisions; immutable | Unique namespace+idempotency key. Same hash returns original result; changed hash fails. |
| `change_records` | transaction/command/actor, subject, before/after revision refs, evidence, reason; immutable | Records authoritative accepted change. Protect sensitive values; history need not embed every raw document. |
| `scope_generations` | scope kind/id, generation bigint | Atomic increment with membership/rule/info changes. New scope starts defined generation; omitted scope never implies complete read. |
| `scheduled_reassessments` | assessment/scope, invalidate_at, state, claim, next retry | Durable time invalidation and downtime catch-up. |
| `exposure_index`, named read-model tables | Derived subject/geography/time/population summaries and source generations | Rebuildable. Reject stale index as sole proof of unaffected scope before consequential action. |
| `legacy_id_map` | source dataset/type/id -> target identity with mapping evidence | Unique source identity mapping; multiple legacy identities may map to one target only with evidence. |
| `migration_runs` | dataset hash, exporter/importer version, progress, validations, reconciliation exceptions | Resume idempotently; incomplete imports never become authoritative runtime. |
| `schema_migrations` | ordered version, checksum, applied_at | Fail on checksum drift; do not overwrite history. |

## 9. Constraint and index checklist

M0 must encode and M1/domain migrations must test these constraints:

1. Workspace-safe FKs on all canonical/association rows.
2. One Traveller per Journey and unique Trip+Traveller; active Trip has members.
3. Registry kind and owner consistency; child updates require root revision.
4. Engagement references participation or a standalone appointment exclusively.
5. Participation and reservation allocation person matches the linked Journey.
6. Credential selection and linked document ownership are consistent.
7. Exactly one active field-group owner; ownership transfer is audited.
8. Source/command/provider keys deduplicate equal payloads and reject collisions.
9. Published information, rules, evidence, assessments and approvals are immutable.
10. Resource/capacity and budget admission serialize competing commands.
11. Action dependency DAG is acyclic and authority covers each required action.
12. One active intent dispatch claim plus shared reservation/action-scope conflict
    protection; unknown attempts cannot be discarded as ordinary retry failures.

Indexes must follow actual operations rather than indexing every field:

- Journeys by Traveller, Trip and active travel window; items by Journey/order.
- Reservation allocations by Traveller, JourneyItem and line; service to line and
  JourneyItem reverse lookup for shared disruption.
- Participation by item and Traveller; ProgrammeItems by Programme/time/place.
- Dependencies in both directions; requirement operands by referenced subject.
- Membership/support scopes by Journey/Traveller and interval.
- Rule assignments by organisation/subject/jurisdiction/population and validity.
- Information by publisher/topic/jurisdiction and effective interval; area geometry
  GiST and exposure time/range indexes. Apply exact spatial check after candidate
  lookup where bounding-box filtering is used.
- Assessment inputs by aggregate/scope/evidence and expiration; pending reassessment
  by due time; current projection keys include generation.
- Open case subjects; actionable intents; pending inbox/outbox/attempts by state
  and next_run_at. Use partial indexes for runnable work, not whole-history scans.
- External record identity unique indexes; provider operation/idempotency keys.
- Credential selections and rule use reverse links for document/requirement changes.
- Grants by actor/scope/action/effective time; budget commitments by budget/status.

Use representative query plans during M6/M9 integration to validate broad geographic
and shared-object access. Fine-grained performance tuning is not an excuse to omit
conservative correctness when scope is incomplete.

## 10. JSON policy

Bounded JSON is appropriate for immutable raw/provider capture metadata, a typed
versioned rule expression, scenario/action payload of a registered schema,
explanation/reason detail, provider-specific private extension fields and
uncertainty distributions whose semantics are declared by a typed evaluator.
Validate schema, size and version at every boundary; extract queried/related fields
into columns and association rows.

JSON is explicitly inappropriate for mutable Trips, Journeys, Programmes,
Reservations, Traveller documents, cases with nested action history, relationship
ID arrays, provider identity keys, current lifecycle/authority/viability truth,
money used for concurrent limits, or an untyped extensibility bucket. Raw source
capture may contain arbitrary material; canonical acceptance still requires typed
validation and provenance.

## 11. Command, snapshot and concurrency contracts

### 11.1 Domain command

The application-facing command envelope must carry:

```text
commandType + schemaVersion
workspaceId + actorPrincipalId + representedPartyId
idempotencyKey + canonicalPayloadHash
expectedAggregateRevisions[]
basisAssessmentId + exactPlanVersion (required for assessed/reviewed changes)
typedPayload
causationId + correlationId + evidenceRefs[]
```

Command execution:

1. Validate schema, tenant access, actor and typed ownership/mutation permission.
2. Begin short transaction. Look up/claim idempotency receipt; return committed
   result for equal payload, reject a mismatched key.
3. Load/lock affected aggregate heads in stable identity order. Validate all
   expected revisions and relevant collection generations.
4. Validate domain admission invariants, including referenced people/objects,
   resource/support constraints and authority for internally controlled changes.
5. Persist typed changed rows, advance every changed root exactly once, increment
   affected scope generations, append history/signal/outbox and command receipt.
6. Commit. Return changed identities/revisions and queued work references.

A reviewed/assessed command loads the immutable basis assessment/plan manifest and
compares its aggregate revisions, scope generations and time bounds with current
state. The server cannot substitute newly read generations and call an old review
validated. A simple command may omit that basis only when its full admission checks
are recomputed inside the transaction; it cannot implicitly reuse an old approval.

A conflict is a typed stale-revision outcome, not an unconditional upsert. Never
load mutable state before the transaction and then overwrite an unseen newer state.
Never call a model/provider while locks are held.

For independent simple commands, expected revisions and row locks suffice. For
cross-root allocation, budget and membership predicate invariants, use explicit
shared invariant locks and/or SERIALIZABLE with bounded whole-transaction retry.
Retry logic re-reads state and recomputes invariants; it does not replay an old
decision blindly. Exhaustion returns a meaningful conflict, not partial success.

An external observation may reveal that a real-world constraint is violated.
Accept credible owned observation and invalidate/recover; do not reject provider
reality to keep an old viability result green. Observation still validates schema,
identity, ordering, source authority and ownership.

### 11.2 World snapshot and assessment

Build a read-only WorldSnapshot in a consistent database snapshot (normally
REPEATABLE READ), containing canonical typed objects and all applicability scope
generations read. Readers return both selected rows and the scope/coverage they
examined, including empty result sets. Use effective itinerary projections rather
than persisted copied times/status.

Evaluation can run outside the read transaction on the captured immutable world
slice. Store its result and manifest; on selection/dispatch compare with current
heads/generations and clock. A snapshot need not block writers while AI plans.
Missing data/readers/coverage yield explicit UNKNOWN and scope uncertainty.

The AssessmentManifest shape is normative in the architecture closure. Insertion
of an applicable rule, group member, publication or ownership change invalidates
the relevant scope even when none of the old read rows changed. Time invalidation
also works without any incoming event. Derived index rebuild is fenced by source
generation; an incomplete index cannot be certified current.

### 11.3 External execution and reconciliation

1. Select a typed action from a viable scenario, or an explicitly permitted
   evidence-gathering/manual path. Verify required independent approvals and grants.
2. Refresh/revalidate input manifest, quote, ownership, provider capability and
   exact costs. Claim the intent/shared action scope and reserve budget in one
   transaction. Persist prepared attempt with stable operation key/fingerprint.
3. Commit before dispatch. Mark durable dispatch state according to the worker
   protocol; the crash window is treated as possibly sent, not safe to repurchase.
4. Dispatch through the adapter. Use provider idempotency if supported; retain the
   same logical operation identity. No capability may claim idempotent retries
   unless the provider contract/evidence supports it.
5. Store result evidence and normalize observation. Timeout/lost reply becomes
   outcome_unknown. Lookup/observe before resend; if safe lookup/retry cannot be
   established, escalate without a duplicate action.
6. Reconcile only source-owned fields in a domain transaction with attempt result,
   budget settlement/hold status, change records and outbox. Stale/out-of-order
   observations retain evidence without overwriting newer accepted source state.
7. Recompute affected closure. A completed API call does not resolve the case until
   mandatory objectives/requirements and uncertain operations are reconciled.

Internal programme action instead invokes the authorized revision-checked command;
its committed receipt is authoritative observation. There is no simulated provider
confirmation needed for internally controlled state.

World changes immediately after dispatch are unavoidable. Record them, invalidate
remaining actions and reconcile real outcomes. Database serializability cannot
provide atomicity with a supplier or guarantee that future information never changes.

## 12. Repository and worker boundaries

Expose typed repository readers and domain command handlers through a UnitOfWork.
Do not expose `save(anyEntity)` or direct SQL from the engine. The assessment engine
consumes a WorldSnapshot/EvaluationContext interface. The planner outputs typed
ScenarioChanges. The action compiler outputs typed ActionPlans, while adapters
implement declared capabilities and normalized observations.

Workers use claim leases, monotonically advancing fencing tokens and bounded retries.
Every worker-owned state transition compares the current token. Where transactional,
handler domain changes, cursor/checkpoint advancement and work completion commit
together. A stale worker cannot mark its replacement's work complete. An expired
dispatch claim enters reconciliation rather than granting an independent fresh
dispatch. Database fencing cannot fence a supplier call already in progress;
provider idempotency and observation/reconciliation handle that external boundary.

Queue rows are durable even if a
process restarts. Processing a shared programme/information change commits one
authoritative update and outbox notification, then creates resumable per-target
assessment work. Partial fan-out does not require rolling back the real state
change. Until dependent assessment completes, its projection is pending/stale,
never silently current. PostgreSQL outbox/inbox workers are sufficient initially;
an external broker may be added later without changing command truth.

Audit is append-only change history plus immutable evidence/decisions and source
capture. Current tables are authoritative; replaying all audit events is not a
requirement for ordinary reads. Backups, restore drills and operational retention
remain necessary and are a cutover gate in the implementation plan.
