---
name: cap:completeness
description: "Generate a markdown audit of F-048's Implementation Completeness Score (4 signals per AC). Suitable for PR attachment."
argument-hint: "[--out PATH] [--json]"
allowed-tools:
  - Read
  - Write
  - Bash
---

<!-- @cap-context CAP v3 opt-in completeness-score command (F-048). Read-only by default. -->
<!-- @cap-decision Writes a markdown file ONLY when --out is provided. Default output is stdout. -->
<!-- @cap-feature(feature:F-048, primary:true) /cap:completeness orchestrator surfaces cap-completeness.cjs scoring as a PR-ready audit. -->

<objective>
Produce a per-AC audit using the four signals defined by F-048:

- **T** — `@cap-*` tag in source code references the AC
- **S** — a test file carries a `@cap-*` tag for the AC
- **I** — at least one test file statically imports the primary implementation
- **R** — primary file is reachable via imports from public surface (`bin/install.js`, `hooks/*.js`)

Each AC scores 0–4. Feature average = arithmetic mean of its AC scores. The threshold gate for `shipped` transitions is enforced by `updateFeatureState()` when enabled.

**Flags:**
- `--out PATH` — write markdown report to `PATH` instead of stdout.
- `--json` — emit structured JSON for downstream tooling.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 0: Opt-in gate

```bash
node -e "
const comp = require('./cap/bin/lib/cap-completeness.cjs');
const cfg = comp.loadCompletenessConfig(process.cwd());
if (!cfg.enabled) {
  console.error('F-048 (completeness score) is opt-in and not enabled for this project.');
  console.error('To enable: add { \"completenessScore\": { \"enabled\": true } } to .cap/config.json');
  process.exit(2);
}
console.log('threshold=' + cfg.shipThreshold);
"
```

On exit 2, show the message and stop.

## Step 1: Parse flags

- `--out PATH` → `outPath`
- `--json` → `jsonOutput`

## Step 2: Compute scores

```bash
node -e "
const comp = require('./cap/bin/lib/cap-completeness.cjs');
const ctx = comp.buildContext(process.cwd());
const scores = comp.scoreAllFeatures(ctx);
const json = process.argv[1] === 'true';
if (json) {
  console.log(JSON.stringify(scores, null, 2));
} else {
  console.log(comp.formatCompletenessReport(scores));
}
" '<JSON>'
```

## Step 3: Write to file (only with --out)

If `outPath` is set:

```bash
node -e "
const fs = require('node:fs');
const comp = require('./cap/bin/lib/cap-completeness.cjs');
const ctx = comp.buildContext(process.cwd());
const scores = comp.scoreAllFeatures(ctx);
fs.writeFileSync(process.argv[1], comp.formatCompletenessReport(scores), 'utf8');
console.log('Wrote ' + process.argv[1]);
" '<OUT_PATH>'
```

## Step 4: Suggest next action

- If any feature's averageScore < configured `shipThreshold` → "These features cannot transition to `shipped` with the current threshold. Add missing tags/tests, or lower `completenessScore.shipThreshold` in .cap/config.json if appropriate."
- Otherwise → "All scored features meet the ship threshold. Attach the report to the next PR for audit."

</process>
