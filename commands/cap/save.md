---
name: cap:save
description: Save current session context to a snapshot file via the cap-historian agent. Cross-session continuity without compression losses.
argument-hint: "[name] [--unassigned] [--platform=<topic>] [--feature=<F-ID>] [--fork=<parent-snapshot>]"
allowed-tools:
  - Task
  - Read
  - Bash
---

<!-- @cap-context Thin orchestrator. Real lifecycle work lives in agents/cap-historian.md (modes: SAVE / CONTINUE / FORK). Mirrors the test.md→cap-validator wrapper shape. -->
<!-- @cap-decision /cap:save delegates to cap-historian via Task() with MODE: SAVE prefix. Backwards-compat: positional [name], --unassigned, --platform=<topic> preserved verbatim. New: --feature=<F-ID> is forwarded; --fork=<parent> redirects to MODE: FORK. -->
<!-- @cap-feature(feature:F-079) Snapshot-Linkage to Features and Platform — frontmatter `feature:` / `platform:` fields wire snapshots to F-076 per-feature / F-078 platform memory layers. cap-historian reuses cap-snapshot-linkage.cjs; soft-warn semantics inherited. -->

<objective>
Spawn `cap-historian` to capture current session context as a `.cap/snapshots/<name>.md` snapshot with Frontmatter linkage and a JSONL index entry. The snapshot can later be loaded via `/cap:continue`.

**Arguments (backwards-compatible):**
- `[name]` — optional snapshot name (default: auto-generated from active feature + date, else `YYYY-MM-DD-HHMM`).
- `--unassigned` — save without feature/platform linkage (soft-warn on stderr).
- `--platform=<topic>` — link to platform topic (kebab-case). Mutually exclusive with `--unassigned`.
- `--feature=<F-ID>` — explicit feature linkage override (default: `SESSION.json.activeFeature`).
- `--fork=<parent-snapshot>` — branch off a parent snapshot ("what if X instead"). Routes to MODE: FORK; parent is never mutated.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Detect mode

If `$ARGUMENTS` contains `--fork=<parent>`, mode is **FORK**. Otherwise mode is **SAVE**.

## Step 2: Spawn cap-historian

Invoke `cap-historian` via Task tool with the appropriate mode prefix:

```
**MODE: SAVE**          (or **MODE: FORK** if --fork= present)

$ARGUMENTS

Capture current session context. Reuse cap-snapshot-linkage.cjs for linkage
resolution and cap-session-extract.cjs for source-JSONL discovery. Write snapshot
to .cap/snapshots/<name>.md (refuse to overwrite — append -2/-3 if needed) and
append an event line to .cap/snapshots/index.jsonl.

Return the structured `=== HISTORIAN SAVE RESULTS ===` (or FORK) block verbatim.
```

Wait for cap-historian to complete. Parse the structured results block.

## Step 3: Confirm to user

After the agent returns, surface the outcome in the legacy-compatible shape:

```
Snapshot saved to .cap/snapshots/<name>.md
Linkage: feature=<F-NNN> | platform=<topic> | unassigned
Files captured: <N>

To continue in a fresh session: /cap:continue <name>
```

For FORK mode, also include `Forked from: <parent>`.

**Note:** The snapshot is auto-wired into per-feature/platform memory by the
`hooks/cap-memory.js` pipeline on the next run (F-079/AC-4) — no manual step.

</process>
