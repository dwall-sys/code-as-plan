---
name: cap:memory
description: "Manage project memory — bootstrap, run pipeline, pin/unpin annotations, view status, migrate to V6."
argument-hint: "[init|status|pin|unpin|prune|migrate] [--dry-run|--apply]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

<!-- @cap-feature(feature:F-030) Memory command — bootstrap, manual trigger, pin/unpin/status management -->
<!-- @cap-decision /cap:memory init processes ALL sessions for the current project — one-time bootstrap to build initial memory. -->
<!-- @cap-decision /cap:memory with no args runs incremental only (sessions since last run). -->

<objective>
Manage project memory — bootstrap from existing sessions, run incremental pipeline, or manage annotations.

**Subcommands:**
- `init` — **Bootstrap**: process ALL sessions for this project, build initial memory (run once per project)
- `(no args)` — run incremental pipeline (only sessions since last run)
- `status` — show memory summary (annotation counts, stale, pinned, last run)
- `pin <file> <content-prefix>` — mark a @cap-pitfall as pinned:true
- `unpin <file> <content-prefix>` — remove pinned:true from annotation
- `prune [--apply]` — decay stale entries, archive very-stale low-confidence ones, purge old raw-logs (default dry-run)
- `migrate [--apply] [--interactive=false]` — **F-077**: one-shot migration from V5 monolith files (`decisions.md`, `pitfalls.md`, etc.) to V6 per-feature layout under `.cap/memory/features/`. Default is dry-run; `--apply` requires a confirm prompt unless `--interactive=false` is passed.
- `--dry-run` — show what would change without writing
</objective>

<process>

## Subcommand: init (Bootstrap)

One-time full processing of all sessions for this project. Run this when setting up memory for an existing project.

```bash
node "$HOME/.claude/hooks/cap-memory.js" init
```

This will:
1. Find all session JSONL files for the current project directory
2. Parse every session — extract decisions, pitfalls, patterns, file edit history
3. Write @cap-history, @cap-pitfall, @cap-pattern annotations into source files
4. Generate .cap/memory/ directory (decisions.md, hotspots.md, patterns.md, pitfalls.md)
5. Save timestamp to .cap/memory/.last-run (future hook runs are incremental from here)

Display the output to the user. Then show:

```
Bootstrap complete.

Memory directory: .cap/memory/
  - decisions.md
  - hotspots.md
  - patterns.md
  - pitfalls.md

From now on, the Stop hook will run incrementally after each session.
Run /cap:memory status to see what was accumulated.
```

## Default (no args): Run incremental pipeline

```bash
node "$HOME/.claude/hooks/cap-memory.js"
```

Only processes sessions newer than .cap/memory/.last-run timestamp.
If .last-run doesn't exist, processes all sessions (same as init).

<!-- @cap-decision(F-079/iter1) Stage-2 #1 fix: processSnapshots wired into memory-pipeline. -->
The pipeline also walks `.cap/snapshots/` and updates the `linked_snapshots` auto-block in every
per-feature / platform memory file the snapshots route to (F-079/AC-4). Re-running the pipeline
on the same set of snapshots is byte-identical (idempotent contract pinned by F-079 tests).

