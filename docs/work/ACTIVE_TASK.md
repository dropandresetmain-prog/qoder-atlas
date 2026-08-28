# ACTIVE TASK — NORTHSTAR remaining system-world sequences

## Goal
Build separately renderable Seq 05, 06, 07, 08, 09, 10 and 15 on `video-system-world-production`, based on `video-production-integration` @ `a614e4c8dd81541b6ed96c81bf61b9062aae6ae6`.

## Branch / base
- Base: `video-production-integration`
- Base SHA: `a614e4c8dd81541b6ed96c81bf61b9062aae6ae6`
- Working branch: `video-system-world-production`
- Implementation commit: `503e0e5bfaf6c19300dbbb209b4d7c4241218374`

## Checklist
- [x] Freeze objective-field world/state contract
- [x] Seq 05 muted comprehension + render QA PASS
- [x] Seq 06 muted comprehension + render QA PASS
- [x] Freeze Seq 06 baseline / Seq 07 mutation contract
- [x] Seq 07 selective blast-radius QA PASS
- [x] Freeze Seq 08 impacted-trip contract
- [x] Seq 08 context → constraints → strategies QA PASS
- [x] Seq 09 Qwen/Atlas role distinction QA PASS
- [x] Seq 10 authority/HITL QA PASS
- [x] Freeze Seq 10 → real UI handoff frame
- [x] Seq 15 thesis lockup QA PASS
- [x] Playback checks + 1920×1080 still review
- [x] Hardcoding review: facts in data, generic primitives in shared
- [x] SSOT reconciliation
- [x] Commit exact paths + push

## Critical visual constraints
- Objective field / commitment constellation, not donor pill-day composition.
- Seq 05 begins on the accepted Seq 04 far-state visual before transforming it.
- Representative readable subgraph only; no hairball.
- LOD: close data, medium compact journeys, far state marks/topology.
- Semantic colour only; unrelated state recedes during traces.
- Seq 07 mutates Seq 06 topology; Seq 08 continues impacted trip; Seq 09 continues strategies; Seq 10 continues verified actions.
- No Qwen/Atlas before Seq 09; no HITL before Seq 10.
- Seq 15 quiet healthy journey + thesis, no celebration.

## Current checkpoint
COMPLETE. Implementation and acceptance evidence reconciled; source/config/docs committed on the dedicated production branch.

## Next action
None for this task. Final film editing may consume the generated assets and the Seq 10 decision-surface handoff.

## Acceptance evidence
### Visual QA
- Seq 05–06 first grammar gate PASS after far-LOD refinement.
- Seq 07–10 + 15 second visual gate PASS from full-frame 1080p still review.
- Decoded MP4 contact-sheet review PASS; delivered frames preserve authored hierarchy.
- Seq 04→05 opening was explicitly corrected to carry the accepted filled health marks, supplier rails, HUD and reduced-detail Traveller 17 instead of approximating them.

### Handoff evidence
Mean pixel differences between exact browser-rendered handoff frames:
- Seq04→05: 0.1640%
- Seq05→06: 0.2170%
- Seq06→07: 0.0834%
- Seq07→08: 0.3823%
- Seq08→09: 0.2876%
- Seq09→10: 0.4105%

### Technical evidence
- Shared/world/sequence JavaScript: `node --check` PASS.
- Shared-renderer hardcoding audit: PASS — no demo traveller IDs, routes, provider names or scenario facts in generic shared primitives.
- Final MP4 target: H.264 1920×1080 30fps; exact durations 6/17/9/14/9/12/9 sec.
- SSOT: visuals reconcile to approved connected-state → blast-radius → reasoning → Qwen/Atlas → authority/HITL → final thesis beats.

## Risk triage
- **Ignore / Accept Risk:** constrained environment samples browser raster at 12fps and resamples delivery to 30fps; deterministic authored `renderAt(t)` remains intact and shared capture can rebake native 30fps elsewhere.
- **Park for final edit:** Seq 10 provides the generated decision-surface push and frozen handoff frame; the actual morph/cut into real NORTHSTAR UI belongs to final film editing, not this sequence renderer.
