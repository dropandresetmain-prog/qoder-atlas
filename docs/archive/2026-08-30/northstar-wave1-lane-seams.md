# Northstar Wave 1 lane seam contract (integrator-owned)

Fan-out base: NORTHSTAR_WAVE12_BASE_SHA = b7037033f2af4f1a7b9985fd04e76158be246bde
Frozen contracts (do not modify): src/contracts/programmeIntake.ts, src/contracts/readmodels.ts
(ProgrammeView et al.), src/domain/**, src/operational/**.

## Integrator-owned modules (integration/northstar lane)

- `src/app/programme.ts` — ProgrammeService (promotion + programme creation + fan-out):

  ```ts
  export interface ProgrammeServiceDeps {
    mutations: MutationService;
    entities: EntityStore;
    sources: SourceRepository;
    audit: AuditRepository;
  }
  export class ProgrammeService {
    /** Promote one validated import draft; only path from draft -> state. */
    intakeImportDraft(input: { importDraft: ProgrammeImportDraft; at: IsoDateTime }): Promise<{ outcomes: PromotionOutcome[] }>;
    /** Create/update event programme entities from validated intake context. */
    applyProgrammeContext(input: {
      at: IsoDateTime;
      sourceId: EntityId;
      organisation?: Organisation;
      anchorEvent?: AnchorEvent;
      places?: Place[];
      ruleSets?: RuleSet[];
    }): Promise<{ accepted: boolean; issues: ValidationIssue[] }>;
    /** Commitment change -> authoritative commitment update + per-trip signals. */
    applyCommitmentChange(input: { signal: TripSignal; at: IsoDateTime }): Promise<CommitmentFanOutOutcome>;
  }
  ```

- `src/app/programmeReadmodel.ts`:
  `projectProgrammeView(deps: ReadModelDependencies, anchorEventId: EntityId, at: IsoDateTime): Promise<ProgrammeView>`
  Pure projection over authoritative state; reuses statusForTrip semantics of readmodels.ts.

- `src/engine/funding.ts`:
  `allocateCost(params: { rules: PolicyRule[]; priceDelta: Money; at: IsoDateTime; fundingDeclaration?: FundingDeclaration }): CostAllocation`
  Deterministic FUNDED_WINDOW allocation; never assumes event-funded.

## Intake lane outputs (lane/northstar-intake-policy)

- `src/intake/programmeCsv.ts` — deterministic CSV -> ProgrammeTravellerDraft[]
- `src/intake/programmeTable.ts` — table-like rows (XLSX-shaped) -> drafts
- `src/intelligence/programmeExtraction.ts` — LLM mapping seam:
  - `RosterExtractionSchema` (model output DTO; strict; converted to drafts downstream)
  - `EventBriefExtractionSchema` (event context + candidate policy clauses)
  - both registered through validateExtraction-style gating; malformed output -> structured failure + uncertainty, never repair
- `src/ingest/programmeClauses.ts` — candidate recognized clauses -> RuleSet via
  normalizeExtractedTemporal (temporal values) -> MutationService promotion
- tests: test/northstar-intake.test.ts (equivalence manual/CSV/LLM; missing stays missing)

## UI lane outputs (lane/northstar-ui)

- `src/ui/screens/operator-programme.ts` — renderProgrammeBody(view: ReadModelEnvelope<ProgrammeView>): string
- traveller programme entry contract surface (mobile shell metadata)
- tests: test/ui-programme.test.ts

## Provider probe lane outputs (probe/provider-access)

- docs/reality-validation/provider-access-probes.md — evidence report, each probe
  concluding Adopt Now | Keep Stretch | Defer | Reject. No src/** changes.
