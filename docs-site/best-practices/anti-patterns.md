# Anti-Patterns

Things to avoid in a CAP Pro project. Each one comes from a real mistake we've made or seen.

## "Let me write the spec doc first"

The whole point of CAP Pro is **don't**. A 200-page upfront spec drifts the moment code changes. Sketch in your head for 5 minutes, then prototype. The prototype + tags **is** the spec.

Exception: regulatory pre-commitment where you legally must produce a spec before code. Even then, generate the spec from the prototype's tags after the fact — it'll be more accurate.

## Multi-feature prototyping

Building five features in parallel "for efficiency". It is not efficient. Each feature in isolation reveals different surprises; in parallel, the surprises compound and the rollback cost grows. **One feature at a time.**

## Premature abstraction

The first prototype generates `BaseFeatureFactory` and `IFeatureProvider` and `FeatureRegistry`. Don't. Three similar lines is better than a premature abstraction. Abstract on the **third** instance, not the first.

## Decorative comments

```ts
// This function calculates the total
function calculateTotal() { ... }
```

This adds zero information. The function name already says it. CAP Pro's tag system is the **opposite** of decorative comments — `@cap-feature` adds traceability (links to AC), `@cap-todo` adds honesty (surfaces what's open). Neither describes what the code does.

Don't comment what the code does. Comment **why** something non-obvious is the way it is.

## Tags after refactor instead of before

Refactoring a file then tagging it is fine.
Refactoring a file *and forgetting to tag it* is a permanent loss of context — the refactor erased the original `@cap-feature` annotations and now there's nothing tying the new code to its AC.

`/cap:scan` will detect orphaned ACs (acceptance criteria with no `@cap-feature` tag in code) and warn you. Run it after any major refactor.

## Mocking the database in integration tests

A project I worked on shipped a migration that broke prod because all integration tests were against a mocked database. The mocked migration ran fine; the real migration failed on a NOT NULL constraint that the mock didn't enforce.

**Integration tests must hit a real database.** Use a test instance, not mocks, for the things you care about being right.

## Tests that pass without testing

```ts
test('clicking submit validates the form', () => {
  render(<Form />);
  fireEvent.click(screen.getByText('Submit'));
  expect(true).toBe(true);  // ← never fails
});
```

The RED-GREEN discipline is supposed to catch this. Run the test against an empty implementation — if it passes, it's not testing what you think.

## Friendly tests

```ts
test('cart total is correct', () => {
  const cart = new Cart([{ price: 10, qty: 2 }]);
  cart.calculate = vi.fn().mockReturnValue(20);  // ← test author replaced the real method
  expect(cart.calculate()).toBe(20);
});
```

This test asserts that `vi.fn().mockReturnValue(20)` returns `20`. It does not test the cart. Friendly tests are worse than no tests because they create false confidence.

## Skipping `pitfalls.md`

`cap-architect MODE: REFACTOR` is **required** to consult `pitfalls.md` before suggesting splits. Many refactors fail because someone didn't know about a load-bearing implicit contract that was burned-in to the previous structure.

If you're refactoring without reading the project's pitfalls, you are running an experiment that the team has already run. Read first.

## Force-pushing to main

Don't. Even when CAP Pro pushed up a snapshot you wish you hadn't. `cap-historian MODE: FORK` is built for this — fork the snapshot, try the alternative approach, keep both. If the alternative wins, promote it. Force-push erases the original; that's data loss, not version control.

## Bypassing pre-commit hooks

`git commit --no-verify` exists for a reason — but the reason is "the hook is broken and I have to ship right now", not "the hook is annoying". If the hook fails, **fix the hook or fix the code**. Don't skip.

## Re-using session snapshots across unrelated work

`cap-historian MODE: CONTINUE` is for resuming a session you actually paused. If you `/cap:save` after working on Feature A and then `/cap:continue` while working on Feature B, you'll get phantom-context: the agent acts as if Feature A is still active and gets confused.

Use **`/cap:start --feature=<id>`** to switch features. Use **`/cap:fork`** to branch off. Don't reuse snapshots that don't apply.

## Putting CAP Pro state into version control without thinking

These belong in git:
- `FEATURE-MAP.md` — yes, the spec is part of the code
- `features/` (sharded layout) — yes
- `.cap/memory/` — yes, the project's accumulated learning
- `.cap/snapshots/` — yes, history of decisions

These do **not** belong in git:
- `.cap/SESSION.json` — ephemeral per-user state (gitignored by default)
- `.cap/stack-docs/` — auto-fetched library docs (gitignored by default)
- `.cap/migrations/<id>/backup/` — local rollback state

Check your `.gitignore` after `/cap:init` runs.

## Auto-mode without supervision

Letting CAP Pro run autonomously is great for low-risk iterative work. It is not great for:

- Deploying to production
- Merging PRs
- Sending Slack messages
- Modifying CI pipelines
- Running migrations

CAP Pro's underlying agent (Claude / GPT / etc.) is asked to confirm risky actions before taking them — but the confirmation is only useful if a human is reading. Don't run unattended on actions that affect shared systems.
