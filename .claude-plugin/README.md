# CAP — Claude Code Plugin Manifests

This directory holds the two manifests Claude Code reads when CAP is installed as a plugin (alongside, or instead of, `npx code-as-plan@latest`).

## Triple-name layout

CAP ships under three related-but-distinct names. Knowing which is which avoids most install-time confusion:

| Name | Where it appears | Purpose |
|------|------------------|---------|
| `code-as-plan` | `package.json`, npm registry, `.claude-plugin/marketplace.json` | **Distribution slug.** The npm package name and the marketplace listing both use this kebab-case form so `/plugin install code-as-plan` and `npx code-as-plan@latest` stay symmetric. |
| `cap` | `.claude-plugin/plugin.json` → `name`, slash commands (`/cap:init`, `/cap:status`, …), plugin cache directory (`~/.claude/plugins/cache/cap@…`) | **Plugin identity.** Short and command-friendly. All user-facing commands are namespaced `/cap:*`. |
| `code-as-plan` | GitHub repository, homepage URL | **Project identity.** Repository URL and documentation live under the descriptive long-form. |

The single source of truth for these names is [`cap/bin/lib/cap-plugin-manifest.cjs`](../cap/bin/lib/cap-plugin-manifest.cjs) (`PLUGIN_NAME`, `MARKETPLACE_NAME`, `NPM_PACKAGE_NAME`, `RESERVED_MARKETPLACE_NAMES`). Doctor checks, install detection, and tests all read from there.

## Why two manifests?

- **`plugin.json`** — consumed by Claude Code when the plugin is loaded. Declares metadata (name, version, author, commands directory) and is the file `isCapPluginManifest()` gates the local-dev install detection on.
- **`marketplace.json`** — consumed by the `/plugin install <name>` flow. Lists CAP as a marketplace entry so users can install via `/plugin install code-as-plan` without knowing the plugin's internal name.

Both coexist with the npx path. A user who installs via both routes gets a non-fatal warning from `cap:doctor` (dual-install is not an error — the npx copy and the plugin cache live in separate directories and do not collide).

## Coexistence with `npx`

`npx code-as-plan@latest` stays the primary install method. The plugin manifests are additive: they enable `/plugin install` as an alternative for users who prefer the marketplace UI, without deprecating the npx flow or fragmenting the CLI surface.
