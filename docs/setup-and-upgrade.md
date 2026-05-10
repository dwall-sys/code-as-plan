# CAP Setup and Upgrade

This document covers the operational concerns previously held in dedicated slash commands (`/cap:doctor`, `/cap:update`, `/cap:upgrade`). After the cleanup in `iteration/cap-pro-1`, these concerns live here as documentation rather than as runtime commands. Where automation still exists, it is invoked directly via `node`/`npm`/`npx`.

---

## 1. Doctor — Environment Health Check

CAP requires a small set of external tools at runtime.

**Required**

- Node.js >= 20
- npm
- git

**Optional**

- `npx ctx7@latest` (Context7) — used by `/cap:refresh-docs`
- `c8`, `vitest` — used by `npm run test:coverage` in this repo
- `fast-check` — project-specific, only if a project uses property-based tests

**How to check**

```bash
node --version    # must be >= 20
npm --version
git --version
npx ctx7@latest --help   # optional
```

If you previously used `/cap:doctor`, run the same checks above. The doctor logic that wrapped these checks lived in `cap/bin/lib/cap-doctor.cjs` and can still be invoked directly:

```bash
node -e "console.log(require('./cap/bin/lib/cap-doctor.cjs').runDoctorChecks(process.cwd()))"
```

---

## 2. Update — Bumping the CAP version

CAP is distributed via npm as `code-as-plan`. To update an existing install:

```bash
# show the latest published version
npm view code-as-plan version

# show the version installed in your project
node -e "console.log(require('code-as-plan/package.json').version)" 2>/dev/null \
  || npx code-as-plan@latest --version

# perform a clean install (clears the cap-update-check.json cache)
npx --yes code-as-plan@latest
rm -f .cap/cap-update-check.json
```

**Changelog:** Browse releases on the project repo (or `npm view code-as-plan time`) to see what changed between versions.

**Local patches:** If you applied local patches to the installed CAP files, re-apply them after the update — `npx code-as-plan@latest` overwrites `commands/cap/`, `agents/`, and `cap/bin/` from the published tarball.

---

## 3. Upgrade — Onboarding & Migrating an Existing Project

The `cap:upgrade` command used to orchestrate a 7-stage migration pipeline. The pipeline still exists as a programmatic API (`cap/bin/lib/cap-upgrade.cjs`); you simply run the underlying steps yourself in the right order.

The 7 stages, in order:

1. **doctor** — environment check (see §1)
2. **init-or-skip** — `/cap:init` if `.cap/` and `FEATURE-MAP.md` are missing; otherwise skip
3. **annotate** — `/cap:annotate` to retroactively tag existing code (optional, slow on large repos)
4. **migrate-tags** — `/cap:migrate-tags` for fragment → anchor-block tag migration (F-047)
5. **memory-bootstrap** — `/cap:memory bootstrap` for V6 per-feature memory (F-076)
6. **migrate-snapshots** — `/cap:memory migrate-snapshots` for snapshot-linkage migration (F-077, F-079)
7. **refresh-docs** — `/cap:refresh-docs` (optional, requires network)

Each stage is **idempotent** — re-running converges on the same state. A `.cap/version` marker tracks completed stages; you can inspect it with:

```bash
cat .cap/version 2>/dev/null
```

**Programmatic plan / dry-run** (still supported by the underlying module):

```bash
node -e "
const upgrade = require('./cap/bin/lib/cap-upgrade.cjs');
const plan = upgrade.planMigrations(process.cwd(), { runOptions: {} });
console.log(upgrade.summarizePlan(plan));
"
```

This prints which stages would run, which would skip, and why — useful before doing the manual work.

**Failure handling:** Each stage runs independently. If one fails, log the error and continue with the next — the failure does not block subsequent stages. Re-run any failed stage individually once the underlying issue is fixed.

### SessionStart hook (optional)

For users installing CAP as a Claude Code plugin (`npx code-as-plan@latest`), the SessionStart version-check hook is auto-registered via `hooks/hooks.json`. No manual step is required.

For developers working **inside** the CAP repo or installing without the plugin manifest, opt in by adding to your project-local `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/hooks/cap-version-check.js",
            "timeout": 2
          }
        ]
      }
    ]
  }
}
```

The hook is non-blocking and emits at most one advisory per session when the installed CAP version doesn't match the project's `.cap/version` marker. Suppress via `.cap/config.json`:

```json
{ "upgrade": { "notify": false } }
```

> `.claude/settings.json` is gitignored in most repos — opt in by editing it manually; do not modify it programmatically.

---

## 4. Two-phase quick/finalize workflow (deprecated as a slash command)

The previous `/cap:quick` and `/cap:finalize` commands implemented a two-phase visual-iteration workflow (Phase 1 = freeform editing, Phase 2 = catch-up annotate + iterate + test). The flag in `SESSION.json` and the `cap-prototyper` iterate-mode + `cap-validator` (test mode) agents still exist; the orchestration is now expected to run via `/loop` or by composing `/cap:annotate`, `/cap:iterate`, and `/cap:test` manually on the changed file set. (Note: prior to `iteration/cap-pro-4` this paragraph referenced `cap-tester`, which has since been folded into `cap-validator`.)

If you need the old behavior, the helper still lives in `cap/bin/lib/cap-session.cjs` (`startQuickMode`, `endQuickMode`, `getChangedFilesSinceQuickStart`).

---

## 5. Switching active app in a monorepo

Previously a dedicated `/cap:switch-app` command. Now use `/cap:start --app=<name>`, which lists workspace packages, shows tag counts, and updates `SESSION.json`.
