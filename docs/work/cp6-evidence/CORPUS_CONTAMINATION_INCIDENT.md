# CP6 Phase 0/1 incident — canonical corpus contamination (detected and reverted)

## What happened

Between this session's Phase 0 SHA-256 inventory of the frozen, founder-approved
canonical corpus (`recordings/jordan-corpus-2026-09-23`, 28 files) and the start of
Phase 1 staging work, the working tree in this same worktree
(`C:\Dev\qoder-atlas\.worktrees\a5-jordan-transaction-recording`) was found to have:

- 11 existing canonical recording files with **changed content** (git-tracked, showed
  as `M` in `git status`)
- 9 **new, untracked** recording files added directly under
  `recordings/jordan-corpus-2026-09-23/nuitee/quote/` and
  `.../nuitee/stay_context/`

This was detected by re-hashing the canonical corpus and diffing per-file against the
Phase 0 baseline (`docs/work/cp6-evidence/cp5-corpus-sha256-inventory.txt`), then
confirmed independently via `git status --porcelain -- recordings/jordan-corpus-2026-09-23/`.

## Likely cause

The coordinator reported that a separate diagnostic probe
(`scripts/probe-cp6-authority-gate.mjs`, left untracked in this worktree) was run
concurrently against this same worktree to check authority-gate behavior. That
script's own source hard-codes `env.ADAPTER_MODE = 'RECORD'` when it loads
`.env.local`, and `.env.local`'s `RECORDINGS_DIR` in this worktree points at
`recordings/jordan-corpus-2026-09-23` — the canonical, founder-approved path, not an
isolated copy. If the probe exercised transport/hotel research in RECORD mode without
overriding `RECORDINGS_DIR`, it would write real sandbox provider responses straight
into the canonical corpus, which is exactly what the file diff shows (new/changed
`atlas/search`, `nuitee/search`, `nuitee/quote`, `nuitee/stay_context`, and
`official-documents/document.read` recordings — consistent with a fresh D1→D3
research pass).

This is exactly the failure mode `AGENTS.md` and the CP6 brief both call out by name:
*"The approved CP5 corpus is immutable evidence... Do not silently overwrite it."*
It happened anyway, from a process outside this session's direct control.

## Remediation taken (this session)

1. Reverted all 11 modified files: `git checkout --` against the exact 11 paths.
2. Deleted all 9 untracked new files: `rm -f` against the exact 9 paths.
3. Verified restoration via `git status --porcelain` (empty) and `git diff --stat`
   (empty) against `recordings/jordan-corpus-2026-09-23/`, and via
   `git show HEAD:<path> | sha256sum` matching the Phase 0 baseline hash for every
   previously-contaminated path (content-level match; raw on-disk SHA-256 differs
   from the Phase 0 baseline only due to `core.autocrlf=true` LF→CRLF checkout
   normalization, not remaining contamination — git's own diff engine, which
   normalizes line endings, reports zero difference).
4. Rebuilt `recordings/jordan-corpus-2026-09-23-cp6-staging/` a second time, this
   time copied from the verified-clean canonical source (28 files, matching Phase 0
   exactly), with `CP6-STAGING-MANIFEST.json` recording parent-corpus identity and
   this incident.

## Why this session stopped here instead of proceeding to Phase 2+

Continuing straight into real sandbox Atlas/Nuitée provider execution and further
git push checkpoints, in the same worktree where an out-of-band process just wrote
into evidence explicitly marked immutable, without first surfacing this to the
coordinator, would repeat the same category of mistake at higher stakes. This is
flagged as **Act Now**, not routed around silently.
