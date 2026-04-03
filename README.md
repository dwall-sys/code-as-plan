# CAP -- Code as Plan

> Build first. Plan from code. Ship with confidence.

CAP is a developer framework for AI-assisted coding that follows the Code-First principle: instead of writing requirements documents before touching code, you build a prototype, annotate it with lightweight tags, and let the framework derive your project plan from what you actually built.

Works with Claude Code, Gemini CLI, Codex, Copilot, Cursor, Windsurf, OpenCode, and Antigravity.

```
  brainstorm --> prototype --> iterate --> test --> review
       |              |            |          |        |
  FEATURE-MAP    @cap-tags    scan+fix    green=done  ship
```

---

## The Problem

Traditional AI coding frameworks follow a plan-heavy workflow:

```
discuss -> requirements -> plan -> execute -> verify -> review  (9+ steps with sub-steps)
```

This produces a stack of planning artifacts -- ROADMAP.md, REQUIREMENTS.md, STATE.md, VERIFICATION.md, MILESTONES.md -- that drift from reality the moment code changes. You spend more time maintaining documents than building software.

Tests should be verification. Git tags should be milestones. Code should be the plan.

CAP eliminates accidental complexity by making code the single source of truth.

---

## How CAP Is Different

| Traditional frameworks | CAP |
|------------------------|-----|
| 9+ step workflow | 5 steps: brainstorm, prototype, iterate, test, review |
| 8+ mandatory tags/annotations | 2 mandatory tags: `@cap-feature`, `@cap-todo` |
| Manually maintained ROADMAP.md | FEATURE-MAP.md auto-derived from code + brainstorm |
| Separate VERIFICATION.md | Green tests = verified |
| MILESTONES.md with status tracking | Git tags = milestones |
| Runtime dependencies | Zero runtime dependencies (pure Node.js built-ins) |
| Single AI runtime | Multi-runtime: Claude Code, Gemini, Codex, Copilot, Cursor, Windsurf, OpenCode, Antigravity |
| Flat project scoping | Per-app monorepo scoping with independent Feature Maps |
| Stale library documentation | Context7 integration for always-current docs |

---

## Installation

```bash
npx code-as-plan@latest
```

### Runtime flags

Install for a specific AI coding tool:

```bash
npx code-as-plan@latest --claude
npx code-as-plan@latest --gemini
npx code-as-plan@latest --codex
npx code-as-plan@latest --copilot
npx code-as-plan@latest --cursor
npx code-as-plan@latest --windsurf
npx code-as-plan@latest --all       # install for all runtimes
```

### Scope

```bash
npx code-as-plan@latest --local     # current project only (default)
npx code-as-plan@latest --global    # all projects
```

---

## Quick Start

### 1. Initialize your project

```bash
/cap:init
```

Creates `.cap/` directory and an empty `FEATURE-MAP.md`. For existing codebases, runs brownfield analysis to detect what you already have.

### 2. Brainstorm features

```bash
/cap:brainstorm
```

Interactive conversation that produces Feature Map entries with acceptance criteria, feature grouping, and dependency analysis. No PRD documents -- results go directly into FEATURE-MAP.md.

### 3. Build a prototype

```bash
/cap:prototype
```

Reads your Feature Map, confirms acceptance criteria, and builds annotated code. Every function and module gets `@cap-feature` tags linking it back to the Feature Map.

```javascript
// @cap-feature F-001 User authentication
// @cap-todo Add refresh token rotation (risk: token replay attacks)
function authenticateUser(credentials) {
  // implementation
}
```

### 4. Iterate until done

```bash
/cap:iterate
```

Scans code for tags, identifies Feature Map gaps, builds missing pieces, re-scans. Repeat until all acceptance criteria are satisfied.

### 5. Test and review

```bash
/cap:test     # writes tests against Feature Map acceptance criteria
/cap:review   # two-stage review: spec compliance, then code quality
```

Green tests mean verified. No separate verification document.

---

## Architecture

