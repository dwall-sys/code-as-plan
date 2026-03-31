# CAP v2.0 — Code as Plan

## Overview

CAP (Code as Plan) is a developer framework for Claude Code that implements the "Code-First" principle: developers build first, extract structured planning from annotated code, and iterate using a minimal set of agents and artifacts. CAP replaces the GSD (Get Shit Done) framework entirely — all GSD commands, agents, and artifacts are removed in a clean-break big-bang release.

**Philosophy:** Code is the plan. Build first, extract structure from annotated code, eliminate upfront document-heavy planning while maintaining traceability.

**Aligned with:** Dave Farley's "Modern Software Engineering" — optimize for learning and managing complexity through separation of concerns, loose coupling, cohesion, testability, and avoiding accidental complexity.

## Distribution

- **npm package name:** `cap` (fallback: `code-as-plan` if taken)
- **Install:** `npx cap@latest`
- **Command prefix:** `/cap:`
- **Agent prefix:** `cap-`

## Workflow

Five steps, linear by default, re-entrant by design:

```
brainstorm → prototype → iterate → test → review
```

This replaces the v1.x 9-step workflow (discuss → plan → execute → verify → review with sub-steps).

---

## Acceptance Criteria

### 1. Project Initialization (`/cap:init`)

- **AC-1:** `/cap:init` shall create `FEATURE-MAP.md` at the project root with an empty template containing section headers (Features, Legend) and no feature entries.
- **AC-2:** `/cap:init` shall create `.cap/SESSION.json` with a valid JSON structure containing at minimum `{ "active_feature": null, "step": null, "started_at": null }`.
- **AC-3:** `/cap:init` shall create `.cap/.gitignore` that ignores `SESSION.json` (ephemeral state shall not be committed).
- **AC-4:** `/cap:init` shall not prompt the user with questions, wizards, or configuration forms — it opens a door, it does not fill a form.
- **AC-5:** `/cap:init` shall complete in a single invocation with no follow-up steps required.
- **AC-6:** `/cap:init` shall be idempotent — running it on an already-initialized project shall not overwrite existing `FEATURE-MAP.md` content.

### 2. Feature Map (`FEATURE-MAP.md`)

- **AC-7:** The Feature Map shall be a single Markdown file at the project root named `FEATURE-MAP.md`.
- **AC-8:** Each feature entry shall contain: feature ID (e.g., `F-001`), title (verb + object format: "A user can [verb] [object]"), state, acceptance criteria, and file references.
- **AC-9:** Feature state shall follow the lifecycle: `planned → prototyped → tested → shipped`.
- **AC-10:** The Feature Map shall be the single source of truth for feature identity, state, acceptance criteria, and relationships — replacing ROADMAP.md, REQUIREMENTS.md, and CODE-INVENTORY.md.
- **AC-11:** The Feature Map shall support auto-derivation from brainstorm output — `cap-brainstormer` shall write feature entries directly to `FEATURE-MAP.md`.
- **AC-12:** The Feature Map shall support auto-enrichment from `@cap-feature` tags found in source code, linking file paths to feature IDs.
- **AC-13:** The Feature Map shall support auto-enrichment from dependency graph analysis (imports), environment variables, and `package.json` metadata.
- **AC-14:** The Feature Map shall scale to 80–120 features in a single file without requiring directory-based splitting.
- **AC-15:** Orphan tags (tags referencing a feature ID not in the Feature Map) shall be flagged with a fuzzy-match hint suggesting the closest existing feature ID, with the developer making the final decision.

### 3. Session State (`.cap/SESSION.json`)

- **AC-16:** `SESSION.json` shall track ephemeral workflow state: active feature ID, current workflow step, and session timestamps.
- **AC-17:** `SESSION.json` shall connect to `FEATURE-MAP.md` only via feature IDs (loose coupling).
- **AC-18:** `SESSION.json` shall not be committed to version control (enforced by `.cap/.gitignore`).
- **AC-19:** `SESSION.json` shall be the only mutable session artifact — no STATE.md, no MILESTONES.md, no PLAN.md.

### 4. Tag System

