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

const nodeArgs = ['--test'];
if (wantsCoverage) {
  // Node >=22 defaults to process-per-file isolation. Coverage from those
  // subprocesses is dropped by both c8 and the native reporter, so force
  // single-process execution when measuring coverage. Plain `npm test` keeps
  // the safer default isolation.
  nodeArgs.push(
    '--test-isolation=none',
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
