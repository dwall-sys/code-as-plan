# Multi-Runtime Support

CAP Pro is **the only Code-First framework that runs across 8 AI coding runtimes from a single install**:

- Claude Code
- Gemini CLI
- Codex
- GitHub Copilot
- Cursor
- Windsurf
- OpenCode
- Antigravity

The installer translates the canonical Claude Code agent/command format into each runtime's native format and writes them into the right config directory.

## Why care?

Most frameworks lock you into one runtime. If you switch tools, you lose your workflow. CAP Pro's tags and Feature Map travel with the *project*, not the *tool* — so when you switch from Claude Code to Cursor or back, your CAP Pro state is intact.

## What gets translated

| Source (Claude Code) | Translated to |
|---|---|
| `~/.claude/agents/cap-*.md` (Markdown agent with YAML frontmatter) | Native agent format for each runtime |
| `~/.claude/commands/cap/*.md` (slash command) | Skill / command for each runtime |
| `~/.claude/hooks/*` | Native hook format where supported |
| Tool names (`Read`, `Edit`, `Bash`, `Grep`) | Mapped to runtime-specific tool names (e.g. Copilot's `read`, `edit`, `execute`, `search`) |

## Per-runtime install commands

```bash
# Pick what you use
npx cap-pro@latest --claude
npx cap-pro@latest --cursor
npx cap-pro@latest --windsurf

# Or install for everything at once
npx cap-pro@latest --all
```

## Slash command syntax differences

| Runtime | Syntax |
|---|---|
| Claude Code | `/cap:prototype` |
| Gemini CLI | `/cap:prototype` |
| OpenCode | `/cap-prototype` |
| Codex | `$cap-prototype` |
| GitHub Copilot | `/cap-prototype` |
| Antigravity | `/cap-prototype` |
| Cursor | `cap-prototype` (mention the skill name) |
| Windsurf | `/cap-prototype` |

The CAP Pro installer handles all of this — you don't have to remember.

## Tool-name mapping (Copilot example)

GitHub Copilot uses different tool names than Claude. The installer maps them:

| Claude Code | Copilot |
|---|---|
| `Read` | `read` |
| `Write`, `Edit` | `edit` |
| `Bash` | `execute` |
| `Grep`, `Glob` | `search` |
| `Task` | `agent` |
| `WebSearch`, `WebFetch` | `web` |
| `TodoWrite` | `todo` |
| `AskUserQuestion` | `ask_user` |
| `SlashCommand` | `skill` |

This mapping applies only to **agents**. Skills (slash commands) are passed through unchanged.

## Custom config directories

Multi-config users (work vs personal, multiple Claude profiles):

```bash
npx cap-pro@latest --claude --global --config-dir ~/.claude-work
```

Takes priority over runtime-specific env vars (`CLAUDE_CONFIG_DIR`, `GEMINI_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_CONFIG_DIR`, `ANTIGRAVITY_CONFIG_DIR`, `CURSOR_CONFIG_DIR`, `WINDSURF_CONFIG_DIR`).

## What does NOT translate

A few features are runtime-specific:

- **Statusline integration** — Claude Code and Gemini CLI only.
- **Session-extract subcommand** (`cap extract`) — relies on Claude Code's session log format.
- **Hooks** — only Claude Code, OpenCode, Gemini and Codex have a stable hook system. Copilot and Cursor don't expose pre/post-tool hooks the same way.

For these, CAP Pro degrades gracefully — the affected feature is a no-op on unsupported runtimes, but everything else works.

## Roadmap: more runtimes?

If a new AI coding runtime appears (Sourcegraph Cody, Aider, Continue, …) and has a stable agent + skill format, we'll add it. [Open an issue](https://github.com/dwall-sys/code-as-plan/issues/new) with the runtime's spec link.