- **AC-20:** The primary tags shall be `@cap-feature` and `@cap-todo` — these are the mandatory, high-adoption tags.
- **AC-21:** `@cap-feature` shall associate a code location with a feature ID from the Feature Map (e.g., `@cap-feature F-001`).
- **AC-22:** `@cap-todo` shall support structured conventions as scannable subtypes: `@cap-todo risk:...`, `@cap-todo decision:...`, and plain `@cap-todo ...` for general items.
- **AC-23:** `@cap-risk` and `@cap-decision` shall be available as standalone optional tags but shall not be enforced or required.
- **AC-24:** The following v1.x tags shall be removed: `@gsd-status` (status lives in Feature Map), `@gsd-depends` (deps derived from import graph), `@gsd-context` (use normal comments).
- **AC-25:** The tag scanner shall use native `RegExp` with dotAll flag for multiline extraction — no external parser dependencies.
- **AC-26:** The tag scanner shall be language-agnostic, operating on comment syntax patterns across JavaScript, TypeScript, Python, Ruby, Shell, and other languages with `//`, `#`, `/* */`, or `""" """` comment styles.

### 5. `/cap:scan` Command

- **AC-27:** `/cap:scan` shall recursively walk the project tree, extract all `@cap-*` tags from source files, and produce a summary report.
- **AC-28:** `/cap:scan` shall use `fs.readdirSync` with recursive walk and extension filtering — no glob library dependency.
- **AC-29:** `/cap:scan` shall cross-reference found tags against `FEATURE-MAP.md` and flag orphan tags with fuzzy-match hints.
- **AC-30:** `/cap:scan` shall auto-enrich `FEATURE-MAP.md` with discovered file references, linking `@cap-feature` annotations to their feature entries.

### 6. `/cap:status` Command

- **AC-31:** `/cap:status` shall display the current session state from `SESSION.json` (active feature, current step, session duration).
- **AC-32:** `/cap:status` shall display a summary of `FEATURE-MAP.md` (count of features per state: planned, prototyped, tested, shipped).
- **AC-33:** `/cap:status` shall display tag coverage statistics (files with tags vs. total source files).

### 7. `/cap:start` Command

- **AC-34:** `/cap:start` shall initialize a session by setting the active feature in `SESSION.json` and restoring context from the Feature Map.
- **AC-35:** `/cap:start` shall auto-scope to the project by deriving project information from actual code (package.json, directory structure) rather than asking questions.

### 8. `/cap:brainstorm` Command and `cap-brainstormer` Agent

- **AC-36:** `/cap:brainstorm` shall invoke the `cap-brainstormer` agent for conversational feature discovery.
- **AC-37:** `cap-brainstormer` shall produce structured PRD output with numbered acceptance criteria.
- **AC-38:** `cap-brainstormer` shall write discovered features directly to `FEATURE-MAP.md` with state `planned`.
- **AC-39:** `cap-brainstormer` shall assign feature IDs in sequential format (`F-001`, `F-002`, ...).
- **AC-40:** `cap-brainstormer` output shall be directly consumable by `/cap:prototype` without manual translation.

### 9. `/cap:prototype` Command and `cap-prototyper` Agent

- **AC-41:** `/cap:prototype` shall invoke the `cap-prototyper` agent which operates in four modes: `prototype`, `iterate`, `architecture`, and `annotate`.
- **AC-42:** In `prototype` mode, the agent shall build a working prototype for a feature, annotating code with `@cap-feature` and `@cap-todo` tags as it builds.
- **AC-43:** In `iterate` mode, the agent shall refine an existing prototype based on feedback, updating tags and Feature Map state.
- **AC-44:** In `architecture` mode, the agent shall analyze and refactor system-level structure (module boundaries, dependency graph, shared abstractions) without changing feature behavior.
- **AC-45:** In `annotate` mode, the agent shall retroactively annotate existing code with `@cap-feature` and `@cap-todo` tags — primary use case is Brownfield project initialization.
- **AC-46:** `cap-prototyper` shall update the feature state in `FEATURE-MAP.md` from `planned` to `prototyped` upon completing a prototype.
- **AC-47:** `cap-prototyper` shall derive project context (language, framework, conventions) from actual code on first invocation — no upfront configuration required.
- **AC-48:** `cap-prototyper` shall follow deviation rules via a shared reference document to maintain consistency across modes.

### 10. `/cap:iterate` Command

- **AC-49:** `/cap:iterate` shall invoke `cap-prototyper` in `iterate` mode.
- **AC-50:** `/cap:iterate` shall support a `--auto` flag for multi-iteration autonomous loops.
- **AC-51:** `/cap:iterate` shall read the current feature from `SESSION.json` and refine the associated prototype.

### 11. `/cap:test` Command and `cap-tester` Agent

- **AC-52:** `/cap:test` shall invoke the `cap-tester` agent with a RED-GREEN discipline mindset.
- **AC-53:** `cap-tester` shall approach testing with a "how do I break this?" adversarial mindset — it is separated from the building agent by design (separation of concerns).
- **AC-54:** `cap-tester` shall write tests that verify the acceptance criteria from the Feature Map entry for the active feature.
- **AC-55:** `cap-tester` shall update the feature state in `FEATURE-MAP.md` from `prototyped` to `tested` when all tests pass.
- **AC-56:** `cap-tester` shall use `node:test` for CJS code and `vitest` for SDK TypeScript code — matching the existing test infrastructure.
- **AC-57:** Green tests shall replace the need for a separate VERIFICATION.md artifact.

