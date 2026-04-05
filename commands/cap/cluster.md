---
name: cap:cluster
description: Display neural memory clusters -- overview of all clusters or detail view of a specific cluster with pairwise affinity and drift status.
argument-hint: "[cluster-label] [--verbose]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

<!-- @cap-feature(feature:F-040) Cluster command -- displays detected thread clusters with affinity scores, shared concepts, and drift status. -->
<!-- @cap-decision Cluster display is read-only -- it presents clustering information but never modifies graph or session state. Safe to run at any time. -->
<!-- @cap-decision Pure formatting logic lives in cap-cluster-display.cjs for testability; this command orchestrates I/O and output. -->

<objective>
Displays neural memory clusters derived from the memory graph, thread index, and affinity data:
- Overview: all clusters with labels, member counts, average affinity, dormant count (AC-1)
- Detail: specific cluster members, pairwise scores, shared concepts, drift status (AC-2)

**Arguments:**
- `cluster-label` -- if provided, show detail view for the matching cluster
- `--verbose` -- include additional signal breakdown in pairwise table
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- First non-flag argument -- if present, store as `cluster_label` (the cluster label to show detail for)
- `--verbose` -- if present, set `verbose = true`

## Step 1: Load data and run cluster detection

<!-- @cap-todo(ac:F-040/AC-1) Load graph, threads, affinity config, run cluster detection, display overview -->

```bash
node -e "
const display = require('./cap/bin/lib/cap-cluster-display.cjs');
const result = display.loadAndFormatOverview(process.cwd());
console.log(result);
"
```

Store the output as `overview_output`.

If `cluster_label` is set, proceed to Step 2. Otherwise, display `overview_output` and skip to Step 3.

## Step 2: Display cluster detail

<!-- @cap-todo(ac:F-040/AC-2) Display detail view for a specific cluster: members, pairwise scores, shared concepts, drift status -->

```bash
node -e "
const display = require('./cap/bin/lib/cap-cluster-display.cjs');
const label = process.argv[1];
const result = display.loadAndFormatDetail(process.cwd(), label);
console.log(result);
" -- "$cluster_label"
```

Display the detail output.

## Step 3: Present formatted output

<!-- @cap-todo(ac:F-040/AC-7) Consistent CAP status formatting with markdown tables and consistent headers -->

Display the output from Step 1 or Step 2 as the command result.

Format:
- Use markdown tables with consistent headers
- Use monospace for thread IDs and scores
- Indent nested sections for readability

If no clusters are detected, display:

```
Neural Memory Clusters

No clusters detected. Run /cap:iterate or /cap:prototype to build thread history,
then affinity scores will be computed automatically.
```

## Step 4: Suggest next action

Based on current state, suggest the most useful next command:

- If no clusters exist: "Run /cap:prototype or /cap:iterate to generate thread activity for clustering."
- If viewing overview: "Run /cap:cluster {label} to see detail for a specific cluster."
- If viewing detail with drift detected: "Consider running /cap:iterate on diverging threads to re-align."
- Otherwise: "Run /cap:status to see the full project dashboard including neural memory."

```
Suggested next: {action}
```

</process>
