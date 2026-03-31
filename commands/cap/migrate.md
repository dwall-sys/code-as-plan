---
name: cap:migrate
description: "Migrate GSD Code-First v1.x projects to CAP v2.0 -- converts @gsd-* tags, planning artifacts, and session format."
argument-hint: "[--dry-run] [--tags-only] [--force]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

<!-- @cap-feature(feature:F-MIGRATE) Migration command -- converts GSD v1.x projects to CAP v2.0 format. -->
<!-- @cap-todo Supports --dry-run, --tags-only, and --force flags. -->

<objective>
Migrate a GSD Code-First v1.x project to CAP v2.0 format. Converts @gsd-* tags to @cap-* equivalents, transforms planning artifacts into FEATURE-MAP.md entries, and migrates .planning/SESSION.json to .cap/SESSION.json.
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--dry-run` — show what would change without writing files
- `--tags-only` — only migrate tags, skip artifact and session migration
- `--force` — skip user confirmation gate

## Step 1: Analyze migration scope

Run the analysis to determine what needs migrating:

```bash
node -e "
const migrate = require('./cap/bin/lib/cap-migrate.cjs');
const report = migrate.analyzeMigration(process.cwd());
console.log(JSON.stringify(report, null, 2));
"
```

Store as `analysis`. Present a summary to the user:

```
Migration Analysis
==================

@gsd-* tags found:     {gsdTagCount}
Legacy artifacts:       {gsdArtifacts.length} ({list})
.planning/ directory:   {yes/no}
SESSION.json (v1.x):   {yes/no}

Recommendations:
{For each recommendation:}
  - {recommendation}
```

## Step 2: Confirm with user (unless --force)

If `--force` is NOT set and this is NOT `--dry-run`, use AskUserQuestion to confirm:

> "Proceed with migration? This will modify source files and create CAP v2.0 artifacts. Use --dry-run first if you want to preview changes."

If user declines, abort with message: "Migration cancelled. Run with --dry-run to preview changes."

## Step 3: Migrate tags

```bash
node -e "
const migrate = require('./cap/bin/lib/cap-migrate.cjs');
const dryRun = process.argv[1] === 'true';
const result = migrate.migrateTags(process.cwd(), { dryRun });
console.log(JSON.stringify(result, null, 2));
" '<DRY_RUN_VALUE>'
```

Store as `tag_result`. Report:

```
Tag Migration
=============
Files scanned:    {filesScanned}
Files modified:   {filesModified}
Tags converted:   {tagsConverted}
Tags removed:     {tagsRemoved}

{If changes.length > 0, show first 20 changes:}
Changes:
  {file}:{line} [{action}]
    - {original}
    + {replaced}
```

If `--tags-only` is set, skip to Step 6.

## Step 4: Migrate artifacts

```bash
node -e "
const migrate = require('./cap/bin/lib/cap-migrate.cjs');
const dryRun = process.argv[1] === 'true';
const result = migrate.migrateArtifacts(process.cwd(), { dryRun });
console.log(JSON.stringify(result, null, 2));
" '<DRY_RUN_VALUE>'
```

Store as `artifact_result`. Report:

```
Artifact Migration
==================
Source:            {source}
Features found:    {featuresFound}
Feature Map:       {featureMapCreated ? 'created/updated' : 'no changes'}
```

## Step 5: Migrate session

```bash
node -e "
const migrate = require('./cap/bin/lib/cap-migrate.cjs');
const dryRun = process.argv[1] === 'true';
const result = migrate.migrateSession(process.cwd(), { dryRun });
console.log(JSON.stringify(result, null, 2));
" '<DRY_RUN_VALUE>'
```

Store as `session_result`. Report:

```
Session Migration
=================
Old format:   {oldFormat}
New format:   {newFormat}
Migrated:     {migrated ? 'yes' : 'no'}
```

## Step 6: Final report and session update

```
Migration Complete
==================

Tags:       {tagsConverted} converted, {tagsRemoved} removed
Artifacts:  {featuresFound} features extracted → FEATURE-MAP.md
Session:    {migrated ? 'migrated to .cap/SESSION.json' : 'no session to migrate'}

{If dry run:}
NOTE: This was a dry run. No files were modified. Run without --dry-run to apply changes.

{If not dry run:}
Next steps:
  1. Review changes with `git diff`
  2. Run /cap:scan to verify tag migration
  3. Run /cap:status to see project state from Feature Map
  4. Commit migrated files
```

Update session state (unless dry run):

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
