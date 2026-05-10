---
name: cap:review
description: Two-stage code review -- Stage 1 checks Feature Map AC compliance, Stage 2 checks code quality. Stage 2 only runs if Stage 1 passes.
argument-hint: "[--features NAME] [--stage2-only]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Task
  - Glob
  - Grep
  - AskUserQuestion
---

<!-- @cap-context CAP v2.0 review command -- orchestrates two-stage code review. Collects test results, reads Feature Map ACs, spawns cap-validator agent. -->
<!-- @cap-decision Stage 2 only runs if Stage 1 passes -- prevents wasted review cycles on code that does not meet spec. -->
<!-- @cap-decision Review output goes to .cap/REVIEW.md -- centralized under .cap/ runtime directory. -->

<objective>
<!-- @cap-todo(ref:AC-58) /cap:review shall invoke the cap-validator agent for two-stage review. -->

Runs two-stage code review:
1. Stage 1: Check Feature Map AC compliance (does the code implement what was promised?)
2. Stage 2: Check code quality (security, maintainability, error handling)

Stage 2 only runs if Stage 1 passes.

**Arguments:**
- `--features NAME` -- scope review to specific Feature Map entries
- `--stage2-only` -- skip Stage 1, run only code quality review
</objective>

<context>
$ARGUMENTS

@FEATURE-MAP.md
@.cap/SESSION.json
</context>

<process>

## Step 0: Parse flags

Check `$ARGUMENTS` for:
- `--features NAME` -- if present, store as `feature_filter`
- `--stage2-only` -- if present, set `stage2_only = true`

## Step 1: Collect test results

Run existing tests to get current pass/fail state:

```bash
node --test tests/*.test.cjs 2>&1 | tail -30
```

Store output as `test_output` and exit code as `test_exit_code`.

## Step 2: Read Feature Map ACs for review scope

<!-- @cap-todo(ref:AC-59) Stage 1: cap-validator shall verify that the implementation satisfies all acceptance criteria listed in the Feature Map entry. -->

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const session = require('./cap/bin/lib/cap-session.cjs');
const scanner = require('./cap/bin/lib/cap-tag-scanner.cjs');
// @cap-todo(ac:F-081/AC-4 iter:2) Migrated to {safe: true} opt-in to preserve CLI on duplicate-ID FEATURE-MAP.
// @cap-decision(F-081/iter2) Warn on parseError; continue with partial map for read-only display.
const featureMap = fm.readFeatureMap(process.cwd(), undefined, { safe: true });
if (featureMap && featureMap.parseError) {
  console.warn('cap: review — duplicate feature ID detected, AC checklist uses partial map: ' + String(featureMap.parseError.message).trim());
}
const s = session.loadSession(process.cwd());
const tags = scanner.scanDirectory(process.cwd());
const groups = scanner.groupByFeature(tags);

console.log(JSON.stringify({
  activeFeature: s.activeFeature,
  features: featureMap.features.map(f => ({
    id: f.id, title: f.title, state: f.state,
    acs: f.acs, files: f.files
  })),
  tagGroups: Object.fromEntries(
    Object.entries(groups).map(([k, v]) => [k, v.map(t => ({ type: t.type, file: t.file, line: t.line, description: t.description }))])
  )
}));
"
```

**Scope features:**
- If `feature_filter`: filter to matching IDs
- Else if active feature: use only that feature
- Else: use all features with state `tested`

Store as `review_features`.

## Step 3: Spawn cap-validator for Stage 1 (AC compliance)

<!-- @cap-todo(ref:AC-61) cap-validator shall check that all code implementing the feature has appropriate @cap-feature annotations. -->

**Skip Stage 1 if `stage2_only`.**

Spawn `cap-validator` via Task tool:

```
**MODE: REVIEW**

**STAGE 1: ACCEPTANCE CRITERIA COMPLIANCE**

**Features under review:**
{For each review_feature:}
Feature: {feature.id} - {feature.title} [{feature.state}]
Implementation files: {feature.files.join(', ')}
Acceptance criteria:
{For each AC:}
  {ac.id}: {ac.description} [{ac.status}]
{End for}
{End for}

