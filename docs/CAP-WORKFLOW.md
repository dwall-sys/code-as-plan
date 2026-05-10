# CAP Workflow Guide

> How to use Code as Plan — from project setup to shipped features.

## The Big Picture

```mermaid
flowchart TD
    classDef init fill:#7c3aed,color:#fff,stroke:#5b21b6,stroke-width:2px
    classDef brainstorm fill:#f59e0b,color:#000,stroke:#d97706,stroke-width:2px
    classDef prototype fill:#3b82f6,color:#fff,stroke:#2563eb,stroke-width:2px
    classDef iterate fill:#06b6d4,color:#fff,stroke:#0891b2,stroke-width:2px
    classDef test fill:#ef4444,color:#fff,stroke:#dc2626,stroke-width:2px
    classDef review fill:#10b981,color:#fff,stroke:#059669,stroke-width:2px
    classDef support fill:#6b7280,color:#fff,stroke:#4b5563,stroke-width:1px
    classDef decision fill:#fbbf24,color:#000,stroke:#d97706,stroke-width:2px

    START([New Project or Feature]):::init
    INIT["/cap:init<br/>Setup project structure"]:::init
    BRAINSTORM["/cap:brainstorm<br/>Discover features conversationally"]:::brainstorm
    PROTOTYPE["/cap:prototype<br/>Build annotated code"]:::prototype
    ITERATE["/cap:iterate<br/>Refine until ACs pass"]:::iterate
    TEST["/cap:test<br/>RED-GREEN adversarial tests"]:::test
    REVIEW["/cap:review<br/>AC compliance + code quality"]:::review
    SHIPPED([Feature Shipped]):::review

    START --> INIT
    INIT --> BRAINSTORM
    BRAINSTORM --> PROTOTYPE
    PROTOTYPE --> ITERATE
    ITERATE --> TEST
    TEST --> REVIEW
    REVIEW --> SHIPPED

    %% Feedback loops
    REVIEW -->|"Corrections needed"| ITERATE
    TEST -->|"Tests fail"| ITERATE
    ITERATE -->|"New requirements"| BRAINSTORM

    %% Support commands
    SCAN["/cap:scan<br/>Sync tags with Feature Map"]:::support
    STATUS["/cap:status<br/>Dashboard"]:::support
    DEBUG["/cap:debug<br/>Scientific debugging"]:::support
    ANNOTATE["/cap:annotate<br/>Tag existing code"]:::support
    MEMORY["/cap:memory<br/>Project memory pipeline"]:::support

    ITERATE -.->|"after changes"| SCAN
    SCAN -.-> STATUS
    PROTOTYPE -.->|"bugs found"| DEBUG
    INIT -.->|"brownfield project"| ANNOTATE
    SHIPPED -.->|"session end"| MEMORY
```

---

## Phase 1: Project Setup

### `/cap:init` — One-time initialization

```mermaid
flowchart LR
    classDef action fill:#7c3aed,color:#fff,stroke:#5b21b6
    classDef artifact fill:#e5e7eb,color:#000,stroke:#9ca3af
    classDef auto fill:#ddd6fe,color:#000,stroke:#7c3aed,stroke-dasharray:5

    INIT["/cap:init"]:::action
    CAP[".cap/ directory"]:::artifact
    FM["FEATURE-MAP.md"]:::artifact
    DOCS[".cap/stack-docs/"]:::artifact
    RULES[".claude/rules/cap-memory.md"]:::auto
    GRAPH[".cap/memory/graph.json"]:::auto
    THREADS[".cap/memory/threads/"]:::auto

    INIT --> CAP
    INIT --> FM
    INIT -->|"Context7 fetch"| DOCS
    INIT -->|"if existing project"| RULES
    INIT -->|"if memory data exists"| GRAPH
    INIT -->|"if past sessions exist"| THREADS
```

**When:** Once per project, or when joining an existing project.