```
+-------------------------------------------------------------------+
|                        Developer Workflow                          |
|                                                                   |
|  /cap:brainstorm  ->  /cap:prototype  ->  /cap:iterate            |
|       |                    |                    |                  |
|       v                    v                    v                  |
|  +-----------+     +---------------+     +-------------+          |
|  | Feature   |     | Annotated     |     | Tag Scanner |          |
|  | Map (MD)  |<--->| Source Code   |---->| (regex)     |          |
|  +-----------+     +---------------+     +------+------+          |
|       ^                    |                    |                  |
|       |                    v                    v                  |
|       +---------- @cap-feature F-001 ----------+                  |
|                   @cap-todo ...                                   |
|                                                                   |
|  /cap:test       ->  Green tests = verified                       |
|  /cap:test-audit ->  Mutation score + trust score                 |
|  /cap:review     ->  Stage 1 (ACs) + Stage 2 (quality)           |
|                      + Stage 3 (manual checklist)                 |
|  /cap:report     ->  Human-readable team overview                 |
|  git tag v1.0    ->  Milestone complete                           |
+-------------------------------------------------------------------+
|                          Agents                                   |
|  cap-brainstormer | cap-prototyper | cap-tester | cap-reviewer    |
|                          cap-debugger                             |
+-------------------------------------------------------------------+
|                        Infrastructure                             |
|  Node.js built-ins only | Zero runtime deps | Provenance-signed  |
+-------------------------------------------------------------------+
```

---

## Commands

| Command | Description |
|---------|-------------|
| `/cap:init` | Initialize CAP project -- creates `.cap/`, FEATURE-MAP.md, detects stack via Context7 |
| `/cap:brainstorm` | Interactive feature discovery that produces Feature Map entries with acceptance criteria |
| `/cap:prototype` | Build annotated code scaffold from Feature Map (supports `--architecture` and `--annotate` modes) |
| `/cap:iterate` | Scan, identify gaps, build, re-scan -- repeat until acceptance criteria are met |
| `/cap:test` | Write runnable tests against Feature Map acceptance criteria using RED-GREEN discipline |
| `/cap:review` | Two-stage review: Stage 1 checks Feature Map compliance, Stage 2 checks code quality |
| `/cap:debug` | Systematic debugging with persistent state across context resets |
| `/cap:scan` | Scan codebase for `@cap-feature` and `@cap-todo` tags, update Feature Map |
| `/cap:status` | Show project status derived from Feature Map -- completion, coverage, open risks |
| `/cap:start` | Initialize session -- restore previous state, detect project context |
| `/cap:switch-app` | Switch active app in a monorepo |
| `/cap:annotate` | Retroactively add `@cap-feature` and `@cap-todo` tags to existing code |
| `/cap:refresh-docs` | Fetch or refresh library documentation via Context7 |
| `/cap:update` | Update CAP to the latest version with changelog display |
| `/cap:migrate` | Migrate from GSD Code-First v1.x to CAP v2.0 (supports `--rescope` for per-app Feature Maps) |
| `/cap:test-audit` | Test quality analysis: assertion density, coverage, mutation score, spot-check guide, trust score |
| `/cap:report` | Human-readable project overview for non-technical stakeholders (no IDs, no tag syntax) |
| `/cap:doctor` | Health check for all required and optional dependencies |
| `/cap:save` | Save current session context to snapshot file for cross-session continuity |
| `/cap:continue` | Restore a saved context snapshot |
| `/cap:memory` | Project memory management -- `init`, `status`, `pin`, `unpin` subcommands |

---

## Tag System

CAP uses inline code annotations to link source code to the Feature Map. Two tags are mandatory. Two more are optional for richer tracking.

### Mandatory tags

#### @cap-feature

Links code to a Feature Map entry.

```javascript
// @cap-feature F-001 User authentication
function login(email, password) { ... }
```

```python
# @cap-feature F-003 Data export pipeline
def export_to_csv(dataset):
    ...
```

