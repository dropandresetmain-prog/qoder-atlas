# A3 new-stay proposal — architecture gap and next seam

Status: proposed-stay contract frozen for stage 1; entry/composite/observation integration remains open. 2026-09-20.
Required by [hero depth](ASTRA_HERO_DEPTH_SCOPE.md), not general hotel parity.

**WHAT WE KNOW**

- Normal boot advertises composed FLIGHT research only. The hotel adapter exists outside
  this planner path. Existing overnight and entry/transit evaluators provide deterministic
  semantics; a new legality/recovery engine is unnecessary.
- `ScenarioEffect` has no effect for adding a stay. The overlay operates on existing
  itinerary items; offer execution bindings require an existing journey item; normal
  protected offer execution observes transport/Atlas results only.
- The historical M9 multi-action PG test proves dependency/partial-failure infrastructure
  using seeded plans and fake provider boundaries. It does not prove a normally planned,
  live-researched, newly added hotel stay through current product boot.
- A new Narita stay cannot currently complete proposal -> viability -> authority ->
  booking -> observation -> canonical addition. Preseeding a fake booking is not a fix.
- Founder confirms prior Nuitée Narita viability proof and known unsupported modify API.
  If Singapore shortens three to two nights, model explicit cancel + rebook actions;
  reuse prior provider viability evidence, do not repeat broad adapter archaeology.
- Reusable provider proof: `fca63dcc47f65fa5b022f9594eadef32d90c24b2` Narita real
  sandbox search/quote/book/retrieve/cancel recordings; `005d055` and
  `WIT_JORDAN_CONCORDE_CAPTURE_REPORT.md` Singapore baseline/recovered captures.
  The capture report's actual dates are 29 Sep–3 Oct (four nights) and 30 Sep–3 Oct
  (three nights), both historically nonrefundable with full cancellation fees. These
  are historical quotes, not current prices. Runtime must calculate nights from dates,
  compare retention/no-show consequences with cancel+rebook, and use fresh provider policy.
  The founder three-to-two example describes the required operation model, not permission
  to relabel four calendar nights as three or force an uneconomic cancellation.

**WHAT WE DO NOT KNOW**

- Exact minimum candidate-stay fields required by effective-world, entry encounter and
  overnight evaluators; which existing authoritative place/jurisdiction facts are missing.
- Whether proposed item refs can appear in current action/authority contracts before
  registration. They must not be mistaken for existing canonical scope.
- Hotel quote/cancellation/sandbox semantics, unknown-outcome lookup support and required
  protected guest/contact evidence; actual selected Singapore stay consequence.

**KEY ASSUMPTION**

A closed typed new-stay effect can preserve the frozen boundaries: proposed itinerary
exists in the strategy overlay, authority binds existing owning Journey/Trip plus exact
proposal/offer, durable execution precedes network, and confirmed observation atomically
creates canonical stay/reservation/allocation with idempotent identities. Unconfirmed
outcomes keep current world unchanged and require reconciliation before retry.

**WHAT SHOULD BE TESTED NEXT**

1. Freeze the bounded new-stay contract after checking authority and observation owners.
2. Prove a synthetic non-scenario-specific overnight candidate closes the real evaluator
   gap in memory, with zero canonical rows before execution; missing entry inputs remain UNKNOWN.
3. Prove compilation, exact scope/price/freshness validation, durable attempt-before-network,
   observed canonical creation/reassessment, repeated observation idempotency and unknown
   outcome no-redispatch, using only external-provider boundary fakes in focused PG tests.
4. Compose real hotel research/execution for supported sandbox actions, then prove normal
   boot/product evidence. Live provider semantics must be verified before those calls.

**Act Now:** generalized proposed-new-stay support for Jordan. Deferring blocks required
hero depth. Investigate bounded authority/observation seams before parallel implementation.
**Park for Later:** arbitrary itinerary editing, general travel composer, hotel operations
unneeded by the selected heroes. Do not expand effect vocabulary speculatively.

Likely seams: `ScenarioEffectSchema`, scenario overlay, ActionPlan compiler, provider-neutral
stay offer binding, protected stay executor/observation, canonical stay commands and normal
composition. No transport-specific binding reuse or new persistence tier.

