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
- **The user is in a UI/design iteration sprint** — see "Frontend Sprint Pattern" below

### Frontend Sprint Pattern (Phase-1 / Phase-2)

UI work has a different shape than backend work: dozens of fast tweaks (padding, color, spacing, copy) where the agent ceremony costs more than the edit itself. The replacement for the retired `/cap:quick + /cap:finalize` is an auto-recognized two-phase pattern — no slash command needed.

**Phase 1 — Free Edit Sprint** (recognize and stay out of the way):

Trigger signals (ANY of):
- File path is `*.tsx`, `*.jsx`, `*.css`, `*.scss`, Storybook story, or component-only changes
- User asks for visual changes: "padding größer / Farbe ändern / spacing / hover-state / Animation / das Design / das Layout"
- User is doing rapid back-and-forth on the same file (3+ edits in a row)
- User explicitly says "schnell mal / quick / lass mich erstmal probieren"

In Phase 1:
- **Do NOT invoke `cap:prototype`** — just edit directly
- **Do NOT invoke `cap:iterate`** — just edit directly
- **Do NOT block on tag discipline** — tags can be batched at the end
- **No research gate, no AC confirmation, no agent spawn**
- The session-state stays in whatever phase it was (`prototyped` or earlier)

**Phase 2 — Catch-up** (auto-invoke when sprint ends):

Trigger signals:
- User says "ok das passt jetzt / fertig / lass uns das aufräumen / commit ready"
- User shifts topic away from visual to logic/data/tests
- A natural pause (e.g. starting a new feature)

In Phase 2:
1. Invoke `cap:annotate` Skill — retroactively add `@cap-feature` and `@cap-todo` tags to the changed files
2. Invoke `cap:test` Skill — write tests against the now-stable form
3. Optionally suggest `/cap:save` to snapshot the sprint result

This keeps tag discipline and AC traceability intact without slowing down the actual visual work.

### Multi-User Workflow (role-aware sessions, role-aware handoff)

Projects with multiple contributors (e.g. one frontend-focused, one backend-focused) benefit from explicit user-aware behavior. CAP supports this without spawning per-user agents — instead, a single `activeUser` field on `.cap/SESSION.json` plus role rules in the project's CLAUDE.md drives all Skills.

**Detection order (CAP convention):**
1. `.cap/SESSION.json:activeUser` if explicitly set (use `--user=<name>` on `/cap:start`)
2. `git config user.email` matched against project-defined patterns
3. Ask once, persist

**Role rules belong in the project's CLAUDE.md** — CAP itself stays unopinionated about which user owns what. The project lists, per role:
- What the user owns (file globs, packages, layers)
- Default Skill priorities for that role
- Skills that should NOT auto-invoke for that role
- Topics that should NOT be pushed to that role

**Handoff snapshots** are first-class: `cap-historian` MODE: SAVE accepts a `handoff_to: <user>` frontmatter field. The recipient sees an unconsumed handoff on next `cap:start` via `cap-historian` MODE: CONTINUE; once the recipient writes a follow-up snapshot or runs a state-changing Skill on the same feature, the handoff is implicitly consumed.

Snapshot frontmatter for a handoff:
```yaml
handoff_to: <recipient-user>
handoff_from: <sender-user>
handoff_type: design | implementation    # forward = design (default); reverse briefing = implementation
handoff_date: <ISO timestamp>
feature: F-XXX
handoff_phase: <next-phase>
files_changed: [list]

# Forward (design) handoff:
open_acs: [list]
exit_notes: |
  Free-form notes on what's done and what's open.

# Reverse / implementation briefing — richer:
implementation_summary: |
  3-5 sentence executive summary of what was built.
verification_status:
  - { ac: F-X/AC-Y, status: implemented+tested, caveat: <e.g. "design pass not done"> }
divergence_from_design:
  - { title: <short>, reason: <why>, ask: <question> }
open_questions:
  - <question, blocking by default>
suggestions:
  - { title: <improvement>, rationale: <why>, effort: S|M|L, risk: low|medium|high }
```

**Two flow types:**
- **Forward handoff (design)** — design owner → implementation owner. Snapshot lists files + open ACs + exit notes. The recipient picks up to implement.
- **Reverse handoff / implementation briefing (implementation)** — implementation owner → design owner. Snapshot is a structured briefing: what was built, divergences from the original design (with explicit asks), open questions (blocking), best-practice suggestions (with effort/risk). The recipient reviews, answers, and either accepts or asks back. This loop can ping-pong multiple times within a feature.

**Open-questions-block-rule:** If a briefing has unanswered `open_questions`, the agent should not auto-invoke state-changing Skills on the feature in the recipient's session — answers come first. Soft enforcement; explicit slash commands override.

The Hub project (GoetzeInvest) is the canonical example — see its `CLAUDE.md` for the fully-spelled-out Bastian-Dennis bidirectional handoff pattern with concrete trigger phrases and surface formats. The CAP repo itself is single-user and does not use this feature.

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
