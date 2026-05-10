---
name: cap:migrate
description: "Migrate GSD Code-First v1.x projects to CAP v2.0 — converts @gsd-* tags, planning artifacts, and session format. Spawns cap-migrator (MODE: GSD)."
argument-hint: "[--dry-run] [--apply] [--tags-only] [--rescope] [--force] [--allow-large-diff]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
  - Grep
  - AskUserQuestion
---

<!-- @cap-feature(feature:F-MIGRATE) /cap:migrate — thin wrapper around cap-migrator (MODE: GSD). -->
<!-- @cap-decision Wrapper pattern (mirrors /cap:test → cap-validator). All Plan→Diff→Apply→Verify→Rollback logic lives in cap-migrator; this command parses flags and spawns the agent. -->
<!-- @cap-decision Argument compat: legacy --dry-run is preserved AND remains the default. New --apply flag opts in to write — required by cap-migrator's safety contract. Passing neither = dry-run. -->
<!-- @cap-decision Legacy --tags-only is forwarded to the agent prompt (agent will run only the migrateTags sub-plan in MODE: GSD). -->

<objective>
Migrate a GSD Code-First v1.x project to CAP v2.0 format. Converts `@gsd-*` tags to `@cap-*` equivalents, transforms `.planning/*` artifacts into FEATURE-MAP.md entries, and migrates `.planning/SESSION.json` to `.cap/SESSION.json`.

This command is a thin wrapper that spawns the `cap-migrator` agent in **MODE: GSD**. The agent owns the atomic Plan→Diff→Apply→Verify pipeline with backup + rollback under `.cap/migrations/<id>/`.

**Flags (backwards-compatible):**
- `--dry-run` — preview only, no writes (default; identical to omitting `--apply`).
- `--apply` — perform the migration. Without this flag the run is a dry-run, regardless of `--dry-run` presence.
- `--tags-only` — run only the tag-rewrite sub-plan; skip artifact + session migration.
- `--rescope` — split the root FEATURE-MAP.md into per-app Feature Maps (monorepo only).
- `--force` — skip the user-confirmation gate.
- `--allow-large-diff` — bypass the 100 KB / 500-file safety gate after a clean dry-run review.
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
</context>

<process>

## Step 1: Parse flags

From `$ARGUMENTS`:
- `apply = $ARGUMENTS contains "--apply"` (otherwise dry-run)
- `tags_only = $ARGUMENTS contains "--tags-only"`
- `rescope = $ARGUMENTS contains "--rescope"`
- `force = $ARGUMENTS contains "--force"`
- `allow_large_diff = $ARGUMENTS contains "--allow-large-diff"`

`--dry-run` is the default; mention it in the prompt only if explicitly passed (signals user intent).

## Step 2: Spawn cap-migrator (MODE: GSD)

Use the Task tool to spawn `cap-migrator` with the prompt below. Forward `$ARGUMENTS` verbatim so the agent sees every flag.

```
**MODE: GSD**

$ARGUMENTS

**Flags resolved by /cap:migrate:**
- apply: {apply}
- tags_only: {tags_only}
- rescope: {rescope}
- force: {force}
- allow_large_diff: {allow_large_diff}

**Sub-plans to compose (MODE: GSD pipeline):**
1. migrateTags — rewrite @gsd-* → @cap-*
{If NOT tags_only:}
2. migrateArtifacts — .planning/* → FEATURE-MAP.md entries
3. migrateSession — .planning/SESSION.json → .cap/SESSION.json
{End if}
{If rescope:}
4. rescopeFeatures — split root FEATURE-MAP.md per workspace package (cap-feature-map.cjs::rescopeFeatures). Abort with a clear message if not a monorepo.
{End if}

**Confirmation:**
{If apply AND NOT force:}
Use AskUserQuestion before promoting the staged tree:
> "Proceed with migration? Plan shows N files, +K bytes. Run with --dry-run first to preview."
{End if}

**Output contract:** emit the standard `=== MIGRATION RESULTS ===` block. Include the GSD-specific sub-plan counters (tagsConverted, tagsRemoved, featuresFound, sessionMigrated, rescope distribution if applicable) so the wrapper can render the legacy summary verbatim.
```

## Step 3: Render the legacy summary

Parse the agent's `=== MIGRATION RESULTS ===` block plus its sub-plan counters, then print:

```
Migration {Complete | Plan-only}
==================

Tags:       {tagsConverted} converted, {tagsRemoved} removed
Artifacts:  {featuresFound} features extracted → FEATURE-MAP.md
Session:    {sessionMigrated ? 'migrated to .cap/SESSION.json' : 'no session to migrate'}
{If rescope:}
Rescope:    {appsCreated} apps, {featuresDistributed} features distributed, {featuresKeptAtRoot} kept at root
{End if}

Backup:     {tx_backup_path}
Verify:     {PASS | FAIL — reason}

{If NOT apply:}
NOTE: This was a dry run. No files were modified. Run with --apply to execute.
{Else if PASS:}
Next steps:
  1. Review changes with `git diff`
  2. Run /cap:scan to verify tag migration
  3. Run /cap:status to see Feature Map state
  4. Commit migrated files
{Else:}
Migration rolled back. Inspect: {tx_dir}
{End if}
```

## Step 4: Update session (only after a successful apply)

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:migrate',
  lastCommandTimestamp: new Date().toISOString()
});
"
```

</process>