**What it does:**
1. Creates `.cap/` directory structure (SESSION.json, stack-docs, debug)
2. Creates `FEATURE-MAP.md` template (only if it doesn't exist)
3. Fetches library documentation via Context7 for all dependencies
4. Detects monorepo structure and creates per-app Feature Maps
5. Performs brownfield analysis on existing codebases
6. Builds memory graph from existing data (if any)
7. Migrates past brainstorm sessions to conversation threads

**Best practice:** Run `/cap:init` even if you've used CAP before — it's idempotent and will pick up new dependencies and build the memory graph.

---

## Phase 2: Feature Discovery

### `/cap:brainstorm` — Conversational feature design

```mermaid
flowchart TD
    classDef brainstorm fill:#f59e0b,color:#000,stroke:#d97706
    classDef agent fill:#fef3c7,color:#000,stroke:#f59e0b
    classDef artifact fill:#e5e7eb,color:#000,stroke:#9ca3af
    classDef user fill:#dbeafe,color:#000,stroke:#3b82f6
    classDef decision fill:#fbbf24,color:#000,stroke:#d97706

    START["/cap:brainstorm"]:::brainstorm

    THREADS{"Prior threads<br/>found?"}:::decision
    SHOW["Show prior threads<br/>for context"]:::agent
    SKIP["Start fresh"]:::agent

    START --> THREADS
    THREADS -->|"yes"| SHOW
    THREADS -->|"no"| SKIP

    SHOW --> CONV
    SKIP --> CONV

    CONV["cap-brainstormer agent<br/>asks questions ONE at a time"]:::agent

    P1["Phase 1: Problem Space<br/>What problem? Who uses it?<br/>What's the workaround?"]:::user
    P2["Phase 2: Solution Shape<br/>How should it work?<br/>What's the MVP?"]:::user
    P3["Phase 3: Boundaries<br/>What's NOT included?<br/>Dependencies?"]:::user

    CONV --> P1 --> P2 --> P3

    CLUSTER["Cluster into features<br/>with ACs"]:::agent
    APPROVE{"User<br/>approves?"}:::decision
    WRITE["Write to<br/>FEATURE-MAP.md"]:::artifact
    THREAD["Persist as<br/>conversation thread"]:::artifact

    P3 --> CLUSTER --> APPROVE
    APPROVE -->|"yes"| WRITE
    APPROVE -->|"corrections"| CONV
    WRITE --> THREAD
```

**When:** Starting new work, exploring a feature area, or when requirements are unclear.

**Key behaviors:**
- Agent asks **one question at a time** — not a list
- References existing Feature Map to avoid duplicates
- Checks prior brainstorm threads and asks if you want to continue
- Returns structured Feature Map entries with numbered ACs
- **Nothing is written until you explicitly approve**

**Best practice:**
- Use `--resume` to continue a previous brainstorm thread
- Use `--multi` when the project has multiple independent feature areas
- Run brainstorm even for small features — the ACs become your test contract

---

## Phase 3: Build

### `/cap:prototype` — Code-first development

```mermaid
flowchart LR
    classDef proto fill:#3b82f6,color:#fff,stroke:#2563eb
    classDef agent fill:#dbeafe,color:#000,stroke:#3b82f6
    classDef artifact fill:#e5e7eb,color:#000,stroke:#9ca3af
    classDef tag fill:#bfdbfe,color:#000,stroke:#3b82f6

    CMD["/cap:prototype<br/>--features F-001"]:::proto
    READ["Read Feature Map<br/>+ stack docs"]:::agent
    BUILD["cap-prototyper agent<br/>builds working code"]:::agent
    TAG1["@cap-feature(feature:F-001)<br/>in source files"]:::tag
    TAG2["@cap-todo(ref:F-001:AC-1)<br/>per acceptance criterion"]:::tag
    SCAN["/cap:scan<br/>auto-runs after"]:::proto
    FM["FEATURE-MAP.md<br/>updated: planned → prototyped"]:::artifact

    CMD --> READ --> BUILD
    BUILD --> TAG1
    BUILD --> TAG2
    TAG1 --> SCAN
    TAG2 --> SCAN
    SCAN --> FM
```

**When:** After brainstorm, when you have features with ACs in the Feature Map.

**What it does:**
1. Reads Feature Map and selects target features
2. Loads stack docs for library context
3. Builds working, annotated code with `@cap-feature` and `@cap-todo` tags
4. Auto-runs `/cap:scan` to sync tag state back to Feature Map
5. Creates feature branch automatically

**4 modes:**
| Mode | Flag | Use case |
|------|------|----------|
| Prototype | *(default)* | Build new feature from scratch |
| Iterate | `--iterate` | Refine existing prototype |
| Architecture | `--architecture` | Design structure without implementation |
| Annotate | `--annotate` | Tag existing code retroactively |

**Best practice:** Prototype one feature at a time. The tags create a traceable link from requirements (Feature Map) to implementation (code).

---

## Phase 4: Refine

### `/cap:iterate` — Close the gaps

```mermaid
flowchart TD
    classDef iterate fill:#06b6d4,color:#fff,stroke:#0891b2
    classDef scan fill:#6b7280,color:#fff,stroke:#4b5563
    classDef decision fill:#fbbf24,color:#000,stroke:#d97706
    classDef artifact fill:#e5e7eb,color:#000,stroke:#9ca3af

    ITER["/cap:iterate"]:::iterate
    SCAN1["/cap:scan<br/>find gaps"]:::scan
    GAPS{"Uncovered<br/>ACs?"}:::decision
    BUILD["cap-prototyper<br/>ITERATE mode"]:::iterate
    SCAN2["/cap:scan<br/>re-check"]:::scan
    DONE["All ACs covered"]:::artifact

    ITER --> SCAN1 --> GAPS
    GAPS -->|"yes"| BUILD --> SCAN2
    SCAN2 --> GAPS
    GAPS -->|"no"| DONE
```

**When:** After initial prototype, to fill in missing acceptance criteria.

**What it does:**
1. Runs `/cap:scan` to find which ACs lack `@cap-todo` coverage
2. Spawns prototyper in ITERATE mode to address gaps
3. Re-scans and repeats until all ACs are satisfied (or you stop)

**Best practice:** Run iterate before testing — it catches missing ACs that would fail in tests.

---

## Phase 5: Test

### `/cap:test` — Adversarial RED-GREEN testing

```mermaid
flowchart TD
    classDef test fill:#ef4444,color:#fff,stroke:#dc2626
    classDef green fill:#10b981,color:#fff,stroke:#059669
    classDef audit fill:#7c3aed,color:#fff,stroke:#5b21b6

    READ["Read Feature Map ACs"]:::test
    RED["RED: write failing tests"]:::test
    GREEN["GREEN: verify they pass"]:::green
    DEEP{"--deep?"}
    AUDIT["Trust Score Audit<br/>density + coverage + mutations"]:::audit
    LOW{"< 70%?"}
    SUGGEST["Improvement suggestions<br/>prioritized by point gain"]:::audit
    DONE["Done"]:::green

    READ --> RED --> GREEN --> DEEP
    DEEP -->|"no"| DONE
    DEEP -->|"yes"| AUDIT --> LOW
    LOW -->|"yes"| SUGGEST
    LOW -->|"no"| DONE
```

**When:** After prototype/iterate, when code is ready for verification.

**Flags:**
| Flag | Effect |
|------|--------|
| `--features F-001` | Scope to specific features |
| `--red-only` | Stop after RED phase (TDD workflow) |
| `--deep` | Run test audit after GREEN — trust score < 70% triggers improvement suggestions |

**What it does:**
1. Reads Feature Map ACs for target features
2. **RED phase:** Writes tests that SHOULD fail if the AC isn't implemented
3. **GREEN phase:** Runs tests against actual code, verifies they pass
4. **DEEP mode** (`--deep`): Runs full audit — assertion density, coverage, mutations, anti-patterns
5. Trust score < 70% shows prioritized suggestions with estimated point gains

**Trust score components:** Assertion density (30pts), Coverage (30pts), Mutation score (25pts), Anti-pattern penalty (-15pts), Empty test penalty (-10pts)

**Best practice:** Use `--deep` for important features. The trust score catches weak tests that pass but don't actually verify anything.

---

## Phase 6: Review

### `/cap:review` — Two-stage quality gate

```mermaid
flowchart TD
    classDef review fill:#10b981,color:#fff,stroke:#059669
    classDef stage fill:#d1fae5,color:#000,stroke:#10b981
    classDef fail fill:#ef4444,color:#fff,stroke:#dc2626
    classDef pass fill:#10b981,color:#fff,stroke:#059669
    classDef decision fill:#fbbf24,color:#000,stroke:#d97706

    CMD["/cap:review"]:::review

    S1["Stage 1: AC Compliance<br/>Every AC verified against code"]:::stage
    S1PASS{"Stage 1<br/>passes?"}:::decision
    S1FAIL["STOP<br/>Fix AC gaps first"]:::fail

    S2["Stage 2: Code Quality<br/>Security, patterns, performance"]:::stage
    S2PASS{"Stage 2<br/>passes?"}:::decision
    S2FAIL["Quality issues<br/>to address"]:::fail
    SHIP["Ready to ship"]:::pass

    CMD --> S1 --> S1PASS
    S1PASS -->|"no"| S1FAIL
    S1PASS -->|"yes"| S2 --> S2PASS
    S2PASS -->|"no"| S2FAIL
    S2PASS -->|"yes"| SHIP
```

**When:** Before merging, after tests pass.

**Key rule:** Stage 2 only runs if Stage 1 passes. No point reviewing code quality if the feature doesn't meet its acceptance criteria.

---

## Support Commands

### Always available, use anytime

```mermaid
flowchart LR
    classDef support fill:#6b7280,color:#fff,stroke:#4b5563
    classDef desc fill:#f3f4f6,color:#000,stroke:#9ca3af

    SCAN["/cap:scan"]:::support
    SCAN_D["Sync @cap-* tags<br/>with Feature Map"]:::desc
    SCAN --- SCAN_D

    STATUS["/cap:status"]:::support
    STATUS_D["Feature completion<br/>dashboard"]:::desc
    STATUS --- STATUS_D

    DEBUG["/cap:debug"]:::support
    DEBUG_D["Scientific method<br/>debugging"]:::desc
    DEBUG --- DEBUG_D

    ANNOTATE["/cap:annotate"]:::support
    ANNOTATE_D["Add @cap-* tags<br/>to existing code"]:::desc
    ANNOTATE --- ANNOTATE_D

    MEMORY["/cap:memory"]:::support
    MEMORY_D["Bootstrap or view<br/>project memory + clusters"]:::desc
    MEMORY --- MEMORY_D

    START_CMD["/cap:start"]:::support
    START_D["Resume previous<br/>session state"]:::desc
    START_CMD --- START_D
```

---

## Tag System — The Traceability Link

Tags in your source code are the bridge between the Feature Map and implementation:

```
Source Code                          Feature Map
-----------                          -----------
@cap-feature(feature:F-001)    <-->  F-001: Implement Auth
  @cap-todo(ref:F-001:AC-1)   <-->    AC-1: Login endpoint
  @cap-todo(ref:F-001:AC-2)   <-->    AC-2: JWT tokens
  @cap-todo risk: session...   <-->    (surfaced in pitfalls.md)
  @cap-todo decision: bcrypt   <-->    (surfaced in decisions.md)
```

**Primary tags (mandatory):**
- `@cap-feature(feature:F-NNN)` — marks a file as belonging to a feature
- `@cap-todo(ref:F-NNN:AC-N)` — marks implementation of a specific acceptance criterion

**Subtypes (optional):**
- `@cap-todo risk: ...` — known risk or concern
- `@cap-todo decision: ...` — architectural decision with rationale

---

## Memory System — Cross-Session Intelligence

```mermaid
flowchart TD
    classDef session fill:#7c3aed,color:#fff,stroke:#5b21b6
    classDef hook fill:#ddd6fe,color:#000,stroke:#7c3aed
    classDef memory fill:#e5e7eb,color:#000,stroke:#9ca3af
    classDef graph fill:#fef3c7,color:#000,stroke:#f59e0b
    classDef thread fill:#f59e0b,color:#000,stroke:#d97706

    SESSION["Claude Code Session"]:::session
    TAGS["@cap-decision tags<br/>@cap-todo risk: tags<br/>in source code"]:::session

    HOOK["cap-memory.js hook<br/>(runs on session end)"]:::hook

    DECISIONS[".cap/memory/decisions.md"]:::memory
    PITFALLS[".cap/memory/pitfalls.md"]:::memory
    PATTERNS[".cap/memory/patterns.md"]:::memory
    HOTSPOTS[".cap/memory/hotspots.md"]:::memory
    GRAPH[".cap/memory/graph.json<br/>Connected knowledge graph"]:::graph

    THREADS[".cap/memory/threads/<br/>Conversation threads"]:::thread

    SESSION -->|"session end"| HOOK
    TAGS -->|"scanned"| HOOK
    HOOK --> DECISIONS
    HOOK --> PITFALLS
    HOOK --> PATTERNS
    HOOK --> HOTSPOTS
    HOOK --> GRAPH

    BRAINSTORM["/cap:brainstorm"]:::thread
    BRAINSTORM -->|"persists thread"| THREADS
    BRAINSTORM -->|"checks prior threads"| THREADS

    RULE[".claude/rules/cap-memory.md<br/>Claude reads memory<br/>at session start"]:::hook
    DECISIONS -.-> RULE
    PITFALLS -.-> RULE
```

**How it works:**
1. You write code with `@cap-decision` and `@cap-todo risk:` tags
2. The memory hook extracts these after each session
3. Flat markdown files give you a human-readable view
4. The knowledge graph connects features, threads, decisions, and pitfalls
5. Claude auto-reads `.cap/memory/` at the start of every session via the rules file

---

## Typical Day-to-Day Workflow

```
Morning:
  /cap:start              # Restore session state, see what's in progress

New Feature:
  /cap:brainstorm         # Discover and define features
  /cap:prototype F-042    # Build the feature
  /cap:iterate            # Fill in gaps
  /cap:test F-042 --deep  # Verify ACs + audit trust score
  /cap:review             # Quality gate
  git push                # Ship it

Bug Found:
  /cap:debug              # Scientific method: hypothesize → test → conclude

Joining Existing Project:
  /cap:init               # Setup + detect stack + build memory
  /cap:status             # See where things stand
  /cap:annotate           # Tag existing code

Periodic:
  /cap:scan               # Keep Feature Map in sync
  /cap:memory init        # Bootstrap memory from all past sessions
  # Environment / install / library docs: see docs/setup-and-upgrade.md
```

---

## Key Principles

1. **Code is the plan** — Build first, extract structure from annotated code
2. **Feature Map is the single source of truth** — Not PRDs, not Jira, not Confluence
3. **Tags create traceability** — Every line of code links back to a requirement
4. **Agents are stateless** — All state lives in Feature Map, SESSION.json, and code tags
5. **Nothing is written without approval** — Brainstorm and review have explicit confirmation gates
6. **Memory persists across sessions** — Decisions, pitfalls, and threads survive context resets
