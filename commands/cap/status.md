---
name: cap:status
description: Show project status derived from Feature Map -- thin wrapper that spawns cap-curator (MODE: STATUS or DRIFT) for the dashboard, drift report, or completeness audit.
argument-hint: "[--features NAME] [--verbose] [--drift] [--completeness]"
allowed-tools:
  - Read
  - Bash
  - Task
  - Glob
  - Grep
---

<!-- @cap-context CAP v3 status command -- thin multi-mode wrapper. The dashboard logic (feature states, AC totals, tag coverage, token telemetry, neural memory, design-usage, suggested-next) lives in cap-curator MODE: STATUS. Drift detection lives in cap-curator MODE: DRIFT. Completeness scoring (F-048 opt-in) stays inline because the output format `formatFeatureBreakdown` is user-facing and was not migrated into cap-validator MODE: AUDIT (which uses `formatCompletenessReport`). -->
<!-- @cap-decision Wrapper, not orchestrator. Status.md was 327 lines duplicating logic now consolidated in cap-curator. The wrapper only parses flags, dispatches the right mode, and surfaces backwards-compat fast-paths (--drift, --completeness). -->
<!-- @cap-decision --completeness stays inline (calls formatFeatureBreakdown directly) to preserve the per-feature N/4 breakdown output. cap-validator MODE: AUDIT renders the longer formatCompletenessReport — distinct surface, distinct command (/cap:completeness). -->
<!-- @cap-decision Status remains read-only -- wrapper never mutates Feature Map or session. cap-curator's read-only contract is non-negotiable. -->
<!-- @cap-feature(feature:F-042) /cap:status --drift surfaces feature/AC status mismatches via cap-curator MODE: DRIFT (detectDrift + formatDriftReport). -->

<objective>
Presents a compact project status dashboard derived from FEATURE-MAP.md, SESSION.json, and a live tag scan. All rendering is delegated to cap-curator (read-only agent) — this command is a thin dispatcher.

**Arguments:**
- `--features NAME` — show status for specific features only (comma-separated). Forwarded to cap-curator.
- `--verbose` — include per-AC + Design-Usage breakdown via cap-trace.formatDesignUsage. Forwarded to cap-curator.
- `--drift` — fast-path: cap-curator MODE: DRIFT. Exit code 0 if consistent, 1 if drift exists (CI-friendly).
- `--completeness` — F-048 opt-in: per-feature 4-point Completeness Score breakdown. Inline fast-path (preserves `formatFeatureBreakdown` output verbatim).
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Parse flags

Inspect `$ARGUMENTS` for:
- `--completeness` → run Step 1 (inline fast-path), STOP.
- `--drift` → run Step 2 (cap-curator MODE: DRIFT), STOP.
- Otherwise → run Step 3 (cap-curator MODE: STATUS) with `--features NAME` and `--verbose` forwarded as-is.

## Step 1: Completeness fast-path (--completeness, F-048)

<!-- @cap-todo(ac:F-048/AC-2) /cap:status --completeness shall show per-feature N/4 scores. -->

```bash
node -e "
const comp = require('./cap/bin/lib/cap-completeness.cjs');
const cfg = comp.loadCompletenessConfig(process.cwd());
if (!cfg.enabled) {
  console.error('F-048 (completeness score) is opt-in and not enabled for this project.');
  console.error('To enable: add { \"completenessScore\": { \"enabled\": true } } to .cap/config.json');
  process.exit(2);
}
const ctx = comp.buildContext(process.cwd());
const scores = comp.scoreAllFeatures(ctx);
console.log(comp.formatFeatureBreakdown(scores));
"
```

Display verbatim, then **stop**. (For the longer markdown audit suitable for PR attachment, see `/cap:completeness`.)

## Step 2: Drift fast-path (--drift)

<!-- @cap-todo(ac:F-042/AC-6) /cap:status --drift surfaces mismatched feature/AC states for the entire Feature Map. Exit code 0 if no drift, 1 if drift exists (CI-friendly). -->

Spawn `cap-curator` via Task tool with this prompt:

```
**MODE: DRIFT**

$ARGUMENTS

Render the drift report verbatim from `fm.formatDriftReport(fm.detectDrift(root))`.
Exit code is CI-meaningful: 0 = consistent, 1 = drift.
Append the read-only footer pointing at /cap:reconcile.
```

Display the agent's output verbatim, then **stop**.

## Step 3: Status dashboard (default)

<!-- @cap-todo(ref:AC-31) /cap:status shall display the current session state from SESSION.json (active feature, current step, session duration). -->
<!-- @cap-todo(ref:AC-32) /cap:status shall display a summary of FEATURE-MAP.md (count of features per state). -->
<!-- @cap-todo(ref:AC-33) /cap:status shall display tag coverage statistics (files with tags vs. total source files). -->
<!-- @cap-todo(ac:F-061/AC-3) /cap:status shall display current session token consumption and LLM budget remaining capacity. -->
<!-- @cap-todo(ac:F-080/AC-4) /cap:status displays Claude-native bridge surface when bridge data is available. -->
<!-- @cap-todo(ac:F-040/AC-3) /cap:status surfaces Neural Memory section (cluster count, dormant nodes, highest-affinity pair, last clustering timestamp). -->
<!-- @cap-todo(ac:F-063/AC-5) /cap:status --verbose displays the feature's Design-Usage list inline via cap-trace.formatDesignUsage. -->

Spawn `cap-curator` via Task tool with this prompt:

```
**MODE: STATUS**

$ARGUMENTS

Render the compact dashboard:
- Session block: activeFeature, step, durationMinutes, lastCommand + token telemetry line (cap-telemetry.formatSessionStatusLine).
- Claude-native bridge surface (cap-memory-bridge.formatSurface) — silent skip if empty.
- Features by state (planned/prototyped/tested/shipped) + AC totals (total/implemented/tested/reviewed).
- Tag coverage (filesWithTags/totalFiles, totalTags grouped by @cap-feature/@cap-todo/@cap-risk/@cap-decision).
- Last scan timestamp.
- Neural Memory block (cap-cluster-display.loadAndFormatStatus).
- If --verbose: per-feature ACs + file count + dependencies + Design-Usage line via cap-trace.formatDesignUsage(feature, parseDesignIds(DESIGN.md)).
- Suggested-next hint based on session/feature state and tag coverage.

Read-only: never write FEATURE-MAP, SESSION, memory, or code. Output to stdout only.
```

The agent renders the full `=== CAP Status ===` dashboard verbatim, including the suggested-next line. Display its output as-is.

</process>
</content>
</invoke>