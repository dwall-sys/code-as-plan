## Project

**CAP — Code as Plan**

A developer framework for Claude Code that implements the "Code-First" principle. Developers build first, extract structured planning from annotated code, and iterate using a minimal set of agents and artifacts. Installable as `npx code-as-plan@latest`.

**Core Value:** Code is the plan — build first, extract structure from annotated code, eliminate upfront document-heavy planning while maintaining traceability.

**Aligned with:** Dave Farley's "Modern Software Engineering" — optimize for learning and managing complexity.

### Constraints

- **Tech stack**: JavaScript/Node.js (CJS), Markdown, JSON
- **Distribution**: Installable via `npx code-as-plan@latest`
- **Zero runtime deps**: No external npm packages at runtime
- **Node.js minimum**: >=20.0.0

## Workflow

Five steps, linear by default, re-entrant by design:

```
brainstorm → prototype → iterate → test → review
```

### Auto-Workflow (when to use slash commands vs. just-do-it)

CAP's per-feature commands (`brainstorm`, `prototype`, `iterate`, `test`, `review`) exist as **explicit power-user triggers**. In normal use you do **not** need to type them — Claude should recognize the workflow moment and invoke the right Skill (or just do the work directly) without being asked. The Skill descriptions are written to be auto-trigger-friendly.

**Auto-trigger contract — Claude SHOULD invoke the matching Skill when:**

| Situation | Auto-action |
|-----------|-------------|
| User describes a new feature without a FEATURE-MAP.md entry yet ("we need X", "let's add Y") | Invoke `cap:brainstorm` Skill — produces structured ACs |
| FEATURE-MAP.md has an entry in state `planned` and user says "build / implement / start coding it" | Invoke `cap:prototype` Skill — Code-First with @cap-* tags |
| Feature in state `prototyped` with open `@cap-todo` tags, user says "iterate / refine / keep going" | Invoke `cap:iterate` Skill — loop until ACs satisfied |
| Feature in state `prototyped`, code in place but not yet `tested` | Invoke `cap:test` Skill — RED-GREEN, framework auto-detected |
| Feature in state `tested`, user says "review / ready to ship / final check" | Invoke `cap:review` Skill — two-stage AC + quality |
| User reports a bug, error, or "this works locally but not in prod" | Invoke `cap:debug` Skill — hypothesis logbook with persistent state |
| User asks for project status, wants to see the dashboard, or asks "where are we?" | Invoke `cap:status` (or spawn `cap-curator` MODE: STATUS) |

**Auto-trigger contract — Claude should NOT invoke a Skill when:**
- The change is a one-line edit, typo, or trivial refactor — just do it
- The user explicitly says "don't use cap" or "just write it directly"
- The work is exploratory and not yet ready for FEATURE-MAP.md (decide first whether brainstorm is warranted)
- Inside another agent's context (subagents shouldn't recursively spawn each other)

**Macro-workflow agents (project-wide)** are spawned via `Task()` when you need a step back, never by the user typing slash commands. Auto-invoke when:

| Situation | Macro-agent |
|-----------|-------------|
| User asks "how is the architecture", "what should we refactor", "is module X bloated" | `cap-architect` (audit / refactor / boundaries) |
| User wants a stakeholder-readable summary or a non-technical project overview | `cap-curator` MODE: REPORT (writes `.cap/REPORT.md`) |
| Before a risky pivot or experiment, or when user says "let me try a different approach" | `cap-historian` MODE: FORK |
| At the start of a session, or when user says "where were we" | `cap-historian` MODE: CONTINUE on the latest snapshot |
| Migration request (GSD→CAP, V5→V6, monolithic→sharded, fragmented→unified anchors) | `cap-migrator` (always plan→diff→apply→verify with rollback) |

### Commands

| Command | What it does |
|---------|-------------|
| `/cap:init` | Initialize project — creates FEATURE-MAP.md + .cap/ |
| `/cap:brainstorm` | Conversational feature discovery → Feature Map |
| `/cap:prototype` | Build code for a feature (4 modes: prototype/iterate/architecture/annotate) |
| `/cap:iterate` | Refine existing prototype based on feedback |
| `/cap:test` | RED-GREEN adversarial testing against Feature Map ACs |
| `/cap:review` | Two-stage review: spec compliance + code quality |
| `/cap:debug` | Scientific method debugging with persistent state |
| `/cap:scan` | Tag scanner — extract @cap-* tags, find orphans, enrich Feature Map |
| `/cap:status` | Show session state + Feature Map summary |
| `/cap:start` | Initialize session, select active feature |
| `/cap:annotate` | Retroactively annotate existing code with @cap-* tags |
| `/cap:migrate-feature-map` | Shard a monolithic FEATURE-MAP.md into Index + Per-Feature Files (F-089) |

