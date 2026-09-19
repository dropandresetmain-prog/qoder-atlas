# A3 new-stay proposal — architecture gap and next seam

Status: investigated, implementation contract not yet frozen. 2026-09-20.
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
