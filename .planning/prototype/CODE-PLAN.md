# Code Plan: Monorepo Migration and Session Management (AC-9 through AC-16)

## Context

The monorepo mode prototype introduces two new library modules (`monorepo-migrator.cjs` and `session-manager.cjs`) and two new command files (`monorepo-init-migrate.md`, `switch-app.md`). The library files are structurally complete — typedefs, helpers, and most logic are in place — but contain one unfinished stub (`regenerateScopedInventories`) and several `@gsd-todo` annotations marking wire-up work that was deferred. The subcommand dispatch in `gsd-tools.cjs` does not yet expose `monorepo-migrate`, `session-get`, or `session-set`. The `extract-tags` handler already supports explicit `--app` flag scoping via `workspace-detector.cjs` and `monorepo-context.cjs`, but does not fall back to `SESSION.json` when `--app` is omitted. No tests exist yet for the two new modules.

**Constraints:**
- Zero external dependencies — all modules use only Node.js built-ins (`fs`, `path`)
- `regenerateScopedInventories` must delegate to `arc-scanner.cjs` `cmdExtractTags` — no reimplementation of scanning logic
- Session init does NOT auto-select an app — user must explicitly choose via `/gsd:switch-app`
- Tests follow `node:test` + `node:assert` pattern used in all 47 existing test files — not vitest

**Risks:**
- `fs.renameSync` in `archiveAppPlanning` may fail across filesystem boundaries; acceptable for same-disk monorepos — add a note but no cross-device fallback needed now
- `looksAppSpecific` heuristic in `analyzeRootPlanning` may produce false positives — callers must always require user confirmation before acting on app-specific classification
- Root `prototype/` detected as ambiguous may hold the monolithic `CODE-INVENTORY.md` — regeneration replaces this per-app rather than deleting it

## Tasks

### Task 1: Complete `regenerateScopedInventories` in monorepo-migrator.cjs

**Files:** `get-shit-done/bin/lib/monorepo-migrator.cjs`

**Action:** At the top of the file add `const arcScanner = require('./arc-scanner.cjs')`. In `regenerateScopedInventories` (line 352), replace the `throw new Error('NotImplementedError: ...')` stub with a real call: `arcScanner.cmdExtractTags(appAbsPath, appAbsPath, { format: 'md', outputFile: inventoryPath })`. Wrap in try/catch that catches real I/O errors. Push `{ appPath, inventoryPath, success: true, error: null }` on success and `{ appPath, inventoryPath, success: false, error: err.message }` on failure.

**Done when:**
- `regenerateScopedInventories(root, [{ path: 'apps/foo' }])` creates `apps/foo/.planning/prototype/CODE-INVENTORY.md` populated with tags scanned from `apps/foo/`
- No `NotImplementedError` throw remains in the function body
- AC-12 satisfied: scoped inventories regenerate per app after migration

---

### Task 2: Wire `monorepo-migrate` and session subcommands into gsd-tools.cjs

**Files:** `get-shit-done/bin/gsd-tools.cjs`

**Action:** Add three new `case` blocks in the `switch (command)` dispatch immediately before `default:` (line 1048). Also add the three commands to the header comment block under a new `Session & Migration Operations:` section.

**`monorepo-migrate`** — requires `monorepo-migrator.cjs` and `workspace-detector.cjs`. Detects workspace via `detectWorkspace(cwd)`. If no workspace, writes to stderr and sets `process.exitCode = 1`. Otherwise calls `auditAppPlanning(cwd, workspace.apps)` and writes `formatAuditReport(audit)` to stdout. Accepts optional `--output <file>` to write the report to disk in addition to stdout.

**`session-get`** — requires `session-manager.cjs`. Calls `getSession(cwd)` and outputs via `core.output(session, raw, session ? JSON.stringify(session, null, 2) : 'No session')`.

**`session-set`** — requires `session-manager.cjs`. Parses `--app <path>` and boolean `--global`. If `--global`, calls `setCurrentApp(cwd, null, [])`. Otherwise calls `setCurrentApp(cwd, appPath, [])`. Outputs updated session via `core.output`. Errors if neither `--app` nor `--global` is provided.

**Done when:**
- `node gsd-tools.cjs monorepo-migrate` in a monorepo root prints the migration audit report
- `node gsd-tools.cjs session-get` prints SESSION.json content or "No session"
- `node gsd-tools.cjs session-set --app apps/dashboard` writes SESSION.json with `current_app: "apps/dashboard"`
- `node gsd-tools.cjs session-set --global` writes SESSION.json with `current_app: null`

---

### Task 3: Wire session auto-scoping into extract-tags

**Files:** `get-shit-done/bin/gsd-tools.cjs`

