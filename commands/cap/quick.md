---
name: cap:quick
description: "Enter Phase 1 (Visual Iteration) — fast-lane editing without prototype agent / AC ritual. Pair with /cap:finalize when done."
argument-hint: "[F-feature-id]"
allowed-tools:
  - Read
  - Bash
---

<!-- @cap-context F-092 two-phase workflow — Phase 1 toggle. Trivial: SESSION.json flag + git HEAD snapshot. -->
<!-- @cap-decision /cap:quick is a STATE TOGGLE, not an action. It does not spawn agents or modify code. -->
<!-- @cap-feature(feature:F-092, primary:true) /cap:quick surfaces startQuickMode to the user. -->

> **DEPRECATED (2026-05-09):** F-092 explicit toggle is superseded by F-098 (Implicit Quick-Mode). The Stop hook now detects raw-chat sessions automatically (no formal `/cap:command` + ≥5 edits + activeFeature → silent `@cap-feature` annotation). You can keep using `/cap:quick` for now; the command will be removed after 2–3 weeks of dogfooding F-098. To opt out of implicit catch-up, set `CAP_SKIP_IMPLICIT_QUICK=1` or `.cap/config.json: { "implicitQuick": { "enabled": false } }`.

<objective>
Enter Phase 1 (Visual Iteration) for a feature. Optimized for rapid frontend tweaks where speed matters more than rigor:

- "make this button bigger"
- "spacing wrong, fix it"
- "color should match brand X"
- "swap these two sections"

In Phase 1 you edit directly with Claude — no prototype agent spawn, no AC validation, no annotation pressure. CAP records the entry point (current git HEAD) so `/cap:finalize` can later identify what changed and run the full rigor (annotation + iterate + test) on the consolidated result.

**Workflow:**
```
/cap:quick F-Hub-Spotlight-Carousel    # toggle on
*work freely with Claude — visual iterations*
/cap:finalize                          # when satisfied → CAP catches up
```

**Argument:**
- `F-feature-id` (optional) — Feature ID being worked on. If omitted, uses the currently-active feature from SESSION.json.
</objective>

<context>
$ARGUMENTS
</context>

<process>

## Step 1: Resolve target feature

Parse the argument. If `$ARGUMENTS` is empty:

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const s = session.loadSession(process.cwd());
if (!s.activeFeature) {
  console.error('No feature specified and no activeFeature in SESSION.json. Pass a feature ID: /cap:quick F-X');
  process.exit(2);
}
console.log(s.activeFeature);
"
```

If exit 2: stop, ask the user for the feature ID.

If `$ARGUMENTS` is `F-...`: use it directly.

## Step 2: Verify the feature exists in FEATURE-MAP.md

```bash
node -e "
const fm = require('./cap/bin/lib/cap-feature-map.cjs');
const map = fm.readFeatureMap(process.cwd(), null, { safe: true });
const id = process.argv[1];
const found = map.features.find(f => f.id === id);
if (!found) {
  console.error('Feature ' + id + ' not found in FEATURE-MAP.md.');
  console.error('Run /cap:brainstorm to draft it first, or check the ID.');
  process.exit(2);
}
console.log('OK: ' + found.id + ' [' + found.state + '] — ' + found.title);
" '<FEATURE_ID>'
```

On exit 2: stop, surface the error.

## Step 3: Toggle quick-mode

```bash
node -e "
const session = require('./cap/bin/lib/cap-session.cjs');
const id = process.argv[1];
const updated = session.startQuickMode(process.cwd(), id);
console.log('Quick-mode active: ' + updated.quickMode.feature);
console.log('Start commit: ' + (updated.quickMode.startCommit || '(no git repo — finalize will use unstaged + untracked only)'));
" '<FEATURE_ID>'
```

## Step 4: Print the workflow hint

Print verbatim:

```
=== Quick-mode active for <FEATURE_ID> ===

You're in Phase 1 (Visual Iteration). Edit freely with Claude — no AC ritual,
no prototype agent overhead. Make it look right.

When satisfied, run:
  /cap:finalize

That will run annotation + iterate (refactor + AC definition) + test on the
files you changed since this point.
```

</process>
