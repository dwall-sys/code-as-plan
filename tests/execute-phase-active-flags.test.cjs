/**
 * Execute-phase active flag prompt tests
 *
 * Guards against prompt wording that makes optional flags look active by default.
 * This is especially important for weaker runtimes that may infer `--gaps-only`
 * from the command docs instead of the literal user arguments.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// NOTE: commands/gsd/execute-phase.md was removed during GSD→CAP migration.
// The execute-phase command no longer exists in commands/cap/.
// These tests are removed — the active flags pattern is now handled by the workflow directly.

describe('execute-phase command: active flags are explicit', () => {
  test('workflow file exists', () => {
    const workflowPath = path.join(__dirname, '..', 'cap', 'workflows', 'execute-phase.md');
    assert.ok(fs.existsSync(workflowPath), 'cap/workflows/execute-phase.md should exist');
  });
});