### 12. `/cap:review` Command and `cap-reviewer` Agent

- **AC-58:** `/cap:review` shall invoke the `cap-reviewer` agent for two-stage review.
- **AC-59:** Stage 1: `cap-reviewer` shall verify that the implementation satisfies all acceptance criteria listed in the Feature Map entry for the feature under review.
- **AC-60:** Stage 2: `cap-reviewer` shall perform code quality review (naming, structure, complexity, test coverage, tag completeness).
- **AC-61:** `cap-reviewer` shall check that all code implementing the feature has appropriate `@cap-feature` annotations — flagging unannotated implementation files.
- **AC-62:** `cap-reviewer` shall update the feature state in `FEATURE-MAP.md` from `tested` to `shipped` upon passing both review stages.

### 13. `/cap:debug` Command and `cap-debugger` Agent

- **AC-63:** `/cap:debug` shall invoke the `cap-debugger` agent using a scientific method approach.
- **AC-64:** `cap-debugger` shall maintain persistent debug state (hypotheses, tests run, results) across the debug session.
- **AC-65:** `cap-debugger` shall follow a hypothesis → test → verify loop, documenting each step.
- **AC-66:** `cap-debugger` shall not modify production code without explicit developer approval.

### 14. Agent Architecture

- **AC-67:** The system shall have exactly 5 agents: `cap-brainstormer`, `cap-prototyper`, `cap-tester`, `cap-reviewer`, `cap-debugger`.
- **AC-68:** Each agent shall be defined as a Markdown file with Claude Code agent frontmatter (YAML) following the existing agent file format.
- **AC-69:** Agents shall not depend on each other's internals — communication happens only via shared artifacts (Feature Map, SESSION.json, code with tags).
- **AC-70:** Agents shall be placed in the `agents/` directory with `cap-` prefix naming.

### 15. GSD Removal (Clean Break)

- **AC-71:** All `/gsd:*` commands shall be removed from the codebase.
- **AC-72:** All `gsd-*` agent files shall be removed from the `agents/` directory.
- **AC-73:** The following agents are explicitly killed: `gsd-discuss`, `gsd-planner`, `gsd-milestone-*`, `gsd-executor`, `gsd-annotator`, and all discuss/plan phase agents.
- **AC-74:** The following artifacts shall no longer be created or referenced: `ROADMAP.md`, `REQUIREMENTS.md`, `STATE.md`, `MILESTONES.md`, `VERIFICATION.md`, `PLAN.md`.
- **AC-75:** `CODE-INVENTORY.md` functionality shall be evolved into the enriched `FEATURE-MAP.md` — the standalone file is removed.
- **AC-76:** The `bin/install.js` entry point shall be updated to reference CAP branding and commands.
- **AC-77:** `package.json` name shall be updated to `cap` (or `code-as-plan` fallback).

### 16. Monorepo Support

- **AC-78:** CAP shall be deeply integrated with monorepo workflows — `/cap:scan` shall traverse all packages in a monorepo.
- **AC-79:** Feature Map entries shall support cross-package file references (e.g., `packages/core/src/auth.ts`).
- **AC-80:** CAP shall also work seamlessly with normal single-repo projects with no monorepo-specific configuration required.

### 17. Context7 Integration (Mandatory Stack Documentation)

- **AC-81:** Upon `/cap:init` on an existing project, the system shall automatically detect all dependencies from package.json / requirements.txt / Cargo.toml / go.mod and fetch current documentation for each recognized library via Context7.
- **AC-82:** Fetched stack documentation shall be stored in `.cap/stack-docs/{library-name}.md` — compressed to API surface, configuration, and breaking changes (not full documentation).
- **AC-83:** Agents shall receive `.cap/stack-docs/` as context input on every invocation. When an agent references a library not yet in stack-docs, Context7 shall be invoked on-demand to fetch it.
- **AC-84:** Stack-docs shall carry a freshness marker (fetch date). Upon `/cap:init`, docs older than 7 days shall be automatically refreshed. Manual refresh available via `/cap:refresh-docs`.
- **AC-85:** Context7 fetching is MANDATORY at init — not optional. If Context7 is unreachable, a warning shall be emitted and init shall continue, but agent context shall contain an explicit marker: "Stack docs unavailable — elevated risk of outdated API information."

### 18. Brownfield Project Initialization

