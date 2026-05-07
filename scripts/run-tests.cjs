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
  // Three real remediation paths (none implemented yet):
  //   1. Switch to c8/nyc (writes per-worker JSON, supports merge across
  //      workers). ~1-2 days.
  //   2. Upgrade CI to Node 23+ and switch to stable --test-isolation=process
  //      with v23's worker-coverage-merge fixes. ~0.5 day, needs verification.
  //   3. Status quo: keep --experimental-test-isolation=none, ~21 min CI runs,
  //      97.4% coverage. F-052-class race detection sacrificed by design here
  //      but covered by plain `npm test` worker isolation.
  //
  // Until one of those lands: the flag stays. The 552 in-process migrations
  // are still net wins (faster `npm test` runs locally + cleaner test
  // architecture) but did NOT enable the Path 1 wall-time win on coverage.
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
