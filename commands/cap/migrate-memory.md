---
name: cap:migrate-memory
description: "Migrate V5 monolithic project memory (.cap/memory/{decisions,pitfalls,patterns,hotspots}.md) to V6 per-feature layout (F-077). Spawns cap-migrator (MODE: MEMORY)."
argument-hint: "[--apply] [--interactive=false] [--allow-large-diff]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - AskUserQuestion
---

<!-- @cap-feature(feature:F-077, primary:true) /cap:migrate-memory — thin wrapper around cap-migrator (MODE: MEMORY). -->
<!-- @cap-decision New top-level command (sibling to /cap:migrate-tags and /cap:migrate-feature-map). The legacy `/cap:memory migrate` subcommand remains as an alias for backwards compatibility — both ultimately route through cap-migrator (MODE: MEMORY). -->
<!-- @cap-decision Argument compat: --apply and --interactive=false mirror the existing /cap:memory migrate flags. --allow-large-diff is added for parity with the other migrators. -->

<objective>
Migrate V5 monolithic project memory to the V6 per-feature layout (F-077).

**V5 (legacy):** monolithic `.cap/memory/decisions.md`, `pitfalls.md`, `patterns.md`, `hotspots.md` plus `graph.json`. Detected as V5 when the top-level files lack the `(V6 Index)` marker.

**V6 (target):** per-feature files under `.cap/memory/features/F-NNN-<topic>.md`, cross-cutting topics under `.cap/memory/platform/<topic>.md`, ambiguous entries pooled in `.cap/memory/snapshots-unassigned.md`. The top-level `decisions.md` / `pitfalls.md` become thin `(V6 Index)` index tables (`Destination | Count | File`).

**Why:** V6 lets agents load only the index plus the active feature's memory file — typically a 10–50× token reduction over reading the full V5 monolith on every Read.

This command is a thin wrapper that spawns the `cap-migrator` agent in **MODE: MEMORY**. The agent owns the atomic Plan→Diff→Apply→Verify pipeline with backup + rollback under `.cap/migrations/<id>/`. The agent reuses the existing `cap-memory-migrate.cjs::migrateMemory()` pipeline (classification, snapshot routing, ambiguity prompts) — no logic is reimplemented.

**Flags:**
- `--apply` — execute the migration. Without it, dry-run only (default).
- `--interactive=false` — auto-resolve every ambiguity to its highest-confidence candidate (CI-friendly). Default is interactive.
- `--allow-large-diff` — bypass the 100 KB / 500-file safety gate after a clean dry-run review.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Parse flags

From `$ARGUMENTS`:
- `apply = $ARGUMENTS contains "--apply"`
- `interactive = NOT ($ARGUMENTS contains "--interactive=false")`
- `allow_large_diff = $ARGUMENTS contains "--allow-large-diff"`

## Step 2: Spawn cap-migrator (MODE: MEMORY)

Use the Task tool to spawn `cap-migrator`. Forward `$ARGUMENTS` verbatim.

```
**MODE: MEMORY**

$ARGUMENTS

**Flags resolved by /cap:migrate-memory:**
- apply: {apply}
- interactive: {interactive}
- allow_large_diff: {allow_large_diff}

**Pipeline obligations (MODE: MEMORY):**
1. Detect V5 vs V6 by reading `.cap/memory/decisions.md`. If it already contains `(V6 Index)`, emit `=== PLAN-ONLY ===` (already migrated) and stop.
2. Plan via `cap-memory-migrate.cjs::planMigration(projectRoot)` (or `migrateMemory(projectRoot, { apply: false, interactive })` for full classification dry-run).
3. Render the plan with classification counts: total, assigned (per-feature), platform, unassigned, ambiguous-needing-prompt.
4. If --apply AND interactive: prompt for each ambiguous entry (top-3 candidates + skip + auto-all + quit) using AskUserQuestion. If --interactive=false, auto-resolve all to highest-confidence candidate.
5. Stage + verify + promote per the shared pipeline. V5 source files are backed up to BOTH `.cap/migrations/<tx_id>/backup/` (migrator) AND `.cap/memory/.archive/<date>/` (memory-pipeline convention).
6. Stage rewritten top-level `decisions.md` / `pitfalls.md` as `(V6 Index)` index tables.
7. Stage migration report at `.cap/memory/.archive/migration-report-<date>.md`.

**Verify obligations:**
- Every V5 entry has exactly one V6 destination (no loss, no duplication).
- Each `(V6 Index)` table count matches the file scan count.
- All staged Markdown parses without error.
- On any failure: roll back via `.cap/migrations/<tx_id>/backup/` AND restore from `.cap/memory/.archive/<date>/`.

**Output contract:** preserve the `migrateMemory()` report counters (total / assigned / platform / skipped) AND emit the standard `=== MIGRATION RESULTS ===` block.
```

## Step 3: Post-apply guidance

After a successful apply, point the user to the next step:

```
V6 layout active.

Index files (root):    .cap/memory/decisions.md, pitfalls.md  ← (V6 Index) tables
Per-feature memory:    .cap/memory/features/F-NNN-<topic>.md
Platform memory:       .cap/memory/platform/<topic>.md
Migration report:      .cap/memory/.archive/migration-report-<date>.md
Migrator backup:       .cap/migrations/<tx_id>/backup/

The agent rule at .claude/rules/cap-memory.md auto-detects the (V6 Index) marker
and reads only the relevant per-feature file. No agent prompts need to change.

If anything looks wrong, the rollback paths are preserved in BOTH backup locations.
Commit .cap/memory/features/, .cap/memory/platform/, and .cap/memory/.archive/ to git when satisfied.
```

If only a dry-run was requested:

```
Dry-run complete. No files were modified.

Run /cap:migrate-memory --apply to execute.
For CI: /cap:migrate-memory --apply --interactive=false
```

</process>
