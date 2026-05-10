# The 9 Agents

CAP Pro ships with exactly **9 agents**, organised into two layers:

- **Per-feature (micro-workflow)** — 5 agents that drive the brainstorm → prototype → iterate → test → review flow for a single feature.
- **Project-wide (macro-workflow)** — 4 agents that operate across the whole project: snapshots & forks, dashboards, architecture review, migrations.

Each agent does **one thing well**. There are no "do everything" mega-agents.

## Per-feature agents (5)

### `cap-brainstormer`

Conversational feature discovery. Asks targeted questions, clusters features into groups, surfaces dependencies, drafts Feature Map entries with acceptance criteria. Spawned by `/cap:brainstorm`.

**Output:** new entries in `FEATURE-MAP.md`, state `planned`.

### `cap-prototyper`

The workhorse. Builds working code with `@cap-feature` and `@cap-todo` tags inline. Four modes:

- **`prototype`** (default) — green-field implementation
- **`iterate`** — refine based on feedback (called by `/cap:iterate`)
- **`architecture`** — propose structure first, build later
- **`annotate`** — retroactively tag existing code (called by `/cap:annotate`)

Spawned by `/cap:prototype` and `/cap:iterate`.

### `cap-validator`

Two-stage validation. Three modes:

- **`MODE: TEST`** — RED-GREEN test discipline (called by `/cap:test`)
- **`MODE: REVIEW`** — two-stage review: AC compliance + code quality (called by `/cap:review`)
- **`MODE: AUDIT`** — completeness audit (F-048 score)

Replaces the legacy `cap-tester` and `cap-reviewer` agents (consolidated in CAP Pro 1.0).

Spawned by `/cap:test` and `/cap:review`.

### `cap-debugger`

Investigates bugs using **scientific method** with persistent debug state across context resets. Manages hypothesis-test-conclude cycles, with deploy-aware workflow for staging/production issues.

Spawned by `/cap:debug`.

### `cap-designer`

Reviews UI/UX work for "anti-slop" — checks the **9-family aesthetic system** (typography, color, spacing, layout, motion, interaction, hierarchy, density, accessibility) and suggests fixes for the slop patterns LLMs love (over-rounded corners, hot pink gradients, every button size 40 px).

Spawned by `/cap:design`.

## Project-wide agents (4)

### `cap-historian`

Active snapshot lifecycle. Three modes:

- **`MODE: SAVE`** — writes a snapshot with frontmatter and an event row in `.cap/snapshots/index.jsonl`. Snapshots can carry `handoff_to:` for multi-user workflows.
- **`MODE: CONTINUE`** — does mtime-vs-snapshot diff per file and re-reads only drifted files (token-sparing). The default `/cap:start` action.
- **`MODE: FORK`** — creates branch-points with explicit divergence rationale. The parent snapshot is never mutated.

Spawned by `/cap:save`, `/cap:continue`, `/cap:fork`.

### `cap-curator`

Single dashboard agent with **5 read-only modes**:

- **`MODE: STATUS`** — feature dashboard, state distribution, drift indicators
- **`MODE: REPORT`** — writes a stakeholder-readable summary to `.cap/REPORT.md` (the only mode that mutates anything)
- **`MODE: CLUSTERS`** — neural memory clusters with pairwise affinity
- **`MODE: LEARN-BOARD`** — recent learnings extracted from sessions
- **`MODE: DRIFT`** — detects mismatches between Feature Map state and code (CI exit codes: 0 clean, 1 drift)

Spawned by `/cap:status`, `/cap:report`.

### `cap-architect`

System-architecture review **without auto-apply**. Three modes:

- **`MODE: AUDIT`** — sweeps for god-modules (>800 LOC), high-fanout modules (>10 imports), circular dependencies, code duplication
- **`MODE: REFACTOR`** — targets a specific module; **must consult `pitfalls.md`** before suggesting splits
- **`MODE: BOUNDARIES`** — proposes API contracts between feature groups via affinity clustering

Tools list deliberately excludes `Write` and `Edit`. The architect proposes; the prototyper applies.

### `cap-migrator`

Unified migration pipeline. Four modes:

- **`MODE: GSD`** — migrates legacy `gsd-*` agents, commands, hooks
- **`MODE: TAGS`** — converts old tag formats to current `@cap-*`
- **`MODE: FEATURE-MAP`** — monolithic → sharded layout
- **`MODE: MEMORY`** — V5 (monolithic) → V6 (per-feature) memory layout

All modes share a **plan → diff → apply → verify** pipeline with atomic backup under `.cap/migrations/<id>/backup/` and three rollback paths (verify-failure, promote-failure, user-initiated). `--dry-run` is the default. `--allow-large-diff` gate at 100 KB total / 500 files.

## How agents communicate

Agents do **not call each other directly**. They communicate exclusively via shared artefacts:

- `FEATURE-MAP.md` — feature state and ACs
- `.cap/SESSION.json` — ephemeral session state (active feature, role, mode)
- `.cap/snapshots/<id>.md` — historical session snapshots
- Code with `@cap-*` tags — the running record

This loose coupling means you can swap one agent for another (or for a human) without breaking the workflow.

## Why these 9?

CAP Pro v0.x had 18+ agents at one point. We consolidated by asking, for each agent: *"if this agent didn't exist, would the workflow break?"*

If the answer was "no, just merge it into a sibling" — we merged. The 9 that remain each pull their weight.

## Want to add your own?

CAP Pro doesn't ship a custom-agent SDK *yet* (it's on the [roadmap](/roadmap)). For now, you can drop a custom Markdown agent into `~/.claude/agents/` (or your runtime's equivalent) and Claude Code will pick it up. CAP Pro's agents won't conflict with yours.
