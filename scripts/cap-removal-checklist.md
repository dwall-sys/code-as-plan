# CAP v2.0 -- GSD Removal Checklist

<!-- @gsd-context This document defines the COMPLETE removal plan for transitioning from GSD to CAP. It is NOT executed during prototyping -- it documents what gets removed when the clean break is made. -->
<!-- @gsd-decision Removal is documented as a checklist, not executed during prototype. This allows the current GSD infrastructure to keep working during development while clearly defining the target end state. -->

<!-- @gsd-todo(ref:AC-71) All /gsd:* commands shall be removed from the codebase -->
<!-- @gsd-todo(ref:AC-72) All gsd-* agent files shall be removed from the agents/ directory -->
<!-- @gsd-todo(ref:AC-73) Explicitly killed agents: gsd-discuss, gsd-planner, gsd-milestone-*, gsd-executor, gsd-annotator, and all discuss/plan phase agents -->
<!-- @gsd-todo(ref:AC-74) Artifacts no longer created or referenced: ROADMAP.md, REQUIREMENTS.md, STATE.md, MILESTONES.md, VERIFICATION.md, PLAN.md -->
<!-- @gsd-todo(ref:AC-75) CODE-INVENTORY.md evolved into enriched FEATURE-MAP.md -- standalone file removed -->
<!-- @gsd-todo(ref:AC-76) bin/install.js updated to reference CAP branding and commands -->
<!-- @gsd-todo(ref:AC-77) package.json name updated to cap (or code-as-plan fallback) -->

---

## 1. Agent Files to Remove (AC-72, AC-73)

The following agent files in `agents/` shall be deleted:

### Explicitly Killed Agents (AC-73)

These agents represent the discuss/plan workflow that CAP eliminates:

- [ ] `agents/gsd-planner.md` -- replaced by Feature Map + cap-prototyper
- [ ] `agents/gsd-executor.md` -- replaced by cap-prototyper (prototype/iterate modes)
- [ ] `agents/gsd-annotator.md` -- replaced by cap-prototyper (annotate mode)
- [ ] `agents/gsd-brainstormer.md` -- replaced by cap-brainstormer
- [ ] `agents/gsd-roadmapper.md` -- ROADMAP.md no longer exists
- [ ] `agents/gsd-plan-checker.md` -- no plan phase to check
- [ ] `agents/gsd-reviewer.md` -- replaced by cap-reviewer
- [ ] `agents/gsd-tester.md` -- replaced by cap-tester
- [ ] `agents/gsd-debugger.md` -- replaced by cap-debugger

### Supporting Agents to Remove

- [ ] `agents/gsd-advisor-researcher.md`
- [ ] `agents/gsd-arc-executor.md`
- [ ] `agents/gsd-arc-planner.md`
- [ ] `agents/gsd-assumptions-analyzer.md`
- [ ] `agents/gsd-code-planner.md`
- [ ] `agents/gsd-codebase-mapper.md`
- [ ] `agents/gsd-integration-checker.md`
- [ ] `agents/gsd-nyquist-auditor.md`
- [ ] `agents/gsd-phase-researcher.md`
- [ ] `agents/gsd-project-researcher.md`
- [ ] `agents/gsd-prototyper.md`
- [ ] `agents/gsd-research-synthesizer.md`
- [ ] `agents/gsd-ui-auditor.md`
- [ ] `agents/gsd-ui-checker.md`
- [ ] `agents/gsd-ui-researcher.md`
- [ ] `agents/gsd-user-profiler.md`
- [ ] `agents/gsd-verifier.md`

**Agents to KEEP (CAP v2.0 agent set per AC-67):**
- `agents/cap-brainstormer.md`
- `agents/cap-prototyper.md`
- `agents/cap-tester.md`
- `agents/cap-reviewer.md`
- `agents/cap-debugger.md`

---

## 2. Command Files to Remove (AC-71)

All files in `commands/gsd/` shall be deleted. Current GSD commands:

- [ ] `commands/gsd/add-backlog.md`
- [ ] `commands/gsd/add-phase.md`
- [ ] `commands/gsd/add-tests.md`
- [ ] `commands/gsd/add-todo.md`
- [ ] `commands/gsd/annotate.md`
- [ ] `commands/gsd/audit-milestone.md`
- [ ] `commands/gsd/audit-uat.md`
- [ ] `commands/gsd/autonomous.md`
- [ ] `commands/gsd/brainstorm.md`
- [ ] `commands/gsd/check-todos.md`
- [ ] `commands/gsd/cleanup.md`
- [ ] `commands/gsd/complete-milestone.md`
- [ ] `commands/gsd/debug.md`
- [ ] `commands/gsd/deep-plan.md`
- [ ] `commands/gsd/discuss-phase.md`
- [ ] `commands/gsd/do.md`
- [ ] `commands/gsd/execute-phase.md`
- [ ] `commands/gsd/extract-plan.md`
- [ ] `commands/gsd/fast.md`
- [ ] `commands/gsd/forensics.md`
- [ ] All remaining `commands/gsd/*.md` files

