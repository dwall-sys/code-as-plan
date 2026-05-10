---
name: cap:migrate-feature-map
description: "Shard a monolithic FEATURE-MAP.md into Index + per-feature files (F-089). Spawns cap-migrator (MODE: FEATURE-MAP)."
argument-hint: "[--apply] [--app=<path>] [--force]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
---

<!-- @cap-feature(feature:F-089, primary:true) /cap:migrate-feature-map — thin wrapper around cap-migrator (MODE: FEATURE-MAP). -->
<!-- @cap-decision Wrapper pattern. Byte-lossless extraction (raw bytes, no parse → serialize) and atomic backup + rollback live in cap-migrator. -->
<!-- @cap-decision Argument compat: --apply, --app=<path>, --force preserved. Dry-run remains the default. -->

<objective>
Shard the monolithic `FEATURE-MAP.md` into the F-089 layout:

```
FEATURE-MAP.md          ← index file (one line per feature)
features/F-001.md       ← full feature block
features/F-002.md
features/F-Hub-Spotlight.md
...
FEATURE-MAP.md.backup-pre-F-089   ← byte-identical backup of the original
```

**Why:** A FEATURE-MAP that grew to 4,000+ lines costs 30–50k tokens for every agent read. Sharded mode makes agents load just the index (~100 chars per feature) plus the active feature's per-feature file — typically a 10–50× token reduction on large projects.

The migration is **byte-lossless** for feature blocks (raw extraction). Once migrated, all CAP commands continue to work via the read/write dispatchers — no agent prompts need to change.

**Flags (backwards-compatible):**
- `--apply` — write the migration to disk. Without it, dry-run only.
- `--app=<path>` — operate on a sub-app's `FEATURE-MAP.md` instead of the root (e.g. `--app=apps/hub`).
- `--force` — proceed even when the planner flagged duplicate IDs or other issues. NOT recommended for duplicates.

**Idempotency:** Re-running on an already-sharded project is a no-op. Backwards-compat: projects without `features/` continue to work in monolithic mode.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Parse flags

From `$ARGUMENTS`:
- `apply = $ARGUMENTS contains "--apply"`
- `app_path = value after --app=` (or null)
- `force = $ARGUMENTS contains "--force"`

## Step 2: Spawn cap-migrator (MODE: FEATURE-MAP)

Use the Task tool to spawn `cap-migrator`. Forward `$ARGUMENTS` verbatim.

```
**MODE: FEATURE-MAP**

$ARGUMENTS

**Flags resolved by /cap:migrate-feature-map:**
- apply: {apply}
- app_path: {app_path or root}
- force: {force}

**Pipeline obligations (MODE: FEATURE-MAP):**
1. Plan via `cap-feature-map-migrate.cjs::planMigration(projectRoot, app_path)`.
2. Render verbatim using `formatPlan`. Source-mode handling:
   - `missing` — abort, nothing to migrate.
   - `sharded` — already done; emit `=== PLAN-ONLY ===` and exit.
   - `monolithic` — proceed.
   - `monolithic` with skips (duplicate IDs etc.) — surface skips, ask user to resolve OR pass --force to proceed without those features.
3. If --apply: AskUserQuestion → "Migrate FEATURE-MAP.md to sharded layout? Will write N per-feature files + backup + new index. (yes/no)" — skip the prompt only if --apply was passed AND the plan has zero skips.
4. On apply success, stage + verify + promote per the shared pipeline. Verify obligations:
   - `readFeatureMap()` loads the same feature count as the planner.
   - Every feature ID in the index has a matching `features/F-<id>.md`.
   - The `FEATURE-MAP.md.backup-pre-F-089` matches the original by byte-length and sha256.

**Output contract:** preserve `formatPlan` output verbatim, then append the `=== MIGRATION RESULTS ===` block.
```

## Step 3: Post-apply guidance

After a successful apply, point the user to the next step:

- "Sharded layout active. Index file: `FEATURE-MAP.md`. Per-feature files: `features/F-*.md`. Backup: `FEATURE-MAP.md.backup-pre-F-089`."
- "All CAP commands (`/cap:scan`, `/cap:reconcile`, `/cap:status`, etc.) continue to work transparently."
- "If anything looks wrong, restore via the migrator backup at `.cap/migrations/<tx_id>/backup/` or via: `cp FEATURE-MAP.md.backup-pre-F-089 FEATURE-MAP.md && rm -rf features/`"

</process>
