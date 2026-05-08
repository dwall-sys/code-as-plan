---
name: cap:migrate-feature-map
description: "Shard a monolithic FEATURE-MAP.md into Index + Per-Feature Files (F-089). Dry-run by default, --apply writes."
argument-hint: "[--apply] [--app=<path>] [--force]"
allowed-tools:
  - Read
  - Write
  - Bash
---

<!-- @cap-context CAP V6.3 — Feature Map sharding (F-089). -->
<!-- @cap-decision Dry-run is the default. --apply writes per-feature files + index + backup. -->
<!-- @cap-feature(feature:F-089, primary:true) /cap:migrate-feature-map surfaces cap-feature-map-migrate.cjs to the user. -->

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

**Why:** A FEATURE-MAP that grew to 4,000+ lines costs 30–50k tokens for every agent read. Sharded mode makes agents load just the index (~100 chars per feature) plus the active feature's per-feature file — typically a 10–50× token reduction on large projects. The migration is **byte-lossless** for feature blocks (raw extraction, no parse → serialize round-trip). Once migrated, all CAP commands continue to work via the read/write dispatchers — no agent prompts need to change.

**Flags:**
- `--apply` — actually write the migration to disk. Without it, dry-run only.
- `--app=<path>` — operate on a sub-app's `FEATURE-MAP.md` instead of the root (e.g. `--app=apps/hub`).
- `--force` — proceed even when the planner flagged duplicate IDs or other issues. NOT recommended for duplicates.

**Idempotency:** Re-running on an already-sharded project is a no-op. Backwards-compat: projects without `features/` continue to work in monolithic mode.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Parse flags

- `--apply` → `apply = true`
- `--app=<path>` → `appPath = <path>`
- `--force` → `force = true`

## Step 2: Plan the migration (dry-run)

```bash
node -e "
const migrate = require('./cap/bin/lib/cap-feature-map-migrate.cjs');
const appPath = process.argv[1] || null;
const plan = migrate.planMigration(process.cwd(), appPath);
console.log(migrate.formatPlan(plan));
" '<APP_PATH_OR_EMPTY>'
```

Display verbatim. Possible outcomes:

- **`Source mode: missing`** — no `FEATURE-MAP.md` found. Stop.
- **`Source mode: sharded`** — already migrated. Stop.
- **`Source mode: monolithic`** with planned writes — proceed to confirmation.
- **`Source mode: monolithic`** with skips (e.g. duplicate IDs) — surface the skips, ask user to resolve before re-running, OR pass `--force` to proceed without those features.

## Step 3: Apply (only with --apply AND after confirmation)

Ask the user (skip if --apply was passed and the plan has zero skips):

> "Migrate FEATURE-MAP.md to sharded layout? Will write N per-feature files + backup + new index. (yes/no)"

On `yes`:

```bash
node -e "
const migrate = require('./cap/bin/lib/cap-feature-map-migrate.cjs');
const args = process.argv.slice(1);
const force = args.includes('--force');
const appPath = (args.find(a => a.startsWith('--app=')) || '--app=').slice('--app='.length) || null;
const result = migrate.applyMigration(process.cwd(), appPath, { force });
if (!result.ok) {
  console.error('Migration NOT applied. Plan summary:');
  console.error(migrate.formatPlan(result.plan));
  process.exit(1);
}
console.log('Migration applied:');
console.log('  Per-feature files written: ' + result.applied.featuresWritten);
console.log('  Index written: ' + (result.applied.indexWritten ? 'yes' : 'no'));
console.log('  Backup written: ' + (result.applied.backupWritten ? 'yes' : 'no'));
console.log('Backup location: ' + result.plan.backupPath);
" -- {ARGS}
```

On `no`: print `Aborted — no files were modified.` and stop.

## Step 4: Verify and suggest next action

After a successful apply, run a sanity check:

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const map = fm.readFeatureMap(process.cwd());
console.log('Loaded ' + map.features.length + ' features via sharded read.');
"
```

Then point the user to the next step:

- "Sharded layout active. Index file: `FEATURE-MAP.md`. Per-feature files: `features/F-*.md`. Backup: `FEATURE-MAP.md.backup-pre-F-089`."
- "All CAP commands (`/cap:scan`, `/cap:reconcile`, `/cap:status`, etc.) continue to work transparently."
- "If anything looks wrong, restore via: `cp FEATURE-MAP.md.backup-pre-F-089 FEATURE-MAP.md && rm -rf features/`"

</process>
