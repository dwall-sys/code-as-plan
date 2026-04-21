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
