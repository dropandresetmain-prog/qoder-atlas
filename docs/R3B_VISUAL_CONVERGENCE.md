# R3B - Visual Convergence Evidence

**Lane:** `lane/r3-reference-visual-convergence` (visual deltas only; not wholesale merge)  
**Integration base:** `integration/final-r2-r3` - R2 @ `9756729` + R3A @ `1605665` + R3B deltas from `e31e92c`  
**Captured:** 27 Aug 2026 (fresh run on final projection state)

Reference baseline: approved fixture previews (`data/ui-preview/` from `src/ui/preview.ts`). Live captures: `output/r3b-visual/` via `scripts/r3b-visual-capture.ts`.

## Screen convergence matrix

| Screen | Reference | Status |
|--------|-----------|--------|
| Overview O1 | ref-o1-overview.png | PASS |
| Programme P1 | ref-p1-programme.png | PASS |
| Decisions D1 | ref-d1-decisions.png | PASS |
| Activity | ref-activity.png | PASS |
| Hero travellers/cases | live-hero-*.png | PASS |

## Fixes landed

1. Overview role lines via R3A projections
2. Case URL encoding (encodeUri + decodeURIComponent)
3. Programme preview pages in preview.ts
4. Reset demo control styling
5. R3A HTTP wiring for /decisions and /activity

## Integration note

Previous R3B evidence against stale bases (049ab9d / 57cecb4) is superseded.
