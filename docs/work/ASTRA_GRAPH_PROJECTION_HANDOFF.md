# A1 graph projection handoff

Primary decision, 2026-09-20. Applies after A0 `f55899b15200de692dd749bbcfb795c67f6a22e0`.
This is an additive product projection contract, not an ontology or RC-6 change.

WHAT WE KNOW: canonical transport timings, objectives and structured evaluator
explanations already exist. Current LDG drops cause identity and renders workflow
state, leaving the first breakpoint on a broad affected Journey.

WHAT WE DO NOT KNOW: every desired commitment/service has its own assessment;
every historical snapshot has enough timing detail. Missing evidence stays unknown.

KEY ASSUMPTION: existing typed facts and explanation references suffice to produce
the accepted causal view without new authoritative entities or timing calculations
in the browser.

WHAT SHOULD BE TESTED NEXT: current and alternate programme/connection fixtures,
missing/stale evidence, mapped and unmapped causes, and immutable Original under
an additive read-model change, followed by a focused PostgreSQL projection proof.

## Case projection package (first semantic lane)

Approved additive fields/categories, if required by implementation:

- `TRIP_OBJECTIVE` in `LdgNodeKind`: presentation of an existing canonical Objective.
  Label from canonical human text; assessment from relevant evaluator explanation or
  current objective assessment. Never copy whole-Journey failure onto every objective.
- Optional `subjectRefs: string[]` on LDG nodes: explicit backend-supplied canonical
  references represented by a presentation node. This is mapping metadata, not new
  executable dependencies. Old snapshots without it remain valid.
- Optional `timing` on LDG nodes: `currentAt` (qualified ISO instant), optional
  `publishedAt` (qualified ISO instant), optional `timeZone` (canonical IANA zone).
  A renderer may format these; it must not calculate lateness or infer condition.
  Never label a published time as an earlier observation or immutable Original.
- Optional `causeSubjectRef` on `CausalPathStep`, taken directly from the persisted
  evaluator explanation's cause. Preserve `subjectRef` as affected subject.

Keep schema additions optional where old snapshots/consumers require compatibility.
The semantic producer may supply a dedicated arrival/connection TIMING node only
from canonical timing and relevant explanation facts. Its stable ref is producer
owned. Breakpoint mapping uses supplied cause, dimension and explicit projection
mapping, not a browser traversal, names, routes, or guessed causal order. If mapping
is not defensible, retain an explicit unmapped step instead of fabricating one.

Read programme-item assessments when available. A journey's structured participation
explanation may establish that specific traveller's consequence for the referenced
commitment; a generic Journey FAIL cannot establish a missed programme item.
Keep the scope explicit in labels/details and preserve UNKNOWN/pending independently.

Remove Recovery case nodes and their incident-to-case/subject-to-case edges from
the focused visual. Do not delete historical stored snapshots or alter execution
state. Existing case identity/change revision still owns polling/snapshot lookup.

One lane owns shared `readModels.ts`, fact `types.ts`, `pgFactAssembler.ts`, focused
projectors, LDG pure producer, semantic adapters/model and minimal kind layout
support. It must not edit `scene.ts`, graph `index.ts`/`views.ts`, navigation screens,
shell/HTTP handlers, Overview producer or renderer while those have other owners.
No migration/domain/executor/planner changes in this package.

## Overview follow-on (freeze exact implementation after Case integration)

- Add explicit bounded relations (`id`, `kind`, `fromRef`, `toRef`, `health`) to the
  backend Overview projection; the renderer consumes them directly. Missing/old
  relation condition stays neutral, not inherited from endpoints.
- Generalize backend dependency inputs beyond transport. Prove a material shared
  non-transport dependency using existing canonical data; no new provider required.
- Commitment health must use commitment-specific evidence, not participant status.
- Ordinary population without programme days stays visible in an unassigned cohort;
  no invented programme date. Keep all population accounted for under caps.
- Compact rendering uses bounded pages/territories/disclosure when needed, rather
  than shrinking an arbitrarily wide world. Expanded view uses the same semantics.

The primary retains shared contract integration, test-manifest registration,
physical acceptance and any ambiguity that would otherwise weaken semantic truth.
