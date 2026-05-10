# Multi-User Workflow

Many projects have multiple contributors with different focus areas — a frontend-focused engineer, a backend-focused engineer, a designer who hands off to implementation. CAP Pro has **first-class primitives** for this without spawning per-user agents.

## How it works

A single field — `activeUser` on `.cap/SESSION.json` — drives all CAP Pro Skills. Combined with **role rules** in your project's `CLAUDE.md`, this lets a single shared CAP Pro install behave differently per user.

## User detection

CAP Pro picks the active user in this order:

1. **Explicit `--user=<name>`** on `/cap:start`
2. **`git config user.email`** matched against project-defined patterns
3. **Ask once, persist** — the user picks on first run, CAP Pro remembers

## Role rules in `CLAUDE.md`

CAP Pro itself stays unopinionated about which user owns what. Your project's `CLAUDE.md` defines, per role:

- What the user owns (file globs, packages, layers)
- Default Skill priorities for that role
- Skills that should **not** auto-invoke for that role
- Topics that should **not** be pushed to that role

Example:

```markdown
## Multi-User Roles

### Bastian (design-focused)
- Owns: `apps/marketing/**`, `packages/ui/**`, design docs
- Default skills: `/cap:design`, `/cap:ui`, `/cap:brainstorm`
- Don't auto-invoke: `/cap:test`, `/cap:debug`
- Don't push: backend infra, db migrations

### Dennis (implementation-focused)
- Owns: `apps/api/**`, `packages/db/**`, infrastructure
- Default skills: `/cap:prototype`, `/cap:test`, `/cap:debug`
- Auto-invoke RED-GREEN test discipline aggressively
```

## Handoff snapshots

CAP Pro's `cap-historian MODE: SAVE` accepts a `handoff_to:` frontmatter field. The recipient sees an unconsumed handoff on their next `/cap:start` via `cap-historian MODE: CONTINUE`. Once the recipient writes a follow-up snapshot or runs a state-changing Skill on the same feature, the handoff is implicitly consumed.

### Forward handoff (design → implementation)

The design owner finishes the visual work and writes a snapshot for the implementation owner:

```yaml
handoff_to: dennis
handoff_from: bastian
handoff_type: design
handoff_date: 2026-05-10T14:30:00Z
feature: F-Hub-Spotlight-Carousel
handoff_phase: implementation
files_changed:
  - apps/marketing/src/components/Spotlight.tsx
  - packages/ui/src/Carousel.tsx
open_acs: [F-Hub-Spotlight/AC-3, F-Hub-Spotlight/AC-5]
exit_notes: |
  AC-1, AC-2, AC-4 covered with the new Carousel component.
  AC-3 (reduced-motion) + AC-5 (ARIA) need the implementation pass.
  Storybook story is in place — design is locked in.
```

### Reverse handoff (implementation → design briefing)

The implementation owner finishes and writes a structured briefing back:

```yaml
handoff_to: bastian
handoff_from: dennis
handoff_type: implementation
feature: F-Hub-Spotlight-Carousel
implementation_summary: |
  Implemented AC-3 and AC-5. Added a useReducedMotion hook for AC-3 and
  ARIA live-region announcements for AC-5. One divergence from the design.
verification_status:
  - { ac: F-Hub-Spotlight/AC-3, status: implemented+tested }
  - { ac: F-Hub-Spotlight/AC-5, status: implemented+tested, caveat: "manual test in Safari only" }
divergence_from_design:
  - title: "Auto-advance interval changed from 5s to 7s"
    reason: "Usability testing showed 5s was too fast for screen-reader users"
    ask: "Are you OK with 7s, or want a different fallback for SR users?"
open_questions:
  - "Should the manual nav arrows be visible on touch devices, or hide them?"
suggestions:
  - title: "Extract Carousel into its own package for re-use in /pricing"
    rationale: "We are about to need it in F-Hub-Pricing too"
    effort: M
    risk: low
```

## Open-questions-block-rule

If a briefing has unanswered `open_questions`, CAP Pro's auto-trigger contract softens: state-changing Skills on that feature won't auto-invoke until the recipient answers. Soft enforcement only — explicit slash commands always override.

## The ping-pong loop

A feature can ping-pong between design and implementation handoffs multiple times. Each handoff is a snapshot; each answer is a follow-up snapshot. The full conversation is preserved in `.cap/snapshots/` and indexed in `index.jsonl`.

## When NOT to use multi-user mode

- **Solo projects.** The CAP Pro repo itself is single-user — no `activeUser` field set, no role rules in `CLAUDE.md`, no handoffs. Multi-user adds overhead; only use it when there are actually multiple humans.
- **Pair-programming sessions.** When two people are at one keyboard, role-aware handoffs are pointless — just do the work.
- **Pure infrastructure-as-code repos** with one owner.

## Reference: snapshot frontmatter

```yaml
handoff_to: <recipient-user>
handoff_from: <sender-user>
handoff_type: design | implementation
handoff_date: <ISO timestamp>
feature: F-XXX
handoff_phase: <next-phase>
files_changed: [list]

# Forward (design) handoff:
open_acs: [list]
exit_notes: |
  Free-form notes on what's done and what's open.

# Reverse / implementation briefing:
implementation_summary: |
  3-5 sentence executive summary of what was built.
verification_status:
  - { ac: F-X/AC-Y, status: implemented+tested, caveat: <e.g. "design pass not done"> }
divergence_from_design:
  - { title: <short>, reason: <why>, ask: <question> }
open_questions:
  - <question, blocking by default>
suggestions:
  - { title: <improvement>, rationale: <why>, effort: S|M|L, risk: low|medium|high }
```
