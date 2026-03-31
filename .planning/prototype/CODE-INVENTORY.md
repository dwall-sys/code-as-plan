# CODE-INVENTORY.md

**Generated:** 2026-03-31T11:56:47.326Z
**Project:** Unknown Project
**Schema version:** 1.0
**Tags found:** 366 across 27 files

## Summary Statistics

| Tag Type | Count |
|----------|-------|
| @gsd-context | 36 |
| @gsd-decision | 57 |
| @gsd-todo | 106 |
| @gsd-constraint | 29 |
| @gsd-pattern | 26 |
| @gsd-ref | 9 |
| @gsd-risk | 25 |
| @gsd-api | 78 |

## Tags by Type

### @gsd-context

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/README.md

| Line | Metadata | Description |
|------|----------|-------------|
| 95 | — | Auth module -- stateless JWT validation, RS256 only |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-feature-map.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | CAP v2.0 Feature Map reader/writer -- FEATURE-MAP.md is the single source of truth for all features, ACs, status, and dependencies. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-session.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | CAP v2.0 session manager -- manages .cap/SESSION.json for cross-conversation workflow state. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | CAP v2.0 stack docs manager (final pass) -- adds freshness markers, multi-language detection, and mandatory init fetch flow. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | CAP v2.0 stack docs manager -- wraps Context7 CLI for library documentation fetch and caching in .cap/stack-docs/. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | CAP v2.0 tag scanner (final pass) -- adds monorepo workspace detection and cross-package scanning to the base tag scanner. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | CAP v2.0 tag scanner -- extracts @cap-feature, @cap-todo, @cap-risk, and @cap-decision tags from source files. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | phase:11 | Convention reader utility -- discovers existing project conventions for architecture mode |
| 50 | — | Reads package.json for module type, naming conventions, and dependency-based framework detection |
| 79 | — | Reads TypeScript/JavaScript config for path aliases and module resolution |
| 99 | — | Reads directory names to detect naming convention (kebab-case vs camelCase etc.) |
| 112 | — | Checks for linter config files to match code style in generated skeleton |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/feature-aggregator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 10 | phase:12 | Feature aggregator — reads PRDs and CODE-INVENTORY.md to produce FEATURES.md. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/manifest-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | Manifest generator for monorepo shared packages -- extracts public API surface and produces markdown summaries |
| 60 | — | Find and scan the main entry point / barrel file for exports |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-context.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | Monorepo context resolver -- assembles per-app planning paths and agent context for scoped operations |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-migrator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | Monorepo migration module -- audits existing .planning/ directories in apps, supports archive/replace/keep per app, analyzes root .planning/ for global vs app-specific split, regenerates scoped CODE-INVENTORY.md |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/session-manager.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | Session manager for monorepo mode -- persists and resolves the current app selection so all GSD commands auto-scope without --app flag |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/skeleton-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | phase:11 | Skeleton generator -- produces directory tree and file list for architecture mode confirmation gate |
| 77 | — | Module naming follows discovered convention (kebab-case, camelCase, etc.) |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/workspace-detector.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | Workspace detector for monorepo mode -- discovers NX, Turbo, and pnpm workspaces and enumerates apps/packages |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md

| Line | Metadata | Description |
|------|----------|-------------|
| 20 | — | JWT validation module — stateless, RS256 only |
| 53 | — | Valid tag — anchored to comment token     (VALID) |
| 62 | — | Partitioned by tenant_id                  (VALID — SQL comment) |
| 85 | — | — |
| 90 | phase:1 | Auth middleware — validates JWT on every protected route. Stateless, RS256 only. |
| 179 | phase:1 | Single phase scoping |
| 191 | phase:1 | Auth middleware — validates JWT on every protected route |
| 230 | — | Connection pool — shared across all handlers, initialized once at startup |
| 238 | — | FFI boundary to the C crypto library — unsafe block intentional |
| 252 | — | Partitioned by tenant_id for query isolation — max 50K rows per partition |
| 269 | — | Bootstraps the dev environment — must be idempotent |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-stack-docs-v2.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | Tests for cap-stack-docs-v2.cjs -- multi-language dependency detection, freshness markers, batch fetch, and workspace detection. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-stack-docs.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | Tests for cap-stack-docs.cjs -- dependency detection, doc writing, listing, and freshness checking. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-tag-scanner-v2.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 1 | — | Tests for cap-tag-scanner-v2.cjs -- monorepo workspace detection, cross-package scanning, and group-by-package. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/feature-aggregator.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | phase:12 | Unit tests for the feature aggregator module. |

### @gsd-decision

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/README.md

| Line | Metadata | Description |
|------|----------|-------------|
| 96 | phase:1 | Use jose library for JWT parsing -- zero native deps |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/agents/gsd-arc-executor.md