Entry-source discovery for later verified ingestion: [MOFA visa exemptions](https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html)
and [Japan Embassy Singapore FAQ](https://www.sg.emb-japan.go.jp/itpr_en/visa_faq.html).
These are sources to retrieve with provenance and evaluate against declared travel-document
facts; they do not establish any traveller's admission. Programme/input pack says SG while
booking dossier says US: reconcile authoritative fixture truth before provider use.

## Additional bounded composition findings — 2026-09-20

**WHAT WE KNOW:** `coordinatorCore.ts` currently researches before running per-domain
proposers and evaluates each candidate immediately. A flight and a necessary overnight
stay must be evaluated as one effect set; independently approving two incomplete options
is not whole-trip recovery. Existing `deriveEncounters` derives transit from transport and
entry from intended visits, but not landside entry from an added stay. Overnight coverage
is enforced only when an `overnight_accommodation_required` constraint is present; current
normal dataset materialization does not load that requirement.

**WHAT WE DO NOT KNOW:** the smallest shared evidence/proposer binding needed to propose
flight-plus-stay candidates; which existing typed visit/credential commands can supply the
landside encounter in the proposed world; current sandbox-safe protected contact inputs.

**KEY ASSUMPTION:** one bounded multi-effect proposer/evidence composition can reuse the
existing coordinator, RC-6 and action plan. Required accommodation/entry semantics must be
explicit typed source/proposal facts. Neither UI context nor successful flight booking can
substitute for their deterministic assessment.

**WHAT SHOULD BE TESTED NEXT:** after A2, prove a synthetic flight-only candidate fails a
real overnight requirement, a flight-plus-stay candidate still stays UNKNOWN without entry
coverage, and the fully evidenced composite passes. Do not implement isolated hotel booking
and claim this composite planning seam is complete.

Canonical observation decision: existing public commands each open their own transaction.
Do not nest them and call the result atomic. Prefer one bounded typed observed-stay command
using existing repositories, validation, aggregate revision locks, audit/outbox and receipt
rules for item/reservation/line/allocation, with zero partial canonical graph on failure.
Exact API contract is still to be frozen after A2.

- **Act Now for A3:** composite proposal and entry encounter/evidence composition; omission
  would permit a false flight-only recovery or make the required overnight unplannable.
- **Investigate Now for A4/A5:** Reset currently removes workspace execution state. Establish
  safe handling of unresolved external outcomes and confirmed sandbox bookings before repeat
  hero runs; do not delete reconciliation identity and then redispatch blindly.
- **Park for Later:** broad full-programme regeneration alignment. The historical generator
  currently drops accepted provider/place/itinerary enrichment; do not rebuild the accepted
  programme wholesale merely to fix a dossier. Revisit when full source regeneration is needed.

Prepared data closure (not integrated into A2): `codex/a3-canonical-dossier-reconciliation`
@ `710faf584fbb49b96e58ff0fd289e22536bbe152`, four focused tests and TypeScript passed.
Windows path normalization fixes silently skipped dossier discovery; `--dossiers-only`
regenerates SG nationality and source stay dates without touching `programme.json`.
The contradictory overnight-baseline note is corrected; no gender/contact facts invented.
## Stage 1 frozen implementation boundary

**WHAT WE KNOW:** a proposed stay is a Journey-owned itinerary intention; its provider
confirmation belongs to observed reservation state. Current WJourneyItem already supports
STAY, intended place/window and required nights. A hotel search result must not fabricate
reservation, allocation or observed-status rows merely to make an overlay pass.

**KEY ASSUMPTION:** ADD_JOURNEY_STAY carries proposedJourneyItemId, existing journeyId,
orderKey, offerId and exact offerPrice. A separate resolvedStayOffers collection supplies
existing captured placeId, stayWindow and price. Validate identity/ownership, exact price,
positive interval and canonical-timezone nights; no proposed ID collision. The cloned overlay
adds only the proposed STAY. Action compilation uses existing JOURNEY + OFFER scope,
journey.stay authority, captured Journey revision, exact effect fingerprint and explicitly
composed external:stay.book capability. Missing capability/revision refuses compilation.

**WHAT WE DO NOT KNOW:** the final proposed IntendedVisit/document-selection attachment and
atomic observed-stay command. An accommodation PASS alone does not establish entry legality.
These remain integration prerequisites; stage1 is not A3 acceptance or dispatch permission.

**WHAT SHOULD BE TESTED NEXT:** synthetic flight-only FAIL versus flight+stay accommodation
PASS, input rejection and immutable base world; then the full composite remains UNKNOWN
without exact current entry evidence. Terra owns isolated stage1 implementation. Luna owns
separate explicit sandbox identity/budget provisioning (CLI only, no invented production
values) and exact Journey/visit coverage matching. Root owns integration and acceptance.

**Act Now:** scope legal coverage to the researched Journey/visit. Existing entry coverage
lookup checks only topic/jurisdiction; a narrow complete answer must not confer completeness
to another traveller. Existing synthetic broad ENTRY coverage in the dataset is not live legal
research and must not be used to certify the added overnight entry.

**Investigate Now:** express the overnight requirement as explicit Journey-scoped source data.
Do not make every destination hotel cover every minute between arrival and return departure.
The current Jordan journey has two outbound transport items plus its Singapore stay; its
connection overnight requirement can use the existing evaluator without changing Sarah.

## Updated Nuitée documentation evidence

Current official [booking API](https://docs.liteapi.travel/reference/post_rates-book) documents
clientReference duplicate protection and sandbox ACC_CREDIT_CARD simulation. The official
[booking-list API](https://docs.liteapi.travel/reference/listbookings) supports clientReference
lookup. This is newly verified provider documentation, not proof our current adapter implements
it or that a live lost-response path has been exercised. Add bounded read-only lookup and verify
exact returned booking terms before reconciliation. Empty/ambiguous lookup never licenses blind
redispatch. Cancel/rebook remains separate authority and observation for each action.

**Act Now:** compose lookup for unknown booking outcomes before A4. **Park for Later:** general
hotel booking administration/history UI and unsupported in-place modify. Root reviewed the
external/reset lease and guard; integrated at94454f4, preparation checkpointb9c7af3. Any external
attempt/observation blocks destructive demo reset; future repeats retain prior workspaces.
Official-document retrieval foundation: `OfficialDocumentReader` accepts only configured
source IDs, bounds size/time, rejects redirects/unsupported content, and retains publisher,
URL, observation time and sanitized-content hash through shared LIVE/RECORD/REPLAY normalization.
It emits evidence text, never a legal verdict or published rule. Four focused tests and
TypeScript passed. Actual RECORD reads on2026-09-19 at23:32UTC fetched both catalog sources;
local ignored proof is `output/playwright/a3-official-source-proof.json` with sanitized recordings.
This is adapter/source proof, not normal-boot Jordan entry acceptance. No private model
reasoning, provider credentials or legal source assertions were fabricated.

## Stage 2 frozen landside-stay association

**WHAT WE KNOW:** ADD_JOURNEY_STAY stage1 and read-only Nuitée client-reference
lookup are integrated at5669f2c. Existing IntendedVisit and CredentialSelection are
Journey-owned intent; credential editions remain Traveller-owned immutable evidence.
Without a visit, a candidate hotel could evade the entry evaluator entirely.

**KEY ASSUMPTION:** every newly proposed landside stay in this bounded capability must
carry `visit`, either EXISTING `{ visitId }` or PROPOSED `{ proposedVisitId,
jurisdictionId, purpose, intendedWindow, credentialSelections: [{ proposedSelectionId,
credentialId, credentialVersionId }] }`. Existing visits must belong to the same Journey,
be landside, cover the stay, and match a captured jurisdiction of the stay place. Proposed
visits obey the same interval/jurisdiction checks and enter only the cloned world with
`transitIntent: false`. Empty selections are permitted as missing evidence, producing the
real evaluator UNKNOWN. No credential metadata can be invented by an effect.

Each selected edition must be captured, belong to the owning traveller and the stated
credential. Duplicate IDs/credential choices and collisions are rejected. When an existing
Journey selection already pins that credential, extend its visit scope only if the version
matches; do not silently replace its pinned edition. The accepted full effect is fingerprinted
under `journey.stay` authority. This authorizes the stay's stated visit/document-use intent,
not mutation of credentials or disclosure of protected document contents. No canonical
visit, selection, stay, reservation or allocation appears before confirmed observation.

**WHAT WE DO NOT KNOW:** final atomic observed-stay command and normal research composition.
The provider action remains unavailable until those contracts and protected inputs are wired.
Airside hotels, domestic-stay exemption inference and arbitrary visit editing remain parked.

**WHAT SHOULD BE TESTED NEXT:** flight plus accommodation with a proposed landside visit
must remain UNKNOWN without selected current document and scoped entry evidence; verified
inputs must drive the real credentials/entry evaluators. Wrong owner, wrong jurisdiction,
non-covering visit, malformed dates and conflicting selection fail before persistence.
Preserve the immutable base world and same Journey authority in all tests.

Passport presentability closure: current credentials evaluator stored but ignored
`physicallyAvailable`. For a selected passport, false now fails and missing availability
is UNKNOWN; electronic authorisations do not acquire a physical-possession requirement.
This was Act Now because landside overnight feasibility cannot rely on a passport that
cannot be presented. Credentials and scoped-entry evaluator editions advance to2 so the
assessment manifest distinguishes these semantics. Focused/adjacent evaluator tests57/57
and TypeScript passed. No canonical credential facts were authored or changed.
