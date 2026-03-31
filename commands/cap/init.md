---
name: cap:init
description: "Initialize CAP project -- creates .cap/, FEATURE-MAP.md, detects dependencies via Context7, performs brownfield analysis on existing codebases."
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

<!-- @gsd-context CAP v2.0 init command (final pass) -- adds mandatory Context7 integration and brownfield detection on top of the base init flow. -->
<!-- @gsd-decision Context7 fetch is mandatory at init time per AC-81. If unreachable, warning is emitted but init continues with explicit marker in SESSION.json. -->
<!-- @gsd-decision Brownfield analysis is ephemeral -- results are used as context for /cap:annotate suggestion, NOT persisted as a separate document (AC-87). -->
<!-- @gsd-decision No /cap:map command exists. Codebase analysis is part of /cap:init only (AC-90). -->
<!-- @gsd-constraint No prompts, wizards, or configuration forms. Init completes in a single invocation (AC-4, AC-5). -->

<!-- @gsd-todo(ref:AC-81) Detect all dependencies from package.json / requirements.txt / Cargo.toml / go.mod and fetch docs via Context7 -->
<!-- @gsd-todo(ref:AC-82) Store fetched stack docs in .cap/stack-docs/{library-name}.md compressed to API surface, config, breaking changes -->
<!-- @gsd-todo(ref:AC-83) Agents receive .cap/stack-docs/ as context input on every invocation -->
<!-- @gsd-todo(ref:AC-84) Stack-docs carry freshness marker (fetch date). Docs older than 7 days auto-refreshed. Manual refresh via /cap:refresh-docs -->
<!-- @gsd-todo(ref:AC-85) Context7 fetching is MANDATORY at init. If unreachable, warning emitted and init continues with explicit marker -->
<!-- @gsd-todo(ref:AC-86) Brownfield init performs one-time codebase analysis: architecture detection, convention detection, test setup detection -->
<!-- @gsd-todo(ref:AC-87) Brownfield analysis result NOT persisted as separate document -- used as init context for /cap:annotate suggestion -->
<!-- @gsd-todo(ref:AC-88) After brownfield init, suggest /cap:annotate to retroactively annotate existing code -->
<!-- @gsd-todo(ref:AC-90) No /cap:map command. Codebase analysis is part of /cap:init -->
<!-- @gsd-todo(ref:AC-91) To refresh codebase information: /cap:annotate + /cap:refresh-docs -->
<!-- @gsd-todo(ref:AC-92) The 7 documents from .planning/codebase/ shall NOT be generated in v2.0 -->

<objective>
Initialize the CAP project structure with mandatory Context7 stack documentation fetch and brownfield codebase analysis. This command:

1. Creates `.cap/` directory with subdirectories (stack-docs, debug)
2. Creates `.cap/.gitignore` (ignores SESSION.json and debug/)
3. Creates `.cap/SESSION.json` with default session state
4. Creates `FEATURE-MAP.md` at project root (ONLY if it does not already exist)
5. **Detects project dependencies** from manifest files (package.json, requirements.txt, Cargo.toml, go.mod)
6. **Fetches stack documentation via Context7** for all detected dependencies
7. **Performs brownfield analysis** if existing source code is detected
8. Suggests `/cap:annotate` if brownfield code is found

**Idempotent:** Safe to run multiple times. Never overwrites existing FEATURE-MAP.md.
**Non-interactive:** No prompts, no wizards, no configuration forms.
**Context7 is MANDATORY:** If unreachable, warning emitted and init continues with explicit marker.
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
</context>

<process>

## Step 1: Detect project root and check initialization state

Use Bash to check current state:

```bash
ls -la .cap/ 2>/dev/null && echo "ALREADY_INITIALIZED" || echo "FRESH_PROJECT"
test -f FEATURE-MAP.md && echo "FEATURE_MAP_EXISTS" || echo "NO_FEATURE_MAP"
```

## Step 2: Create .cap/ directory structure

```bash
mkdir -p .cap/stack-docs .cap/debug
```

## Step 3: Write .cap/.gitignore

Use the Write tool to create `.cap/.gitignore`:

```
# CAP ephemeral state -- do not commit
SESSION.json
debug/
```

## Step 4: Write .cap/SESSION.json (only if not exists)

Check if SESSION.json exists first. If not, write default session:

```json
{
  "version": "2.0.0",
  "lastCommand": "/cap:init",
  "lastCommandTimestamp": "<ISO_NOW>",
  "activeFeature": null,
  "step": "init",
  "startedAt": "<ISO_NOW>",
  "activeDebugSession": null,
  "context7Available": null,
  "metadata": {}
}
```

Note the `context7Available` field -- this gets set in Step 6 to indicate whether Context7 was reachable.

## Step 5: Write FEATURE-MAP.md (only if not exists)

**CRITICAL: Skip this step if FEATURE-MAP.md already exists.**

If FEATURE-MAP.md does NOT exist, write the empty template.

## Step 6: Mandatory Context7 dependency fetch