Every function, module, or component that implements a feature gets this tag. The tag scanner uses these to calculate Feature Map completion.

#### @cap-todo

Marks work items, open questions, and known gaps.

```javascript
// @cap-todo Implement rate limiting for login endpoint
// @cap-todo(risk: brute force attacks) Add account lockout after 5 failures
// @cap-todo(decision: chose bcrypt over argon2 -- wider ecosystem support)
```

Subtypes `risk:` and `decision:` let you capture architectural decisions and known risks inline, right where they matter.

### Optional tags

#### @cap-risk

Standalone risk annotation when the risk is not tied to a specific todo.

```javascript
// @cap-risk Memory usage grows linearly with connected WebSocket clients
```

#### @cap-decision

Standalone architectural decision record.

```javascript
// @cap-decision Use SQLite over PostgreSQL -- single-node deployment, no ops overhead
```

### That is the entire tag system

Two mandatory tags. Two optional tags. Compare this to frameworks that require 8+ annotation types with mandatory metadata fields. Simplicity is the point.

---

## Feature Map

`FEATURE-MAP.md` is the single source of truth for project status. It is auto-generated from two inputs:

1. **Brainstorm output** -- feature definitions and acceptance criteria
2. **Tag scan results** -- `@cap-feature` and `@cap-todo` counts from source code

You never edit FEATURE-MAP.md manually. Run `/cap:scan` or `/cap:iterate` to regenerate it.

```markdown
## F-001 User Authentication
Status: IN PROGRESS (3/5 ACs met)
Tags: 12 @cap-feature, 4 @cap-todo
Files: src/auth/login.js, src/auth/session.js, src/auth/middleware.js

### Acceptance Criteria
- [x] Users can log in with email and password
- [x] JWT tokens issued on successful login
- [x] Invalid credentials return 401
- [ ] Refresh token rotation
- [ ] Account lockout after failed attempts
```

---

## Monorepo Support

CAP auto-detects monorepo tooling and scopes all commands to the active app.

### Supported workspace managers

- npm workspaces (`package.json` workspaces field)
- pnpm workspaces (`pnpm-workspace.yaml`)
- Yarn workspaces
- NX (`nx.json`)
- Lerna (`lerna.json`)

### How it works

```bash
/cap:init                  # detects monorepo, creates per-app .cap/ directories
/cap:switch-app            # interactive app selector with tag counts
/cap:prototype             # scopes to active app only
/cap:scan                  # scans active app + shared packages
```

Each app gets its own `FEATURE-MAP.md`. Shared packages are scanned and included as lightweight dependency context -- exports and types only, not full source.

---

## Agents

CAP ships five specialized agents. You do not invoke them directly -- commands spawn them as needed.

| Agent | Spawned by | Purpose |
|-------|-----------|---------|
| `cap-brainstormer` | `/cap:brainstorm` | Guides feature discovery conversation, produces Feature Map entries |
| `cap-prototyper` | `/cap:prototype`, `/cap:iterate`, `/cap:annotate` | Builds annotated code. Four modes: PROTOTYPE, ITERATE, ARCHITECTURE, ANNOTATE |
| `cap-tester` | `/cap:test` | Writes tests against Feature Map acceptance criteria using RED-GREEN discipline |
| `cap-reviewer` | `/cap:review` | Two-stage review: spec compliance (Stage 1), code quality (Stage 2) |
| `cap-debugger` | `/cap:debug` | Systematic debugging with persistent state across context window resets |

---

## Test Quality Infrastructure

CAP goes beyond "tests are green" with a 6-level trust model:

### /cap:test -- AI-generated tests

The `cap-tester` agent writes tests with an adversarial mindset ("how do I break this?") and includes specialized templates for:

- **Security tests** -- RLS policies, auth bypass, input sanitization, data leakage
- **Contract tests** -- API schema validation between monorepo services
- **Property-based tests** -- fast-check templates for business logic invariants

### /cap:test-audit -- verify the tests themselves

