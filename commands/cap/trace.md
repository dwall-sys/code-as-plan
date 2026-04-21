---
name: cap:trace
description: "Print the call graph for a single acceptance criterion across all contributing files. Resolves primary file via @cap-feature(...primary:true) or tag-density heuristic."
argument-hint: "<AC-N | F-NNN/AC-N> [--depth N] [--restrict] [--json]"
allowed-tools:
  - Read
  - Bash
---

<!-- @cap-context CAP v2.0 trace command -- shows where an AC is implemented across files and what it depends on. Read-only. -->
<!-- @cap-decision Trace is read-only -- no Feature Map writes, no session updates. Safe to run repeatedly. -->
<!-- @cap-feature(feature:F-045) /cap:trace renders TraceResult from cap-trace.cjs as a tree. -->
<!-- @cap-todo(ac:F-045/AC-4) /cap:trace AC-N shall print the call graph from the primary file across referenced files for a given acceptance criterion. -->

<objective>
Print a structured trace for a single acceptance criterion:

- Which file is the primary implementation (designated via `@cap-feature(...primary:true)` or inferred via tag density)
- Which other files contribute to the same AC
- Static call graph (require/import edges) walked outward from the primary file up to N hops

This makes multi-file ACs navigable when a single AC spans more than one source file.

**Argument formats:**
- `F-NNN/AC-M` -- fully qualified
- `AC-M` -- short form, requires an active feature in `.cap/SESSION.json`

**Flags:**
- `--depth N` -- max BFS depth for the call graph (default 3)
- `--restrict` -- only follow edges into other AC-contributing files (suppresses non-AC neighbors)
- `--json` -- emit raw `TraceResult` JSON instead of formatted output
</objective>

<context>
$ARGUMENTS

@.cap/SESSION.json
</context>

<process>

## Step 0: Parse arguments

Read `$ARGUMENTS`. Extract:
- The first non-flag token as `ac_arg`
- `--depth N` -> `depth` (integer, default 3)
- `--restrict` -> `restrict_to_ac_files` (boolean)
- `--json` -> `json_output` (boolean)

If `ac_arg` is missing, print usage and stop:

```
Usage: /cap:trace <AC-N | F-NNN/AC-N> [--depth N] [--restrict] [--json]
```

## Step 1: Resolve AC reference

If `ac_arg` already contains `/` (e.g. `F-045/AC-4`), use it as-is.

Otherwise, read the active feature from SESSION.json and prefix it:

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
console.log(s.activeFeature || '');
"
```

If the active feature is empty, print:

```
No active feature in SESSION.json. Pass a fully-qualified AC reference like F-045/AC-1, or run /cap:start to set an active feature.
```

and stop. Otherwise build `ac_ref = "<activeFeature>/<ac_arg>"`.

## Step 2: Run the trace

```bash
node -e "
const tr = require('./cap/bin/lib/cap-trace.cjs');
const acRef = process.argv[1];
const _parsedDepth = parseInt(process.argv[2], 10);
const depth = Number.isFinite(_parsedDepth) ? _parsedDepth : tr.DEFAULT_MAX_DEPTH;
const restrict = process.argv[3] === 'true';
const result = tr.traceAc(process.cwd(), acRef, { maxDepth: depth, restrictToAcFiles: restrict });
const json = process.argv[4] === 'true';
if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(tr.formatTraceResult(result));
}
" '<AC_REF>' '<DEPTH>' '<RESTRICT>' '<JSON>'
```

Display the output verbatim.

## Step 2b: Append Design-Usage for the AC's feature (F-063)

<!-- @cap-todo(ac:F-063/AC-5) /cap:trace shall emit a Design-Usage line per feature whose usesDesign is non-empty. -->

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const d = require('./cap/bin/lib/cap-design.cjs');
const trace = require('./cap/bin/lib/cap-trace.cjs');
const featureId = process.argv[1];
const map = fm.readFeatureMap(process.cwd());
const feature = map.features.find(f => f.id === featureId);
if (!feature) process.exit(0);
const design = d.readDesignMd(process.cwd());
const designIdx = design ? d.parseDesignIds(design) : { byToken: {}, byComponent: {} };
const line = trace.formatDesignUsage(feature, designIdx);
if (line) console.log('Design-Usage: ' + line);
" '<FEATURE_ID>'
```

## Step 3: Suggest next action (only when not in --json mode)

Inspect the trace result and suggest one of:

- If `primary.role === 'inferred'` AND `allFiles.length > 1` -> "Designate the canonical file with `@cap-feature(feature:<id>, primary:true)` to suppress the heuristic warning."
- If `allFiles.length === 0` -> "No tags reference this AC. Add `@cap-todo(ac:<ref>)` at the implementation site, then re-run /cap:scan."
- If `callGraph.length === 0` AND `primary.file` is set -> "Primary file has no resolvable internal imports. The AC may be self-contained, or imports use dynamic require() / TS path aliases that the static walker cannot resolve."
- Otherwise -> "Trace looks complete."

</process>
