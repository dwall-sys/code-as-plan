# What is CAP Pro?

**CAP Pro** (Code-as-Plan, Pro edition) is a developer framework for AI-assisted coding that follows the **Code-First principle**: instead of writing requirements documents before touching code, you build a working prototype, annotate it with two lightweight tags, and let the framework derive your project plan from what you actually built.

It works with **8 AI coding runtimes** — Claude Code, Gemini CLI, Codex, GitHub Copilot, Cursor, Windsurf, OpenCode, and Antigravity — from a single `npx cap-pro@latest` install.

## The problem CAP Pro solves

Most AI coding frameworks follow a plan-heavy workflow:

```
discuss → requirements → plan → execute → verify → review
   (9+ steps, with sub-steps and handover docs at every transition)
```

This produces a stack of planning artefacts — `ROADMAP.md`, `REQUIREMENTS.md`, `STATE.md`, `VERIFICATION.md`, `MILESTONES.md` — that **drift from reality the moment code changes**. You spend more time maintaining documents than building software.

CAP Pro inverts that:

| Traditional frameworks | CAP Pro |
|------------------------|---------|
| 9+ step workflow | 5 steps: brainstorm, prototype, iterate, test, review |
| 8+ mandatory tags / annotations | 2 mandatory tags: `@cap-feature`, `@cap-todo` |
| Manually maintained `ROADMAP.md` | `FEATURE-MAP.md` auto-derived from code + brainstorm |
| Separate `VERIFICATION.md` | Green tests = verified |
| `MILESTONES.md` with status tracking | Git tags = milestones |
| Runtime dependencies | Zero runtime dependencies (Node.js built-ins only) |
| Single AI runtime | 8 runtimes from one install |

> **Tests are verification. Git tags are milestones. Code is the plan.**
>
> CAP Pro eliminates accidental complexity by making code the single source of truth.

## Aligned with Modern Software Engineering

CAP Pro is aligned with **Dave Farley's "Modern Software Engineering"** philosophy — optimise for *learning* and *managing complexity*. The framework actively encourages:

- **Small, frequent integration** — every prototype iteration is a learning step.
- **Reversibility over commitment** — `cap-historian` lets you fork and roll back any session.
- **Empiricism over speculation** — RED-GREEN tests, not whiteboard plans, decide what is "done".
- **Cognitive load reduction** — two tags, five workflow steps, nine focused agents. No more.

## The 5-step workflow at a glance

```
  brainstorm  →  prototype  →  iterate  →  test  →  review
       │             │            │          │         │
  FEATURE-MAP   @cap-tags    scan + fix   green=done  ship
```

Each step has a slash command (`/cap:brainstorm`, `/cap:prototype`, …) and an underlying agent. In normal use you don't need to type the commands — CAP Pro recognises the workflow moment and auto-triggers the right agent. The commands exist as power-user explicit triggers.

[See the full workflow guide →](./workflow.md)

## What's in the box

After `npx cap-pro@latest`, you get:

- **5 per-feature agents** — `cap-brainstormer`, `cap-prototyper`, `cap-validator`, `cap-debugger`, `cap-designer`
- **4 project-wide agents** — `cap-historian` (snapshots & forks), `cap-curator` (status & dashboards), `cap-architect` (system review), `cap-migrator` (migrations)
- **20+ slash commands** — see the [command reference](/reference/commands)
- **Hooks** — auto-detection, drift checks, status-line integration
- **Project memory** — `.cap/memory/` auto-tracks decisions, pitfalls, patterns, hotspots
- **Context7 integration** — always-current library docs via `npx ctx7@latest`
- **Multi-user handoff** — built-in primitives for forward + reverse handoffs between team members

## Where to next?

- **Just want to start?** → [Quick Start](./quick-start.md)
- **Want to understand the philosophy?** → [Code-First Principle](/features/code-first.md)
- **Coming from `code-as-plan@7.x`?** → [Migration guide](./migrating.md)
- **Looking for a specific command?** → [Command reference](/reference/commands.md)
