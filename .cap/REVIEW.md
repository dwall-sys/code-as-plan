# Review: F-051 + F-052

**Date:** 2026-04-20
**Reviewer:** cap-reviewer (automated, 2-stage)
**Scope:** Feature branches `f-051/coverage-gap` and `f-052/test-state-leaks`

## Stage 1 — AC Compliance: PASS

### F-051: Fix Coverage Runner — Replace c8 with Node Native

| AC | Result | Evidence |
|----|--------|----------|
| AC-1 | PASS | `scripts/run-tests.cjs:25-36` enables native coverage + isolation=none only on `--coverage`. Measured: 97.99% lines / 97.78% funcs — above 95% bar |
| AC-2 | PASS | `package.json` devDependencies contain only `esbuild` and `vitest`; `test:coverage` script no longer invokes c8 |
| AC-3 | PASS | `npm test` (no flag) keeps default isolation: 4524/4524 green |
| AC-4 | DEFERRED | Windows-incompatible skip markers — explicitly out-of-scope |
| AC-5 | DEFERRED | Pre-merge "new module requires tests" check — re-plan later |

### F-052: Fix Shared-State Leaks in Test Suite

| AC | Result | Evidence |
|----|--------|----------|
| AC-1 | PASS | `tests/cap-cluster-io.test.cjs` has `patchWarn()` helper at lines 38-57; invoked inside all 7 test bodies. Verified with `cap-logger.test.cjs` → `cap-cluster-io.test.cjs` run order |
| AC-2 | PASS | `runCopilotInstall`/`runCopilotUninstall` delete `CAP_TEST_MODE` from execFileSync env, verified with `install-hardening.test.cjs` → `copilot-install.test.cjs` order |
| AC-3 | PASS | `npm run test:coverage` exits 0: 4559/4559 tests pass under `--test-isolation=none` |
| AC-4 | PASS | Regression guard is the test:coverage gate itself — acceptable for a tooling-level AC |

## Stage 2 — Code Quality: PASS_WITH_NOTES (notes addressed)

### Warnings (all addressed in follow-up commit)

1. **patchWarn re-entrant safety** — Added defensive guard that throws on nested calls (`tests/cap-cluster-io.test.cjs:47`).
2. **patchWarn inside try** — Moved `patchWarn()` invocation inside every `try` block (6 sites) so a throw from `patchModule()` cannot leak a patched `console.warn`.
3. **Concurrency constraint** — Added explicit comment on module-scoped `captured` / `originalConsoleWarn` documenting that `concurrency: true` is not safe in this file (`tests/cap-cluster-io.test.cjs:16-20`).

### Notes (tracked as follow-up)

4. **Coverage threshold 0.7 vs. measured 97.99%** — Kept at 0.7 for now. A regression to 71% would silently pass, but tightening too early would cause flakes. Re-evaluate after stability window.
5. **`cap-test-audit.cjs` still uses `npx c8`** — New feature **F-053** filed to migrate to Node native coverage (removes last c8 dependency).
6. **`scripts/run-tests.cjs` comment clarified** — Now explicitly states why isolation=none is gated behind `--coverage` rather than always-on (default isolation caught F-052's leaks, a desirable property to preserve).

### Tag Completeness: CLEAN
- `patchWarn()` is a test helper (tests don't require @cap-feature).
- `scripts/run-tests.cjs` is infrastructure outside the tag-scanned tree.
- `package.json` is config. No gaps.

## Verdict

**Both features MERGE-READY. State: shipped.**

Top actions:

1. ✓ patchWarn hardening (defensive guard + inside-try)
2. ✓ Comment documenting concurrency constraint
3. ✓ Comment explaining isolation=none gating
4. F-053 tracks cap-test-audit migration off npx c8
5. Coverage threshold re-evaluation after stability window