Because "tests are green" is not the same as "tests are trustworthy":

```
Test Audit — apps/booking
=========================

ASSERTIONS:      142 total, 0 empty tests
COVERAGE:        73% lines, 68% branches
MUTATION SCORE:  8/10 caught (80%)

SPOT-CHECK GUIDE (for human review):
  1. auth.test.ts:42 — "rejects expired token"
     Break: Delete token check in auth.ts:18
     Expected: Test turns RED
     [ ] Verified  [ ] Suspect

ANTI-PATTERNS:   3 weak assertions flagged
TRUST SCORE:     87/100
```

**Mutation testing** is the strongest automated check: the engine introduces deliberate bugs (flip `===` to `!==`, negate conditions, remove returns) and verifies the tests catch them. A mutation score above 80% means your tests are genuinely testing behavior.

**Spot-checks** guide human reviewers to the 3 most critical tests. Five minutes of human attention at the right places provides more confidence than reading every test file.

### /cap:report -- for your team

Generates a plain-language project overview without feature IDs, tag syntax, or technical jargon. Written so non-technical colleagues can understand what's built, what's in progress, and what's at risk.

---

## Migration from GSD

If you have an existing GSD Code-First v1.x project:

```bash
/cap:migrate --dry-run     # preview what would change (safe)
/cap:migrate --tags-only   # convert @gsd-* tags to @cap-* only
/cap:migrate               # full migration: tags + artifacts + session
/cap:migrate --rescope     # split root Feature Map into per-app Feature Maps (monorepo)
```

Tag conversion:

| GSD tag | CAP equivalent |
|---------|---------------|
| `@gsd-feature` | `@cap-feature` |
| `@gsd-todo` | `@cap-todo` |
| `@gsd-risk` | `@cap-todo risk:` |
| `@gsd-decision` | `@cap-todo decision:` |
| `@gsd-context` | Plain comment (tag removed) |
| `@gsd-status` | Removed (status lives in Feature Map) |
| `@gsd-depends` | Removed (derived from import graph) |

---

## Why Prototype-Driven Development

CAP implements Prototype-Driven Development -- a methodology designed for AI-assisted engineering. It is different from TDD and Spec-Driven Development in a fundamental way.

### The problem with older approaches

**TDD** says: write the test first, then the code. But developers often don't know what to test until they've built something. The test becomes a guess that gets rewritten alongside the code.

**Spec-Driven** says: write the specification first, then build against it. But specifications written before building are based on assumptions, not knowledge. They drift the moment code reveals what the problem actually is.

Both approaches were designed for a world where building is expensive. When writing code takes hours or days, it makes sense to plan first and build later. You want to get it right the first time because iteration is costly.

### AI changes the economics

When AI builds a working prototype in minutes instead of hours, the calculation flips:

| | Human alone | Human + AI (CAP) |
|---|---|---|
| Cost of a prototype | Hours | Minutes |
| Cost of throwing it away | Painful | Trivial |
| Cost of a wrong spec | Days of wasted work | One conversation to correct |
| When you discover missing requirements | After building (too late) | While looking at the prototype |

Building is no longer expensive. Specifying incorrectly is. This makes "build first, then understand" more rational than "understand first, then build."

### How CAP uses this

```
TDD:          Test  -->  Code  -->  Refactor
Spec-Driven:  Spec  -->  Code  -->  Verify
CAP:          Idea  -->  Prototype  -->  Spec emerges  -->  Test  -->  Verify
```

The specification is not an input -- it is an output. You start with an idea (brainstorm), build a prototype (fast, cheap), and the specification crystallizes from what you actually built:

- Feature Map entries emerge from brainstorming
- `@cap-feature` tags emerge from implementation
- `@cap-todo risk:` and `decision:` annotations emerge from coding experience
- Acceptance criteria get refined as you see what works and what doesn't

### Why this helps humans learn, not just ship faster

