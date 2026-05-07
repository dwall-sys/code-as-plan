---
name: cap:upgrade
description: "Onboard or migrate a CAP project — runs the 7-stage migration pipeline (doctor → init → annotate → migrate-tags → memory-bootstrap → migrate-snapshots → refresh-docs)."
argument-hint: "[--dry-run-only] [--non-interactive] [--skip-stages=name,...] [--include-stages=name,...] [--force-rerun]"
allowed-tools:
  - Bash
  - Read
  - Write
---

<!-- @cap-feature(feature:F-084, primary:true) Project Onboarding & Migration Orchestrator — markdown command spec. The companion module is cap/bin/lib/cap-upgrade.cjs. -->
<!-- @cap-context F-084 closes the "first-run/upgrade" gap: instead of asking the user to remember /cap:doctor + /cap:init + /cap:annotate + /cap:migrate-tags + /cap:memory bootstrap + /cap:memory migrate-snapshots + /cap:refresh-docs in the right order, /cap:upgrade orchestrates them based on actual project state. -->
<!-- @cap-decision(F-084/AC-2) The 7 stages are FIXED in order. cap-upgrade.cjs decides which to skip; this command spec invokes the surviving ones. -->
<!-- @cap-decision(F-084/AC-3) Dry-run-first UX: every run starts with a plan preview. --non-interactive runs without confirms but still prints the plan first. -->
<!-- @cap-decision(F-084/AC-4) Per-stage isolation: a failed stage is logged but does not block the remainder. -->

<objective>
Onboard a fresh repo or migrate an existing project to the current CAP version. Runs a 7-stage pipeline:

1. **doctor** — health check (Node version, required tools, module integrity)
2. **init-or-skip** — `/cap:init` for fresh projects (skipped if `.cap/` + `FEATURE-MAP.md` already exist)
3. **annotate** — retroactive `/cap:annotate` (OPTIONAL, skipped in `--non-interactive` unless `--include-stages=annotate`)
4. **migrate-tags** — fragment → anchor-block tag migration (F-047)
5. **memory-bootstrap** — `/cap:memory bootstrap` for V6 per-feature memory (F-076)
6. **migrate-snapshots** — F-077 + F-079 snapshot-linkage migration
7. **refresh-docs** — `/cap:refresh-docs` (OPTIONAL, slow + needs network)

Each stage is **idempotent** and **skip-able**. A `.cap/version` marker tracks completed stages; re-runs only execute what's missing. A `.cap/upgrade.log` JSONL audit trail records success/failure per stage.

**Flags:**
- `--dry-run-only` — show the plan without executing any stage
- `--non-interactive` — no confirms; auto-skip optional stages (CI mode)
- `--skip-stages=a,b,c` — comma-separated stage names to skip
- `--include-stages=a,b` — opt-in to optional stages in non-interactive mode
- `--force-rerun` — ignore the marker; replan from scratch
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
</context>

<process>

## Step 1: Build the migration plan

```bash
node -e "
const upgrade = require('./cap/bin/lib/cap-upgrade.cjs');
const args = process.argv.slice(1).join(' ');
const opts = {
  nonInteractive: /--non-interactive/.test(args),
  forceRerun:     /--force-rerun/.test(args),
  dryRunOnly:     /--dry-run-only/.test(args),
  skipStages:     (/--skip-stages=([^ ]+)/.exec(args) || [,''])[1],
  includeStages:  (/--include-stages=([^ ]+)/.exec(args) || [,''])[1],
};
const planResult = upgrade.planMigrations(process.cwd(), { runOptions: opts });
console.log(upgrade.summarizePlan(planResult));
console.log('');
console.log('---PLAN-JSON---');
console.log(JSON.stringify(planResult, null, 2));
" -- $ARGUMENTS
```

Display the human-readable summary to the user. Parse the `---PLAN-JSON---` block to drive subsequent steps.

## Step 2: Handle special cases

**If `planResult.alreadyCurrent === true` and `--force-rerun` was NOT set:**
- Tell the user "Project already current at version X.Y.Z — nothing to do."
- Suggest `--force-rerun` if they want to re-execute stages anyway.
- Exit.

**If `--dry-run-only` was passed:**
- Stop here. The plan summary is the deliverable.
- Exit with the summary as the final response.

## Step 3: Confirmation gate (skipped in `--non-interactive`)

For each NON-SKIPPED stage in `planResult.plan`:
- Tell the user "About to run stage `<name>` via `<command>`. Reason: `<reason>`."
- If `--non-interactive` is set, proceed without asking.
- Otherwise, ask the user to confirm. They can:
  - **yes** — proceed to execute the stage
  - **no** — record as `skipped` with reason `user-declined` and continue to the next stage
  - **abort** — stop the entire upgrade (record what was done so far)

