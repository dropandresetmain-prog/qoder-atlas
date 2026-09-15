# WiT programme seed — implementation decisions

Branch: `lane/wit-demo-programme-seed`  
Base: `milestone-m9-product-integration` @ `a89f22a70d226896be2bcdfe9dc96cf4a6de68d1`  
Freeze: `docs/work/WIT_DEMO_WORLD_PROGRAMME_SEED_FREEZE_v1.md` + Amendments A–C

## Amendment C — Daniel commitment ID

**Chosen id:** `cmt-ait-d1-local-host-session`  
**Window:** 2026-10-01 14:30–15:00 +08, `place-mbs`  
**Occupant:** Daniel Ong (`ait-draft-02`), HOST, REQUIRED, CHANGEABLE

**Why new rather than reuse:** Daniel’s only existing Day-1 commitment is `cmt-ait-d1-marketplace-chat` (09:50–10:10, REQUIRED/FIXED). Remapping that morning slot to 14:30 would distort the morning programme. Day-0 `cmt-ait-d0-purpose-panel` is the wrong day. No other semantically appropriate Daniel CHANGEABLE Day-1 slot exists.

## Amendment D — India fireside interviewer

**Chosen:** Elena Tan (`ait-draft-01`), the existing Singapore local.

Elena is free between the 10:10–10:30 India fireside and her 11:30 headline
interview, so this replacement removes Felix from the inbound-critical
morning role without introducing a new traveller or a schedule collision.

## Amendment B — Felix Day-1 REQUIRED

**Chosen:** retime `cmt-ait-d1-agentic-provocation` to **16:30–16:40** with Felix SPEAKER REQUIRED/FIXED.  
Remove Felix from `cmt-ait-d1-india-fireside` morning REQUIRED (reassign interviewer to a non-cohort local in programme-importance/roster).  
Gap after ID7153 10:30 arrival = 360 minutes ≥ 150 → runtime VIABLE with meaningful programme evaluation.

## Amendment A — readiness

Organiser `MIN_BUFFER` = **150** minutes.  
Applicability at promotion: engagement `importance === REQUIRED` **and** `placeId` present (physical presence). No role-name list in application code.  
`eventChangePreview` reads buffer from constraints/policy — no hardcoded 360/150.

## Sarah flights — provenance

Geometry: ID7159 (30 Sep 17:45→20:30) → synthetic cancel → ID7153 (1 Oct 07:45→10:30).  
**Not provider-backed.** No Atlas Search/Verify recordings for Batik in tree. Seeded as **SIMULATED / ORGANISER_SUPPLIED_SYNTHETIC**. Do not present as Atlas evidence until recordings exist.

## Jordan stay

Baseline Concorde check-in **29 Sep**; recovered arrival 30 Sep invalidates first night via generic whole-trip stay logic (not Jordan-specific branches).