> Setup, install, update, and upgrade procedures (formerly `/cap:doctor`, `/cap:update`, `/cap:upgrade`) live in [`docs/setup-and-upgrade.md`](docs/setup-and-upgrade.md). The `/cap:refresh-docs`, `/cap:report`, `/cap:cluster`, `/cap:switch-app`, `/cap:quick`, and `/cap:finalize` commands have been retired in favor of native Claude features, `/cap:start --app=`, `/cap:memory status`, and `/loop`-based composition.

### Agents (9 active)

**Per-feature (micro-workflow):**
- `cap-brainstormer` — conversational feature discovery
- `cap-prototyper` — 4 modes: prototype, iterate, architecture, annotate
- `cap-designer` — 9-family aesthetic system, anti-slop review
- `cap-validator` — 3 modes: test (RED-GREEN), review (Stage 1+2 AC + code quality), audit (F-048 completeness score)
- `cap-debugger` — scientific method, persistent state

**Project-wide (macro-workflow, introduced in iteration/cap-pro-1):**
- `cap-historian` — 3 modes: save (snapshot + JSONL index), continue (mtime-diff + targeted re-read), fork (branch-point with divergence rationale)
- `cap-curator` — 5 read-only modes: status, report, clusters, learn-board, drift (single dashboard agent; only mutates `.cap/REPORT.md`)
- `cap-architect` — 3 read-only modes: audit (system review), refactor (per-module proposals), boundaries (feature-group API contracts). No auto-apply
- `cap-migrator` — 4 modes (gsd / tags / feature-map / memory) behind a unified plan → diff → apply → verify pipeline with atomic backup + rollback under `.cap/migrations/<id>/`

> The legacy `cap-tester` and `cap-reviewer` agents were removed in `iteration/cap-pro-4` — both responsibilities are consolidated into `cap-validator` (use `MODE: TEST` and `MODE: REVIEW`).

### Tag System

- **Primary (mandatory):** `@cap-feature`, `@cap-todo`
- **Subtypes:** `@cap-todo risk:...`, `@cap-todo decision:...`
- **Optional:** `@cap-risk`, `@cap-decision`

### Key Artifacts

- `FEATURE-MAP.md` — single source of truth (replaces roadmap + requirements)
- `.cap/SESSION.json` — ephemeral workflow state (gitignored)
- `.cap/stack-docs/` — Context7-generated library documentation

## Technology Stack

| Layer | Technology | Pattern |
|-------|-----------|---------|
| Runtime | Node.js built-ins (fs, path, crypto) | Zero external deps |
| Tag scanner | Native RegExp with dotAll flag | Language-agnostic |
| Agents | Markdown with YAML frontmatter | `agents/cap-*.md` |
| Commands | Markdown orchestrators | `commands/cap/*.md` |
| CJS utilities | CommonJS modules | `cap/bin/lib/cap-*.cjs` |
| Tests (CJS) | `node:test` + `node:assert` | `tests/cap-*.test.cjs` |
| Tests (SDK) | vitest | `sdk/src/**/*.test.ts` |
| Coverage | c8 (70% line minimum) | `npm run test:coverage` |
| Build | esbuild | `scripts/build-hooks.js` |

## Conventions

- CJS modules use `'use strict'`, JSDoc typedefs, `node:` prefix imports
- Agent/command files use Claude Code YAML frontmatter
- Feature IDs:
  - Single-app projects: `F-NNN` (zero-padded, e.g., `F-001`) — CAP repo itself uses this form
  - Monorepo apps (recommended for new features in apps/*): `F-<App>-<Slug>` (e.g., `F-Hub-Spotlight-Carousel`) — descriptive IDs give context without loading the feature block
  - Both forms coexist permanently; a project may mix them
- Feature state lifecycle: `planned → prototyped → tested → shipped`
- File naming: kebab-case with `cap-` prefix for new modules

## Feature Map Layout

CAP supports two layouts for `FEATURE-MAP.md`:

- **Monolithic (legacy)** — single file with all feature blocks. Simple, works fine up to ~80 features.
- **Sharded (F-089)** — `FEATURE-MAP.md` becomes a thin index (one line per feature: `id | state | title`); each feature lives in its own `features/<ID>.md` file. Recommended at scale: agent reads consume just the index plus the active feature, typically a 10–50× token reduction.

To migrate a monolithic map to sharded layout: `/cap:migrate-feature-map --apply` (dry-run by default, byte-lossless extraction, automatic backup). All CAP read/write APIs detect the layout transparently — no other code changes needed.

## Architecture

- `cap/bin/lib/cap-tag-scanner.cjs` — regex tag extraction + monorepo scanning
- `cap/bin/lib/cap-feature-map.cjs` — Feature Map read/write/enrich
- `cap/bin/lib/cap-session.cjs` — session state management
- `cap/bin/lib/cap-stack-docs.cjs` — Context7 integration wrapper
- Communication between agents only via shared artifacts (Feature Map, SESSION.json, code tags)
- Feature ID is the only shared key between Feature Map and SESSION.json (loose coupling)
