# The 5-Step Workflow

CAP Pro's workflow is **linear by default, re-entrant by design**:

```
  brainstorm  →  prototype  →  iterate  →  test  →  review
```

Each step has a clear input, a clear output, and a state transition in `FEATURE-MAP.md`:

| Step | Input | Output | State after |
|---|---|---|---|
| `brainstorm` | conversation | Feature Map entry with ACs | `planned` |
| `prototype` | `planned` feature | Annotated working code | `prototyped` |
| `iterate` | `prototyped` + open `@cap-todo` tags | Closed todos | still `prototyped` |
| `test` | `prototyped` feature | RED-GREEN tests for every AC | `tested` |
| `review` | `tested` feature | Two-stage approval | `shipped` |

## State machine

```
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   ▼                                                              │
[planned]──prototype──▶[prototyped]──test──▶[tested]──review──▶[shipped]
                            │  ▲
                            │  │
                            └──┘
                          iterate
```

You can re-enter any step at any time. Found a bug after `shipped`? Run `/cap:debug`, fix, re-test. Want to add an AC to a `tested` feature? It drops back to `prototyped` until the new AC is also tested.

## What each step does

### 1. `brainstorm` — Discover features

Launches a conversation with `cap-brainstormer` that:

- Probes "what are you actually trying to build?"
- Clusters related features into groups
- Surfaces dependencies
- Drafts Feature Map entries with **acceptance criteria** (ACs)

Output: `FEATURE-MAP.md` populated.

### 2. `prototype` — Build it

`cap-prototyper` reads the active feature, confirms the ACs once, and builds working code with `@cap-feature` + `@cap-todo` tags inline.

The four prototype modes:

- **`prototype`** (default) — green-field implementation
- **`iterate`** — refine based on feedback (called by `/cap:iterate`)
- **`architecture`** — propose structure first, build later
- **`annotate`** — retroactively tag existing code (called by `/cap:annotate`)

### 3. `iterate` — Close the todos

Loops:

1. `/cap:scan` extracts all `@cap-todo` tags from the codebase
2. Pick the next open todo (sorted by risk)
3. `cap-prototyper` in `iterate` mode addresses it
4. Re-scan, repeat

The loop terminates when all `@cap-todo` tags for the feature are closed.

### 4. `test` — Verify with RED-GREEN

`cap-validator` (`MODE: TEST`) uses **adversarial RED-GREEN** discipline:

1. Read the AC from the Feature Map
2. Write the failing test **first** (no implementation peek)
3. Run it — confirm it fails *for the right reason*
4. Implement until it passes
5. Refactor with green tests as the safety net

Frameworks auto-detected: `vitest`, `node:test`, `jest`, `mocha`, `pytest`, `unittest`, Go test, Rust `cargo test`.

### 5. `review` — Two stages, fail-fast

`cap-validator` (`MODE: REVIEW`):

- **Stage 1 — AC compliance**: every AC has a green test, every `@cap-todo` is closed, every claim in the Feature Map matches the code. *If Stage 1 fails, Stage 2 is skipped.*
- **Stage 2 — Code quality**: security (OWASP top 10), performance (N+1, blocking I/O), maintainability (cognitive load, dead code), anti-patterns.

Pass both stages → feature is `shipped`.

## Sideways tools (not in the linear flow)

These are commands you invoke as needed, not as a "next step":

| Command | Purpose |
|---|---|
| `/cap:debug` | Scientific-method debugger with persistent hypothesis log |
| `/cap:status` | Dashboard view of the project (states, drift, hotspots) |
| `/cap:save` | Snapshot the current session for later resume |
| `/cap:continue` | Resume a saved snapshot, with mtime-diff to spot drift |
| `/cap:scan` | Re-extract `@cap-*` tags and refresh the Feature Map |
| `/cap:annotate` | Retroactively tag existing code |
| `/cap:memory` | Manage `.cap/memory/` (decisions, pitfalls, patterns) |
| `/cap:trace` | Walk a feature from Feature Map → tags → tests → commits |

[Full command reference →](/reference/commands)

## When to use slash commands vs. just talk

CAP Pro is designed for **conversational use**. You shouldn't have to type the commands — describe what you want, and CAP Pro picks the right tool. The commands exist as **explicit power-user triggers** for when you want manual control.

[See the auto-trigger contract →](./quick-start.md#the-auto-trigger-contract)

## Frontend Sprint mode

UI work has a different shape — dozens of fast tweaks (padding, color, copy) where the agent ceremony costs more than the edit. CAP Pro auto-detects "Phase 1 free-edit sprint" mode and stays out of the way during rapid visual iteration, then auto-catches up with `cap:annotate` + `cap:test` once the visual tweaks settle.

[See the Frontend Sprint Pattern →](/best-practices/frontend-sprint.md)
