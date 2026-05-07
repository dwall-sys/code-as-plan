#!/usr/bin/env node
// Cross-platform test runner — resolves test file globs via Node
// instead of relying on shell expansion (which fails on Windows PowerShell/cmd).
// Pass --coverage to enable Node's native experimental test coverage
// (c8 misses data from `node --test` isolation subprocesses on Node 22+).
'use strict';

const { readdirSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');

const wantsCoverage = process.argv.includes('--coverage');
const testDir = join(__dirname, '..', 'tests');
const files = readdirSync(testDir)
  .filter(f => f.endsWith('.test.cjs'))
  .sort()
  .map(f => join('tests', f));

if (files.length === 0) {
  console.error('No test files found in tests/');
  process.exit(1);
}

// The default TAP reporter swallows failure details under
// --experimental-test-isolation=none (only `# fail N` in the summary, no
// per-test `not ok` lines), which makes red CI unnecessarily opaque.
// The spec reporter emits explicit ✖ lines with the assertion error.
const nodeArgs = ['--test', '--test-reporter=spec'];
if (wantsCoverage) {
  // Node >=22 defaults to process-per-file isolation. Coverage from those
  // subprocesses is dropped by both c8 and the native reporter, so force
  // single-process execution when measuring coverage. Plain `npm test` keeps
  // the safer default isolation on purpose: it surfaces shared-state leaks
  // (F-052 was found exactly this way), which isolation=none would hide.
  // Flag-name history: `--experimental-test-isolation` landed in Node v22.8.0;
  // the non-experimental `--test-isolation=...` form was stabilised in v23.x.
  // CI runs on Node 22 reject the stabilised name with "bad option", so we use
  // the experimental prefix — Node 23+ still accepts it for back-compat.
  // Discovered during the 2026-04-21 F-054..F-059 batch: every feature PR
  // merged with red CI because this mismatch failed the runner before a single
  // test executed.
  //
  // @cap-decision(CI/issue-42) Path 1 rejected — DOUBLE-CONFIRMED.
  //
  // First measurement (2026-05-07, before Path 2): dropping
  // --experimental-test-isolation=none cut wall-time 43x (1437s -> 33s) but
  // collapsed line coverage 96.95% -> 56.31% (-40.64pp). Hypothesis: subprocess
  // fixtures via `runGsdTools` (helpers.cjs:21) hide coverage from the native
  // --experimental-test-coverage aggregator. Bridge fix PR #46 raised CI
  // timeout 10->20 min. Path 2 plan: migrate fixtures to in-process module calls.
  //
  // Second measurement (2026-05-07, after Path 2 Phase 1-3 -- PRs #54-#61
  // migrated 552 callsites across 14 files): re-ran the same Path 1 change.
  // Wall-time 1298s -> 26s (49.9x faster); line coverage 97.40% -> 55.83%
  // (-41.57pp). Per-hot-file deltas remain catastrophic (cap-feature-map.cjs
  // -72.78, cap-feature-map-monorepo.cjs -71.19, cap-memory-migrate.cjs
  // -70.26, cap-tag-scanner.cjs -61.23). The 552 migrations had near-zero
  // effect on the coverage gap.
  //
  // Revised root-cause: NOT subprocess fixtures. Node 22's native
  // --experimental-test-coverage aggregator does not merge coverage across
  // test-file workers -- only the parent process is counted. Under per-file
  // isolation each test file becomes its own worker; their coverage data is
  // not surfaced. The gap is at the worker->parent boundary, NOT
  // fixture->parent. Migrating runGsdTools to in-process moved work from
  // grand-child fixtures into worker processes, which the aggregator still
  // doesn't see.
  //
  // Phase 4 (migrate the remaining 248 callsites in 9 files: dispatcher,
  // frontmatter-cli, init-manager, profile-pipeline, milestone, roadmap,
  // template, verify, uat) WILL NOT close the gap -- those are CLI-dispatch
  // tests, not the hot lib modules whose coverage collapses. Diagnosed
  // empirically.
  //
  // Three real remediation paths considered:
  //   1. Switch to c8/nyc (hypothesis: writes per-worker JSON, supports merge
  //      across workers). REJECTED — see @cap-decision below.
  //   2. Upgrade CI to Node 23+ and switch to stable --test-isolation=process
  //      with v23's worker-coverage-merge fixes. ~0.5 day, needs verification.
  //   3. Status quo: keep --experimental-test-isolation=none, ~21 min CI runs,
  //      97.4% coverage. F-052-class race detection sacrificed by design here
  //      but covered by plain `npm test` worker isolation.
  //
  // @cap-decision(CI/issue-42 c8-also-rejected) Path 1 (c8 variant) REJECTED.
  //
  // Hypothesis from PR #62 follow-up: c8 instruments via a require()-hook at
  // module-load time and writes per-worker JSON to coverage/tmp/, so it should
  // fix the worker-aggregator gap that bit native --experimental-test-coverage.
  // Empirically tested 2026-05-07 with c8 v10.1.3 + Node 24 + --test-isolation=
  // process (the stabilised flag). Three configurations measured:
  //
  //   A. native + --experimental-test-isolation=none .... 97.40% lines, 1240s
  //      (current production, unchanged since F-051)
  //   B. c8     + --test-isolation=process (default) .... 55.18% lines, 26.4s
  //      (the hypothesised win — REJECTED, same gap as native+Path 1's 55.83%)
  //   C. c8     + --experimental-test-isolation=none .... 97.39% lines, 1258s
  //      (parity check — confirms c8 matches native at the same isolation)
  //
  // Root cause of the c8 rejection: c8 v10 does NOT use a require()-hook. The
  // hypothesis was wrong about how c8 works. c8 v10 just sets NODE_V8_COVERAGE
  // before spawning the wrapped command and reads V8's per-process JSONs on
  // exit — it is a thin wrapper around Node's *native* coverage mechanism.
  // Forensic check on coverage/tmp/ after the c8+Path1 run: 308 worker JSONs
  // were written but only 46 of 167 test files appeared in any of them. The
  // missing 121 test files are alphabetically-early (agent-*, antigravity-*,
  // arc-*, build-*, cap-affinity through cap-divergence, cap-feature-map.*,
  // most cap-memory-*, cap-tag-*, etc). This is the SAME Node-level bug:
  // --test-isolation=process pool workers spawn before NODE_V8_COVERAGE has
  // had its on-exit handler armed, so early workers exit without writing.
  // Switching tools cannot fix this — both tools sit downstream of the same
  // V8/Node coverage mechanism.
  //
  // Phase 4 is still NOT necessary. The remaining remediation options are:
  //   - Node 23+ upgrade + stable --test-isolation=process with verified
  //     worker-coverage-merge (Remediation Path 2 above).
  //   - Persist current --experimental-test-isolation=none status quo.
  // c8 was the original tool, removed in F-051 (commit 8cc51fd) under the same
  // empirical evidence — that decision stands.
  //
  // Until Path 2 lands: the flag stays. The 552 in-process migrations from
  // PRs #54-#61 remain net wins (faster `npm test` runs locally + cleaner test
  // architecture) but neither they nor c8 close the coverage gap on Path 1.
  //
  // @cap-decision(CI/issue-42 quadruple-rejection) Path 1 also rejected on
  // Node 22, 23, 25 — confirms the bug is structural, not version-specific.
  //
  // Empirical Node-version sweep (2026-05-07): tested Path 1 across all four
  // current Node majors with both flag forms:
  //
  //   Node 22.22.2 + Path 1 (--experimental-...=none removed) .. 55.22% lines, 23s
  //   Node 23.11.1 + Path 1 ........................................ 55.84% lines, 23s
  //   Node 24.15.0 + Path 1 ........................................ 55.11% lines, 26s
  //   Node 25.9.0  + Path 1 ........................................ 55.04% lines, 26s
  //   Node 23.11.1 + --test-isolation=process (stabilised flag) ... 55.43% lines, 26s
  //   Node 25.9.0  + --test-isolation=process (stabilised flag) ... 55.15% lines, 28s
  //
  // Hot-file numbers were BYTE-IDENTICAL across all 6 Path-1 runs. This is
  // deterministic missing-aggregation, not flaky measurement. The bug is
  // present in Node 22 through 25 and survives both flag forms.
  //
  // What this eliminates:
  //   - "Node 23+ has worker-coverage-merge fixes" — wrong, v23 has the bug.
  //   - "Upgrade fixes it" — wrong, v25 has the bug.
  //   - "Use the stabilised flag" — wrong, same bug under both forms.
  //
  // Final remediation set: Status quo only. The
  // --experimental-test-isolation=none flag stays. ~21 min CI runs, ~97.4%
  // coverage. F-052-class race detection sacrificed by design under coverage
  // but covered by plain `npm test` worker-isolation. The 552 in-process
  // migrations from PRs #54-#61 remain net wins for plain-test speed but did
  // NOT enable Path 1.
  //
  // If a future investigator considers re-trying Path 1: don't. It has been
  // rejected FOUR times with empirical data:
  //   1. native pre-Path-2 (PR #62, ~40pp drop)
  //   2. native post-Path-2 (PR #62, ~42pp drop, byte-identical hot files)
  //   3. c8 v10 (PR #63, ~42pp drop, same hot files)
  //   4. Node 22/23/24/25 sweep (this commit, ~42pp drop on every Node major)
  //
  // The actionable next step (NOT this commit, low urgency) is filing an
  // upstream Node bug with a minimal repro showing alphabetically-early
  // workers missing from the native coverage aggregator under per-file
  // isolation. Until that lands and ships in some Node version: status quo.
  nodeArgs.push(
    '--experimental-test-isolation=none',
    '--experimental-test-coverage',
    '--test-coverage-lines=0.7',
    '--test-coverage-include=cap/bin/lib/*.cjs'
  );
}
nodeArgs.push(...files);

try {
  execFileSync(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: { ...process.env },
  });
} catch (err) {
  process.exit(err.status || 1);
}
