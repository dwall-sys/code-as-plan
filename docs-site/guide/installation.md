# Installation

CAP Pro installs in one command. The installer detects your AI runtime, sets up agents/commands/hooks, and (if you previously had `code-as-plan@7.x` installed) cleans up legacy files automatically.

## Requirements

- **Node.js 20+** (the CLI uses only Node.js built-ins — no runtime dependencies)
- One of the supported AI coding runtimes (see below)

## Quick install

```bash
npx cap-pro@latest
```

That's it. The installer prompts you for your runtime and install location, then handles everything.

## Supported runtimes

| Runtime | Flag | Config dir (global) |
|---|---|---|
| Claude Code | `--claude` | `~/.claude/` |
| OpenCode | `--opencode` | `~/.config/opencode/` |
| Gemini CLI | `--gemini` | `~/.gemini/` |
| Codex | `--codex` | `~/.codex/` |
| GitHub Copilot | `--copilot` | `~/.copilot/` |
| Antigravity | `--antigravity` | `~/.gemini/antigravity/` |
| Cursor | `--cursor` | `~/.cursor/` |
| Windsurf | `--windsurf` | `~/.windsurf/` |

You can install for one, several, or all runtimes:

```bash
# Single runtime
npx cap-pro@latest --claude --global

# Multiple runtimes
npx cap-pro@latest --claude --gemini --global

# All 8 runtimes
npx cap-pro@latest --all --global
```

## Install scope

```bash
# Local (current project only) — the default
npx cap-pro@latest --local

# Global (all projects) — most users want this
npx cap-pro@latest --global
```

Local installs put CAP Pro into `./.claude/` (or `./.opencode/`, etc.). Global installs put it into `~/.claude/` so all your projects get CAP Pro for free.

## Custom config directory

If you maintain multiple AI configs (e.g. work vs personal):

```bash
npx cap-pro@latest --claude --global --config-dir ~/.claude-work
```

This takes priority over `CLAUDE_CONFIG_DIR`, `GEMINI_CONFIG_DIR`, etc.

## Plugin marketplace (Claude Code)

In Claude Code you can also install CAP Pro via the plugin marketplace:

```
/plugin install cap-pro
```

The plugin path and the npm path coexist. The plugin name is `cap-pro`, the CLI binary is `cap`, the slash commands are `/cap:*`.

## Migrating from `code-as-plan@7.x`

If you previously ran `npx code-as-plan@latest`, the CAP Pro installer detects legacy files (retired commands, retired agents) and offers to clean them up before installing v1.0:

```text
  Legacy code-as-plan@7.x files detected

  CAP Pro 1.0 is a rebrand+reset of the framework formerly published as
  code-as-plan. A few files from the old version are still in this
  config directory and would conflict with CAP Pro:

    Retired agents (2): cap-tester.md, cap-reviewer.md
    Retired commands (5): cluster.md, report.md, doctor.md, update.md, refresh-docs.md

  Your project files — FEATURE-MAP.md, .cap/, code tags, memory — are
  100% format-compatible with CAP Pro and are NOT touched.

  1) Yes, remove retired files (recommended)
  2) No, keep them (--skip-legacy-cleanup for next time)
```

Choose **(1)** — your project state stays intact, only stale framework files are removed.

If you want to skip this for any reason: `--skip-legacy-cleanup`.

## Uninstall

```bash
npx cap-pro@latest --uninstall --global    # remove global install
npx cap-pro@latest --uninstall --local     # remove local install
```

This removes CAP Pro agents, commands, hooks, and statusline config from the runtime config directory. Your project files (`FEATURE-MAP.md`, `.cap/`, code with `@cap-*` tags) are NOT touched — those belong to your project, not to CAP Pro.

## Environment health

CAP Pro ships with an environment-health check (formerly `/cap:doctor`) — see [`docs/setup-and-upgrade.md`](https://github.com/dwall-sys/code-as-plan/blob/main/docs/setup-and-upgrade.md) on GitHub for the complete list.

## Updating

```bash
npx cap-pro@latest
```

Re-running the installer with the latest version updates everything in place. Your project state is never touched.

For a clean reinstall: `npx cap-pro@latest --force`.

## Verify your install

```bash
# In a project directory
/cap:status

# Or check the npm provenance attestation
npm view cap-pro dist.attestations
```
