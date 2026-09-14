# NORTHSTAR M5 active task — knowledge, provenance and requirements

## Objective

Complete the recovered M5 target-persistence package for external information,
provenance, typed applicability, requirements, preferences, bounded rules and
coverage. Keep it behind PostgreSQL repository/command ports; do not wire the
legacy SQLite runtime or claim M6 entry/evaluation capability.

## Recovery base and lane

- Repository: `dropandresetmain-prog/qoder-atlas`
- Accepted common base: `71f638ed30d01e65981bdd9e5e6128ad067fbf1d`
- Recovery source: `salvage/m5-qoder-cloud` at `b2ed9b56da72cf71946fde6cc27da9dc56b45c97`
- Worktree: `C:\Dev\qoder-atlas\.worktrees\m5-recovered`
- Branch: `milestone-m5-recovered`
- M5 migration allocation: `0070`–`0086` only

## Frozen contracts

1. Publishers are independent. Northstar retains source editions and
   disagreements; it does not impose a universal source-authority ladder.
2. Source capture, normalized evidence, information publication, observation,
   receipt, effective interval and expiry are distinct facts.
3. Information editions are immutable. Future-effective and retracted editions
   remain explicit states; incomplete, unknown, unsupported and unavailable
   coverage never becomes an unqualified positive result.
4. Applicability is expressed through typed scope columns and registered
   population predicates. Rules use a bounded ALL/ANY/NOT/PREDICATE grammar;
   `eval`, arbitrary JavaScript/SQL and source prose are never executable.
5. Constraint definitions contain no PASS/FAIL/UNKNOWN result. Explicit
   preferences outrank inferred preferences, while inferred preferences remain
   soft signals.
6. AI may prepare candidate structured data before admission; deterministic
   schemas, FK integrity, immutable append-only rules, sequencing, quarantine
   and transaction boundaries decide what is stored. M6 owns feasibility and
   entry evaluation.

## Checklist

- [x] Repair malformed `0074`, `0077`, `0078` and `0081` migrations.
- [x] Close M2 evidence FKs additively in `0085`; preserve M4/M3 deferred
      geography/service FKs.
- [x] Add knowledge domain schemas and deterministic admission helpers.
- [x] Add repository ports, PostgreSQL repository, command handlers and named
      M6 read ports.
- [x] Add source/evidence-aware M2 fixtures and update M2 subtype evidence for
      the newly activated M5 checker branches.
- [x] Verify migration ordering, rerun, rollback and checksum drift on real
      PostgreSQL/PostGIS.
- [x] Verify M5 duplicate replay, conflicting sequence quarantine, out-of-order
      quarantine, bounded rules, typed assignment/scope reads, preference
      precedence, coverage expiry and governing requirements.
- [ ] Integrator merges this lane only after inspecting the exact branch/head
      and accepting the evidence below. This task does not perform a merge.

## Verification record

The final record belongs in `docs/refactor/evidence/M5.md`. Required commands
are `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run lint`,
`npm.cmd run gate:anti-hardcoding`, the focused M5 PostgreSQL file and the
canonical `npm.cmd run test:postgres`, all against a clean temporary database
for the PostgreSQL suites.

## Known boundary

M5 stores requirements and knowledge only. It does not select credentials,
derive entry feasibility, issue authority, execute provider actions, reconcile
external records, or make the target PostgreSQL model the production authority.
