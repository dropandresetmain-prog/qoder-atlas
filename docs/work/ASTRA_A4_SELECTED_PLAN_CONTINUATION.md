# Selected composite plan continuation

Status: **IMPLEMENTED / PHYSICALLY PROVEN IN A4.** This remains the bounded contract for selected-plan continuation; it is not a general workflow framework.

WHAT WE KNOW: the selected composite strategy contains a flight, overnight stay,
destination replacement and cancellation. Each confirmed canonical mutation advances
Journey state. The existing stored gate correctly refuses stale strategy bases. Fresh
planning after the flight cannot currently preserve the pending hotels because hotel
preparation depends on the original connection failure. Current ActionPlan primitives,
authority, durable attempts, observations and deterministic evaluation remain the owners.

WHAT WE DO NOT KNOW: the final live composite recommendation and external outcomes;
whether every current persistence contract can hold the exact continuation evidence.

KEY ASSUMPTION: continue the exact approved remaining effects after fresh deterministic
whole-trip evaluation. Do not introduce a general Journey stale exemption, new planner,
healthy-request path or workflow engine.

WHAT SHOULD BE TESTED NEXT: expected own-action mutations permit one next action;
unrelated edits, unknown outcomes, changed terms or entry evidence refuse dispatch.

## Physical acceptance note

A4 physically proved continuation across the selected flight → overnight stay → destination replacement stay → displaced-stay cancellation path. The real run exposed and closed compound canonical-footprint accounting: one ActionIntent/attempt may create multiple exact command receipts and related JOURNEY/TRAVELLER scope bumps. Continuation now derives the expected same-plan footprint from durable receipts/command namespaces and authoritative fresh capture rather than fixed revision increments. Unknown outcomes remain reconcile-only; unrelated changes still fail closed.

Accepted A4 product SHA: `546adf210db8ead343ecdac22b410515665c176a`. Detailed evidence: [A4_PHYSICAL_SANDBOX_ACCEPTANCE.md](A4_PHYSICAL_SANDBOX_ACCEPTANCE.md).

## Bounded contract

- Persist immutable source effect index/fingerprint for each compiled action. Explicitly
  link a replacement stay to its displaced reservation line; never infer the pair from
  names, property, route or fixture identity.
- Compile dependencies using Journey ownership and the replacement link: transport
  selection precedes new stays; the earlier overnight precedes the destination stay;
  confirmed replacement is mandatory before old-stay cancellation. Order uses authoritative
  itinerary order/window data. Unknown ordering fails closed.
- Preserve the approved action, scope and cost fingerprints. A continuation does not
  grant new authority or silently change the selected strategy.
- After a successful provider observation, apply the canonical command and retain its
  exact receipt and aggregate before/after revisions. Reassess through the existing owner.
- Capture fresh authoritative state and evaluate only the exact remaining effects as one
  whole-trip candidate. Persist a bounded continuation checkpoint for the next intent:
  plan/intent identity, prerequisite attempts/observations and canonical receipts, exact
  accounted revisions, current manifest, residual effect fingerprints, deterministic
  viability/evidence/rule-input references and expiry.
- Gate reuse only while the checkpoint manifest remains current and every change from
  the approved base is accounted for by successful same-plan prerequisites. Interleaved
  unrelated changes refuse. Unknown provider outcome allows lookup only. Reconciled
  success must also have canonical application before satisfying a dependency.
- Refresh provider quote handles separately from approved stable offer identity. Currency,
  amount and relevant cancellation/entry terms must still match the authorized evidence;
  a changed price or terms requires a new decision. Never silently redispatch a known or
  unknown prior purchase.
- Hotel observations atomically attach only required stay/reservation/allocation and
  explicit approved visit/credential records. Cancellation atomically records confirmed
  supplier cancellation and drops the displaced item. Canonical retries never rebook.

## Initial sandbox source booking

The old fixture booking references are cancelled. A new baseline booking may be prepared
as explicitly disclosed sandbox source setup, outside product recovery. Verify the
provider sandbox response, record a durable setup attempt before dispatch, use a stable
client reference, reconcile uncertainty without redispatch, and ingest confirmed facts
through normal source/observation commands. Never invent a RecoveryCase to permit setup.
This booking is not one of A4's four protected selected actions or product acceptance.

Nuitée documents sandbox stored-card booking as simulated with no charge:
[booking reference](https://docs.liteapi.travel/reference/post_rates-book).
No production booking is authorized by this setup contract.

Park for Later: generic itinerary/visit/hotel management, healthy-plan modes, arbitrary
continuations and broader provider orchestration. Retain the existing accepted narrow
Programme continuation behavior.