## Subcommand: status

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const memDir = path.join(process.cwd(), '.cap', 'memory');
const lastRunPath = path.join(memDir, '.last-run');
const lastRun = fs.existsSync(lastRunPath) ? fs.readFileSync(lastRunPath, 'utf8').trim() : 'never';
const categories = ['decisions.md', 'hotspots.md', 'patterns.md', 'pitfalls.md'];
const stats = { lastRun };
for (const f of categories) {
  const fp = path.join(memDir, f);
  if (fs.existsSync(fp)) {
    const content = fs.readFileSync(fp, 'utf8');
    const entries = (content.match(/^###/gm) || []).length;
    const pinned = (content.match(/\[pinned\]/g) || []).length;
    const tableRows = (content.match(/^\| \d/gm) || []).length;
    stats[f] = { entries: entries + tableRows, pinned };
  } else {
    stats[f] = { entries: 0, pinned: 0 };
  }
}
console.log(JSON.stringify(stats, null, 2));
"
```

Display as summary table:
```
Project Memory Status
  Last run: {timestamp or "never — run /cap:memory init to bootstrap"}
  decisions.md:  {N} entries ({P} pinned)
  hotspots.md:   {N} entries
  patterns.md:   {N} entries
  pitfalls.md:   {N} entries ({P} pinned)
```

## Subcommand: pin `<file>` `<content-prefix>`

<!-- @cap-todo(ac:F-030/AC-4) /cap:memory pin adds pinned:true to the matching @cap-pitfall annotation. -->

```bash
node -e "
const pin = require('./cap/bin/lib/cap-memory-pin.cjs');
const file = process.argv[1];
const prefix = process.argv[2];
const result = pin.pin(file, prefix);
console.log(pin.formatResult(result));
process.exit(result.changed || result.status === 'already-pinned' ? 0 : 1);
" '<FILE>' '<PREFIX>'
```

Argument usage:

- `<file>` — path to the source file that carries the `@cap-pitfall` annotation (absolute or relative to the project root).
- `<content-prefix>` — a prefix of the pitfall description (case-sensitive). Use enough to disambiguate if multiple pitfalls live in the same file.

On `ambiguous` status the command prints the candidate descriptions; rerun with a longer prefix to select one.

## Subcommand: unpin `<file>` `<content-prefix>`

<!-- @cap-todo(ac:F-030/AC-5) /cap:memory unpin removes pinned:true from the matching annotation. -->

```bash
node -e "
const pin = require('./cap/bin/lib/cap-memory-pin.cjs');
const file = process.argv[1];
const prefix = process.argv[2];
const result = pin.unpin(file, prefix);
console.log(pin.formatResult(result));
process.exit(result.changed || result.status === 'not-pinned' ? 0 : 1);
" '<FILE>' '<PREFIX>'
```

Same argument semantics as `pin`. An already-unpinned annotation exits 0 with a no-op message.

## Subcommand: prune `[--apply] [--gitignored]`

<!-- @cap-todo(ac:F-056/AC-1) /cap:memory prune is the F-056 subcommand for decay + archive + raw-log purge. -->
<!-- @cap-todo(ac:F-056/AC-2) Default is dry-run; --apply is required to mutate files. -->
<!-- @cap-todo(ac:F-056/AC-6) Prune emits a human report and appends .cap/memory/prune-log.jsonl. -->
<!-- @cap-todo(ac:F-086/AC-3) --gitignored mode runs the scope-filter pass (gitignored entries + bundle-paths). -->

```bash
node -e "
const prune = require('./cap/bin/lib/cap-memory-prune.cjs');
const args = process.argv.slice(1);
const applyFlag = args.includes('--apply');
const gitignoredMode = args.includes('--gitignored');
if (gitignoredMode) {
  const result = prune.pruneGitignored(process.cwd(), { apply: applyFlag });
  console.log(prune.formatGitignoredReport(result));
  process.exit(result.errors && result.errors.length > 0 ? 1 : 0);
} else {
  const result = prune.prune(process.cwd(), { apply: applyFlag });
  console.log(prune.formatReport(result));
  process.exit(result.errors && result.errors.length > 0 ? 1 : 0);
}
" -- {ARGS}
```

What prune does (default mode):

- **Decay** (AC-3): entries with `last_seen > 90 days` lose `-0.05` confidence per additional 30 days of inactivity, floored at `0.0`. Pinned entries are never decayed.
- **Archive** (AC-4): entries with `confidence < 0.2` AND `last_seen > 180 days` move to `.cap/memory/archive/{YYYY-MM}.md` (the archival month, not the entry's own month). Decay runs first — an entry can cross the threshold via decay and get archived in the same run. Pinned entries are never archived.
- **Purge** (AC-5): raw event logs under `.cap/memory/raw/tag-events-YYYY-MM-DD.jsonl` older than 30 days are hard-deleted.
- **Report + log** (AC-6): a console report is emitted. On `--apply`, a single JSONL line `{timestamp, dryRun, decayed, archived, purged}` is appended to `.cap/memory/prune-log.jsonl`.

What `--gitignored` does (F-086/AC-3):

- Runs the **shared scope filter** (`cap-scope-filter.cjs`) against each existing memory entry's referenced files.
- Removes V5 entries (`decisions.md` / `pitfalls.md` / `patterns.md` / `hotspots.md`) whose ALL related files are now out-of-scope (gitignored, plugin-mirror, build-output bundle).
- Removes V6 bullet lines (`features/*.md`, `platform/*.md`) whose backtick-wrapped path would be excluded.
- Useful for projects bootstrapped on a pre-F-085 CAP version that accumulated build-output decisions and bundle-artefact references.

Default behaviour is **dry-run** — no files are touched and no prune-log entry is written. Pass `--apply` explicitly to commit the changes. The two modes (`--gitignored` and the default decay/archive flow) cannot be combined; pick one per run.

## Subcommand: migrate `[--apply] [--interactive=false]`

<!-- @cap-feature(feature:F-077) /cap:memory migrate — V6 per-feature memory migration entry point. -->
<!-- @cap-todo(ac:F-077/AC-4) Default is dry-run; --apply requires explicit confirm in interactive mode. -->

```bash
node -e "
const m = require('./cap/bin/lib/cap-memory-migrate.cjs');
const args = process.argv.slice(1);
const apply = args.includes('--apply');
const interactive = !args.includes('--interactive=false');
m.migrateMemory(process.cwd(), { apply, interactive }).then(r => {
  if (r.report) {
    console.log('Migration report written to .cap/memory/.archive/');
    console.log('  Total entries:', r.report.counts.total);
    console.log('  Assigned:    ', r.report.counts.assigned);
    console.log('  Platform:    ', r.report.counts.platform);
    console.log('  Skipped:     ', r.report.counts.skipped);
  }
  process.exit(r.exitCode);
}).catch(e => { console.error('migrate failed:', e.message); process.exit(1); });
" -- {ARGS}
```

What migrate does (one-shot V5 -> V6):

1. **Parses** `decisions.md`, `pitfalls.md`, `patterns.md`, `hotspots.md` and (for hotspots fallback) `graph.json`.
2. **Backs up** the V5 files to `.cap/memory/.archive/<name>-pre-v6-<YYYY-MM-DD>.<ext>` (idempotent on same date).
3. **Classifies** each entry by priority: tag-metadata (`@cap-decision(feature:F-NNN)`) -> `key_files` path-match -> F-NNN body mention. Confidence >= 0.7 auto-routes; lower = ambiguous.
4. **Routes** snapshots from `.cap/snapshots/` by frontmatter `feature:` field, then date proximity to FEATURE-MAP transitions, then title keyword.
5. **Prompts interactively** for ambiguous entries (top-3 candidates + skip + auto-all + quit) when `--apply` is set with default `--interactive=true`.
6. **Atomically writes** V6 files under `.cap/memory/features/F-NNN-<topic>.md` and `.cap/memory/platform/<topic>.md` (write-temp-then-rename, F-074 pattern).
7. **Writes a migration report** at `.cap/memory/.archive/migration-report-<YYYY-MM-DD>.md` summarising counts and ambiguity resolutions.

Default is **dry-run** -- no files touched. The dry-run output is sent to stderr and lists the planned writes, backup status, and ambiguity counts. Pass `--apply` to execute. Add `--interactive=false` to skip the confirm prompt and auto-resolve every ambiguity to its highest-confidence candidate (CI-friendly).

Exit codes: `0` success, `1` errors during apply, `2` user-initiated quit (declined confirm or `q` in ambiguity prompt).

After a successful migration, the user commits `.cap/memory/features/`, `.cap/memory/platform/`, and `.cap/memory/.archive/` to git themselves -- the tool deliberately does NOT touch git.

</process>