<!-- @gsd-decision Multi-language dependency detection runs in priority order: package.json first, then requirements.txt, then Cargo.toml, then go.mod. First match sets project type. -->

### 6a: Detect dependencies

Run dependency detection for all supported manifest files:

```bash
node -e "
const stackDocs = require('./cap/bin/lib/cap-stack-docs.cjs');
const result = stackDocs.detectDependencies(process.cwd());
console.log(JSON.stringify(result, null, 2));
"
```

Store the result as `dep_info`. Log: "Detected {dep_info.type} project with {dep_info.dependencies.length} dependencies."

### 6b: Fetch stack docs via Context7

For each dependency in `dep_info.dependencies` (limit to top 10 most important -- skip internal/scoped packages that start with `@company/`):

```bash
node -e "
const stackDocs = require('./cap/bin/lib/cap-stack-docs.cjs');
const depName = process.argv[1];
const lib = stackDocs.resolveLibrary(depName, 'API surface and configuration');
if (lib) {
  const result = stackDocs.fetchDocs(process.cwd(), lib.id, 'API surface, configuration, breaking changes');
  console.log(JSON.stringify({ library: depName, ...result }));
} else {
  console.log(JSON.stringify({ library: depName, success: false, error: 'Library not found in Context7' }));
}
" "<DEP_NAME>"
```

Track results:
- `fetched_count` -- number of successfully fetched docs
- `failed_count` -- number of failed fetches
- `context7_available` -- true if at least one fetch succeeded

### 6c: Handle Context7 unreachable

If ALL fetches fail (context7_available = false):

1. Update SESSION.json to set `context7Available: false`
2. Emit warning:
   ```
   WARNING: Context7 is unreachable. Stack documentation could not be fetched.
   Init continues without stack docs. Run /cap:refresh-docs when network is available.
   ```

If some fetches succeeded:
1. Update SESSION.json to set `context7Available: true`
2. Log summary: "Fetched docs for {fetched_count} of {total} dependencies."

## Step 7: Brownfield codebase analysis

<!-- @gsd-decision Brownfield analysis detects 3 things: (1) architecture pattern, (2) coding conventions, (3) test setup. Results are ephemeral -- used only for the /cap:annotate suggestion. -->

### 7a: Check for existing source code

```bash
# Count source files by language
find . -maxdepth 4 -not -path './node_modules/*' -not -path './.git/*' -not -path './.cap/*' \( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.rb" \) | head -50
```

If NO source files are found, this is a greenfield project. Skip to Step 8.

### 7b: Architecture detection (ephemeral)

If source files exist, analyze the codebase structure:

```bash
# Detect directory structure pattern
ls -d */ 2>/dev/null | head -20
# Check for common framework indicators
test -f tsconfig.json && echo "TYPESCRIPT"
test -f next.config.js -o -f next.config.mjs && echo "NEXTJS"
test -f vite.config.ts -o -f vite.config.js && echo "VITE"
test -f Dockerfile && echo "DOCKER"
test -d src && echo "SRC_DIR"
test -d lib && echo "LIB_DIR"
test -d packages && echo "MONOREPO"
```

### 7c: Convention detection (ephemeral)

```bash
# Check for linting/formatting config
test -f .eslintrc.json -o -f .eslintrc.js -o -f eslint.config.js && echo "ESLINT"
test -f .prettierrc -o -f .prettierrc.json && echo "PRETTIER"
test -f .editorconfig && echo "EDITORCONFIG"
```

### 7d: Test setup detection (ephemeral)

```bash
# Check for test frameworks
test -f jest.config.js -o -f jest.config.ts && echo "JEST"
test -f vitest.config.ts -o -f vitest.config.js && echo "VITEST"
test -d __tests__ -o -d tests -o -d test && echo "TEST_DIR_EXISTS"
```

### 7e: Suggest /cap:annotate

If brownfield code was detected, output:

```
Existing codebase detected:
  Source files: ~{count} files ({languages})
  Architecture: {detected patterns}
  Test setup: {detected test frameworks}

Recommended: Run /cap:annotate to add @cap-feature tags to your existing code.
This helps CAP track your features across the codebase.
```

**Do NOT persist the brownfield analysis as a separate document** (AC-87).

## Step 8: Report results

```
CAP initialized.

Created:
  .cap/                   -- runtime directory
  .cap/.gitignore         -- excludes SESSION.json from git
  .cap/SESSION.json       -- ephemeral workflow state
  .cap/stack-docs/        -- cached documentation ({fetched_count} docs fetched)
  .cap/debug/             -- debug session logs
  FEATURE-MAP.md          -- feature source of truth (or: already existed, preserved)

Stack docs: {fetched_count} fetched, {failed_count} failed{context7_warning}

Next steps:
  /cap:brainstorm    -- generate features from conversation
  /cap:annotate      -- add @cap-feature tags to existing code
  /cap:prototype     -- build features from Feature Map
  /cap:status        -- view project dashboard
  /cap:refresh-docs  -- manually refresh stack documentation
```

## Step 9: Update session

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:init',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'initialized'
});
"
```

</process>
