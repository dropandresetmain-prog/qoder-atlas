# Environment and Terminal Recovery

Use this rule whenever Qoder/JetBrains/CLI command execution behaves unexpectedly.

## Principle

A broken terminal, stale shell, working-directory issue, permission wrapper, or Qoder tool failure is **not evidence that application code is wrong**. Diagnose the execution environment before changing source code.

Do not let transient tooling problems consume a long-horizon task indefinitely.

## JetBrains / Qoder Agent Mode

If a command that should work suddenly hangs, returns an implausible shell error, loses PATH/context, or appears to be executing in a stale terminal:

1. Confirm current directory and repository/worktree: `pwd` (or platform equivalent) and `git status --short --branch`.
2. Run one trivial command to distinguish shell failure from application failure.
3. Reset/reopen the JetBrains terminal once.
4. Re-enter the intended worktree/directory and retry the **same** command before changing code.
5. If the integrated terminal remains faulty, use a fresh terminal/shell or another Qoder surface against the same worktree.

Do not rewrite package scripts, source paths, imports, or application logic merely to accommodate a stale JetBrains terminal.

## Qoder CLI permission / shell failures

For `permission denied`, `operation not permitted`, script-execution failures, or similar:

1. Inspect the exact command, current directory, file existence, file mode, and shebang before editing anything.
2. If the file does not need to be executable, prefer an explicit interpreter or package-manager invocation, e.g. `bash path/to/script.sh`, `node script.mjs`, `python script.py`, or the repository's package-manager command.
3. Use `chmod +x` only when the repository intentionally expects the script to be executable and committing the executable bit is appropriate.
4. Distinguish OS/filesystem permissions from Qoder permission-mode/tool approval failures.
5. Do **not** automatically use `--yolo`, disable safety controls, or broaden permissions just to make an error disappear.
6. If the CLI wrapper remains the problem, resume the same branch/worktree in JetBrains Agent Mode or another stable shell rather than changing product code.

## Bounded recovery, then continue or escalate

Do not loop on the same environment failure.

After a reset/retry plus one materially different safe recovery attempt:
- if fixed, continue normally;
- if optional/non-critical, classify the issue and continue independent work;
- if critical-path work remains blocked, capture the failing command/error/environment evidence and trigger the implementation plan's hard-stop condition.

Do not repeatedly reinstall dependencies, change toolchains, alter source code, or restructure the project without evidence that those are the actual root cause.

## Network/provider/model failures

Before treating an external failure as an application bug:
- distinguish DNS/network/auth/quota/provider response from internal validation failures;
- use existing RECORD/REPLAY/fallback paths when allowed;
- never hardcode a provider response into domain logic to get past an outage;
- never spend prolonged time fixing an optional provider when the roadmap says it is non-blocking.

## Git/worktree safety

When environment recovery involves Git:
- verify actual branch/worktree/head before committing or merging;
- do not delete/reset another lane's worktree to recover the current lane;
- do not use destructive reset/clean operations unless explicitly justified and within the approved workflow;
- prefer switching execution surface while keeping the same worktree intact.
