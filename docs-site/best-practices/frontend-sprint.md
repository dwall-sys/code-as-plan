# Frontend Sprint Pattern

UI work has a different shape than backend work. Backend work tends to be a few large structural decisions; UI work tends to be **dozens of fast tweaks** — padding, color, spacing, copy, hover state, animation. Running the full CAP Pro workflow (`prototype → iterate → test → review`) on every "make this padding 16px" edit costs more than the edit itself.

CAP Pro auto-detects this and adapts: a two-phase pattern where Phase 1 is hands-off and Phase 2 catches up at the end.

## Phase 1 — Free Edit Sprint

CAP Pro recognises a frontend sprint when **any** of these signal:

- File path is `*.tsx`, `*.jsx`, `*.css`, `*.scss`, Storybook story, or component-only
- You ask for visual changes — "padding bigger / change color / spacing / hover state / animation / the design / the layout"
- You're doing rapid back-and-forth on the same file (3+ edits in a row)
- You explicitly say "let me try something" / "schnell mal" / "quick"

In Phase 1:

- **No `/cap:prototype` invocation** — CAP Pro just edits directly
- **No `/cap:iterate` invocation** — same, edits directly
- **No tag discipline** — tags are batched at the end, not per-edit
- **No research gate, no AC confirmation, no agent spawn**
- The session-state stays in whatever phase it was

The point: get out of your way. UI design is a fluid, iterative process; the agent ceremony interferes with flow.

## Phase 2 — Catch-up

CAP Pro auto-invokes Phase 2 when:

- You say "ok das passt jetzt / fertig / lass uns das aufräumen / commit ready"
- You shift topic away from visual to logic/data/tests
- A natural pause — e.g. starting a new feature

Phase 2 runs:

1. **`/cap:annotate`** — retroactively adds `@cap-feature` and `@cap-todo` tags to the changed files
2. **`/cap:test`** — writes RED-GREEN tests against the now-stable form
3. **Optional `/cap:save`** — snapshots the sprint result for future continuation

This keeps tag discipline and AC traceability intact without slowing down the visual work.

## Why two phases?

Without this pattern, two failure modes appear:

1. **The tag tax.** Every visual edit triggers a "should I tag this?" prompt, which makes the agent slow and noisy. After 5 edits you give up and disable the agent — losing tag discipline entirely.
2. **The premature lock-in.** The agent writes a test for `padding: 12px` after the first edit. You change to `padding: 16px`. The test breaks. You change again. The test breaks again. Now you fight the test instead of designing.

The Phase-1/Phase-2 split solves both: tags are added once, against the *stable* design, and tests are written against what the team is committing to, not what was tried at minute 3.

## When NOT to use Phase 1

- **Logic changes that look like UI changes.** "The price calculation is wrong" sounds visual but is a backend test. Phase 1 doesn't apply.
- **Data-fetch pattern changes.** Refactoring a `useQuery` call is not a sprint — it deserves the full workflow.
- **Inter-component contract changes.** If the change spans multiple components and adds a new prop type, that's a real prototype, not a sprint.

## Manual override

If CAP Pro misreads the situation and forces tags during a sprint:

```
just edit, no tags yet — sprint mode
```

CAP Pro will switch to Phase 1 explicitly. To force Phase 2 catch-up:

```
ok das passt, lass uns aufräumen
```

(or any of the catch-up trigger phrases above.)

## Replacing the retired `/cap:quick` and `/cap:finalize`

In `code-as-plan@7.x`, this pattern was implemented as two slash commands: `/cap:quick` to enter sprint mode, `/cap:finalize` to exit. We retired both in CAP Pro 1.0 because they required users to *explicitly* opt in — and most users either forgot to (got the tag tax) or overused them (lost discipline).

The auto-detection model is more honest: CAP Pro reads the situation and adjusts.
