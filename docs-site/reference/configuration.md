# Configuration

CAP Pro's configuration lives in two places: per-project (`.cap/config.json`) and per-runtime (your AI runtime's settings file, e.g. `~/.claude/settings.json`).

## Per-project: `.cap/config.json`

```json
{
  "memory": {
    "layout": "v6"
  },
  "featureMap": {
    "layout": "sharded"
  },
  "scan": {
    "ignore": [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**"
    ]
  },
  "monorepo": {
    "apps": ["apps/*"],
    "packages": ["packages/*"]
  }
}
```

| Key | Values | Default |
|---|---|---|
| `memory.layout` | `"v5"`, `"v6"` | `"v5"` |
| `featureMap.layout` | `"monolithic"`, `"sharded"` | auto-detected |
| `scan.ignore` | array of globs | reasonable defaults |
| `monorepo.apps` | array of globs | auto-detected from `nx.json`, `turbo.json`, `pnpm-workspace.yaml`, `package.json:workspaces` |
| `monorepo.packages` | array of globs | same |

## Per-runtime: AI runtime settings

CAP Pro writes hooks and (optionally) a statusline into your AI runtime's settings file. The path depends on the runtime:

| Runtime | Settings file (global) |
|---|---|
| Claude Code | `~/.claude/settings.json` |
| OpenCode | `~/.config/opencode/opencode.json` (or `.jsonc`) |
| Gemini CLI | `~/.gemini/settings.json` |
| Codex | `~/.codex/config.toml` |
| GitHub Copilot | `~/.copilot/copilot-instructions.md` |
| Antigravity | `~/.gemini/antigravity/settings.json` |
| Cursor | `~/.cursor/settings.json` |
| Windsurf | `~/.windsurf/settings.json` |

CAP Pro never overwrites custom settings you have in those files. It uses **markers** (`# CAP Agent Configuration — managed by code-as-plan installer`) to identify CAP-Pro-managed blocks and only modifies those.

To remove all CAP Pro settings cleanly:

```bash
npx cap-pro@latest --uninstall --global
```

## Hooks

CAP Pro ships with a few hooks that run automatically:

| Hook | Triggers | Purpose |
|---|---|---|
| `pre-tool-use` | Before any tool call | Auto-detect frontend sprint mode, suggest commands |
| `session-start` | When a new session opens | Auto-load the last snapshot, refresh memory |
| `session-stop` | When a session ends | Auto-write a checkpoint |
| `tag-drift-check` | Periodic | Warn when code-Feature-Map drift exceeds threshold |

Hooks are runtime-specific — Claude Code, OpenCode, Gemini and Codex have stable hook systems; Copilot and Cursor don't expose pre/post-tool hooks the same way, so a few hooks degrade gracefully on those runtimes.

## Environment variables

| Var | Purpose |
|---|---|
| `CLAUDE_CONFIG_DIR` | Override Claude Code config dir |
| `GEMINI_CONFIG_DIR` | Override Gemini config dir |
| `CODEX_HOME` | Override Codex config dir |
| `COPILOT_CONFIG_DIR` | Override Copilot config dir |
| `OPENCODE_CONFIG_DIR` | Override OpenCode config dir |
| `OPENCODE_CONFIG` | Path to OpenCode config file |
| `ANTIGRAVITY_CONFIG_DIR` | Override Antigravity config dir |
| `CURSOR_CONFIG_DIR` | Override Cursor config dir |
| `WINDSURF_CONFIG_DIR` | Override Windsurf config dir |
| `CONTEXT7_API_KEY` | Higher rate limits for `npx ctx7@latest` |
| `CAP_TEST_MODE` | Used by CAP Pro's test suite |

The `--config-dir` CLI flag takes priority over all of these.

## `.gitignore` recommendations

`/cap:init` writes these to your `.gitignore`:

```gitignore
# CAP Pro
.cap/SESSION.json
.cap/stack-docs/
.cap/migrations/*/backup/
```

The other `.cap/` artefacts — `FEATURE-MAP.md`, `features/` (sharded), `.cap/memory/`, `.cap/snapshots/` — **should** be committed to git. They are part of the project.