**Tag evidence:**
{For each feature in tagGroups:}
  {feature_id}: {tags.length} tags across {unique files}
{End for}

**Test results:**
{test_output}
Test exit code: {test_exit_code}

**Stage 1 checklist:**
For each AC in each feature under review:
1. Is there code that implements this AC?
2. Is the implementing code annotated with @cap-feature(feature:{ID})?
3. Is there a test that verifies this AC?
4. Does the test pass?

**Return format:**
=== STAGE 1 RESULTS ===
VERDICT: PASS | FAIL
{For each feature:}
FEATURE: {id}
{For each AC:}
  {ac.id}: PASS | FAIL | PARTIAL -- {evidence or reason}
{End for}
{End for}
MISSING_ANNOTATIONS: [list of files implementing features without @cap-feature tags]
=== END STAGE 1 RESULTS ===
```

Parse the Stage 1 results.

**If Stage 1 VERDICT is FAIL and NOT `stage2_only`:**

Display Stage 1 failures and STOP:

```
cap:review Stage 1 FAILED.

{For each failing AC:}
  {feature.id}/{ac.id}: FAIL -- {reason}
{End for}

{If missing annotations:}
Missing @cap-feature annotations:
  {For each file: - file}
{End if}

Stage 2 (code quality) skipped -- fix Stage 1 issues first.
Run /cap:iterate to address gaps, then re-run /cap:review.
```

## Step 4: Spawn cap-validator for Stage 2 (code quality)

<!-- @cap-todo(ref:AC-60) Stage 2: cap-validator shall perform code quality review (naming, structure, complexity, test coverage, tag completeness). -->

Spawn `cap-validator` via Task tool:

```
**MODE: REVIEW** (Stage 2 only)

**STAGE 2: CODE QUALITY REVIEW**

{If not stage2_only:}
Stage 1 passed. All ACs verified.
{End if}

**Features under review:**
{For each review_feature:}
Feature: {feature.id} - {feature.title}
Implementation files: {feature.files.join(', ')}
{End for}

**Review checklist:**
1. **Naming:** Are function/variable/file names clear and consistent with project conventions?
2. **Structure:** Is the code organized logically? Are modules appropriately sized?
3. **Complexity:** Are there functions > 50 lines? Deep nesting > 3 levels? Cyclomatic complexity concerns?
4. **Error handling:** Are errors handled gracefully? Are edge cases covered?
5. **Security:** Any hardcoded credentials, SQL injection vectors, XSS risks, path traversal?
6. **Test coverage:** Are critical paths tested? Are error paths tested?
7. **Tag completeness:** Does every significant function have @cap-feature annotation?
8. **Dependencies:** Are there unnecessary imports or tight coupling between modules?

**Return format:**
=== STAGE 2 RESULTS ===
VERDICT: PASS | PASS_WITH_NOTES | FAIL
FINDINGS:
{numbered list of findings with severity: critical/warning/note}
TOP_5_ACTIONS:
1. {actionable improvement}
2. ...
=== END STAGE 2 RESULTS ===
```

Parse Stage 2 results.

## Step 5: Update Feature Map status

<!-- @cap-todo(ref:AC-62) cap-validator shall update the feature state in FEATURE-MAP.md from tested to shipped upon passing both review stages. -->

If both stages pass (or Stage 1 skipped with `stage2_only` and Stage 2 passes):

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const targetIds = {JSON.stringify(target_feature_ids)};
for (const id of targetIds) {
  const result = fm.updateFeatureState(process.cwd(), id, 'shipped');
  console.log(id + ': ' + (result ? 'updated to shipped' : 'state unchanged'));
}
"
```

Write review report:

```bash
node -e "
const fs = require('node:fs');
const path = require('node:path');
const capDir = path.join(process.cwd(), '.cap');
if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
// Write review file (content constructed by command layer from parsed results)
"
```

Write `.cap/REVIEW.md` using the Write tool with the combined Stage 1 + Stage 2 findings.