**1. The prototype is a mirror.** When you look at running code and say "that's wrong," you just discovered a requirement you couldn't have written upfront. The brainstorm-prototype-iterate loop is a requirement discovery machine.

**2. Fewer false assumptions.** In spec-driven workflows, teams commit to assumptions before verifying them. In CAP, you verify assumptions by building -- because building is cheap. "Does this booking flow make sense?" is answered by looking at it, not by reading a document.

**3. Better communication.** Showing a colleague a working prototype ("look, this is how booking works") communicates more in 30 seconds than a spec document communicates in 30 pages.

**4. Less waste.** Studies show 30-50% of upfront specifications describe features that change before they ship. Prototype-Driven avoids this by only formalizing what survives iteration.

**5. Deeper understanding.** When the AI builds and you review, you engage with the problem at a concrete level. You're not reading abstractions -- you're reading code, testing flows, catching edge cases. This builds genuine understanding that no spec document provides.

### What CAP takes from TDD and Spec-Driven

CAP is not opposed to testing or specifications. It reorders when they happen:

From **TDD**: RED-GREEN test discipline, mutation testing, tests as verification (not documents). But tests come after the prototype, not before.

From **Spec-Driven**: Acceptance criteria as contracts (Feature Map ACs), traceability (tags link code to features), review against spec (Stage 1). But the spec emerges from building, it is not written in isolation.

### In one sentence

> TDD and Spec-Driven optimize for executing a known plan correctly. CAP optimizes for discovering the right plan -- by building, observing, learning, and correcting.

---

## Farley's Principles in CAP

CAP is aligned with Dave Farley's "Modern Software Engineering":

**Optimize for learning.** Build a prototype to discover what you do not know. Iterate based on what the code tells you, not what a requirements document predicted.

**Manage complexity.** Planning artifacts that duplicate what code already expresses are accidental complexity. Eliminate them. Keep one source of truth.

**Work in small steps.** The brainstorm-prototype-iterate loop is deliberately short. Each iteration produces working, tested, annotated code -- not documents about code.

**Get fast feedback.** Green tests are verification. Tag scans are progress tracking. Git tags are milestones. Every feedback mechanism is derived from artifacts you already produce.

---

## Security

**Zero runtime dependencies.** CAP uses only Node.js built-in modules. No third-party code runs in your project at runtime. This eliminates supply chain attack surface from transitive dependencies.

**Provenance attestation.** Every npm release is signed via GitHub Actions OIDC, proving the package was built from the public source repository. Verify with:

```bash
npm audit signatures
```

**Safe CI pipeline.** Packages are published exclusively through GitHub Actions with `npm ci --ignore-scripts` -- lockfile-pinned dependencies, no post-install script execution.

**Verify your install.**

```bash
npm view code-as-plan dist.attestations   # check provenance exists
```

---

## Context7 Integration

CAP integrates with Context7 to fetch current library documentation during development. When you run `/cap:init` or `/cap:refresh-docs`, CAP detects your project dependencies and pulls relevant documentation into `.cap/stack-docs/` so agents always have accurate, up-to-date API references -- not stale training data.

```bash
/cap:refresh-docs          # fetch/update docs for all detected dependencies
```

---

## Project Memory System

CAP v3.0 introduces a persistent project memory that accumulates knowledge across sessions, developers, and brainstorm conversations. Unlike traditional session logs, CAP memory follows the Code-First principle: **code tags are the primary source**, session data provides only edit frequency metrics.

### How it works

```
Code Tags                    Session JSONL Files
@cap-decision ...            (edit frequency only)
@cap-todo risk: ...                |
@cap-risk ...                      v
       |                    +-------------+
       v                    | Hotspot     |
+----------------+          | Detection   |
| Memory Engine  |          +------+------+
| (code-first)   |                 |
+-------+--------+                 |
        |                          |
        +----------+---------------+
                   |
                   v
          +--------+--------+
          | Memory Graph    |
          | .cap/memory/    |
          | graph.json      |
          +--------+--------+
                   |
     +-------------+-------------+
     |             |             |
     v             v             v
decisions.md  hotspots.md  pitfalls.md    (human-readable views)
```

