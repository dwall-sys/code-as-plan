# FEATURES.md

> **This file is auto-generated. Do not edit manually.**
> **Last updated:** 2026-03-31T11:56:47.331Z
> **Source hash:** 44c980638b88
> **Sources:** PRD.md

## Overall Progress

| Metric | Value |
|--------|-------|
| Total ACs | 102 |
| Done | 65 |
| Open | 37 |
| Completion | 64% |

## Features by Group

### 1. Project Initialization (`/cap:init`)

**Progress:** 0/6 (0%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-1 | OPEN | ** `/cap:init` shall create `FEATURE-MAP.md` at the project root with an empty template containing section headers (Features, Legend) and no feature entries. | PRD.md |
| AC-2 | OPEN | ** `/cap:init` shall create `.cap/SESSION.json` with a valid JSON structure containing at minimum `{ "active_feature": null, "step": null, "started_at": null }`. | PRD.md |
| AC-3 | OPEN | ** `/cap:init` shall create `.cap/.gitignore` that ignores `SESSION.json` (ephemeral state shall not be committed). | PRD.md |
| AC-4 | OPEN | ** `/cap:init` shall not prompt the user with questions, wizards, or configuration forms — it opens a door, it does not fill a form. | PRD.md |
| AC-5 | OPEN | ** `/cap:init` shall complete in a single invocation with no follow-up steps required. | PRD.md |
| AC-6 | OPEN | ** `/cap:init` shall be idempotent — running it on an already-initialized project shall not overwrite existing `FEATURE-MAP.md` content. | PRD.md |

### 2. Feature Map (`FEATURE-MAP.md`)

**Progress:** 0/9 (0%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-7 | OPEN | ** The Feature Map shall be a single Markdown file at the project root named `FEATURE-MAP.md`. | PRD.md |
| AC-8 | OPEN | ** Each feature entry shall contain: feature ID (e.g., `F-001`), title (verb + object format: "A user can [verb] [object]"), state, acceptance criteria, and file references. | PRD.md |
| AC-9 | OPEN | ** Feature state shall follow the lifecycle: `planned → prototyped → tested → shipped`. | PRD.md |
| AC-10 | OPEN | ** The Feature Map shall be the single source of truth for feature identity, state, acceptance criteria, and relationships — replacing ROADMAP.md, REQUIREMENTS.md, and CODE-INVENTORY.md. | PRD.md |
| AC-11 | OPEN | ** The Feature Map shall support auto-derivation from brainstorm output — `cap-brainstormer` shall write feature entries directly to `FEATURE-MAP.md`. | PRD.md |
| AC-12 | OPEN | ** The Feature Map shall support auto-enrichment from `@cap-feature` tags found in source code, linking file paths to feature IDs. | PRD.md |
| AC-13 | OPEN | ** The Feature Map shall support auto-enrichment from dependency graph analysis (imports), environment variables, and `package.json` metadata. | PRD.md |
| AC-14 | OPEN | ** The Feature Map shall scale to 80–120 features in a single file without requiring directory-based splitting. | PRD.md |
| AC-15 | OPEN | ** Orphan tags (tags referencing a feature ID not in the Feature Map) shall be flagged with a fuzzy-match hint suggesting the closest existing feature ID, with the developer making the final decision. | PRD.md |

### 3. Session State (`.cap/SESSION.json`)

**Progress:** 0/4 (0%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-16 | OPEN | ** `SESSION.json` shall track ephemeral workflow state: active feature ID, current workflow step, and session timestamps. | PRD.md |
| AC-17 | OPEN | ** `SESSION.json` shall connect to `FEATURE-MAP.md` only via feature IDs (loose coupling). | PRD.md |
| AC-18 | OPEN | ** `SESSION.json` shall not be committed to version control (enforced by `.cap/.gitignore`). | PRD.md |
| AC-19 | OPEN | ** `SESSION.json` shall be the only mutable session artifact — no STATE.md, no MILESTONES.md, no PLAN.md. | PRD.md |

### 4. Tag System

**Progress:** 2/7 (29%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-20 | OPEN | ** The primary tags shall be `@cap-feature` and `@cap-todo` — these are the mandatory, high-adoption tags. | PRD.md |
| AC-21 | DONE | ** `@cap-feature` shall associate a code location with a feature ID from the Feature Map (e.g., `@cap-feature F-001`). | PRD.md |
| AC-22 | OPEN | ** `@cap-todo` shall support structured conventions as scannable subtypes: `@cap-todo risk:...`, `@cap-todo decision:...`, and plain `@cap-todo ...` for general items. | PRD.md |
| AC-23 | OPEN | ** `@cap-risk` and `@cap-decision` shall be available as standalone optional tags but shall not be enforced or required. | PRD.md |
| AC-24 | DONE | ** The following v1.x tags shall be removed: `@gsd-status` (status lives in Feature Map), `@gsd-depends` (deps derived from import graph), `@gsd-context` (use normal comments). | PRD.md |
| AC-25 | OPEN | ** The tag scanner shall use native `RegExp` with dotAll flag for multiline extraction — no external parser dependencies. | PRD.md |
| AC-26 | OPEN | ** The tag scanner shall be language-agnostic, operating on comment syntax patterns across JavaScript, TypeScript, Python, Ruby, Shell, and other languages with `//`, `#`, `/* */`, or `""" """` comment styles. | PRD.md |

### 5. `/cap:scan` Command

**Progress:** 3/4 (75%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-27 | OPEN | ** `/cap:scan` shall recursively walk the project tree, extract all `@cap-*` tags from source files, and produce a summary report. | PRD.md |
| AC-28 | DONE | ** `/cap:scan` shall use `fs.readdirSync` with recursive walk and extension filtering — no glob library dependency. | PRD.md |
| AC-29 | DONE | ** `/cap:scan` shall cross-reference found tags against `FEATURE-MAP.md` and flag orphan tags with fuzzy-match hints. | PRD.md |
| AC-30 | DONE | ** `/cap:scan` shall auto-enrich `FEATURE-MAP.md` with discovered file references, linking `@cap-feature` annotations to their feature entries. | PRD.md |

### 6. `/cap:status` Command

**Progress:** 3/3 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-31 | DONE | ** `/cap:status` shall display the current session state from `SESSION.json` (active feature, current step, session duration). | PRD.md |
| AC-32 | DONE | ** `/cap:status` shall display a summary of `FEATURE-MAP.md` (count of features per state: planned, prototyped, tested, shipped). | PRD.md |
| AC-33 | DONE | ** `/cap:status` shall display tag coverage statistics (files with tags vs. total source files). | PRD.md |

### 7. `/cap:start` Command

**Progress:** 2/2 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-34 | DONE | ** `/cap:start` shall initialize a session by setting the active feature in `SESSION.json` and restoring context from the Feature Map. | PRD.md |
| AC-35 | DONE | ** `/cap:start` shall auto-scope to the project by deriving project information from actual code (package.json, directory structure) rather than asking questions. | PRD.md |

### 8. `/cap:brainstorm` Command and `cap-brainstormer` Agent

**Progress:** 5/5 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-36 | DONE | ** `/cap:brainstorm` shall invoke the `cap-brainstormer` agent for conversational feature discovery. | PRD.md |
| AC-37 | DONE | ** `cap-brainstormer` shall produce structured PRD output with numbered acceptance criteria. | PRD.md |
| AC-38 | DONE | ** `cap-brainstormer` shall write discovered features directly to `FEATURE-MAP.md` with state `planned`. | PRD.md |
| AC-39 | DONE | ** `cap-brainstormer` shall assign feature IDs in sequential format (`F-001`, `F-002`, ...). | PRD.md |
| AC-40 | DONE | ** `cap-brainstormer` output shall be directly consumable by `/cap:prototype` without manual translation. | PRD.md |

### 9. `/cap:prototype` Command and `cap-prototyper` Agent

**Progress:** 8/8 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-41 | DONE | ** `/cap:prototype` shall invoke the `cap-prototyper` agent which operates in four modes: `prototype`, `iterate`, `architecture`, and `annotate`. | PRD.md |
| AC-42 | DONE | ** In `prototype` mode, the agent shall build a working prototype for a feature, annotating code with `@cap-feature` and `@cap-todo` tags as it builds. | PRD.md |
| AC-43 | DONE | ** In `iterate` mode, the agent shall refine an existing prototype based on feedback, updating tags and Feature Map state. | PRD.md |
| AC-44 | DONE | ** In `architecture` mode, the agent shall analyze and refactor system-level structure (module boundaries, dependency graph, shared abstractions) without changing feature behavior. | PRD.md |
| AC-45 | DONE | ** In `annotate` mode, the agent shall retroactively annotate existing code with `@cap-feature` and `@cap-todo` tags — primary use case is Brownfield project initialization. | PRD.md |
| AC-46 | DONE | ** `cap-prototyper` shall update the feature state in `FEATURE-MAP.md` from `planned` to `prototyped` upon completing a prototype. | PRD.md |
| AC-47 | DONE | ** `cap-prototyper` shall derive project context (language, framework, conventions) from actual code on first invocation — no upfront configuration required. | PRD.md |
| AC-48 | DONE | ** `cap-prototyper` shall follow deviation rules via a shared reference document to maintain consistency across modes. | PRD.md |

### 10. `/cap:iterate` Command

**Progress:** 3/3 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-49 | DONE | ** `/cap:iterate` shall invoke `cap-prototyper` in `iterate` mode. | PRD.md |
| AC-50 | DONE | ** `/cap:iterate` shall support a `--auto` flag for multi-iteration autonomous loops. | PRD.md |
| AC-51 | DONE | ** `/cap:iterate` shall read the current feature from `SESSION.json` and refine the associated prototype. | PRD.md |

### 11. `/cap:test` Command and `cap-tester` Agent

**Progress:** 6/6 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-52 | DONE | ** `/cap:test` shall invoke the `cap-tester` agent with a RED-GREEN discipline mindset. | PRD.md |
| AC-53 | DONE | ** `cap-tester` shall approach testing with a "how do I break this?" adversarial mindset — it is separated from the building agent by design (separation of concerns). | PRD.md |
| AC-54 | DONE | ** `cap-tester` shall write tests that verify the acceptance criteria from the Feature Map entry for the active feature. | PRD.md |
| AC-55 | DONE | ** `cap-tester` shall update the feature state in `FEATURE-MAP.md` from `prototyped` to `tested` when all tests pass. | PRD.md |
| AC-56 | DONE | ** `cap-tester` shall use `node:test` for CJS code and `vitest` for SDK TypeScript code — matching the existing test infrastructure. | PRD.md |
| AC-57 | DONE | ** Green tests shall replace the need for a separate VERIFICATION.md artifact. | PRD.md |

### 12. `/cap:review` Command and `cap-reviewer` Agent

**Progress:** 5/5 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-58 | DONE | ** `/cap:review` shall invoke the `cap-reviewer` agent for two-stage review. | PRD.md |
| AC-59 | DONE | ** Stage 1: `cap-reviewer` shall verify that the implementation satisfies all acceptance criteria listed in the Feature Map entry for the feature under review. | PRD.md |
| AC-60 | DONE | ** Stage 2: `cap-reviewer` shall perform code quality review (naming, structure, complexity, test coverage, tag completeness). | PRD.md |
| AC-61 | DONE | ** `cap-reviewer` shall check that all code implementing the feature has appropriate `@cap-feature` annotations — flagging unannotated implementation files. | PRD.md |
| AC-62 | DONE | ** `cap-reviewer` shall update the feature state in `FEATURE-MAP.md` from `tested` to `shipped` upon passing both review stages. | PRD.md |

### 13. `/cap:debug` Command and `cap-debugger` Agent

**Progress:** 4/4 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-63 | DONE | ** `/cap:debug` shall invoke the `cap-debugger` agent using a scientific method approach. | PRD.md |
| AC-64 | DONE | ** `cap-debugger` shall maintain persistent debug state (hypotheses, tests run, results) across the debug session. | PRD.md |
| AC-65 | DONE | ** `cap-debugger` shall follow a hypothesis → test → verify loop, documenting each step. | PRD.md |
| AC-66 | DONE | ** `cap-debugger` shall not modify production code without explicit developer approval. | PRD.md |

### 14. Agent Architecture

**Progress:** 4/4 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-67 | DONE | ** The system shall have exactly 5 agents: `cap-brainstormer`, `cap-prototyper`, `cap-tester`, `cap-reviewer`, `cap-debugger`. | PRD.md |
| AC-68 | DONE | ** Each agent shall be defined as a Markdown file with Claude Code agent frontmatter (YAML) following the existing agent file format. | PRD.md |
| AC-69 | DONE | ** Agents shall not depend on each other's internals — communication happens only via shared artifacts (Feature Map, SESSION.json, code with tags). | PRD.md |
| AC-70 | DONE | ** Agents shall be placed in the `agents/` directory with `cap-` prefix naming. | PRD.md |

### 15. GSD Removal (Clean Break)

**Progress:** 7/7 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-71 | DONE | ** All `/gsd:*` commands shall be removed from the codebase. | PRD.md |
| AC-72 | DONE | ** All `gsd-*` agent files shall be removed from the `agents/` directory. | PRD.md |
| AC-73 | DONE | ** The following agents are explicitly killed: `gsd-discuss`, `gsd-planner`, `gsd-milestone-*`, `gsd-executor`, `gsd-annotator`, and all discuss/plan phase agents. | PRD.md |
| AC-74 | DONE | ** The following artifacts shall no longer be created or referenced: `ROADMAP.md`, `REQUIREMENTS.md`, `STATE.md`, `MILESTONES.md`, `VERIFICATION.md`, `PLAN.md`. | PRD.md |
| AC-75 | DONE | ** `CODE-INVENTORY.md` functionality shall be evolved into the enriched `FEATURE-MAP.md` — the standalone file is removed. | PRD.md |
| AC-76 | DONE | ** The `bin/install.js` entry point shall be updated to reference CAP branding and commands. | PRD.md |
| AC-77 | DONE | ** `package.json` name shall be updated to `cap` (or `code-as-plan` fallback). | PRD.md |

### 16. Monorepo Support

**Progress:** 0/3 (0%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-78 | OPEN | ** CAP shall be deeply integrated with monorepo workflows — `/cap:scan` shall traverse all packages in a monorepo. | PRD.md |
| AC-79 | OPEN | ** Feature Map entries shall support cross-package file references (e.g., `packages/core/src/auth.ts`). | PRD.md |
| AC-80 | OPEN | ** CAP shall also work seamlessly with normal single-repo projects with no monorepo-specific configuration required. | PRD.md |

### 17. Context7 Integration (Mandatory Stack Documentation)

**Progress:** 1/5 (20%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-81 | OPEN | ** Upon `/cap:init` on an existing project, the system shall automatically detect all dependencies from package.json / requirements.txt / Cargo.toml / go.mod and fetch current documentation for each recognized library via Context7. | PRD.md |
| AC-82 | OPEN | ** Fetched stack documentation shall be stored in `.cap/stack-docs/{library-name}.md` — compressed to API surface, configuration, and breaking changes (not full documentation). | PRD.md |
| AC-83 | DONE | ** Agents shall receive `.cap/stack-docs/` as context input on every invocation. When an agent references a library not yet in stack-docs, Context7 shall be invoked on-demand to fetch it. | PRD.md |
| AC-84 | OPEN | ** Stack-docs shall carry a freshness marker (fetch date). Upon `/cap:init`, docs older than 7 days shall be automatically refreshed. Manual refresh available via `/cap:refresh-docs`. | PRD.md |
| AC-85 | OPEN | ** Context7 fetching is MANDATORY at init — not optional. If Context7 is unreachable, a warning shall be emitted and init shall continue, but agent context shall contain an explicit marker: "Stack docs unavailable — elevated risk of outdated API information." | PRD.md |

### 18. Brownfield Project Initialization

**Progress:** 4/4 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-86 | DONE | ** `/cap:init` on a project with existing code shall perform a one-time codebase analysis: architecture detection (layers, modules, entry points), convention detection (via convention-reader), test setup detection (via test-detector). | PRD.md |
| AC-87 | DONE | ** The brownfield analysis result shall NOT be persisted as a separate document. It shall be used as initialization context for the subsequent `/cap:annotate` suggestion. The permanent truth lives in `@cap-*` tags in code, not in analysis documents. | PRD.md |
| AC-88 | DONE | ** After brownfield init, the system shall suggest `/cap:annotate` to retroactively annotate existing code with `@cap-feature` and `@cap-todo` tags. The codebase analysis serves as input for the annotate mode. | PRD.md |
| AC-89 | DONE | ** `/cap:annotate` shall invoke `cap-prototyper` in `annotate` mode. | PRD.md |

### 19. No Separate Map Command

**Progress:** 3/3 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-90 | DONE | ** CAP shall NOT offer a `/cap:map` command. Codebase analysis is part of `/cap:init` (brownfield), and afterward all information lives in code annotations, convention-reader output, test-detector output, and stack-docs. | PRD.md |
| AC-91 | DONE | ** To refresh codebase information, the path is: `/cap:annotate` (update tags) + `/cap:refresh-docs` (update stack docs). No monolithic re-scan needed. | PRD.md |
| AC-92 | DONE | ** The 7 documents from `.planning/codebase/` (STACK.md, INTEGRATIONS.md, ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md) shall NOT be generated in v2.0. Their information is covered by: stack-docs (STACK, INTEGRATIONS), convention-reader (CONVENTIONS), test-detector (TESTING), `@cap-todo decision:` tags (ARCHITECTURE, STRUCTURE), `@cap-todo risk:` tags (CONCERNS). | PRD.md |

### 20. Zero Runtime Dependencies

**Progress:** 0/4 (0%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-93 | OPEN | ** The distributed package shall have zero runtime dependencies — all functionality implemented with Node.js built-ins. | PRD.md |
| AC-94 | OPEN | ** The tag scanner shall use native `RegExp` — no `comment-parser` or AST parser libraries. | PRD.md |
| AC-95 | OPEN | ** File discovery shall use `fs.readdirSync` with recursive walk — no `glob` library. | PRD.md |
| AC-96 | OPEN | ** CLI argument parsing shall use the existing `parseNamedArgs()` pattern — no `commander`, `yargs`, or `oclif`. | PRD.md |

### 21. Build and Distribution

**Progress:** 3/3 (100%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-97 | DONE | ** The package shall be installable via `npx cap@latest` (or `npx code-as-plan@latest`). | PRD.md |
| AC-98 | DONE | ** The build shall use `esbuild` for bundling hooks, following the existing `scripts/build-hooks.js` pattern. | PRD.md |
| AC-99 | DONE | ** The `npm files` array shall include: `bin`, `commands`, `agents`, `hooks/dist`, `scripts`, and any new directories. | PRD.md |

### 22. Testing Infrastructure

**Progress:** 2/3 (67%)

| AC | Status | Description | Source |
|----|--------|-------------|--------|
| AC-100 | OPEN | ** All CJS code shall be tested with `node:test` and `node:assert` — matching the existing test pattern. | PRD.md |
| AC-101 | DONE | ** SDK TypeScript code shall be tested with `vitest` — scoped via `vitest.config.ts`. | PRD.md |
| AC-102 | DONE | ** Coverage shall be measured with `c8` with a minimum 70% line coverage threshold. | PRD.md |

## Dependencies

No cross-feature dependencies documented.

---
*Generated by feature-aggregator.cjs via `aggregate-features` subcommand.*
*Regenerated automatically on every `extract-tags` run.*
