---
name: cap:migrate-tags
description: "Migrate fragmented @cap-feature / @cap-todo(ac:…) tags to unified @cap anchor blocks (F-047, additive). Spawns cap-migrator (MODE: TAGS)."
argument-hint: "[--apply] [--json] [--include=<glob>] [--exclude=<glob>] [--allow-large-diff] [--force]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
---

<!-- @cap-feature(feature:F-047, primary:true) /cap:migrate-tags — thin wrapper around cap-migrator (MODE: TAGS). -->
<!-- @cap-feature(feature:F-085) Scope-filter (gitignore + plugin-mirror + 500-file safety gate) is enforced by the agent. -->
<!-- @cap-decision Wrapper pattern. Plan→Diff→Apply→Verify with atomic backup + rollback lives in cap-migrator. -->
<!-- @cap-decision Argument compat: --apply, --json, --include=, --exclude=, --allow-large-diff, --force are all preserved. Dry-run remains the default. -->

<objective>
Plan and optionally apply the migration from fragmented `@cap-*` tags to the unified anchor block format introduced by F-047.

The migration is **additive** — legacy fragmented tags are preserved alongside the new unified block so the two formats can coexist while the ecosystem converts. A future cleanup pass can remove the fragmented tags once the unified block is universal.

**Opt-in gate (F-047):** requires `.cap/config.json → unifiedAnchors.enabled = true`. Without it, `--apply` is refused; `--force` permits a dry-run preview only.

**Scope (F-085):** the migrator shares `cap-scope-filter.cjs` with `cap-tag-scanner`, skipping by default:
- everything matched by the project's top-level `.gitignore` (typically `.claude/`, `node_modules/`, `dist/`, `coverage/`, …);
- agent worktrees under `.claude/worktrees/`;
- the plugin-self-mirror at `.claude/cap/`;
- test fixtures under `tests/fixtures/` and `**/fixtures/polyglot/`.

A built-in safety gate refuses to apply the migration to more than 500 files in a single run; bypass with `--allow-large-diff` after verifying the dry-run report.

**Flags (backwards-compatible):**
- `--apply` — write the migration to disk after explicit confirmation. Without it, dry-run only.
- `--json` — emit the structured migration plan as JSON for downstream tools.
- `--include=<glob>` — restrict the scan to paths matching the pattern (additive, repeatable).
- `--exclude=<glob>` — additionally skip paths matching the pattern (additive, repeatable).
- `--allow-large-diff` — permit `--apply` to write more than 500 files.
- `--force` — ignore the F-047 opt-in gate (dry-run preview only).
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Parse flags

From `$ARGUMENTS`:
- `apply`, `json`, `force`, `allow_large_diff` — boolean flags
- `include`, `exclude` — collected glob lists (repeatable)

## Step 2: Spawn cap-migrator (MODE: TAGS)

Use the Task tool to spawn `cap-migrator`. Forward `$ARGUMENTS` verbatim.

```
**MODE: TAGS**

$ARGUMENTS

**Flags resolved by /cap:migrate-tags:**
- apply: {apply}
- json: {json}
- force: {force}
- allow_large_diff: {allow_large_diff}
- include: {include or none}
- exclude: {exclude or none}

**Pipeline obligations (MODE: TAGS):**
1. Gate on `.cap/config.json → unifiedAnchors.enabled === true` (F-047 opt-in). On gate-fail without --force, refuse and print:
   "F-047 (unified anchors) is opt-in and not enabled for this project.
    To enable: add { \"unifiedAnchors\": { \"enabled\": true } } to .cap/config.json
    You can still run the migration with --force (dry-run) to preview the diff."
2. Plan via `cap-migrate-tags.cjs::planProjectMigration` honoring include/exclude globs.
3. Render the plan with `cap-migrate-tags.cjs::formatMigrationReport`. If --json, emit the plan JSON instead.
4. If --apply AND gate passed: AskUserQuestion → "Apply the unified-anchor migration to the listed files? (yes/no)" — abort on no.
5. On yes: stage + verify + promote via the MODE: TAGS pipeline. The 500-file ceiling raises `CAP_MIGRATE_LARGE_DIFF` unless --allow-large-diff.
6. Legacy fragmented tags MUST be preserved (additive migration).

**Output contract:** preserve `cap-migrate-tags.cjs::formatMigrationReport` output verbatim, then append the `=== MIGRATION RESULTS ===` block.
```

## Step 3: Suggest next action (based on agent results)

- If dry-run completed with changes: "Run `/cap:migrate-tags --apply` to persist the anchors. Legacy tags remain in place; a future cleanup pass can remove them."
- If the F-047 gate blocked the run: "Enable F-047 via `.cap/config.json → unifiedAnchors.enabled=true`, then re-run."
- If `CAP_MIGRATE_LARGE_DIFF` fired: "Verify the dry-run scope, then re-run with `--allow-large-diff` to override."
- If nothing to change: "Project is already migrated or has no fragmented tags."

</process>