### Three data sources

**1. Code tags (primary, zero noise)**

```javascript
// @cap-decision Use SQLite over PostgreSQL -- single-node deployment, no ops overhead
// @cap-todo risk: Connection pool exhaustion under load
// @cap-risk Regex YAML parsing breaks on complex YAML features
```

These are explicit developer annotations -- 100% signal, no heuristic extraction needed.

**2. Session hotspots (edit frequency)**

Which files keep getting changed, across how many sessions? Hotspots help new team members understand where the action is.

```
| File                          | Sessions | Edits |
|-------------------------------|----------|-------|
| packages/auth/callback.ts     | 6        | 29    |
| packages/auth/middleware.ts   | 5        | 24    |
| apps/hub/AuthContext.tsx       | 3        | 5     |
```

**3. Conversation threads (brainstorm memory)**

When you brainstorm with CAP, the conversation is persisted as a named thread in `.cap/memory/threads/`. When you return to the same topic days later, CAP detects the connection and offers to resume, merge, or branch the discussion.

### Conversation threading

Brainstorm conversations naturally branch into tangents. Humans track these threads effortlessly; AI assistants lose them when the session ends. CAP solves this with persistent thread tracking:

```
Session 1: "We need auth for the booking system"
  -> Thread created: thr-a1b2c3 (Auth Architecture)
  -> Features: F-AUTH, F-SSO
  -> Decisions: Supabase over Firebase, cookie-based SSO

Session 2 (next day): "Remember the auth discussion? I have a new idea..."
  -> CAP detects: 85% keyword overlap with thr-a1b2c3
  -> Shows: "Found prior thread: Auth Architecture (2 days ago)"
  -> Proposes: merge | supersede | branch | resume
```

**Four reconnection strategies:**

| Strategy | When to use |
|----------|-------------|
| **Resume** | Continue where you left off |
| **Merge** | Integrate new ideas into old thread, combine ACs |
| **Supersede** | New idea replaces old approach entirely |
| **Branch** | Both approaches coexist as alternatives |

### Impact analysis

When you propose a new feature during brainstorming, CAP automatically checks for overlap with existing features:

- Compares acceptance criteria for semantic similarity
- Traces full dependency chains (A depends on B depends on C -- changing B surfaces impact on A and C)
- Detects circular dependency risks
- Proposes concrete resolutions: merge ACs, split features, adjust dependencies

All proposals are advisory -- CAP never modifies the Feature Map without explicit approval.

### Memory graph

Under the hood, all memory is stored as a connected graph (`.cap/memory/graph.json`):

- **6 node types:** feature, thread, decision, pitfall, pattern, hotspot
- **6 edge types:** depends_on, supersedes, conflicts_with, branched_from, informed_by, relates_to
- **Temporal queries:** "What changed between last Tuesday and today?"
- **Traversal queries:** "Show all decisions that informed F-005 within 2 hops"

The flat markdown files (`decisions.md`, `hotspots.md`, `pitfalls.md`, `patterns.md`) are generated views from the graph -- human-readable and git-diffable.

### Multi-developer workflow

Memory is git-tracked. When multiple developers work on the same project:

```
Developer A: /cap:memory init  ->  .cap/memory/ generated  ->  commit + push
Developer B: git pull          ->  has A's memory
             /cap:memory init  ->  MERGES with A's data (anchor-ID dedup)
             commit + push     ->  combined team memory
```

Both developers' decisions, hotspots, and threads are accumulated into a shared project memory that grows over time.

### Commands

```bash
/cap:memory init      # bootstrap memory from all sessions + code tags (one-time)
/cap:memory           # incremental update (runs automatically after each session)
/cap:memory status    # show memory summary (entries per category, last run)
/cap:memory pin       # mark a pitfall as permanent (immune to aging)
/cap:memory unpin     # remove permanent mark
```

---

## License

MIT
