---
layout: home

hero:
  name: CAP Pro
  text: Code is the Plan.
  tagline: Build first. Plan from code. Ship with confidence. The Code-First framework for AI-assisted coding — across 8 runtimes.
  image:
    src: /logo.svg
    alt: CAP Pro
  actions:
    - theme: brand
      text: Get Started
      link: /guide/what-is-cap-pro
    - theme: alt
      text: Quick Start
      link: /guide/quick-start
    - theme: alt
      text: GitHub
      link: https://github.com/dwall-sys/code-as-plan

features:
  - icon: 🧠
    title: Code-First, Not Doc-First
    details: Stop writing requirements docs that drift from reality. Build a working prototype, annotate it with two simple tags, and let CAP Pro derive your project plan from what you actually built.

  - icon: 🏷️
    title: Two Tags. That's It.
    details: '@cap-feature marks what the code does, @cap-todo marks what is still open. The whole project plan emerges from these two tags — no ROADMAP.md, no REQUIREMENTS.md to maintain.'

  - icon: 🔁
    title: 5-Step Workflow
    details: 'brainstorm → prototype → iterate → test → review. Linear by default, re-entrant by design. Every step is a slash command (/cap:brainstorm, /cap:prototype, …) that auto-triggers when the moment is right.'

  - icon: 🤖
    title: 9 Focused Agents
    details: Per-feature micro-workflow agents (brainstormer, prototyper, validator, debugger, designer) and project-wide macro-workflow agents (historian, curator, architect, migrator). Each one does one thing well.

  - icon: 🌐
    title: Works Everywhere
    details: 'Claude Code, Gemini CLI, Codex, GitHub Copilot, Cursor, Windsurf, OpenCode, Antigravity. One install, all 8 runtimes — or pick the ones you use.'

  - icon: 👥
    title: Multi-User by Design
    details: First-class handoff snapshots between team members. Forward (design → implementation) and reverse (implementation → design briefing) handoffs with structured open-questions, suggestions, and divergence rationale.

  - icon: 🧪
    title: RED-GREEN Testing
    details: 'Tests verify Acceptance Criteria from the Feature Map. Adversarial RED-GREEN discipline: write the failing test first, ship only when green.'

  - icon: 📚
    title: Always-Current Library Docs
    details: 'Context7 integration auto-fetches up-to-date documentation for every dependency in your project. No more debugging against a 6-month-old API surface.'

  - icon: 🧠
    title: Project Memory
    details: '.cap/memory/ tracks decisions, pitfalls, patterns, and hotspots — auto-updated from your sessions and code. Your project remembers what worked and what burned.'
---

<div style="text-align: center; margin-top: 64px;">

## Install in one command

```bash
npx cap-pro@latest
```

No config required. Pick your AI runtime, the installer handles the rest.

</div>

<div style="margin-top: 48px;">

## Why "Pro"?

CAP Pro is a hard rebrand and version reset of the project formerly published as `code-as-plan`. We re-architected the framework end-to-end across the `iteration/cap-pro-1` … `cap-pro-4` cycles — new agent topology, new memory layout, multi-user handoffs, sharded Feature Maps, 8-runtime support — and shipped it as **v1.0.0** under a new npm name. See [Migrating from code-as-plan@7.x](/guide/migrating) if you used the old version.

The CLI command stays `cap`. All slash commands stay `/cap:*`. All tags stay `@cap-*`. Only the npm package name and version reset.

</div>
