# Test-First Discipline

CAP Pro's testing practice is **adversarial RED-GREEN**. Every test starts as a failing test, and the implementation is judged solely by whether the test goes green for the right reason.

## The core loop

```
1. Read AC from FEATURE-MAP.md
2. Write failing test (RED)
3. Run test — confirm it fails for the right reason
4. Implement until green (GREEN)
5. Refactor with green tests as the safety net
6. Mark AC as tested in Feature Map
```

`/cap:test` runs this loop with the `cap-validator` agent in `MODE: TEST`.

## "Adversarial" — what does that mean?

Most TDD failures come from **tests that are too friendly to the implementation**. The test author already knows how the implementation will work, and they write a test that "passes" for incidental reasons.

Adversarial RED-GREEN flips this:

- The test is written **before** the implementation peek
- The test must fail **for the right reason** (assertion failure on the actual behaviour, not "function not defined")
- The test gets **as close to the AC wording as possible** — if the AC says "respects `prefers-reduced-motion`", the test sets up a `prefers-reduced-motion: reduce` media query, not a "fake reduced-motion flag"

## Why adversarial?

LLMs are *especially* prone to "tests that pass without testing anything". A common failure mode:

```ts
// AC: "When the user clicks the submit button, the form is validated."

test('clicking submit validates the form', async () => {
  render(<Form />);
  fireEvent.click(screen.getByText('Submit'));
  expect(true).toBe(true);  // ← test always passes, tests nothing
});
```

Adversarial discipline catches this:

```ts
test('clicking submit validates the form', async () => {
  const onSubmit = vi.fn();
  render(<Form onSubmit={onSubmit} />);
  fireEvent.click(screen.getByText('Submit'));

  // BEFORE the assertion, run the test and confirm it FAILS.
  // It should fail because validation doesn't exist yet.
  expect(screen.getByRole('alert')).toHaveTextContent(/required/i);
  expect(onSubmit).not.toHaveBeenCalled();
});
```

Run the test against an empty `Form` — confirm it fails. Now implement validation. Now it passes for the right reason.

## Framework auto-detection

CAP Pro detects the test framework and writes idiomatic tests:

| Framework | Detected from | Idiomatic style |
|---|---|---|
| **vitest** | `vitest` in `package.json`, `*.test.ts(x)?` files | `import { describe, it, expect } from 'vitest'` |
| **node:test** | `tests/*.test.cjs` (no other framework) | `import { test } from 'node:test'` |
| **jest** | `jest.config.*` | `describe()`, `it()`, `expect()` |
| **mocha** | `mocha.opts`, `mocha` in package | `describe()`, `it()`, `assert.*` |
| **pytest** | `pytest.ini`, `conftest.py` | `def test_*():`, `assert ...` |
| **unittest** | Python without pytest | `class Test*(TestCase): def test_*(self):` |
| **Go** | `go.mod` | `func TestX(t *testing.T)` |
| **Cargo** | `Cargo.toml` | `#[test] fn x() { … }` |

You don't pick the framework — CAP Pro picks for you, based on what your project already uses.

## When tests should be more than RED-GREEN

RED-GREEN gets you correctness for the AC. For richer test value, layer on:

- **Property-based testing** for invariants — e.g. with `fast-check` (JS) or `hypothesis` (Python). Use `/cap:test-audit` to surface where this would help.
- **Mutation testing** to verify your test suite catches the changes it should — `/cap:test-audit --mutation` runs `stryker` (JS) or `mutmut` (Python) and reports the mutation score.
- **Integration tests** for I/O-heavy ACs — don't mock the database when the AC explicitly cares about migration behaviour.

## What NOT to test

- **Implementation details that aren't ACs.** If the AC says "the cart total is correct", don't test that the cart uses a specific reducer pattern. The reducer is implementation; the total is behaviour.
- **Third-party libraries.** If you're using `zod` for validation, don't test that `zod` works. Test that *your code uses zod correctly* for the AC.
- **Trivial getters/setters.** If a class has a `getName()` that returns `this.name`, don't test it. There's no behaviour to verify.

## Don't mock what you can use

A common anti-pattern: mocking the database in integration tests. CAP Pro's general advice (see `pitfalls.md` after `/cap:memory init` runs):

> Integration tests must hit a real database, not mocks. Reason: a project I worked on shipped a migration that broke prod because all tests were against a mocked DB.

Use a real (test) database. Use a real (test) HTTP server. Mock the things you genuinely cannot control (third-party APIs, time, randomness) and nothing else.

## Coverage targets

CAP Pro's own test suite holds itself to:

- **70% line coverage minimum** (enforced via `c8` in CI)
- **Every AC has at least one test**
- **Every public API has a test**

These are floors, not targets. Real targets are: every behaviour the user sees has a test, and every regression we ship has a regression test added before it's fixed.

## Best practices summary

1. Read the AC, then write the test, then write the code. Never re-order this.
2. Confirm your test fails for the right reason before making it pass.
3. Use the framework your project already uses. Don't introduce a second test framework.
4. Mock only what you can't control. Especially: don't mock your own database.
5. Write the regression test for every bug **before** you fix the bug.
6. When `/cap:review` Stage 1 fails because an AC has no test, write the test, don't lower the bar.
