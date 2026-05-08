---
name: cap:finalize
description: "Exit Phase 1 — run full CAP rigor (annotate + iterate + test + enrich) on the files changed since /cap:quick."
argument-hint: ""
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Agent
---

<!-- @cap-context F-092 two-phase workflow — Phase 2 (Solidify). Meta-command chaining existing tools. -->
<!-- @cap-decision /cap:finalize is a SEQUENCED PIPELINE — it does not introduce new logic, only orchestrates annotate/iterate/test/enrich on the changed-files set. -->
<!-- @cap-feature(feature:F-092) /cap:finalize chains existing CAP tools post-hoc. -->

<objective>
Solidify the visual-iteration work done in `/cap:quick` mode. Identifies files changed since quick-mode entry (committed + unstaged + untracked) and runs the full CAP rigor on them:

1. **Annotate** — set `@cap-feature(feature:F-X)` tags on changed files that lack them
2. **Iterate** — spawn `cap-prototyper` in iterate-Mode to review code, propose refactorings, define ACs from the implementation
3. **Test** — spawn `cap-tester` for RED-GREEN tests against the ACs
4. **Enrich** — Feature-Map files-list update via existing `enrichFromTags`

This is the Phase-2 catch-up. Use it when the visual iteration is done and you're satisfied with how it looks. The user owns the final review at each step.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Verify quick-mode is active

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
if (!s.quickMode || !s.quickMode.active) {
  console.error('Not in quick-mode. /cap:finalize is only meaningful after /cap:quick.');
  console.error('To run the full CAP flow on existing code without prior quick-mode, use:');
  console.error('  /cap:annotate, /cap:iterate <feature>, /cap:test <feature>');
  process.exit(2);
}
console.log('Active feature: ' + s.quickMode.feature);
console.log('Started: ' + s.quickMode.startedAt);
"
```

On exit 2: stop and surface the message.

## Step 2: Compute changed-files

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const result = session.getChangedFilesSinceQuickStart(process.cwd());
if (result.error) {
  console.error('git diff failed: ' + result.error);
  process.exit(1);
}
if (result.files.length === 0) {
  console.log('No files changed since /cap:quick. Nothing to finalize.');
  process.exit(0);
}
console.log(JSON.stringify(result, null, 2));
"
```

If exit 0 (no changes): clear quick-mode and stop. If exit 1 (git error): surface it, abort.

## Step 3: Print the finalize plan and confirm

Print verbatim:

```
=== Finalize Plan ===

Active feature: <feature>
Changed files: <N>
  - <file 1>
  - <file 2>
  ...

Will run, in order:
  1. /cap:annotate (changed files, scoped to <feature>)
  2. cap-prototyper iterate-Mode → review + AC definition + refactor proposals
  3. cap-tester → RED-GREEN tests against the new ACs
  4. enrichFromTags → FEATURE-MAP files-list update

Each step pauses for review before proceeding to the next.

Continue? (yes/no)
```

On `no`: stop, leave quick-mode active so the user can resume later.

## Step 4: Execute the chain

For each step below, after the step completes, ask the user: `Step <N> done. Proceed to step <N+1>? (yes/no/skip)`. On `no`: stop. On `skip`: move to next step.

### Step 4a: Annotate

Spawn `cap-prototyper` agent in annotate-Mode (`subagent_type: 'cap-prototyper'`). Prompt:

> "Annotate the following changed files with `@cap-feature(feature:<feature-id>)` tags where they don't already exist. Do NOT modify code logic. Only add the tag in a comment near the top of each file (or near the relevant function), preserving the file's existing style.
> Files: <list>
> Feature: <feature-id>"

### Step 4b: Iterate (review + AC definition)

Spawn `cap-prototyper` agent in iterate-Mode. Prompt:

> "The user just finished a Phase-1 visual iteration on <feature-id>. The implementation works visually but was built for speed, not rigor. Review the changed files, propose:
> 1. Acceptance Criteria (AC-1, AC-2, ...) derived from what the code now does
> 2. Refactoring opportunities (DRY, naming, extraction)
> 3. Edge cases not yet handled
> Do NOT silently rewrite code. Surface proposals for review.
> Files: <list>
> Feature: <feature-id>"

After the agent returns: append the proposed ACs to the feature's AC table in `features/<feature-id>.md` (sharded mode) or `FEATURE-MAP.md` (monolithic), pending user confirmation.

### Step 4c: Test

Spawn `cap-tester` agent. Prompt:

> "Write RED-GREEN tests for the ACs of <feature-id>. Use the project's test stack (detect from package.json or .cap/stack-docs/). Adversarial mindset — assume the implementation has bugs."

### Step 4d: Enrich Feature Map

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
const tags = scanner.scanDirectory(process.cwd(), { projectRoot: process.cwd() });
fm.enrichFromTags(process.cwd(), tags);
console.log('Feature Map enriched.');
"
```

## Step 5: Exit quick-mode

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.endQuickMode(process.cwd());
console.log('Quick-mode cleared. Phase 2 done.');
"
```

## Step 6: Suggest next action

- "Run `/cap:review <feature>` for final compliance + quality check"
- "Or `/cap:status` to see the updated state"

</process>
