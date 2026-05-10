# Migrating from `code-as-plan@7.x`

CAP Pro 1.0 is a **rebrand and version reset** of the framework formerly published as `code-as-plan`. This page covers the practical migration steps.

## TL;DR

```bash
# Replace this:
npx code-as-plan@latest

# With this:
npx cap-pro@latest
```

The installer will detect any leftover legacy files from the old `code-as-plan@7.x` install and clean them up automatically. Your project state — `FEATURE-MAP.md`, `.cap/`, code with `@cap-*` tags, project memory — is **100% format-compatible** and not touched.

## What changed

| | `code-as-plan@7.x` | `cap-pro@1.0.0` |
|---|---|---|
| **npm package** | `code-as-plan` (frozen) | `cap-pro` (active) |
| **Install command** | `npx code-as-plan@latest` | `npx cap-pro@latest` |
| **Plugin name** | `cap` | `cap-pro` |
| **CLI binary** | `cap` | `cap` *(unchanged)* |
| **Slash commands** | `/cap:*` | `/cap:*` *(unchanged)* |
| **Tags** | `@cap-feature`, `@cap-todo`, … | *(unchanged)* |
| **Project artefacts** | `FEATURE-MAP.md`, `.cap/` | *(unchanged)* |

So the user-visible surface inside Claude Code (the slash commands, the agents, the tags, the file formats) is identical. Only the package name on npm changed.

## Why a new package name?

The technical reason: npm only allows you to publish *higher* versions, never lower. To do a clean version reset to `1.0.0`, we needed a new package name.

The marketing reason: the framework was completely re-architected over the `iteration/cap-pro-1` … `cap-pro-4` cycles. Continuing to bump the version on the old name (`7.x`, `8.x`, …) understated how big the change was. The "Pro" rebrand and the `1.0.0` reset signal a clean start.

## What is removed?

The CAP Pro installer cleans up these legacy files automatically:

**Retired agents:**
- `cap-tester.md` — consolidated into `cap-validator MODE: TEST`
- `cap-reviewer.md` — consolidated into `cap-validator MODE: REVIEW`

**Retired commands:**
- `/cap:cluster` — replaced by `cap-curator MODE: CLUSTERS`
- `/cap:report` — replaced by `cap-curator MODE: REPORT`
- `/cap:refresh-docs` — replaced by `/cap:memory status` + native Context7
- `/cap:switch-app` — replaced by `/cap:start --app=<name>`
- `/cap:quick`, `/cap:finalize` — replaced by the [Frontend Sprint Pattern](/best-practices/frontend-sprint.md)
- `/cap:doctor`, `/cap:update`, `/cap:upgrade` — replaced by re-running `npx cap-pro@latest`
- `/cap:new-project` — replaced by `/cap:init`

If the installer detects any of these, you get an interactive prompt:

```
Legacy code-as-plan@7.x files detected
…
1) Yes, remove retired files (recommended)
2) No, keep them (--skip-legacy-cleanup for next time)
```

Choose **(1)**.

## Manual migration (if you want full control)

```bash
# 1. Uninstall the old version (optional — the new installer handles this)
npx code-as-plan@latest --uninstall --global

# 2. Install CAP Pro
npx cap-pro@latest --global

# 3. Verify
/cap:status
```

## After migration

Your existing projects work without any changes. `/cap:start` in an existing project loads the same `FEATURE-MAP.md`, the same `.cap/SESSION.json`, the same `.cap/memory/` you had before — all of it is forward-compatible.

If you have personal scripts or CI that call `npx code-as-plan ...`, update them to `npx cap-pro ...`.

## Should I keep the old npm package installed?

No. Once the CAP Pro installer has cleaned up the legacy files, there is nothing left from the old npm cache that affects you. The `code-as-plan@7.x` package on npm itself can be left alone — it is frozen and will not be updated, but it does not interfere with `cap-pro`.

## Questions?

[Open an issue on GitHub →](https://github.com/dwall-sys/code-as-plan/issues)
