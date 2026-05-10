# Quick Start

This page takes you from zero to a working CAP Pro feature in five commands. It assumes you have CAP Pro installed (`npx cap-pro@latest`) and a project to work in.

## 1. Initialise the project

In your project directory, run:

```
/cap:init
```

This creates:

- `.cap/` — ephemeral session state and project memory
- `FEATURE-MAP.md` — single source of truth for features and acceptance criteria
- `.cap/stack-docs/` — auto-fetched library documentation via Context7

`/cap:init` runs **brownfield analysis** on existing codebases — it will scan your code for existing patterns and pre-populate the Feature Map.

## 2. Discover features

```
/cap:brainstorm
```

This launches an interactive conversation with the `cap-brainstormer` agent. It:

- Asks targeted questions to understand what you want to build
- Clusters features into logical groups
- Surfaces dependencies between features
- Produces structured Feature Map entries with **acceptance criteria** (ACs)

Output: `FEATURE-MAP.md` populated with feature entries in state `planned`.

## 3. Build the prototype

```
/cap:prototype
```

The `cap-prototyper` agent:

- Reads the active feature from `FEATURE-MAP.md`
- Confirms the ACs with you (one round of "is this right?")
- Builds working code, embedding **`@cap-feature`** and **`@cap-todo`** tags
- Marks the feature `prototyped` in the Feature Map

The tags are how CAP Pro keeps the plan in sync with the code. Example:

```ts
// @cap-feature(feature:F-Hub-Spotlight, ac:1) Display spotlight banner with rotating slides
// @cap-todo(ac:F-Hub-Spotlight/AC-3, risk:medium) Hover-to-pause needs reduced-motion fallback
function SpotlightBanner({ slides }: Props) {
  // ...
}
```

## 4. Test it

```
/cap:test
```

The `cap-validator` agent (in `MODE: TEST`) writes runnable tests against the Feature Map ACs using **RED-GREEN discipline**:

1. Write the failing test first (RED)
2. Run it — confirm it fails for the right reason
3. Make it pass (GREEN)

The test framework is auto-detected (vitest, node:test, jest, pytest, …). Once all ACs are green, the feature transitions to `tested`.

## 5. Review & ship

```
/cap:review
```

`cap-validator` (in `MODE: REVIEW`) does a **two-stage review**:

- **Stage 1 — AC compliance**: every AC in the Feature Map has a green test? Every `@cap-todo` is closed?
- **Stage 2 — Code quality** (only if Stage 1 passes): security, performance, maintainability, anti-patterns.

Once both stages pass, the feature moves to `shipped` and you commit + tag.

## What's next?

- **Stuck?** → `/cap:debug` runs the scientific-method debugger with persistent state across context resets.
- **Lost track?** → `/cap:status` shows the feature dashboard (or `/cap:start` re-loads your last session).
- **Different team member taking over?** → see [Multi-User Workflow](/features/multi-user.md).
- **UI/design sprint with lots of small tweaks?** → see [Frontend Sprint Pattern](/best-practices/frontend-sprint.md).

## The auto-trigger contract

You **don't have to type the slash commands**. CAP Pro recognises the workflow moment and auto-invokes the right agent:

| Situation | Auto-action |
|---|---|
| You describe a new feature without a Feature Map entry yet ("we need X") | `/cap:brainstorm` |
| Feature in state `planned`, you say "let's build it" | `/cap:prototype` |
| Feature in state `prototyped` with open `@cap-todo` tags, you say "iterate" | `/cap:iterate` |
| Feature in state `prototyped` but not `tested` yet | `/cap:test` |
| Feature in state `tested`, you say "ready to ship" | `/cap:review` |
| You report a bug or "this works locally but not in prod" | `/cap:debug` |
| You ask "where are we?" / "show me the dashboard" | `/cap:status` |

The slash commands exist as **explicit power-user triggers**. In normal conversational use, just describe what you want and CAP Pro picks the right tool.