Update session:

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
session.updateSession(process.cwd(), {
  lastCommand: '/cap:review',
  lastCommandTimestamp: new Date().toISOString(),
  step: 'review-complete'
});
"
```

## Step 6: Generate Manual Testing Checklist

After automated review passes, generate a checklist of things only a human can verify. Derive from the Feature Map ACs and implementation context.

**Categories of manual tests (include all that apply):**

1. **Visual/UX verification** — Does the UI look correct? Is the layout intuitive? Do transitions feel smooth?
2. **User flow verification** — Can a real user complete the happy path end-to-end? Are error states clear?
3. **Cross-browser/device** — Does it work on mobile? Different browsers?
4. **Data verification** — Does real data (not test data) display correctly? Are edge cases handled (empty states, long names, special characters)?
5. **Permission/access verification** — Can you confirm User A really cannot see User B's data? Try it manually.
6. **Integration verification** — Do external services (Google Calendar, Zoom, Stripe) actually connect and work?
7. **Performance perception** — Does it feel fast enough? Any visible loading delays?

**Generate the checklist:**

For each feature under review, analyze the ACs and implementation files to determine which manual tests are needed:

```
MANUAL TESTING CHECKLIST
========================

These tests cannot be automated. A human must verify each item
before the feature is considered production-ready.

Feature: {feature title}

  Visual / UX:
  [ ] {specific check derived from feature, e.g., "Booking form shows correct time slots for selected date"}
  [ ] {e.g., "Error message appears when double-booking is attempted"}

  User Flow:
  [ ] {e.g., "Complete a booking from start to confirmation as a new user"}
  [ ] {e.g., "Cancel an existing booking and verify calendar is updated"}

  Permissions:
  [ ] {e.g., "Log in as Berater A — confirm you cannot see Berater B's bookings"}
  [ ] {e.g., "Log in as Admin — confirm you CAN see all bookings"}

  External Integrations:
  [ ] {e.g., "Connect Google Calendar — verify new booking appears in calendar"}
  [ ] {e.g., "Connect Zoom — verify meeting link is generated"}

  Edge Cases:
  [ ] {e.g., "Book a slot at 23:50 that crosses midnight — verify correct date handling"}
  [ ] {e.g., "Enter a name with special characters (umlauts, emojis) — verify display"}

Status: [ ] All checks passed  [ ] Issues found (describe below)
Issues: _______________________________________________
Verified by: ________________  Date: ________________
```

Write this checklist to `.cap/MANUAL-TESTS.md` using the Write tool.

Display the checklist to the user with a clear message:

```
IMPORTANT: The automated review passed, but these manual checks
are required before shipping to production.

Please work through the checklist above. It takes approximately
{N} minutes (estimated from item count * 2 min per check).

The checklist is saved at .cap/MANUAL-TESTS.md — share it with
your team or use it as a sign-off document.
```

Use AskUserQuestion:
> "The manual testing checklist has been generated. Would you like to go through it now, or save it for later?"
> Options: "Go through now" / "Save for later" / "Skip manual tests"

If "Go through now": Walk through each item with the user, asking them to confirm each check.
If "Save for later": Remind them: ".cap/MANUAL-TESTS.md keeps the manual checklist; revisit it with `/cap:status` or run the checks directly when ready."
If "Skip": Warn: "Manual tests skipped. Feature will be marked as shipped but .cap/MANUAL-TESTS.md remains open."

## Step 7: Final report

```
cap:review complete.

Stage 1 (AC compliance):  {PASS or FAIL or SKIPPED}
Stage 2 (Code quality):   {PASS or PASS_WITH_NOTES or FAIL}
Stage 3 (Manual tests):   {PENDING — N items to verify}

{If both automated stages pass:}
Feature state updated: {feature_ids} -> shipped
Review report: .cap/REVIEW.md
Manual tests:  .cap/MANUAL-TESTS.md

Top 5 actions:
{top_5_actions}
{End if}

{If stage 2 has notes:}
Review passed with notes. See .cap/REVIEW.md for details.
{End if}

REMINDER: {N} manual test items pending in .cap/MANUAL-TESTS.md
```

</process>
