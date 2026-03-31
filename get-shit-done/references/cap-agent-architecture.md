# CAP Agent Architecture

<!-- @gsd-context Reference document defining the CAP v2.0 agent architecture. All agents read this file to understand boundaries, communication rules, and naming conventions. -->
<!-- @gsd-decision Exactly 5 agents -- no more, no fewer. This is a hard constraint to prevent agent proliferation. New capabilities go into existing agents as modes. -->
<!-- @gsd-decision Communication via shared artifacts only -- agents never invoke each other directly. This eliminates coupling and makes each agent independently testable. -->

<!-- @gsd-todo(ref:AC-67) The system shall have exactly 5 agents: cap-brainstormer, cap-prototyper, cap-tester, cap-reviewer, cap-debugger -->
<!-- @gsd-todo(ref:AC-68) Each agent defined as Markdown file with Claude Code agent frontmatter (YAML) -->
<!-- @gsd-todo(ref:AC-69) Agents shall not depend on each other's internals -- communication via shared artifacts only -->
<!-- @gsd-todo(ref:AC-70) Agents placed in agents/ directory with cap- prefix naming -->

---

## Agent Roster (Exactly 5)

| Agent | File | Purpose | Spawned By |
|-------|------|---------|------------|
| cap-brainstormer | `agents/cap-brainstormer.md` | Feature discovery via conversation | `/cap:brainstorm` |
| cap-prototyper | `agents/cap-prototyper.md` | Code generation in 4 modes: prototype, iterate, architecture, annotate | `/cap:prototype`, `/cap:iterate`, `/cap:annotate` |
| cap-tester | `agents/cap-tester.md` | RED-GREEN test writing against Feature Map ACs | `/cap:test` |
| cap-reviewer | `agents/cap-reviewer.md` | Two-stage review: spec compliance then code quality | `/cap:review` |
| cap-debugger | `agents/cap-debugger.md` | Scientific method debugging with persistent state | `/cap:debug` |

**Hard constraint:** No additional agents shall be created. If a new capability is needed, it must be added as a mode to an existing agent (preferably cap-prototyper).

---

## Agent File Format (AC-68)

Every agent file follows this exact structure:

```yaml
---
name: cap-{name}
description: "{one-line description}"
tools: {comma-separated tool list}
permissionMode: acceptEdits
color: {color}
---
```

Followed by markdown content with:
- `<role>` section defining agent identity and behavior
- `<project_context>` section for context loading
- `<execution_flow>` section with numbered steps
- `@cap-feature` and `@cap-todo` tags embedded in HTML comments

---

## Communication Rules (AC-69)

Agents communicate ONLY through shared artifacts. No agent may:
- Import or require another agent's code
- Read another agent's internal state
- Assume another agent has run or will run
- Call Task() to spawn another agent (only commands do this)

### Shared Artifacts (the communication bus)

| Artifact | Location | Purpose | Read By | Written By |
|----------|----------|---------|---------|------------|
| FEATURE-MAP.md | Project root | Feature identity, state, ACs | All agents | brainstormer, prototyper, tester, reviewer |
| SESSION.json | `.cap/SESSION.json` | Ephemeral workflow state | All agents | Commands only |
| Source code with @cap-* tags | Project tree | Implementation state | All agents | prototyper |
| Stack docs | `.cap/stack-docs/` | Library documentation | All agents | `/cap:init`, `/cap:refresh-docs` |
| REVIEW.md | `.cap/REVIEW.md` | Review findings | prototyper (to address) | reviewer |
| Debug sessions | `.cap/debug/` | Debug state | debugger | debugger |

### Information Flow

```
brainstormer -> FEATURE-MAP.md -> prototyper -> code with @cap-* tags
                                      |
                                      v
                               /cap:scan -> FEATURE-MAP.md (enriched)
                                      |
                                      v
                                  tester -> test files -> reviewer
                                                            |
                                                            v
                                                     REVIEW.md -> prototyper (iterate)
```

---

## Naming Convention (AC-70)

- Agent files: `cap-{name}.md` in `agents/` directory
- Command files: `{name}.md` in `commands/cap/` directory
- CJS library files: `cap-{name}.cjs` in `get-shit-done/bin/lib/`
- Test files: `cap-{name}.test.cjs` in `tests/`
- Tag prefix: `@cap-` (not `@gsd-`)

---

## Anti-Patterns

1. **Do NOT create a 6th agent.** If you need new behavior, add a mode to cap-prototyper.
2. **Do NOT have agents call Task() to spawn other agents.** Only commands orchestrate agents.
3. **Do NOT have agents read SESSION.json to determine what another agent did.** Each agent reads FEATURE-MAP.md and code for state.
4. **Do NOT have agents write to .planning/ directory.** CAP artifacts go in project root (FEATURE-MAP.md) or .cap/ directory.
5. **Do NOT create .planning/codebase/ documents.** The 7-document codebase analysis from GSD is eliminated in CAP v2.0.
