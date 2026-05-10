# Roadmap

This is the public roadmap for CAP Pro. It is intentionally short — we ship features that **need** to exist, not features that *might* be cool. If you'd like to influence what's next, [open an issue](https://github.com/dwall-sys/code-as-plan/issues).

> Status legend: 🟢 shipped · 🟡 in progress · 🔵 planned · ⚪ exploring · ❌ explicitly not on the roadmap

## Now (CAP Pro 1.0 — May 2026)

🟢 Hard rebrand from `code-as-plan` to `cap-pro`, version reset to `1.0.0`
🟢 Sharded Feature Map (`features/<ID>.md`) — 10–50× token reduction
🟢 V6 per-feature memory layout
🟢 9-agent topology (5 per-feature + 4 project-wide)
🟢 Multi-user handoff snapshots (forward + reverse, with structured briefings)
🟢 Auto-trigger contract for slash commands
🟢 Frontend Sprint Pattern (Phase-1 / Phase-2 auto-detection)
🟢 8 runtimes from one install
🟢 VitePress documentation site (this site)
🟢 GitHub Pages deploy on push
🟢 Auto-publish on `package.json` version bump

## Next (CAP Pro 1.1 — target Q3 2026)

🟡 **Telemetry & feedback** — opt-in usage data collection (see [Data Collection](#data-collection-roadmap) below)
🔵 **Custom-agent SDK** — drop a JSON manifest into `.cap/agents/` and CAP Pro discovers and routes to your custom agent
🔵 **`/cap:bench`** — a benchmark command that measures CAP Pro's token savings vs running the same workflow without sharded layout / V6 memory / focused agents
🔵 **Plugin marketplace integration** for OpenCode, Gemini CLI (currently only Claude Code)
🔵 **Native VS Code extension** — show Feature Map state, hotspot highlights, and AC checklist inline in the editor

## Later (CAP Pro 1.2 and beyond)

⚪ **Distributed multi-user mode** — currently `activeUser` is per-machine; explore a sync layer for genuinely concurrent multi-user sessions
⚪ **Auto-detect the right ignore globs** for monorepos with `.gitignore` + `package.json:workspaces` introspection
⚪ **`cap-architect`-driven module split proposals** that produce diffs (not just suggestions) — gated behind explicit user approval
⚪ **Feature Map import / export** in OpenAPI / JSON Schema for downstream tooling
⚪ **Agent observability** — JSON-streamed agent logs with structured trace IDs, integrated into the OpenTelemetry ecosystem
⚪ **Cross-project memory** — patterns extracted from many projects, surfaced as portfolio-wide pitfalls (opt-in, anonymous)

## Explicitly NOT on the roadmap

❌ **A CAP Pro web UI / dashboard.** The point is to stay close to the code. A web UI duplicates effort and drifts from the truth.
❌ **A CAP Pro hosted SaaS.** Local-first, file-first. Your project's state is in your repo. End of story.
❌ **A CAP Pro proprietary LLM.** We are runtime-agnostic on purpose.
❌ **Closed-source CAP Pro Premium tier.** MIT license, full stop.
❌ **Replacing your IDE.** CAP Pro is a workflow framework, not an editor.

## Influencing the roadmap

We weigh four signals:

1. **GitHub issues with concrete reproduction.** A bug with a 5-line repro is worth 10 vague feature requests.
2. **Telemetry signals** (once we ship telemetry — see below). If 80% of users never use a command, we'll deprecate it.
3. **Real-project usage by the maintainers.** CAP Pro is dogfooded on projects we ship; pain we hit becomes priorities.
4. **Aligned philosophy.** Features that violate the Code-First principle (e.g. "let's add a separate REQUIREMENTS.md format") get rejected on principle.

## Data Collection Roadmap

To prioritise the roadmap honestly, we want **opt-in** usage telemetry. Here's the brainstorm of what we'd want to collect — none of it is shipped yet, all of it is opt-in only.

### What we'd want to know

| Data point | Why we want it | Sensitivity |
|---|---|---|
| **Which slash commands you run** (count by command, not args) | Identify dead commands; deprecate those nobody uses | Low |
| **Which agents you spawn** (count, mode, time-to-complete) | Detect agents that are slow / hang / fail | Low |
| **Feature Map size** (number of features, AC count distribution) | Decide when to make sharded layout the default | Low |
| **Memory size** (number of decisions / pitfalls / patterns) | Decide when to make V6 the default | Low |
| **Auto-trigger hit/miss rate** | Improve the auto-trigger contract | Low |
| **Runtime mix** (Claude Code vs Gemini vs Cursor vs …) | Prioritise which runtimes deserve more polish | Low |
| **Crash / error rate per command** | Find and fix broken paths | Low |
| **`/cap:debug` hypothesis count and resolution rate** | Improve the debugger's prompts | Medium |
| **Time spent in Phase-1 vs Phase-2 of frontend sprints** | Tune the auto-detection thresholds | Medium |

### What we will NEVER collect

- File contents, code snippets, commit messages, branch names, file paths
- Feature Map content (titles, descriptions, ACs)
- Tag content
- Memory file content
- Session conversation transcripts
- Project name, repo URL, or any identifier that links data to a specific project
- User identifiers, emails, IPs (we use random opaque session IDs that rotate)

### How we'd ship it

- **Opt-in only.** A new `/cap:telemetry on` command. Default: off. The first run after upgrade asks once, never again.
- **Local file you can inspect.** `.cap/telemetry-pending.jsonl` — every event is written here first. You can `cat` it, see exactly what's about to be sent.
- **Batched + forgettable.** Sent once a week if online; if offline, deleted after 30 days unsent.
- **`/cap:telemetry inspect`** — show last 100 events.
- **`/cap:telemetry off`** — turn it off, deletes pending file.
- **Open-source backend.** The aggregation server is in the same repo, so you can audit it.

If you want to weigh in on the telemetry design *before* it ships, please [open an issue](https://github.com/dwall-sys/code-as-plan/issues/new) — we'd rather get this right than ship it fast.