- **AC-86:** `/cap:init` on a project with existing code shall perform a one-time codebase analysis: architecture detection (layers, modules, entry points), convention detection (via convention-reader), test setup detection (via test-detector).
- **AC-87:** The brownfield analysis result shall NOT be persisted as a separate document. It shall be used as initialization context for the subsequent `/cap:annotate` suggestion. The permanent truth lives in `@cap-*` tags in code, not in analysis documents.
- **AC-88:** After brownfield init, the system shall suggest `/cap:annotate` to retroactively annotate existing code with `@cap-feature` and `@cap-todo` tags. The codebase analysis serves as input for the annotate mode.
- **AC-89:** `/cap:annotate` shall invoke `cap-prototyper` in `annotate` mode.

### 19. No Separate Map Command

- **AC-90:** CAP shall NOT offer a `/cap:map` command. Codebase analysis is part of `/cap:init` (brownfield), and afterward all information lives in code annotations, convention-reader output, test-detector output, and stack-docs.
- **AC-91:** To refresh codebase information, the path is: `/cap:annotate` (update tags) + `/cap:refresh-docs` (update stack docs). No monolithic re-scan needed.
- **AC-92:** The 7 documents from `.planning/codebase/` (STACK.md, INTEGRATIONS.md, ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md) shall NOT be generated in v2.0. Their information is covered by: stack-docs (STACK, INTEGRATIONS), convention-reader (CONVENTIONS), test-detector (TESTING), `@cap-todo decision:` tags (ARCHITECTURE, STRUCTURE), `@cap-todo risk:` tags (CONCERNS).

### 20. Zero Runtime Dependencies

- **AC-93:** The distributed package shall have zero runtime dependencies — all functionality implemented with Node.js built-ins.
- **AC-94:** The tag scanner shall use native `RegExp` — no `comment-parser` or AST parser libraries.
- **AC-95:** File discovery shall use `fs.readdirSync` with recursive walk — no `glob` library.
- **AC-96:** CLI argument parsing shall use the existing `parseNamedArgs()` pattern — no `commander`, `yargs`, or `oclif`.

### 21. Build and Distribution

- **AC-97:** The package shall be installable via `npx cap@latest` (or `npx code-as-plan@latest`).
- **AC-98:** The build shall use `esbuild` for bundling hooks, following the existing `scripts/build-hooks.js` pattern.
- **AC-99:** The `npm files` array shall include: `bin`, `commands`, `agents`, `hooks/dist`, `scripts`, and any new directories.

### 22. Testing Infrastructure

- **AC-100:** All CJS code shall be tested with `node:test` and `node:assert` — matching the existing test pattern.
- **AC-101:** SDK TypeScript code shall be tested with `vitest` — scoped via `vitest.config.ts`.
- **AC-102:** Coverage shall be measured with `c8` with a minimum 70% line coverage threshold.

---

## Out of Scope

- GUI or web dashboard for Feature Map visualization
- Integration with external project management tools (Jira, Linear, Asana)
- Multi-user collaboration features (CAP is a single-developer workflow tool)
- Language-specific AST parsing (tag scanner is regex-based, language-agnostic)
- Directory-based Feature Map splitting (single file scales to 120 features; splitting is deferred)
- Backward compatibility with GSD commands or artifacts
- AI orchestration frameworks (mastra, kaibanjs) — Claude Code native agent spawning is used
- Third-party CLI frameworks (commander, yargs, oclif) — existing parseNamedArgs() pattern is sufficient
- Markdown parsing libraries (marked, markdown-it) — Feature Map is generated via string templates, not parsed

## Technical Notes

- **Node.js minimum:** >=20.0.0
- **Tag regex pattern:** `@cap-(feature|todo|risk|decision)\s+(.+?)` with dotAll flag for multiline block comments
- **Feature ID format:** `F-NNN` (zero-padded three digits, e.g., `F-001`)
- **Feature state machine:** `planned → prototyped → tested → shipped` (no backward transitions in normal workflow; manual override allowed)
- **SESSION.json schema:** `{ "active_feature": "F-001" | null, "step": "brainstorm" | "prototype" | "iterate" | "test" | "review" | null, "started_at": ISO8601 | null }`
- **Agent file format:** Markdown with YAML frontmatter, placed in `agents/` directory
- **Stack-docs location:** `.cap/stack-docs/{library-name}.md` — auto-generated via Context7, refreshed every 7 days or on demand
- **Farley principles enforcement:** Separation of concerns (Feature Map owns state, SESSION.json owns workflow, code owns annotations), loose coupling (feature ID is the only shared key), cohesion (related info co-located), testability as design driver
