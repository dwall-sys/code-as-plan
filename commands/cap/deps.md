---
name: cap:deps
description: "Infer feature dependencies from source imports, diff against FEATURE-MAP DEPENDS_ON, optionally apply or render a Mermaid graph. --design DT-NNN shows feature impact for a design token (F-063)."
argument-hint: "[--auto-fix] [--graph] [--remove-extraneous] [--json] [--design DT-NNN|DC-NNN]"
allowed-tools:
  - Read
  - Write
  - Bash
---

<!-- @cap-context CAP v3 opt-in dependency inference command (F-049). Reads code + FEATURE-MAP, writes only with explicit --auto-fix. -->
<!-- @cap-decision Default mode is read-only diff. Writes require --auto-fix AND an interactive confirmation step. --graph is always side-effect-free. -->
<!-- @cap-feature(feature:F-049, primary:true) /cap:deps orchestrator surfaces cap-deps.cjs functions to the user. -->

<objective>
Surface F-049's dependency-inference pipeline:

- Scan tagged source files for `require`/`import` statements
- Resolve each to a feature ID via the tag scanner
- Diff the inferred dependency set against `**Depends on:**` lines in FEATURE-MAP.md
- Optionally apply the diff (writes FEATURE-MAP.md) or render a Mermaid graph

**Flags:**
- `--auto-fix` — write inferred `**Depends on:**` lines back to FEATURE-MAP.md. Requires a confirmation prompt.
- `--remove-extraneous` — when applying, also remove declared deps not found by the scanner (default: only add missing).
- `--graph` — emit a Mermaid flowchart of the feature dependency graph. Side-effect-free.
- `--json` — emit raw diff JSON instead of formatted report.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 0a: Design-ID impact fast-path (F-063 --design DT-NNN / DC-NNN)

<!-- @cap-todo(ac:F-063/AC-6) /cap:deps --design DT-NNN prints every feature whose usesDesign includes the ID. -->
<!-- @cap-decision Fast-path bypasses the F-049 opt-in gate — design impact is read-only, reads FEATURE-MAP.md only, no tag scanning. -->

If `$ARGUMENTS` contains `--design <ID>`, short-circuit the rest of the command:

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const deps = require('./cap/bin/lib/cap-deps.cjs');
const designId = process.argv[1];
if (!/^(DT-\\d{3,}|DC-\\d{3,})$/.test(designId)) {
  console.error('Invalid --design ID. Expected DT-NNN or DC-NNN.');
  process.exit(2);
}
const map = fm.readFeatureMap(process.cwd());
const using = deps.findFeaturesUsingDesignId(map, designId);
console.log(deps.formatDesignImpactReport(designId, using));
" '<DESIGN_ID>'
```

Display the output verbatim, then stop.

## Step 0: Check opt-in config

F-049 is opt-in. Verify `.cap/config.json` has `autoDepsInference.enabled === true` before doing any work:

```bash
node -e "
const deps = require('./cap/bin/lib/cap-deps.cjs');
const cfg = deps.loadDepsConfig(process.cwd());
if (!cfg.enabled) {
  console.error('F-049 (auto dependency inference) is opt-in and not enabled for this project.');
  console.error('To enable: add { \"autoDepsInference\": { \"enabled\": true } } to .cap/config.json');
  process.exit(2);
}
console.log('enabled=' + cfg.enabled);
"
```

If exit code 2, stop and show the message verbatim.

## Step 1: Parse flags

Read `$ARGUMENTS`. Extract booleans:
- `--auto-fix` → `autoFix`
- `--remove-extraneous` → `removeExtraneous`
- `--graph` → `renderGraph`
- `--json` → `jsonOutput`

## Step 2: Run inference + diff

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const deps = require('./cap/bin/lib/cap-deps.cjs');

const root = process.cwd();
const tags = scanner.scanDirectory(root);
const featureMap = fm.readFeatureMap(root);
const inferred = deps.inferFeatureDeps(tags, root);
const diff = deps.diffDeclaredVsInferred(featureMap, inferred);

const json = process.argv[1] === 'true';
const graph = process.argv[2] === 'true';

if (json) {
  console.log(JSON.stringify({ diff, inferred }, null, 2));
} else if (graph) {
  console.log(deps.renderMermaidGraph(featureMap, inferred));
} else {
  console.log(deps.formatDiffReport(diff));
}
" '<JSON>' '<GRAPH>'
```

Display output verbatim.

If `--graph` or `--json`, stop here — read-only modes do not prompt or write.

## Step 3: Apply diff (only with --auto-fix)

If `autoFix` is true and any diff row has `missing.length > 0` or (when `removeExtraneous`) `extraneous.length > 0`:

Show the diff report again and prompt the user explicitly:

> "Apply the inferred dependencies to FEATURE-MAP.md? (yes/no)"

On `yes`:

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const deps = require('./cap/bin/lib/cap-deps.cjs');

const root = process.cwd();
const tags = scanner.scanDirectory(root);
const featureMap = fm.readFeatureMap(root);
const inferred = deps.inferFeatureDeps(tags, root);
const diff = deps.diffDeclaredVsInferred(featureMap, inferred);
const removeExtraneous = process.argv[1] === 'true';
const result = deps.applyInferredDeps(root, diff, { removeExtraneous });
console.log('Updated: ' + result.updated.length + ' features');
for (const f of result.updated) console.log('  ' + f);
" '<REMOVE_EXTRANEOUS>'
```

On `no`: print "Aborted — FEATURE-MAP.md unchanged." and stop.

## Step 4: Suggest next action

- If diff was empty → "Dependency graph is consistent. Next time a feature imports another module, re-run /cap:deps to check for drift."
- If diff applied → "Re-run /cap:review to verify the FEATURE-MAP changes, or `git diff FEATURE-MAP.md` to inspect."
- If `--graph` → "Paste the Mermaid block into a markdown preview to visualize the dependency flow."

</process>
