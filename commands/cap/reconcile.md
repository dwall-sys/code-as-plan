---
name: cap:reconcile
description: One-shot status drift reconciliation -- propose AC promotions and feature-state corrections for FEATURE-MAP.md, with dry-run preview and audit log.
argument-hint: "[--apply] [-y]"
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

<!-- @cap-context CAP v2.0 reconcile command -- one-shot cleanup of historical status drift in FEATURE-MAP.md introduced before F-041 (parser fix) and F-042 (state propagation) shipped. Combines AC-status drift detection (Phase 1) with implementation-presence drift detection (Phase 2). -->
<!-- @cap-decision Dry-run by default. The --apply flag is required to actually mutate FEATURE-MAP.md, and a confirmation prompt is shown before writes (skippable with -y for CI). -->
<!-- @cap-decision F-043 (this feature) is excluded from Phase 2 self-promotion -- the developer decides when to ship F-043, not the tool. -->
<!-- @cap-feature(feature:F-043) /cap:reconcile is the user-facing entry point for the reconciliation tool. -->

<objective>
<!-- @cap-todo(ac:F-043/AC-1) Scan FEATURE-MAP.md and propose AC status updates for every drifting feature (state shipped/tested with pending ACs). -->
<!-- @cap-todo(ac:F-043/AC-2) Output a dry-run diff first; require explicit confirmation (--apply + prompt) before writing. -->

Reconciles status drift in FEATURE-MAP.md by:
1. **Phase 1** -- promoting pending ACs to `tested` for every feature whose state is `shipped` or `tested` (catches drift introduced by the F-041 parser bug).
2. **Phase 2** -- updating `planned` features to `prototyped` or `tested` based on actual code presence detected via `@cap-feature` tags + sibling test-file probe.
3. **Phase 3** -- verifying that `detectDrift` returns zero entries after the changes, and emitting `.cap/memory/reconciliation-2026-04.md` audit log.

**Arguments:**
- `--apply` -- actually write the changes (default is dry-run)
- `-y` / `--yes` -- skip the confirmation prompt (CI use)
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--apply` -- if present, set `apply_mode = true`
- `-y` or `--yes` -- if present, set `skip_confirm = true`

If neither flag is present: `apply_mode = false` (dry-run).

Log: `cap:reconcile | mode: {dry-run|apply} | confirm: {prompt|skip}`

## Step 1: Build the plan and print the dry-run preview

<!-- @cap-todo(ac:F-043/AC-2) Always print the dry-run preview first, even when --apply is set. The confirmation prompt comes after. -->

```bash
node -e "
const r = require('./cap/bin/lib/cap-reconcile.cjs');
const plan = r.planReconciliation(process.cwd());
console.log(r.formatPlan(plan));
console.log('---');
console.log('PLAN_TOTAL_CHANGES=' + plan.totalChanges);
"
```

Display the preview verbatim. Capture `PLAN_TOTAL_CHANGES`.

If `PLAN_TOTAL_CHANGES === 0`: report "Feature Map is already consistent -- no reconciliation needed." and **stop**.

## Step 2: Dry-run exit (when --apply is not set)

If `apply_mode` is false: report "Dry-run only. Re-run with `--apply` to commit changes." and **stop**. Exit code 0.

## Step 3: Confirm before applying (when --apply is set)

<!-- @cap-todo(ac:F-043/AC-2) Confirmation prompt is the second safety gate before writes. -->

If `skip_confirm` is false:
- Use AskUserQuestion to present: `"Apply N changes to FEATURE-MAP.md? Audit log will be written to .cap/memory/reconciliation-2026-04.md"` with options `["yes", "no"]`.
- If the user picks `no`: report "Aborted -- no changes written." and **stop**. Exit code 0.

## Step 4: Execute the plan

<!-- @cap-todo(ac:F-043/AC-3) executeReconciliation walks the lifecycle path for Phase 2 transitions and propagates AC promotions on every 'tested' hop. -->
<!-- @cap-todo(ac:F-043/AC-4) The audit log is written by executeReconciliation as part of Phase 3. -->
<!-- @cap-todo(ac:F-043/AC-5) executeReconciliation re-runs detectDrift after writing and includes the count in its result. -->

```bash
node -e "
const r = require('./cap/bin/lib/cap-reconcile.cjs');
const plan = r.planReconciliation(process.cwd());
const result = r.executeReconciliation(process.cwd(), plan);
console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
"
```

## Step 5: Report results

If success:
```
Reconciliation complete.
  Changes applied: {plan.totalChanges}
  Post-reconciliation drift: 0
  Audit log: .cap/memory/reconciliation-2026-04.md

Suggested next:
  git diff FEATURE-MAP.md   # review the rewritten Feature Map
  git add FEATURE-MAP.md .cap/memory/reconciliation-2026-04.md
  git commit -m "fix: reconcile status drift in Feature Map"
```

If failure:
```
Reconciliation failed: {result.error}
  Pre-drift count: {plan.preDriftCount}
  Post-drift count: {result.postDriftCount}

Recovery: git checkout -- FEATURE-MAP.md   # revert to pre-reconciliation state
```

Exit code 0 on success, 1 on failure.

</process>