## Step 4: Execute each non-skipped stage

For each stage with `skip === false` (and not user-declined):

1. Record the start time.
2. Invoke the corresponding `/cap:*` slash-command:
   - `doctor` → `/cap:doctor`
   - `init-or-skip` → `/cap:init`
   - `annotate` → `/cap:annotate`
   - `migrate-tags` → `/cap:migrate-tags`
   - `memory-bootstrap` → `/cap:memory bootstrap`
   - `migrate-snapshots` → `/cap:memory migrate-snapshots`
   - `refresh-docs` → `/cap:refresh-docs`
3. Capture the outcome:
   - **success** — the sub-command completed cleanly
   - **failure** — the sub-command threw or returned an error
4. Record the result via `cap-upgrade.cjs:recordStageResult`:

```bash
node -e "
const upgrade = require('./cap/bin/lib/cap-upgrade.cjs');
upgrade.recordStageResult(process.cwd(), '<STAGE_NAME>', {
  status: '<success|failure|skipped>',
  reason: '<short reason or error message>',
  durationMs: <Date.now() - startTime>
});
"
```

5. **Per-stage isolation:** if status === 'failure', LOG the error and CONTINUE to the next stage. Do NOT abort the whole upgrade. (One stage failing should not block the rest.)

For SKIPPED stages, also record the result with `status: 'skipped'` and the predicate's reason — the audit log captures both successes and skips.

## Step 5: Final summary

After all stages have been processed, read back the upgrade log and marker:

```bash
node -e "
const upgrade = require('./cap/bin/lib/cap-upgrade.cjs');
const log = upgrade.readLog(process.cwd());
const marker = upgrade.getMarkerVersion(process.cwd());
console.log('=== UPGRADE SUMMARY ===');
console.log('Marker version: ' + (marker ? marker.version : 'unwritten'));
console.log('Completed stages: ' + (marker ? marker.completedStages.join(', ') : 'none'));
console.log('Last run: ' + (marker ? marker.lastRun : 'never'));
console.log('');
console.log('Recent log entries:');
for (const e of log.slice(-10)) {
  console.log('  [' + e.timestamp + '] ' + e.stage + ' ' + e.status + (e.reason ? ' — ' + e.reason : ''));
}
"
```

Show this to the user.

## Step 6: Hook registration (auto-wired for plugin installs)

<!-- @cap-decision(F-084/iter1) Stage-2 #3 fix: $CLAUDE_PROJECT_DIR consistency. Plugin-mode (npx code-as-plan@latest) auto-registers the SessionStart hook via hooks/hooks.json. Manual install (a developer cloning this repo) uses $CLAUDE_PROJECT_DIR per the project's own .claude/settings.json convention. -->

For users installing CAP as a plugin (`npx code-as-plan@latest`), the SessionStart hook is **auto-registered** via `hooks/hooks.json` — no manual step needed.

For developers working **inside** the CAP repo itself (or installing without the plugin manifest), opt in by adding the following entry to your project-local `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/hooks/cap-version-check.js",
            "timeout": 2
          }
        ]
      }
    ]
  }
}
```

The hook is **non-blocking** and emits a one-line advisory at most once per session when the installed CAP version doesn't match the project's `.cap/version` marker. Suppressible via `.cap/config.json:upgrade.notify=false`.

NOTE: `.claude/settings.json` is gitignored in most repos — do NOT modify it programmatically. The user opts in by editing it.

## Step 7: Update session

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:upgrade',
  lastCommandTimestamp: new Date().toISOString()
});
"
```

</process>

<failure-modes>

| Failure | Behavior |
|---------|----------|
| Marker file corrupted (.cap/version unparseable) | Treat as first-run; log a warning advising `--force-rerun` |
| Stage command throws | Log as `failure` with the error message; continue with the next stage |
| Concurrent /cap:upgrade in another shell | <!-- @cap-decision(F-084/iter1, key:no-lock) Stage-2 #6 fix: no-lock failure-modes wording sharpened. --> Concurrent upgrade runs are NOT prevented by file lock. Per-stage idempotency means correctness is preserved (re-running converges on the same final state via skip-predicates), but `.cap/upgrade.log` entries from concurrent runs may interleave and the `.cap/version` marker reflects only the last writer (so `completedStages` may temporarily under-count one of the runners). Single-user CLI tool; concurrent runs are an unsupported edge case — re-run /cap:upgrade if the marker looks incomplete. |
| Disk full mid-marker-write | _atomicWriteFile writes to .tmp then renames; the original marker is preserved |
| User aborts mid-pipeline | Stages run so far are logged; the user can re-invoke /cap:upgrade and the planner will skip what's already done |

</failure-modes>