| Line | Metadata | Description |
|------|----------|-------------|
| 150 | — | [description of choice] | rationale: [why this approach was chosen over alternatives] |
| 161 | — | Using Map over plain object for O(1) lookup | rationale: data set grows unboundedly |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-feature-map.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Markdown format for Feature Map (not JSON/YAML) -- human-readable, diffable in git, editable in any text editor. Machine-readable via regex parsing of structured table rows. |
| 3 | — | Read and write are separate operations -- no in-memory mutation API. Read returns structured data, write takes structured data and serializes to markdown. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-session.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | SESSION.json is ephemeral (gitignored) -- it tracks the current developer's workflow state, not project state. Project state lives in FEATURE-MAP.md. |
| 3 | — | JSON format (not markdown) -- session state is machine-consumed, not human-read. JSON is faster to parse and type-safe. |
| 12 | — | Session schema is flat and extensible -- new workflow commands can add keys without schema migration. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | This file extends cap-stack-docs.cjs with freshness metadata embedded in doc files and batch fetch orchestration for /cap:init. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Wraps npx ctx7@latest (not a direct API call) -- Context7 is already the user's standard tool per CLAUDE.md. This module provides programmatic access for agent workflows. |
| 3 | — | Docs cached as markdown files in .cap/stack-docs/{library-name}.md -- simple, readable, committable for offline use. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Extends cap-tag-scanner.cjs with monorepo awareness. scanMonorepo() wraps scanDirectory() for each workspace package. |
| 80 | — | Uses fs.readdirSync instead of glob library for workspace pattern expansion. Handles only simple patterns (dir/* and dir/**). |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Separate module from arc-scanner.cjs -- CAP tags use @cap- prefix (not @gsd-) and have different metadata semantics (feature: key instead of phase: key). |
| 3 | — | Regex-based extraction (not AST) -- language-agnostic, zero dependencies, proven sufficient in GSD arc-scanner.cjs. |
| 13 | — | CAP tag types: 2 primary (feature, todo) + 2 optional (risk, decision). Simplified from GSD's 8 types. |
| 25 | — | Subtype detection uses prefix matching on the description text (e.g., "risk: memory leak" -> subtype: "risk") |
| 210 | — | Simple character-level distance for fuzzy matching -- no external library needed |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Implemented as a standalone CJS module (not inline in the agent) so it can be tested independently |
| 58 | — | Detect test runner from devDependencies keys rather than config files -- faster and covers most cases |
| 66 | — | Detect build tool from devDependencies -- covers esbuild, webpack, vite, rollup |
| 104 | — | Check for tests/ or __tests__/ directory first, then fall back to checking for colocated .test. files |
| 161 | — | Simple heuristic: check if majority of directory names match a pattern |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/feature-aggregator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 151 | — | AC completion is derived from tag presence: if a @gsd-todo with ref:AC-N |
| 310 | — | PRD discovery uses a simple glob: .planning/PRD.md and .planning/PRD-*.md |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/manifest-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Scans index/barrel files and TypeScript .d.ts files rather than full AST parsing -- regex is sufficient for export extraction |
| 57 | — | Extract workspace:* dependencies to identify internal monorepo links |
| 81 | — | Check package.json exports/main/module fields, then fall back to index.ts/index.js convention |
| 117 | — | Use regex to extract exports rather than AST parsing -- language-agnostic and zero-dep |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-context.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Separate module from workspace-detector to keep detection (read-only) separate from planning structure (write operations) |
| 54 | — | Create stub PRD.md and FEATURES.md in app .planning/ -- agents expect these files to exist |
| 95 | — | Load global context lazily -- only read file headers, not full content, to minimize token usage |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-migrator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Separate module from monorepo-context.cjs -- migration is a one-time destructive operation; context assembly is read-only and ongoing |
| 16 | — | Standard .planning/ files recognized during audit -- matches the set that monorepo-context.cjs and extract-plan produce |
| 177 | — | Classify root files by name convention -- PROJECT.md, ROADMAP.md, REQUIREMENTS.md are always global; PRD.md and FEATURES.md at root are ambiguous in a monorepo |
| 281 | — | Archive to legacy-{timestamp} inside the app's .planning/ -- keeps history co-located with the app |
| 291 | — | Use cpSync+rmSync instead of renameSync -- cross-device safe for monorepos spanning mounts |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/session-manager.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Session stored in .planning/SESSION.json -- co-located with planning artifacts, not in a hidden dotfile or temp directory |
| 28 | — | SESSION.json lives at root .planning/SESSION.json -- one session file for the whole monorepo, not per-app |
| 88 | — | Explicit --app always wins over session -- escape hatch for one-off commands on a different app |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/skeleton-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | This is a utility that generates the PLAN (tree display), not the files themselves. The agent creates files via Write tool after user confirms the plan. |
| 44 | — | Config files are generated first in the plan because they define project-wide conventions that module files depend on |
| 59 | — | Entry point is src/index with extension matching module type (.mjs for ESM, .cjs for CJS, .js as default) |
| 75 | — | Three-file module template keeps boundaries consistent and predictable across the codebase |
| 100 | — | Test directory structure matches discovered convention -- colocated or separate |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/workspace-detector.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Regex-parses pnpm-workspace.yaml instead of adding a YAML parser -- keeps zero-dep constraint |
| 45 | — | Check nx.json first, then turbo.json, then pnpm-workspace.yaml, then package.json workspaces -- priority matches market share |
| 79 | — | Classify directories under apps/ or packages/ by convention -- NX/Turbo monorepos use this standard structure |
| 184 | — | Parse pnpm-workspace.yaml with regex -- avoids adding js-yaml dependency; works for the simple list format pnpm uses |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md

| Line | Metadata | Description |
|------|----------|-------------|
| 95 | — | — |
| 100 | — | Using jose over jsonwebtoken: jose is ESM-compatible and actively maintained. jsonwebtoken has no ESM export. |
| 192 | — | Using jose over jsonwebtoken: jose is ESM-compatible, no CommonJS issues |
| 215 | — | Using bcrypt not argon2 — bcrypt is available on all target deployment platforms without custom compile |
| 244 | — | Chose ring over openssl: ring has a smaller attack surface and is pure Rust |
| 258 | — | Storing UTC timestamps as BIGINT (epoch ms) not TIMESTAMPTZ — avoids timezone conversion bugs in legacy importers |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-stack-docs-v2.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Mocks execSync for Context7 calls -- tests must not require network access. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-stack-docs.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Mocks execSync for Context7 calls -- tests must not require network access or ctx7 installed. |

### @gsd-todo

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/README.md

| Line | Metadata | Description |
|------|----------|-------------|
| 97 | phase:2, priority:high | Add refresh token rotation |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/agents/gsd-arc-executor.md

| Line | Metadata | Description |
|------|----------|-------------|
| 141 | phase:2 | Add refresh token rotation |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/commands/gsd/prototype.md

| Line | Metadata | Description |
|------|----------|-------------|
| 230 | ref:AC-1 | User can run /gsd:prototype with PRD auto-detection at .planning/PRD.md |
| 231 | ref:AC-3, priority:high | User is prompted to paste PRD content if no file is found |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-feature-map.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 14 | ref:AC-9 | Feature state lifecycle: planned -> prototyped -> tested -> shipped |
| 47 | ref:AC-7 | Feature Map is a single Markdown file at the project root named FEATURE-MAP.md |
| 49 | ref:AC-1 | Generate empty FEATURE-MAP.md template with section headers (Features, Legend) and no feature entries |
| 80 | ref:AC-10 | Feature Map is the single source of truth for feature identity, state, ACs, and relationships |
| 95 | ref:AC-8 | Each feature entry contains: feature ID, title, state, ACs, and file references |
| 96 | ref:AC-14 | Feature Map scales to 80-120 features in a single file |
| 298 | ref:AC-9 | Enforce valid state transitions: planned->prototyped->tested->shipped |
| 321 | ref:AC-12 | Feature Map auto-enriched from @cap-feature tags found in source code |
| 349 | ref:AC-13 | Feature Map auto-enriched from dependency graph analysis, env vars, package.json |
| 441 | ref:AC-11 | Feature Map supports auto-derivation from brainstorm output |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-session.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 13 | ref:AC-16 | SESSION.json tracks ephemeral workflow state: active feature ID, current workflow step, session timestamps |
| 29 | ref:AC-3 | .cap/.gitignore ignores SESSION.json (ephemeral state shall not be committed) |
| 36 | ref:AC-2 | SESSION.json with valid JSON structure: { active_feature: null, step: null, started_at: null } |
| 54 | ref:AC-19 | SESSION.json is the only mutable session artifact |
| 74 | ref:AC-18 | SESSION.json shall not be committed to version control (enforced by .cap/.gitignore) |
| 103 | ref:AC-17 | SESSION.json connects to FEATURE-MAP.md only via feature IDs (loose coupling) |
| 151 | ref:AC-4 | No prompts, questions, wizards, or configuration forms |
| 152 | ref:AC-5 | Completes in a single invocation with no follow-up steps |
| 153 | ref:AC-6 | Idempotent -- running on already-initialized project shall not overwrite existing content |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 16 | ref:AC-93 | Zero runtime dependencies -- uses only Node.js built-ins |
| 17 | ref:AC-94 | Tag scanner uses native RegExp -- no comment-parser or AST parser |
| 18 | ref:AC-95 | File discovery uses fs.readdirSync with recursive walk -- no glob library |
| 46 | ref:AC-81 | Detect all dependencies from package.json / requirements.txt / Cargo.toml / go.mod |
| 151 | ref:AC-84 | Stack-docs carry freshness marker (fetch date). Docs older than 7 days auto-refreshed. |
| 212 | ref:AC-82 | Store fetched stack docs in .cap/stack-docs/{library-name}.md |
| 255 | ref:AC-85 | Context7 fetching is MANDATORY at init. If unreachable, warning emitted and init continues. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 15 | ref:AC-27 | Tag scanner uses stack docs path for enrichment context |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 29 | ref:AC-78 | /cap:scan shall traverse all packages in a monorepo |
| 30 | ref:AC-93 | Zero runtime dependencies -- uses only Node.js built-ins |
| 31 | ref:AC-94 | Tag scanner uses native RegExp -- no comment-parser or AST parser |
| 32 | ref:AC-95 | File discovery uses fs.readdirSync with recursive walk -- no glob library |
| 33 | ref:AC-96 | CLI argument parsing uses existing parseNamedArgs() pattern |
| 122 | ref:AC-79 | Feature Map entries support cross-package file references (e.g., packages/core/src/auth.ts) |
| 123 | ref:AC-80 | Works seamlessly with single-repo projects -- returns regular scanDirectory results if not a monorepo |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 12 | ref:AC-20 | Primary tags are @cap-feature and @cap-todo; risk and decision are optional standalone tags |
| 16 | ref:AC-25 | Tag scanner uses native RegExp with dotAll flag for multiline extraction |
| 20 | ref:AC-26 | Tag scanner is language-agnostic, operating on comment syntax patterns across JS, TS, Python, Ruby, Shell |
| 24 | ref:AC-22 | @cap-todo supports structured subtypes: risk:..., decision:... |
| 85 | ref:AC-22 | Detect subtypes in @cap-todo description (risk:..., decision:...) |
| 115 | ref:AC-25 | Use native RegExp for tag extraction -- no AST parsing |
| 187 | ref:AC-15 | Orphan tags flagged with fuzzy-match hint suggesting closest existing feature ID |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 36 | ref:AC-3 | Implement full convention discovery: package.json parsing, tsconfig reading, directory pattern detection, linter config extraction |
| 109 | — | Detect colocated test pattern by scanning for *.test.* files alongside source files |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/feature-aggregator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 40 | ref:AC-1 | Implement full PRD parsing — extract ACs, feature groups, and dependency sections from PRD markdown |
| 119 | ref:AC-2 | Implement CODE-INVENTORY.md parsing to extract open @gsd-todo(ref:AC-N) tags and determine per-AC completion status |
| 184 | ref:AC-3 | Implement dependency visualization in FEATURES.md from PRD dependency sections |
| 223 | ref:AC-5 | Generate FEATURES.md as a derived read-only artifact with last-updated timestamp and source-hash header |
| 355 | ref:AC-4 | Wire aggregate-features into extract-tags auto-chain so FEATURES.md regenerates on every extract-tags run |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-migrator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 88 | ref:AC-9 | Implement full audit: scan all app directories for existing .planning/ folders and report what exists where |
| 156 | ref:AC-11 | Implement root .planning/ analysis: classify files as global vs app-specific and guide user to split |
| 235 | ref:AC-10 | Implement per-app keep/archive/replace: user chooses action for each app's existing .planning/ |
| 341 | ref:AC-12 | Implement scoped CODE-INVENTORY.md regeneration per app after migration (replacing monolithic version) |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/session-manager.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 43 | ref:AC-13 | Implement session detection at startup: when monorepo detected, present app selector if no session exists |
| 61 | ref:AC-14 | Implement auto-scoping: all GSD commands call resolveCurrentApp() so --app flag is not required after selection |
| 97 | ref:AC-15 | Wire setCurrentApp to /gsd:switch-app command for mid-session app switching |
| 126 | ref:AC-16 | Implement "Global" option: setCurrentApp(rootPath, null) puts session in root-level scope for cross-app work |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/skeleton-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 38 | ref:AC-1 | Implement skeleton plan generation that produces folder structure, config files, and typed interfaces based on discovered conventions |
| 128 | — | Implement naming convention transformations (kebab-case, camelCase, PascalCase, snake_case) |
| 150 | — | Implement tree string builder with proper indentation and box-drawing characters |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md

| Line | Metadata | Description |
|------|----------|-------------|
| 21 | phase:2 | Add refresh token rotation |
| 22 | phase:2, priority:high | Add refresh token rotation |
| 105 | — | — |
| 110 | phase:2, priority:high | Add refresh token rotation — currently tokens never expire |
| 176 | phase:2 | Single key |
| 177 | phase:2, priority:high | Two keys |
| 206 | phase:2, priority:high | Add caching layer for repeated signature verifications |
| 259 | phase:3 | Migrate to TIMESTAMPTZ once legacy importers are decommissioned |
| 270 | phase:3 | Add --dry-run flag for CI validation without side effects |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-feature-map.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 46 | ref:AC-1 | FEATURE-MAP.md template with section headers (Features, Legend) and no feature entries |
| 74 | ref:AC-10 | Feature Map is the single source of truth |
| 98 | ref:AC-8 | Each feature entry contains: feature ID, title, state, ACs, file references |
| 215 | ref:AC-6 | Idempotent -- adding features does not overwrite existing content |
| 254 | ref:AC-9 | Feature state lifecycle: planned -> prototyped -> tested -> shipped |
| 312 | ref:AC-12 | Feature Map auto-enriched from @cap-feature tags |
| 351 | ref:AC-13 | Auto-enrichment from dependency graph, env vars, package.json |
| 415 | ref:AC-11 | Feature Map supports auto-derivation from brainstorm output |
| 505 | ref:AC-14 | Feature Map scales to 80-120 features in a single file |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-session.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 52 | ref:AC-2 | SESSION.json with { active_feature: null, step: null, started_at: null } |
| 97 | ref:AC-16 | SESSION.json tracks ephemeral workflow state |
| 161 | ref:AC-17 | SESSION.json connects to FEATURE-MAP.md only via feature IDs (loose coupling) |
| 236 | ref:AC-3 | .cap/.gitignore ignores SESSION.json |
| 263 | ref:AC-6 | Idempotent -- running on already-initialized project does not overwrite |
| 273 | ref:AC-4 | No prompts, no wizards -- initCapDirectory is synchronous with no user interaction |
| 274 | ref:AC-5 | Completes in single invocation |
| 279 | ref:AC-18 | SESSION.json not committed to version control |
| 286 | ref:AC-19 | SESSION.json is the only mutable session artifact |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-stack-docs-v2.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | ref:AC-100 | All CJS code tested with node:test and node:assert |
| 38 | ref:AC-84 | Docs older than 7 days auto-refreshed |
| 191 | ref:AC-81 | Detect all dependencies from package.json / requirements.txt / Cargo.toml / go.mod |
| 393 | ref:AC-85 | Context7 mandatory -- graceful failure when unreachable |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-tag-scanner-v2.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | ref:AC-100 | All CJS code tested with node:test and node:assert |
| 64 | ref:AC-78 | /cap:scan shall traverse all packages in a monorepo |
| 215 | ref:AC-79 | Feature Map entries support cross-package file references |
| 216 | ref:AC-80 | Works seamlessly with single-repo projects |
| 355 | ref:AC-93 | Zero runtime dependencies |
| 356 | ref:AC-95 | File discovery uses fs.readdirSync -- no glob library |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-tag-scanner.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 34 | ref:AC-20 | Primary tags are @cap-feature and @cap-todo |
| 52 | ref:AC-23 | @cap-risk and @cap-decision available as standalone optional tags |
| 80 | ref:AC-26 | Tag scanner is language-agnostic across JS, TS, Python, Ruby, Shell |
| 175 | ref:AC-22 | @cap-todo supports subtypes: risk:..., decision:... |
| 209 | ref:AC-25 | Multiline block comment support |
| 356 | ref:AC-15 | Orphan tags flagged with fuzzy-match hint |

### @gsd-constraint

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/README.md

| Line | Metadata | Description |
|------|----------|-------------|
| 98 | — | Must remain stateless -- no session storage |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-feature-map.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path). |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-session.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path). |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | — | Zero external dependencies at runtime -- Context7 invoked via child_process.execSync (npx), not imported. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | — | Zero external dependencies at runtime -- Context7 is invoked via child_process.execSync (npx), not imported. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path). No glob library. (AC-93, AC-95) |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path). |
| 143 | — | Uses readdirSync (not glob) per project zero-dep constraint |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path) |
| 132 | — | Uses readdirSync (not glob) per project zero-dep constraint |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/feature-aggregator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 207 | — | FEATURES.md is a derived read-only artifact. It must never be manually edited. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/manifest-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path) |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-context.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path) |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-migrator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path) |
| 355 | — | Must use existing tag-scanner.cjs for extraction -- no reimplementation of scanning logic |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/session-manager.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path) |
| 156 | — | Session init does NOT auto-select an app -- user must explicitly choose via selector or /gsd:switch-app |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/skeleton-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 39 | — | Generated skeleton must contain zero feature implementation code -- only structure and interfaces |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/workspace-detector.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | — | Zero external dependencies -- uses only Node.js built-ins (fs, path) |
| 221 | — | Uses readdirSync (not glob library) per project zero-dep constraint |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md

| Line | Metadata | Description |
|------|----------|-------------|
| 60 | — | No external HTTP calls allowed          (VALID — hash comment) |
| 115 | — | — |
| 120 | — | Max response time 200ms — SLA requirement. Do not add synchronous I/O in this path. |
| 198 | — | No plaintext passwords stored — bcrypt hash only, cost factor 12 |
| 205 | — | No external HTTP calls from this module — must be pure compute |
| 231 | — | Max 25 connections — production database limit. Do not increase without DBA approval. |
| 245 | — | FIPS compliance required — ring is FIPS 140-2 validated for production use |
| 253 | — | No cross-tenant JOINs allowed in this view |
| 275 | — | Requires bash >=4.0 — uses associative arrays. macOS ships bash 3.2; install via Homebrew. |

### @gsd-pattern

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-feature-map.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 5 | — | Feature Map is the bridge between all CAP workflows. Brainstorm writes entries, scan updates status, status reads for dashboard. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-session.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 5 | — | All session reads/writes go through this module -- no direct fs.readFileSync of SESSION.json elsewhere. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | — | Freshness markers stored as HTML comments in the doc file header: <!-- Fetched: ISO_DATE -->. Parsed by checkFreshnessFromContent(). |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | — | File paths in monorepo scans are always relative to PROJECT ROOT (not package root), enabling cross-package Feature Map refs. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 5 | — | Same comment anchor rule as ARC: tag is only valid when first non-whitespace content on a line is a comment token. |
| 17 | — | Tag regex anchors to comment tokens at line start -- identical approach to arc-scanner.cjs |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 12 | — | Convention reader returns a structured report that the agent prompt can serialize into context |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/feature-aggregator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 19 | — | AC lines in PRDs follow the format: AC-N: description text |
| 23 | — | Feature group headings in PRDs use ## or ### markdown headers |
| 26 | — | Dependency sections in PRDs use "## Dependencies" or "### Dependencies" |
| 105 | — | Open @gsd-todo tags with ref:AC-N metadata indicate incomplete ACs. |
| 336 | — | CLI entry follows arc-scanner.cjs cmdExtractTags pattern: |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/manifest-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 5 | — | Manifest output is markdown so it can be injected directly into agent context as lightweight reference |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-context.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 6 | — | Two-level planning: root .planning/ for global context, app-path/.planning/ for scoped work |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-migrator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | — | Migration functions return audit/result objects -- callers (commands) handle user interaction and confirmation |
| 266 | — | Archive uses timestamp-based directory naming (legacy-{timestamp}) -- ensures idempotent re-runs never collide |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/session-manager.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | — | All GSD commands call resolveCurrentApp() to get the effective app -- explicit --app flag overrides session, session overrides nothing |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/skeleton-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 11 | — | Skeleton plans are data structures, not side-effectful -- file writing is done by the agent after user approval |
| 74 | — | Each module gets exactly three files: barrel (index), types, and a single stub |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/workspace-detector.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 5 | — | Workspace detection returns a structured WorkspaceInfo object that downstream modules consume uniformly |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md

| Line | Metadata | Description |
|------|----------|-------------|
| 125 | — | — |
| 130 | — | Use sync.Once for all singleton initializations in this package — see Init() as the reference implementation |
| 224 | — | Use sync.Once for all singleton initializations in this package |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-stack-docs-v2.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | — | Uses node:test and node:assert per project convention. All CJS tests follow this pattern. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-stack-docs.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | — | Uses node:test and node:assert per project convention. All CJS tests follow this pattern. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-tag-scanner-v2.test.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 2 | — | Uses node:test and node:assert per project convention. All CJS tests follow this pattern. |

### @gsd-ref

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | ref:ARCH-03 | gsd-prototyper reads existing project conventions before generating skeleton |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/manifest-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | ref:AC-5 | Shared packages get auto-generated API manifests stored in root .planning/manifests/ |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-context.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | ref:AC-3 | Each scoped app gets its own .planning/ directory with independent CODE-INVENTORY.md, PRD.md, and FEATURES.md |
| 5 | ref:AC-7 | Root .planning/ holds global decisions; app .planning/ holds app-specific work |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/skeleton-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 3 | ref:ARCH-01 | Supports skeleton generation with folder structure, config, and typed interfaces |
| 4 | ref:ARCH-04 | Generates preview for confirmation gate -- no files written until approved |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/workspace-detector.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 4 | ref:AC-1 | GSD auto-detects NX/Turbo/pnpm workspaces and lists available apps and packages on project initialization |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md

| Line | Metadata | Description |
|------|----------|-------------|
| 135 | — | — |
| 140 | ref:ISSUE-142 | Rate limiting logic — see docs/rate-limiting.md for the algorithm specification |

### @gsd-risk

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/agents/gsd-tester.md

| Line | Metadata | Description |
|------|----------|-------------|
| 187 | reason:external-http-call, severity:high | sendEmail calls SMTP -- cannot unit test without mocking |
| 202 | reason:external-http-call, severity:high | sendEmail() calls SMTP -- cannot be unit tested without mocking |
| 203 | reason:database-write, severity:high | deleteUser() issues SQL DELETE -- requires transaction rollback in test setup |
| 204 | reason:async-race-condition, severity:medium | processQueue() may skip items if called concurrently |
| 205 | reason:browser-api, severity:low | initAnalytics() calls window.gtag -- not available in Node.js test environment |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 295 | — | Context7 resolution may fail for less popular libraries. Graceful skip per dep. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 5 | — | Context7 requires network access and may hit rate limits. Module must handle failures gracefully and report to caller. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 74 | — | Malformed package.json silently ignored -- could produce incorrect convention report |
| 162 | — | Heuristic may misclassify projects with mixed naming -- returns 'unknown' when ambiguous |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/feature-aggregator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 365 | — | No PRDs found — FEATURES.md cannot be generated without at least one PRD. |
| 396 | — | If CODE-INVENTORY.md is missing, all ACs appear "done" by default. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/manifest-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 118 | — | Regex export extraction may miss complex re-export patterns like `export * from './module'` chains |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-context.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 117 | — | If app package.json is missing or malformed, no manifests are resolved -- agent gets no package context |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-migrator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 191 | — | Root prototype/ may contain monolithic CODE-INVENTORY.md that should be split per app |
| 225 | — | Heuristic detection of app-specific content may produce false positives -- user confirmation is always required |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/workspace-detector.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 76 | — | Glob expansion uses simple fs.readdirSync matching, not full glob semantics -- patterns like apps/** work but complex negations do not |
| 100 | — | Directories not under apps/ or packages/ are classified as packages by default -- may misclassify standalone tools |
| 185 | — | Regex YAML parsing will break on complex YAML features (anchors, flow sequences) -- sufficient for pnpm-workspace.yaml which is always a simple list |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md

| Line | Metadata | Description |
|------|----------|-------------|
| 145 | — | — |
| 150 | ref:ISSUE-142 | Race condition possible if Init() called before DB connection pool is ready |
| 178 | ref:ISSUE-142, priority:high | Two keys with external reference |
| 216 | — | Memory: bcrypt is CPU-bound; under load this blocks the event loop in sync contexts |
| 225 | ref:ISSUE-142 | Race condition possible if Init() called before DB is ready |
| 239 | — | Memory safety: caller must ensure buf lives longer than the returned slice |
| 276 | — | If HOME is unset this script silently writes to //.config — add guard before production use |

### @gsd-api

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-feature-map.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 78 | — | readFeatureMap(projectRoot) -- Reads and parses FEATURE-MAP.md from project root. |
| 198 | — | writeFeatureMap(projectRoot, featureMap) -- Serializes FeatureMap to FEATURE-MAP.md. |
| 274 | — | addFeature(projectRoot, feature) -- Add a new feature entry to FEATURE-MAP.md. |
| 297 | — | updateFeatureState(projectRoot, featureId, newState) -- Transition feature state. |
| 320 | — | enrichFromTags(projectRoot, scanResults) -- Update file references from tag scan. |
| 348 | — | enrichFromDeps(projectRoot) -- Read package.json, detect imports, add dependency info to features. |
| 386 | — | getNextFeatureId(features) -- Generate next F-NNN ID. |
| 406 | — | enrichFromScan(featureMap, tags) -- Updates Feature Map status from tag scan results. |
| 440 | — | addFeatures(featureMap, newFeatures) -- Adds new features to an existing Feature Map (from brainstorm). |
| 464 | — | getStatus(featureMap) -- Computes aggregate project status from Feature Map. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-session.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 35 | — | getDefaultSession() -- Returns a fresh default session object. |
| 53 | — | loadSession(projectRoot) -- Loads .cap/SESSION.json. Returns default session if file missing or corrupt. |
| 73 | — | saveSession(projectRoot, session) -- Writes .cap/SESSION.json. Creates .cap/ directory if needed. |
| 88 | — | updateSession(projectRoot, updates) -- Partial update to session (merge, not overwrite). |
| 102 | — | startSession(projectRoot, featureId, step) -- Set active feature and step with timestamp. |
| 118 | — | updateStep(projectRoot, step) -- Update current workflow step. |
| 128 | — | endSession(projectRoot) -- Clear active feature and step. |
| 141 | — | isInitialized(projectRoot) -- Check if .cap/ exists. |
| 150 | — | initCapDirectory(projectRoot) -- Creates .cap/ directory structure and .gitignore. Idempotent. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 45 | — | detectDependencies(projectRoot) -- Multi-language dependency detection. |
| 150 | — | parseFreshnessFromContent(content) -- Extracts freshness date from doc file header comment. |
| 164 | — | checkFreshnessEnhanced(projectRoot, libraryName, maxAgeDays) -- Checks freshness using embedded date marker. |
| 211 | — | fetchDocsWithFreshness(projectRoot, libraryId, query) -- Fetches docs with embedded freshness marker. |
| 254 | — | batchFetchDocs(projectRoot, dependencies, options) -- Orchestrates batch fetch for /cap:init. |
| 326 | — | getStaleLibraries(projectRoot) -- Returns list of libraries with stale (>7 day) docs. |
| 356 | — | resolveLibrary(libraryName, query) -- Resolves library name to Context7 ID. |
| 383 | — | detectWorkspacePackages(projectRoot) -- Detects monorepo workspace packages for cross-package scanning. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 39 | — | detectDependencies(projectRoot) -- Reads package.json/requirements.txt/etc to discover project dependencies. |
| 138 | — | resolveLibrary(libraryName, query) -- Resolves a library name to a Context7 library ID. |
| 178 | — | fetchDocs(projectRoot, libraryId, query) -- Fetches library docs via Context7 and caches them. |
| 222 | — | writeDocs(projectRoot, libraryName, content) -- Writes documentation content directly to .cap/stack-docs/. |
| 245 | — | listCachedDocs(projectRoot) -- Lists all cached library docs. |
| 271 | — | checkFreshness(projectRoot, libraryName, maxAgeHours) -- Checks if cached docs are still fresh. |
| 301 | — | getDocsPath(projectRoot, libraryName) -- Returns the expected path for a library's cached docs. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner-v2.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 35 | — | detectWorkspaces(projectRoot) -- Detects monorepo workspaces from package.json and lerna.json. |
| 79 | — | resolveWorkspaceGlobs(projectRoot, patterns) -- Expands workspace glob patterns to actual directories. |
| 121 | — | scanMonorepo(projectRoot, options) -- Scans all workspace packages in a monorepo for @cap-* tags. |
| 187 | — | groupByPackage(tags) -- Groups tags by their workspace package based on file path prefix. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 39 | — | parseMetadata(metadataStr) -- Parses parenthesized key:value pairs. |
| 65 | — | extractTags(content, filePath) -- Regex extraction engine supporting //, #, /* */, """ """ comment styles. |
| 107 | — | scanFile(filePath, projectRoot) -- Scans a single file for @cap-* tags. |
| 126 | — | scanDirectory(dirPath, options) -- Recursively scans a directory for @cap-* tags. |
| 169 | — | groupByFeature(tags) -- Groups tags by their feature: metadata value. |
| 185 | — | detectOrphans(tags, featureIds) -- Compare tags against Feature Map entries, fuzzy-match hints for orphans. |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 11 | — | readProjectConventions(projectRoot) -- returns ConventionReport object describing discovered patterns |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/feature-aggregator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 32 | — | Parameters: prdContent (string) — raw PRD markdown. |
| 112 | — | Parameters: inventoryContent (string) — raw CODE-INVENTORY.md. |
| 158 | — | Parameters: acs (Array), openTodoAcIds (Set<string>). |
| 177 | — | Parameters: dependencies (Array<{from, to}>). |
| 213 | — | Parameters: enrichedAcs (Array), dependencies (Array), groups (string[]). |
| 345 | — | CLI entry: cmdAggregateFeatures(cwd, opts). |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/manifest-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 12 | — | generateManifest(packagePath, options) -- returns ManifestData object with exports, types, and description |
| 270 | — | generateAllManifests(rootPath, packages, options) -- writes markdown manifests to .planning/manifests/ and returns file paths |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-context.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 13 | — | resolveAppPlanningDir(rootPath, appRelativePath) -- returns absolute path to app-scoped .planning/ directory |
| 85 | — | buildMonorepoContext(rootPath, appRelativePath, options) -- returns MonorepoContext with local + global planning refs |
| 201 | — | scopeExtractTags(rootPath, appRelativePath, originalOpts) -- returns modified options for app-scoped tag extraction |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-migrator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 89 | — | auditAppPlanning(rootPath, apps) -- returns MigrationAudit describing existing .planning/ state across all apps |
| 157 | — | analyzeRootPlanning(rootPath) -- returns RootAnalysis classifying root .planning/ contents |
| 236 | — | executeAppMigration(rootPath, action) -- performs keep, archive, or replace on one app's .planning/ |
| 342 | — | regenerateScopedInventories(rootPath, apps) -- triggers extract-tags per app to produce scoped CODE-INVENTORY.md files |
| 396 | — | executeMigration(rootPath, apps, actions) -- runs all migration actions and returns aggregate results |
| 422 | — | formatAuditReport(audit) -- returns human-readable string summarizing the migration audit |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/session-manager.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 44 | — | getSession(rootPath) -- returns SessionData or null if no session file exists |
| 62 | — | getCurrentApp(rootPath) -- returns the current app path string or null (global/root scope) |
| 78 | — | resolveCurrentApp(rootPath, explicitApp) -- returns effective app path: explicit --app flag wins, then session, then null |
| 98 | — | setCurrentApp(rootPath, appPath, availableApps) -- writes SESSION.json with new current_app |
| 127 | — | clearSession(rootPath) -- removes SESSION.json entirely, resetting to no-session state |
| 146 | — | initSession(rootPath, workspaceInfo) -- creates initial SESSION.json from workspace detection results |
| 223 | — | isMonorepoSession(rootPath) -- returns true if a monorepo session is active |
| 235 | — | getAvailableApps(rootPath) -- returns cached list of app paths from session, or empty array |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/skeleton-generator.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 10 | — | generateSkeletonPlan(conventions, modules) -- returns SkeletonPlan with tree string and file list |
| 176 | — | Exports: generateSkeletonPlan, applyNamingConvention (for testing) |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/test-detector.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 9 | — | detectTestFramework(projectRoot: string) |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/workspace-detector.cjs

| Line | Metadata | Description |
|------|----------|-------------|
| 12 | — | detectWorkspace(projectRoot) -- returns WorkspaceInfo | null describing the monorepo type, apps, and packages |
| 319 | — | validateAppPath(workspace, appPath) -- returns {valid, resolved, error} for --app flag validation |

#### /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md

| Line | Metadata | Description |
|------|----------|-------------|
| 155 | — | — |
| 160 | — | POST /auth/token — body: {email, password} — returns: {token, expiresAt} or 401 on invalid credentials |
| 197 | — | POST /users — body: {email, password, name} — returns: {id, email, createdAt} or 400/409 |

## Phase Reference Index

| Phase | Tag Count | Files |
|-------|-----------|-------|
| 1 | 4 | /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/README.md, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md |
| 2 | 8 | /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/README.md, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/agents/gsd-arc-executor.md, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md |
| 3 | 2 | /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md |
| 11 | 2 | /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/skeleton-generator.cjs |
| 12 | 2 | /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/feature-aggregator.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/feature-aggregator.test.cjs |
| (untagged) | 348 | /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/README.md, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/agents/gsd-arc-executor.md, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/agents/gsd-tester.md, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/commands/gsd/prototype.md, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-feature-map.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-session.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs-v2.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-stack-docs.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner-v2.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/cap-tag-scanner.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/convention-reader.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/feature-aggregator.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/manifest-generator.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-context.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/monorepo-migrator.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/session-manager.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/skeleton-generator.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/test-detector.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/bin/lib/workspace-detector.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/get-shit-done/references/arc-standard.md, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-feature-map.test.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-session.test.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-stack-docs-v2.test.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-stack-docs.test.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-tag-scanner-v2.test.cjs, /Users/denniswall/Desktop/GSD-Code-FIrst/gsd-code-first/tests/cap-tag-scanner.test.cjs |
