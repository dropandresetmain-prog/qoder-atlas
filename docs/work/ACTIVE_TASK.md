# ACTIVE TASK — Frontend semantic contract

## Goal

Implement the accepted-M9 presentation contract, one adapter boundary, shared
visual grammar and a fixture-only Contract Lab. Stop before live graph wiring.
This lane supersedes the old M6 ledger here; that ledger remains in base history.

## Identity and preflight

- Milestone: WiT frontend semantic contract (independent of M10).
- Branch: `lane/wit-frontend-semantic-contract`.
- Worktree: `C:/Dev/qoder-atlas/.worktrees/wit-frontend-semantic-contract`.
- Exact base: `c45a9289b7f7ff730cdce97ced6124b1a9332bf8` (accepted M9).
- Frozen `2728acd` -> `ffa77ace2014f597e465179b988a28e0a3d55e14`.
- Frozen `49e7b4d` -> `9efd57de4d7dc9deba99928be7eaf1e7beef30b1`.
- Frozen `e1eb5f4` -> `6ea0ea875a4cb90b1f798bbd670fa608b91c6c29`.
- `git diff --name-only c45a928 HEAD` = `docs/work/WIT_DEMO_VISUAL_AND_PRODUCT_CONTRACT.md`
  only, so the three cherry-picks touched no source file.
- No separate programme-seed merge; no moving M10 dependency.

## Acceptance checklist

- [x] Exact accepted M9 base, frozen commits, visual contract and clean preflight.
- [x] Inventory actual M9 enums, categories, relationships and metadata.
- [x] Record node identity, edge identity and bounded integration gaps (FIG-1..FIG-6).
- [x] Canonical small presentation model with independent dimensions (`model.ts`, 59 lines).
- [x] One pure adapter boundary; exhaustive mappings; loud invalid input (`adapter.ts`, 124 lines).
- [x] Central visual grammar following DESIGN and frozen WiT contract (`grammar.ts`, 71 lines).
- [x] Fixture-only Contract Lab: states, changes, truth, focus, edges, compositions.
- [x] Components consume presentation objects, not raw domain objects (`components.ts`).
- [x] Adapter/unit/render tests pass — `test/ui-semantic-contract.test.ts` 14/14.
- [x] Typecheck, build, lint, anti-hardcoding and regression checkpoint recorded below.
- [x] Browser desktop/mobile, controls, edge cases and console verified.
- [x] Anti-hardcoding / no business reasoning / unchanged ontology checked.
- [x] Contract doc, roadmap and evidence updated; no tracker/DECISIONS entry applies.
- [x] Exact-path commit and push verified; stop before next milestone — milestone
  commit `0f6f5500bc5c81c1910655a070d3cb3d4a8026ca`, 13 paths staged explicitly,
  `git ls-remote origin` == local `HEAD`, 0 ahead / 0 behind.

## Current checkpoint

Implementation and verification are complete. `operatorOverviewAdapter.ts` is the
only pre-existing source file touched: it now delegates to the single boundary
instead of keeping its own silent-default palette (+8/-46). The change is
behaviour-preserving for every legal enum value; the only semantic difference is
that an unmapped value now throws instead of returning `neutral`.

## Next action

None — this lane is closed. Milestone commit `0f6f5500` is pushed to
`origin/lane/wit-frontend-semantic-contract` and the working tree is clean. The
hand-off is independent review. Live `LiveDependencyGraph` wiring stays blocked
on FIG-1/FIG-2/FIG-6 and is explicitly out of scope here; do not start M10 or
any live-state integration from this branch.

## Critical constraints

- Backend remains semantic authority; no viability/time/policy/authority reasoning.
- Do not promote proposal health to authoritative truth.
- Preserve UNKNOWN and absent relation state distinctly.
- Never synthesize stable edge identity or infer changed edges from endpoints.
- No domain/schema/read-model behavior changes without stopping for approval.
- Use current theme and inline SVG vocabulary; no new framework or dependencies.
- No live provider calls, database, SQLite additions, M10 or runtime LDG wiring.
- No animation, revision transitions, layout engine or full demo flows.
- Fixture facts stay in dev/test data; generic components remain scenario-free.

## Verification actually run

- `npm run typecheck` exit 0; `npm run build` exit 0; `npm run lint` exit 0.
- `npm run gate:anti-hardcoding` -> `VERDICT: CLEAN`; 352 TS files
  (strict=211 app=122 provider=16 demo=3 excluded=0). `src/ui/` classifies as
  tier `app`, so the Lab and semantics modules were scanned; `fixtures/` is
  outside `src/` and therefore the permitted home for demo facts.
- `node --test test/ui-semantic-contract.test.ts` -> 14 pass / 0 fail, exit 0.
- Full suite `npm run test` -> exit 1: 1110 pass, **3 fail**.
- Browser: `/contract-lab` DOM snapshot covers all seven sections; fixture
  selector exercised 5 -> 1 -> 5; console clean; no overflow at 530x617;
  computed-style audits confirm all four dimensions encode independently and
  16/16 connectors render. No pixel screenshot: the in-app browser surface
  stayed `visibilityState=hidden`, so the visual claim rests on computed styles
  and structure, not on a rendered image.

## The three full-suite failures are pre-existing at base

Proven, not assumed. `operatorOverviewAdapter.ts` was temporarily replaced with
its exact base content (`git show c45a928:<path>`, verified
`git diff --quiet c45a928 -- <path>` -> `[adapter == base: YES]`) and the three
files re-run: same exit 1, same 3 fail / 8 pass, same three assertion messages.
My version was then restored and re-verified (+8/-46, typecheck 0, 14/14).

- `test/e2e/hero-lifecycle-rehearsal.test.ts:213` — no `RECOVERY_ENVELOPE_APPLIED`
  activity event for the Jordan S2 hotel intent. Server-side authority record;
  the file imports only `compose.ts`, `server/http.ts`, `config.ts`, `demoWorld.ts`.
- `test/integration.r1.test.ts:234` — determinism diff is confined to two
  wall-clock `observedAt` stamps ~2.2s apart; everything else byte-identical
  including `version: 6`. Time-dependent, not state-dependent.
- `test/wave3r-m1-ait-canonical-seed.test.ts:46` — harvested PNR `MNSYN03` not on
  a promoted leg. Seed/promotion data concern.

Triage: all three are **Park for Later** for this lane (out of scope, pre-existing,
no presentation coupling) and must be raised against M9/seed owners separately.
One **Investigate Now** design finding is recorded in
`docs/FRONTEND_SEMANTIC_CONTRACT.md`: `HEALTHY` and `RECOVERED` share tone `ok`
and glyph `check`, differing only by label — weak for the state the product
thesis turns on. Fixing it means extending the frozen `SemanticIndicator['glyph']`
set, which is DESIGN.md authority, so it is not a FIG entry and was not changed.

## Documentation scope note

`docs/ROADMAP.md` gained a lane row. `docs/IMPLEMENTATION_PLAN.md` has no
frontend/WiT tracker and this is not an M0-M11 package, so no tracker row was
invented. `docs/DECISIONS.md` does not exist in this tree and no architecture
invariant changed, so no decision entry was created.
