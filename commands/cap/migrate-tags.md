---
name: cap:migrate-tags
description: "Migrate fragmented @cap-feature / @cap-todo(ac:…) tags to unified @cap anchor blocks (F-047, additive: legacy tags preserved)."
argument-hint: "[--apply] [--json]"
allowed-tools:
  - Read
  - Write
  - Bash
---

<!-- @cap-context CAP v3 opt-in migration tool (F-047). Additive: inserts unified anchors, does not delete legacy tags. -->
<!-- @cap-decision Dry-run is the default. Writes only on explicit --apply after confirmation. -->
<!-- @cap-feature(feature:F-047, primary:true) /cap:migrate-tags surfaces cap-migrate-tags.cjs to the user. -->

<objective>
Plan and optionally apply the migration from fragmented `@cap-*` tags to the unified anchor block format introduced by F-047.

The tool scans the project, groups fragmented `@cap-feature` and `@cap-todo(ac:…)` tags per file, and inserts a single unified anchor block near the file header. Legacy fragmented tags are preserved — this is an **additive migration** so the two formats can coexist while the ecosystem converts. A future cleanup pass (not yet implemented) can delete the fragmented tags once the unified block is adopted everywhere.

Opt-in gate: requires `.cap/config.json → unifiedAnchors.enabled=true`. When disabled, the scanner ignores unified blocks entirely, so running the migration tool alone is safe but its output will not be picked up until the flag is flipped.

**Flags:**
- `--apply` — actually write the migration to disk (after explicit confirmation). Without it, dry-run only.
- `--json` — emit the structured migration plan as JSON for downstream tools.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 0: Gate on opt-in config

```bash
node -e "
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
if (!scanner.isUnifiedAnchorsEnabled(process.cwd())) {
  console.error('F-047 (unified anchors) is opt-in and not enabled for this project.');
  console.error('To enable: add { \"unifiedAnchors\": { \"enabled\": true } } to .cap/config.json');
  console.error('You can still run the migration with --force (dry-run) to preview the diff.');
  process.exit(2);
}
"
```

On exit 2, stop unless the user passed `--force`. Otherwise continue.

## Step 1: Parse flags

- `--apply` → `apply = true`
- `--json` → `json = true`
- `--force` → ignore the opt-in gate (only for previewing)

## Step 2: Plan the migration

```bash
node -e "
const migrate = require('./cap/bin/lib/cap-migrate-tags.cjs');
const results = migrate.planProjectMigration(process.cwd());
const json = process.argv[1] === 'true';
if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(migrate.formatMigrationReport(results));
}
" '<JSON>'
```

Display verbatim.

## Step 3: Apply (only with --apply AND after confirmation)

Ask the user:

> "Apply the unified-anchor migration to the listed files? (yes/no)"

On `yes`:

```bash
node -e "
const migrate = require('./cap/bin/lib/cap-migrate-tags.cjs');
const results = migrate.planProjectMigration(process.cwd());
const out = migrate.applyMigrations(results, process.cwd());
console.log('Written: ' + out.written.length + ' file(s)');
for (const f of out.written) console.log('  ' + f);
"
```

On `no`: print `Aborted — no files were modified.` and stop.

## Step 4: Suggest next action

- If dry-run completed with changes → "Run `/cap:migrate-tags --apply` to persist the anchors. Legacy tags remain in place; a future cleanup pass can remove them."
- If the gate blocked the run → "Enable F-047 via `.cap/config.json → unifiedAnchors.enabled=true`, then re-run."
- If nothing to change → "Project is already migrated or has no fragmented tags."

</process>