**Action:** In the `case 'extract-tags':` block (line 922), immediately after the closing brace of the existing `if (app) { ... break; }` block and before the fallback `arcScanner.cmdExtractTags(...)` call, insert a session fallback block. The block runs only when `app` is falsy. It requires `session-manager.cjs`, calls `resolveCurrentApp(cwd, null)`, and if a non-null `sessionApp` is returned, runs the same explicit-`--app` code path (validate app path via `workspaceDetector.validateAppPath`, scope via `monorepoContext.scopeExtractTags`, call `arcScanner.cmdExtractTags` with scoped args, auto-chain feature aggregator if `scoped.outputFile` is set, then `break`). If `sessionApp` is null or validation fails, fall through to the existing no-app path.

**Done when:**
- `extract-tags --output path/to/inventory.md` with `SESSION.json` containing `current_app: "apps/foo"` scopes the scan to `apps/foo/` and writes output to the app-scoped inventory path
- `extract-tags --app apps/bar` with session set to `apps/foo` still scopes to `apps/bar` (explicit flag wins — no regression)
- `extract-tags` with no session and no `--app` flag continues scanning full `cwd` (no regression)
- AC-14 satisfied: commands using extract-tags auto-scope to the session app without requiring `--app`

---

### Task 4: Write tests for monorepo-migrator.cjs

**Files:** `tests/monorepo-migrator.test.cjs` (new file)

**Action:** Create the test file following the `monorepo-context.test.cjs` pattern: `'use strict'`, `const { describe, it, afterEach } = require('node:test')`, temp dirs via `fs.mkdtempSync`, cleanup in `afterEach`. Cover these areas:

1. `auditAppPlanning` — apps with `.planning/` and without; verify `exists`, `files`, `hasCodeInventory`, `hasPrd`, `appsWithPlanning`, `appsWithoutPlanning` counts
2. `analyzeRootPlanning` — root with `PROJECT.md` (global), `PRD.md` mentioning `apps/dashboard` twice (app-specific), and `STATE.md` (ambiguous); verify correct lists
3. `archiveAppPlanning` — creates `.planning/` with files; calls archive; verifies files moved to `legacy-{timestamp}/` subfolder and original entries absent
4. `replaceAppPlanning` — verifies archive happened plus fresh `PRD.md`, `FEATURES.md`, `prototype/CODE-INVENTORY.md` stubs created
5. `executeAppMigration` — `keep` (no-op, success), `archive` (delegates), `replace` (delegates), unknown action (success: false with error message)
6. `looksAppSpecific` — true when content has 2+ `apps/something` refs in first 20 lines; false otherwise
7. `formatAuditReport` — output string contains app path and counts

**Done when:**
- `node --test tests/monorepo-migrator.test.cjs` exits 0 with all assertions passing
- All seven areas covered
- No external requires beyond `node:test`, `node:assert`, `node:fs`, `node:path`, `node:os`, and the module under test

---

### Task 5: Write tests for session-manager.cjs

**Files:** `tests/session-manager.test.cjs` (new file)

**Action:** Create the test file using the same `node:test` + temp-dir pattern. Cover:

1. `getSession` — null when no `SESSION.json`; returns parsed object when file exists
2. `getCurrentApp` — null with no session; returns `current_app` value when session present
3. `resolveCurrentApp` — explicit arg wins over session; session used when explicit arg is null/undefined; null when neither present
4. `setCurrentApp` — writes `SESSION.json` with correct shape; subsequent `getSession` returns written data; `updated_at` is a number
5. `clearSession` — removes `SESSION.json`; calling again does not throw
6. `initSession` — creates `SESSION.json` with `current_app: null`, correct `workspace_type`, correct `available_apps` from `workspaceInfo.apps`
7. `isMonorepoSession` — true for `workspace_type: 'nx'`; false for `'single'`; false for no session
8. `getAvailableApps` — returns array from session; returns `[]` when no session
9. `formatAppSelector` — output contains all app names, `(current)` marker on active app, Global option as last entry

**Done when:**
- `node --test tests/session-manager.test.cjs` exits 0
- All nine areas covered
- AC-13, AC-14, AC-15, AC-16 behaviors confirmed by assertions

## Success Criteria

- [ ] `regenerateScopedInventories` calls `arc-scanner.cjs` and produces per-app `CODE-INVENTORY.md` files — AC-12 satisfied
- [ ] `node gsd-tools.cjs monorepo-migrate` prints migration audit report — AC-9, AC-10, AC-11 tooling present
- [ ] `node gsd-tools.cjs session-get` and `session-set` read/write `SESSION.json` correctly — AC-13, AC-15, AC-16 tooling present
- [ ] `extract-tags` auto-scopes to session app when no `--app` flag and `SESSION.json` has `current_app` — AC-14 satisfied
- [ ] `node --test tests/monorepo-migrator.test.cjs` exits 0 — AC-9, AC-10, AC-11, AC-12 tested
- [ ] `node --test tests/session-manager.test.cjs` exits 0 — AC-13, AC-14, AC-15, AC-16 tested
- [ ] All 8 @gsd-todo items (ref:AC-9 through ref:AC-16) addressed
- [ ] Zero new external runtime dependencies introduced