**Commands to KEEP (CAP v2.0 command set):**
- `commands/cap/init.md`
- `commands/cap/brainstorm.md`
- `commands/cap/prototype.md`
- `commands/cap/iterate.md`
- `commands/cap/annotate.md`
- `commands/cap/scan.md`
- `commands/cap/test.md`
- `commands/cap/review.md`
- `commands/cap/debug.md`
- `commands/cap/status.md`
- `commands/cap/start.md`
- `commands/cap/refresh-docs.md`

---

## 3. Artifact References to Remove (AC-74)

These planning artifacts shall no longer be created or referenced anywhere in the codebase:

- [ ] `ROADMAP.md` -- eliminated; features are in FEATURE-MAP.md
- [ ] `REQUIREMENTS.md` -- eliminated; ACs are in FEATURE-MAP.md
- [ ] `STATE.md` -- eliminated; state is in SESSION.json
- [ ] `MILESTONES.md` -- eliminated; no milestone concept in CAP
- [ ] `VERIFICATION.md` -- eliminated; review output goes to .cap/REVIEW.md
- [ ] `PLAN.md` -- eliminated; code is the plan
- [ ] `CODE-INVENTORY.md` -- evolved into FEATURE-MAP.md (AC-75)

### Files to grep and update:
- [ ] `CLAUDE.md` -- remove all references to gsd:* commands and GSD workflow
- [ ] `get-shit-done/references/arc-standard.md` -- update @gsd-* references to @cap-* or archive
- [ ] Any README or documentation referencing GSD commands

---

## 4. Package Configuration Changes (AC-76, AC-77)

### package.json updates (AC-77)

```json
{
  "name": "cap",
  "description": "CAP (Code As Plan) -- AI-native development where code IS the plan",
  "bin": {
    "cap": "bin/install.js"
  },
  "keywords": [
    "cap",
    "code-as-plan",
    "claude",
    "claude-code",
    "ai",
    "development-workflow"
  ]
}
```

Fallback name if `cap` is taken on npm: `code-as-plan`

### bin/install.js updates (AC-76)

- [ ] Update branding strings from "GSD" / "Get Shit Done" to "CAP" / "Code As Plan"
- [ ] Update command references from `/gsd:*` to `/cap:*`
- [ ] Update binary name from `get-shit-done-cc` to `cap`
- [ ] Update repository URLs if repo is renamed

### npm files array update (AC-99)

```json
{
  "files": [
    "bin",
    "commands/cap",
    "get-shit-done",
    "agents",
    "hooks/dist",
    "scripts"
  ]
}
```

Note: `commands/cap` instead of `commands` to exclude `commands/gsd/` from distribution.

---

## 5. Distribution Changes (AC-97, AC-98, AC-99)

- [ ] Package installable via `npx cap@latest` (AC-97)
- [ ] Build uses esbuild following `scripts/build-hooks.js` pattern (AC-98)
- [ ] npm `files` array includes: bin, commands/cap, agents, hooks/dist, scripts (AC-99)

---

## 6. Post-Removal Verification

After executing the removal:

1. [ ] `ls agents/` shows only 5 cap-* files
2. [ ] `ls commands/` shows only `commands/cap/` directory
3. [ ] `grep -r "gsd:" commands/ agents/` returns no results
4. [ ] `grep -r "ROADMAP\|REQUIREMENTS\|STATE\.md\|MILESTONES\|VERIFICATION\|PLAN\.md" commands/ agents/` returns no results
5. [ ] `npm test` passes
6. [ ] `npx cap@latest` installs and runs
7. [ ] `/cap:init` creates correct structure
8. [ ] `/cap:scan` detects tags correctly

---

## Execution Notes

- This removal should be executed as a SINGLE atomic operation (one commit)
- All tests must be updated to reference CAP instead of GSD before removal
- The `.planning/` directory contents are NOT part of the distributed package and can remain as historical reference
- The `get-shit-done/` directory name is a legacy artifact that may be renamed in a future pass (low priority)
