/**
 * GSD Tools Tests - State
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const {
  cmdStateLoad,
  cmdStateGet,
  cmdStatePatch,
  cmdStateUpdate,
  cmdStateAdvancePlan,
  cmdStateRecordMetric,
  cmdStateUpdateProgress,
  cmdStateAddDecision,
  cmdStateAddBlocker,
  cmdStateResolveBlocker,
  cmdStateRecordSession,
  cmdStateSnapshot,
  cmdStateJson,
  cmdStateBeginPhase,
  cmdSignalWaiting,
  cmdSignalResume,
  stateExtractField,
  stateReplaceField,
  stateReplaceFieldWithFallback,
} = require('../cap/bin/lib/state.cjs');

// @cap-decision(CI/issue-42 Path-2 PR-2.2) Migrated 84 runGsdTools spawn
// callsites to direct cmdState* in-process calls. Wall time dropped from
// ~4.57s to ~0.31s on this file (~14x). Tracks issue #42 Path 2 plan
// documented in scripts/run-tests.cjs:39-53. One callsite kept as-is
// (the "Invalid --cwd" test) because --cwd validation lives in
// cap-tools.cjs main() before any cmdState* function is invoked.

// ─── In-process capture helpers ──────────────────────────────────────────────
// Replicates the runGsdTools result shape via fs.writeSync + process.stdout.write
// + process.exit interception, so tests can assert on stdout/stderr/exitCode the
// same way they did against the spawned CLI.

/**
 * Run fn(), capturing fd 1 (stdout) writes (both fs.writeSync and
 * process.stdout.write paths). Mirrors a successful CLI run that writes JSON or
 * raw text to stdout.
 */
function captureOutput(fn) {
  const origWriteSync = fs.writeSync;
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  fs.writeSync = function(fd, data) {
    if (fd === 1) { captured += data; return data.length; }
    return origWriteSync.apply(fs, arguments);
  };
  process.stdout.write = function(chunk) {
    captured += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  };
  try { fn(); } finally {
    fs.writeSync = origWriteSync;
    process.stdout.write = origStdoutWrite;
  }
  return captured;
}

/**
 * Run fn() while intercepting process.exit + stdout + stderr. Returns the same
 * shape as runGsdTools: { success, output, error, exitCode }.
 *  - success === true when no process.exit was triggered or exit code was 0.
 *  - output captures fd 1 writes.
 *  - error captures fd 2 writes (Error: ...).
 */
function runStateInProcess(fn) {
  const origExit = process.exit;
  const origWriteSync = fs.writeSync;
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  let exitCode = 0;
  let exited = false;
  let output = '';
  let error = '';
  process.exit = (code) => {
    exitCode = code == null ? 0 : code;
    exited = true;
    throw new Error('__EXIT__');
  };
  fs.writeSync = function(fd, data) {
    if (fd === 1) { output += data; return data.length; }
    if (fd === 2) { error += data; return data.length; }
    return origWriteSync.apply(fs, arguments);
  };
  process.stdout.write = function(chunk) {
    output += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  };
  try {
    fn();
  } catch (e) {
    if (e.message !== '__EXIT__') throw e;
  } finally {
    process.exit = origExit;
    fs.writeSync = origWriteSync;
    process.stdout.write = origStdoutWrite;
  }
  // Match runGsdTools' { success, output, error } contract.
  // success === true when not exited via process.exit(non-zero).
  const success = !exited || exitCode === 0;
  return { success, output: output.trim(), error: error.replace(/^Error:\s*/, '').trim(), exitCode };
}

describe('state-snapshot command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing STATE.md returns error', () => {
    const result = captureOutput(() => cmdStateSnapshot(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.error, 'STATE.md not found', 'should report missing file');
  });

  test('extracts basic fields from STATE.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 03
**Current Phase Name:** API Layer
**Total Phases:** 6
**Current Plan:** 03-02
**Total Plans in Phase:** 3
**Status:** In progress
**Progress:** 45%
**Last Activity:** 2024-01-15
**Last Activity Description:** Completed 03-01-PLAN.md
`
    );

    const result = captureOutput(() => cmdStateSnapshot(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.current_phase, '03', 'current phase extracted');
    assert.strictEqual(output.current_phase_name, 'API Layer', 'phase name extracted');
    assert.strictEqual(output.total_phases, 6, 'total phases extracted');
    assert.strictEqual(output.current_plan, '03-02', 'current plan extracted');
    assert.strictEqual(output.total_plans_in_phase, 3, 'total plans extracted');
    assert.strictEqual(output.status, 'In progress', 'status extracted');
    assert.strictEqual(output.progress_percent, 45, 'progress extracted');
    assert.strictEqual(output.last_activity, '2024-01-15', 'last activity date extracted');
  });

  test('extracts decisions table', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 01

## Decisions Made

| Phase | Decision | Rationale |
|-------|----------|-----------|
| 01 | Use Prisma | Better DX than raw SQL |
| 02 | JWT auth | Stateless authentication |
`
    );

    const result = captureOutput(() => cmdStateSnapshot(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.decisions.length, 2, 'should have 2 decisions');
    assert.strictEqual(output.decisions[0].phase, '01', 'first decision phase');
    assert.strictEqual(output.decisions[0].summary, 'Use Prisma', 'first decision summary');
    assert.strictEqual(output.decisions[0].rationale, 'Better DX than raw SQL', 'first decision rationale');
  });

  test('extracts blockers list', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 03

## Blockers

- Waiting for API credentials
- Need design review for dashboard
`
    );

    const result = captureOutput(() => cmdStateSnapshot(tmpDir, false));
    const output = JSON.parse(result);
    assert.deepStrictEqual(output.blockers, [
      'Waiting for API credentials',
      'Need design review for dashboard',
    ], 'blockers extracted');
  });

  test('extracts session continuity info', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 03

## Session

**Last Date:** 2024-01-15
**Stopped At:** Phase 3, Plan 2, Task 1
**Resume File:** .planning/phases/03-api/03-02-PLAN.md
`
    );

    const result = captureOutput(() => cmdStateSnapshot(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.session.last_date, '2024-01-15', 'session date extracted');
    assert.strictEqual(output.session.stopped_at, 'Phase 3, Plan 2, Task 1', 'stopped at extracted');
    assert.strictEqual(output.session.resume_file, '.planning/phases/03-api/03-02-PLAN.md', 'resume file extracted');
  });

  test('handles paused_at field', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 03
**Paused At:** Phase 3, Plan 1, Task 2 - mid-implementation
`
    );

    const result = captureOutput(() => cmdStateSnapshot(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.paused_at, 'Phase 3, Plan 1, Task 2 - mid-implementation', 'paused_at extracted');
  });

  describe('--cwd override', () => {
    let outsideDir;

    beforeEach(() => {
      outsideDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-test-outside-'));
    });

    afterEach(() => {
      cleanup(outsideDir);
    });

    test('supports --cwd override when command runs outside project root', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'STATE.md'),
        `# Session State

**Current Phase:** 03
**Status:** Ready to plan
`
      );

      // CLI-layer behavior: --cwd is parsed in main() and resolves to the cwd
      // argument passed to cmdStateSnapshot. In-process we call cmdStateSnapshot
      // with the resolved tmpDir directly. outsideDir is intentionally unused
      // here since the in-process call does not depend on process.cwd().
      void outsideDir;
      const result = captureOutput(() => cmdStateSnapshot(tmpDir, false));
      const output = JSON.parse(result);
      assert.strictEqual(output.current_phase, '03', 'should read STATE.md from overridden cwd');
      assert.strictEqual(output.status, 'Ready to plan', 'should parse status from overridden cwd');
    });
  });

  test('returns error for invalid --cwd path', () => {
    // CLI-layer test — kept as runGsdTools because --cwd validation lives in
    // cap-tools.cjs main() before any cmdState* function is invoked.
    const invalid = path.join(tmpDir, 'does-not-exist');
    const result = runGsdTools(`state-snapshot --cwd "${invalid}"`, tmpDir);
    assert.ok(!result.success, 'should fail for invalid --cwd');
    assert.ok(result.error.includes('Invalid --cwd'), 'error should mention invalid --cwd');
  });
});

describe('state mutation commands', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('add-decision preserves dollar amounts without corrupting Decisions section', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

## Decisions
No decisions yet.

## Blockers
None
`
    );

    captureOutput(() => cmdStateAddDecision(tmpDir, {
      phase: '11-01',
      summary: 'Benchmark prices moved from $0.50 to $2.00 to $5.00',
      rationale: 'track cost growth',
    }, false));

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.match(
      state,
      /- \[Phase 11-01\]: Benchmark prices moved from \$0\.50 to \$2\.00 to \$5\.00 — track cost growth/,
      'decision entry should preserve literal dollar values'
    );
    assert.strictEqual((state.match(/^## Decisions$/gm) || []).length, 1, 'Decisions heading should not be duplicated');
    assert.ok(!state.includes('No decisions yet.'), 'placeholder should be removed');
  });

  test('add-blocker preserves dollar strings without corrupting Blockers section', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

## Decisions
None

## Blockers
None
`
    );

    captureOutput(() => cmdStateAddBlocker(tmpDir, {
      text: 'Waiting on vendor quote $1.00 before approval',
    }, false));

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.match(state, /- Waiting on vendor quote \$1\.00 before approval/, 'blocker entry should preserve literal dollar values');
    assert.strictEqual((state.match(/^## Blockers$/gm) || []).length, 1, 'Blockers heading should not be duplicated');
  });

  test('add-decision supports file inputs to preserve shell-sensitive dollar text', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

## Decisions
No decisions yet.

## Blockers
None
`
    );

    const summaryPath = path.join(tmpDir, 'decision-summary.txt');
    const rationalePath = path.join(tmpDir, 'decision-rationale.txt');
    fs.writeFileSync(summaryPath, 'Price tiers: $0.50, $2.00, else $5.00\n');
    fs.writeFileSync(rationalePath, 'Keep exact currency literals for budgeting\n');

    captureOutput(() => cmdStateAddDecision(tmpDir, {
      phase: '11-02',
      summary_file: summaryPath,
      rationale_file: rationalePath,
    }, false));

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.match(
      state,
      /- \[Phase 11-02\]: Price tiers: \$0\.50, \$2\.00, else \$5\.00 — Keep exact currency literals for budgeting/,
      'file-based decision input should preserve literal dollar values'
    );
  });

  test('add-blocker supports --text-file for shell-sensitive text', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

## Decisions
None

## Blockers
None
`
    );

    const blockerPath = path.join(tmpDir, 'blocker.txt');
    fs.writeFileSync(blockerPath, 'Vendor quote updated from $1.00 to $2.00 pending approval\n');

    captureOutput(() => cmdStateAddBlocker(tmpDir, {
      text_file: blockerPath,
    }, false));

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.match(state, /- Vendor quote updated from \$1\.00 to \$2\.00 pending approval/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state json command (machine-readable STATE.md frontmatter)
// ─────────────────────────────────────────────────────────────────────────────

describe('state json command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing STATE.md returns error', () => {
    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.error, 'STATE.md not found', 'should report missing file');
  });

  test('builds frontmatter on-the-fly from body when no frontmatter exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 05
**Current Phase Name:** Deployment
**Total Phases:** 8
**Current Plan:** 05-03
**Total Plans in Phase:** 4
**Status:** In progress
**Progress:** 60%
**Last Activity:** 2026-01-20
`
    );

    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.gsd_state_version, '1.0', 'should have version 1.0');
    assert.strictEqual(output.current_phase, '05', 'current phase extracted');
    assert.strictEqual(output.current_phase_name, 'Deployment', 'phase name extracted');
    assert.strictEqual(output.current_plan, '05-03', 'current plan extracted');
    assert.strictEqual(output.status, 'executing', 'status normalized to executing');
    assert.ok(output.last_updated, 'should have last_updated timestamp');
    assert.strictEqual(output.last_activity, '2026-01-20', 'last activity extracted');
    assert.ok(output.progress, 'should have progress object');
    assert.strictEqual(output.progress.percent, 60, 'progress percent extracted');
  });

  test('reads existing frontmatter when present', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `---
gsd_state_version: 1.0
current_phase: 03
status: paused
stopped_at: Plan 2 of Phase 3
---

# Project State

**Current Phase:** 03
**Status:** Paused
`
    );

    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.gsd_state_version, '1.0', 'version from frontmatter');
    assert.strictEqual(output.current_phase, '03', 'phase from frontmatter');
    assert.strictEqual(output.status, 'paused', 'status from frontmatter');
    assert.strictEqual(output.stopped_at, 'Plan 2 of Phase 3', 'stopped_at from frontmatter');
  });

  test('normalizes various status values', () => {
    const statusTests = [
      { input: 'In progress', expected: 'executing' },
      { input: 'Ready to execute', expected: 'executing' },
      { input: 'Paused at Plan 3', expected: 'paused' },
      { input: 'Ready to plan', expected: 'planning' },
      { input: 'Phase complete — ready for verification', expected: 'verifying' },
      { input: 'Milestone complete', expected: 'completed' },
    ];

    for (const { input, expected } of statusTests) {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'STATE.md'),
        `# State\n\n**Current Phase:** 01\n**Status:** ${input}\n`
      );

      const result = captureOutput(() => cmdStateJson(tmpDir, false));
      const output = JSON.parse(result);
      assert.strictEqual(output.status, expected, `"${input}" should normalize to "${expected}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATE.md frontmatter sync (write operations add frontmatter)
// ─────────────────────────────────────────────────────────────────────────────

describe('STATE.md frontmatter sync', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('state update adds frontmatter to STATE.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 02
**Status:** Ready to execute
`
    );

    captureOutput(() => cmdStateUpdate(tmpDir, 'Status', 'Executing Plan 1'));

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(content.startsWith('---\n'), 'should start with frontmatter delimiter');
    assert.ok(content.includes('gsd_state_version: 1.0'), 'should have version field');
    assert.ok(content.includes('current_phase: 02'), 'frontmatter should have current phase');
    assert.ok(content.includes('**Current Phase:** 02'), 'body field should be preserved');
    assert.ok(content.includes('**Status:** Executing Plan 1'), 'updated field in body');
  });

  test('state patch adds frontmatter', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 04
**Status:** Planning
**Current Plan:** 04-01
`
    );

    captureOutput(() => cmdStatePatch(tmpDir, {
      Status: 'In progress',
      'Current Plan': '04-02',
    }, false));

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(content.startsWith('---\n'), 'should have frontmatter after patch');
  });

  test('frontmatter is idempotent on multiple writes', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 01
**Status:** Ready to execute
`
    );

    captureOutput(() => cmdStateUpdate(tmpDir, 'Status', 'In progress'));
    captureOutput(() => cmdStateUpdate(tmpDir, 'Status', 'Paused'));

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    const delimiterCount = (content.match(/^---$/gm) || []).length;
    assert.strictEqual(delimiterCount, 2, 'should have exactly one frontmatter block (2 delimiters)');
    assert.ok(content.includes('status: paused'), 'frontmatter should reflect latest status');
  });

  test('preserves frontmatter status when body Status field is missing', () => {
    // Simulate: frontmatter has status: executing, but body lost Status: field
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `---
status: executing
milestone: v1.0
---

# Project State

**Current Phase:** 03
**Current Plan:** 03-02
`
    );

    // Any writeStateMd triggers syncStateFrontmatter — use state update on a field that exists
    captureOutput(() => cmdStateUpdate(tmpDir, 'Current Plan', '03-03'));

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(content.includes('status: executing'), 'should preserve existing status, not overwrite with unknown');
    assert.ok(!content.includes('status: unknown'), 'should not contain unknown status');
  });

  test('round-trip: write then read via state json', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State

**Current Phase:** 07
**Current Phase Name:** Production
**Total Phases:** 10
**Status:** In progress
**Current Plan:** 07-05
**Progress:** 70%
`
    );

    captureOutput(() => cmdStateUpdate(tmpDir, 'Status', 'Executing Plan 5'));

    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.current_phase, '07', 'round-trip: phase preserved');
    assert.strictEqual(output.current_phase_name, 'Production', 'round-trip: phase name preserved');
    assert.strictEqual(output.status, 'executing', 'round-trip: status normalized');
    assert.ok(output.last_updated, 'round-trip: timestamp present');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stateExtractField and stateReplaceField helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('stateExtractField and stateReplaceField helpers', () => {
  // stateExtractField tests

  test('extracts simple field value', () => {
    const content = '# State\n\n**Status:** In progress\n';
    const result = stateExtractField(content, 'Status');
    assert.strictEqual(result, 'In progress', 'should extract simple field value');
  });

  test('extracts field with colon in value', () => {
    const content = '# State\n\n**Last Activity:** 2024-01-15 — Completed plan\n';
    const result = stateExtractField(content, 'Last Activity');
    assert.strictEqual(result, '2024-01-15 — Completed plan', 'should return full value after field pattern');
  });

  test('returns null for missing field', () => {
    const content = '# State\n\n**Phase:** 03\n';
    const result = stateExtractField(content, 'Status');
    assert.strictEqual(result, null, 'should return null when field not present');
  });

  test('is case-insensitive on field name', () => {
    const content = '# State\n\n**status:** Active\n';
    const result = stateExtractField(content, 'Status');
    assert.strictEqual(result, 'Active', 'should match field name case-insensitively');
  });

  // stateReplaceField tests

  test('replaces field value', () => {
    const content = '# State\n\n**Status:** Old\n';
    const result = stateReplaceField(content, 'Status', 'New');
    assert.ok(result !== null, 'should return updated content, not null');
    assert.ok(result.includes('**Status:** New'), 'output should contain updated field value');
    assert.ok(!result.includes('**Status:** Old'), 'output should not contain old field value');
  });

  test('returns null when field not found', () => {
    const content = '# State\n\n**Phase:** 03\n';
    const result = stateReplaceField(content, 'Status', 'New');
    assert.strictEqual(result, null, 'should return null when field not present');
  });

  test('preserves surrounding content', () => {
    const content = [
      '# Project State',
      '',
      '**Phase:** 03',
      '**Status:** Old',
      '**Last Activity:** 2024-01-15',
      '',
      '## Notes',
      'Some notes here.',
    ].join('\n');

    const result = stateReplaceField(content, 'Status', 'New');
    assert.ok(result !== null, 'should return updated content');
    assert.ok(result.includes('**Phase:** 03'), 'Phase line should be unchanged');
    assert.ok(result.includes('**Status:** New'), 'Status should be updated');
    assert.ok(result.includes('**Last Activity:** 2024-01-15'), 'Last Activity line should be unchanged');
    assert.ok(result.includes('## Notes'), 'Notes heading should be unchanged');
    assert.ok(result.includes('Some notes here.'), 'Notes content should be unchanged');
  });

  test('round-trip: extract then replace then extract', () => {
    const content = '# State\n\n**Phase:** 3\n';
    const extracted = stateExtractField(content, 'Phase');
    assert.strictEqual(extracted, '3', 'initial extract should return "3"');

    const updated = stateReplaceField(content, 'Phase', '4');
    assert.ok(updated !== null, 'replace should succeed');

    const reExtracted = stateExtractField(updated, 'Phase');
    assert.strictEqual(reExtracted, '4', 'extract after replace should return "4"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stateReplaceFieldWithFallback — consolidated fallback helper
// ─────────────────────────────────────────────────────────────────────────────

describe('stateReplaceFieldWithFallback', () => {
  test('replaces primary field when present', () => {
    const content = '# State\n\n**Status:** Old\n';
    const result = stateReplaceFieldWithFallback(content, 'Status', null, 'New');
    assert.ok(result.includes('**Status:** New'));
  });

  test('falls back to secondary field when primary not found', () => {
    const content = '# State\n\nLast activity: 2024-01-01\n';
    const result = stateReplaceFieldWithFallback(content, 'Last Activity', 'Last activity', '2025-03-19');
    assert.ok(result.includes('Last activity: 2025-03-19'), 'should update fallback field');
  });

  test('returns content unchanged when neither field matches', () => {
    const content = '# State\n\n**Phase:** 3\n';
    const result = stateReplaceFieldWithFallback(content, 'Status', 'state', 'New');
    assert.strictEqual(result, content, 'content should be unchanged');
  });

  test('prefers primary over fallback when both exist', () => {
    const content = '# State\n\n**Status:** Old\nStatus: Also old\n';
    const result = stateReplaceFieldWithFallback(content, 'Status', 'Status', 'New');
    // Bold format is tried first by stateReplaceField
    assert.ok(result.includes('**Status:** New'), 'should replace bold (primary) format');
  });

  test('works with plain format fields', () => {
    const content = '# State\n\nPhase: 1 of 3 (Foundation)\nStatus: In progress\nPlan: 01-01\n';
    let updated = stateReplaceFieldWithFallback(content, 'Status', null, 'Complete');
    assert.ok(updated.includes('Status: Complete'), 'should update plain Status');
    updated = stateReplaceFieldWithFallback(updated, 'Current Plan', 'Plan', 'Not started');
    assert.ok(updated.includes('Plan: Not started'), 'should fall back to Plan field');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdStateLoad, cmdStateGet, cmdStatePatch, cmdStateUpdate CLI tests
// ─────────────────────────────────────────────────────────────────────────────

describe('cmdStateLoad (state load)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns config and state when STATE.md exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Status:** Active\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ mode: 'yolo' })
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n'
    );

    const result = captureOutput(() => cmdStateLoad(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.state_exists, true, 'state_exists should be true');
    assert.strictEqual(output.config_exists, true, 'config_exists should be true');
    assert.strictEqual(output.roadmap_exists, true, 'roadmap_exists should be true');
    assert.ok(output.state_raw.includes('**Status:** Active'), 'state_raw should contain STATE.md content');
  });

  test('returns state_exists false when STATE.md missing', () => {
    const result = captureOutput(() => cmdStateLoad(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.state_exists, false, 'state_exists should be false');
    assert.strictEqual(output.state_raw, '', 'state_raw should be empty string');
  });

  test('returns raw key=value format with --raw flag', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Status:** Active\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ mode: 'yolo' })
    );

    // raw=true triggers process.exit(0) in cmdStateLoad — use runStateInProcess.
    const result = runStateInProcess(() => cmdStateLoad(tmpDir, true));
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('state_exists=true'), 'raw output should include state_exists=true');
    assert.ok(result.output.includes('config_exists=true'), 'raw output should include config_exists=true');
  });
});

describe('cmdStateGet (state get)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns full content when no section specified', () => {
    const stateContent = '# Project State\n\n**Status:** Active\n**Phase:** 03\n';
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateContent);

    const result = captureOutput(() => cmdStateGet(tmpDir, undefined, false));
    const output = JSON.parse(result);
    assert.ok(output.content !== undefined, 'output should have content field');
    assert.ok(output.content.includes('**Status:** Active'), 'content should include full STATE.md text');
  });

  test('extracts bold field value', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Status:** Active\n'
    );

    const result = captureOutput(() => cmdStateGet(tmpDir, 'Status', false));
    const output = JSON.parse(result);
    assert.strictEqual(output['Status'], 'Active', 'should extract Status field value');
  });

  test('extracts markdown section content', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Status:** Active\n\n## Blockers\n\n- item1\n- item2\n'
    );

    const result = captureOutput(() => cmdStateGet(tmpDir, 'Blockers', false));
    const output = JSON.parse(result);
    assert.ok(output['Blockers'] !== undefined, 'should have Blockers key in output');
    assert.ok(output['Blockers'].includes('item1'), 'section content should include item1');
    assert.ok(output['Blockers'].includes('item2'), 'section content should include item2');
  });

  test('returns error for nonexistent field', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Status:** Active\n'
    );

    const result = captureOutput(() => cmdStateGet(tmpDir, 'Missing', false));
    const output = JSON.parse(result);
    assert.ok(output.error !== undefined, 'output should have error field');
    assert.ok(output.error.toLowerCase().includes('not found'), 'error should mention "not found"');
  });

  test('returns error when STATE.md missing', () => {
    // cmdStateGet calls error() which calls process.exit(1) when STATE.md missing.
    const result = runStateInProcess(() => cmdStateGet(tmpDir, 'Status', false));
    assert.ok(!result.success, 'command should fail when STATE.md is missing');
    assert.ok(
      result.error.includes('STATE.md') || result.output.includes('STATE.md'),
      'error message should mention STATE.md'
    );
  });
});

describe('cmdStatePatch and cmdStateUpdate (state patch, state update)', () => {
  let tmpDir;
  const stateMd = [
    '# Project State',
    '',
    '**Current Phase:** 03',
    '**Status:** In progress',
    '**Last Activity:** 2024-01-15',
  ].join('\n') + '\n';

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('state patch updates multiple fields at once', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateMd);

    captureOutput(() => cmdStatePatch(tmpDir, {
      Status: 'Complete',
      'Current Phase': '04',
    }, false));

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('**Status:** Complete'), 'Status should be updated to Complete');
    assert.ok(updated.includes('**Last Activity:** 2024-01-15'), 'Last Activity should be unchanged');
  });

  test('state patch reports failed fields that do not exist', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateMd);

    const result = captureOutput(() => cmdStatePatch(tmpDir, {
      Status: 'Done',
      Missing: 'value',
    }, false));
    const output = JSON.parse(result);
    assert.ok(Array.isArray(output.updated), 'updated should be an array');
    assert.ok(output.updated.includes('Status'), 'Status should be in updated list');
    assert.ok(Array.isArray(output.failed), 'failed should be an array');
    assert.ok(output.failed.includes('Missing'), 'Missing should be in failed list');
  });

  test('state update changes a single field', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateMd);

    const result = captureOutput(() => cmdStateUpdate(tmpDir, 'Status', 'Phase complete'));
    const output = JSON.parse(result);
    assert.strictEqual(output.updated, true, 'updated should be true');

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('**Status:** Phase complete'), 'Status should be updated');
    assert.ok(updated.includes('**Current Phase:** 03'), 'Current Phase should be unchanged');
    assert.ok(updated.includes('**Last Activity:** 2024-01-15'), 'Last Activity should be unchanged');
  });

  test('state update reports field not found', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateMd);

    const result = captureOutput(() => cmdStateUpdate(tmpDir, 'Missing', 'value'));
    const output = JSON.parse(result);
    assert.strictEqual(output.updated, false, 'updated should be false');
    assert.ok(output.reason !== undefined, 'should include a reason');
  });

  test('state update returns error when STATE.md missing', () => {
    const result = captureOutput(() => cmdStateUpdate(tmpDir, 'Status', 'value'));
    const output = JSON.parse(result);
    assert.strictEqual(output.updated, false, 'updated should be false');
    assert.ok(
      output.reason.includes('STATE.md'),
      'reason should mention STATE.md'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdStateAdvancePlan, cmdStateRecordMetric, cmdStateUpdateProgress
// ─────────────────────────────────────────────────────────────────────────────

describe('cmdStateAdvancePlan (state advance-plan)', () => {
  let tmpDir;

  const advanceFixture = [
    '# Project State',
    '',
    '**Current Plan:** 1',
    '**Total Plans in Phase:** 3',
    '**Status:** Executing',
    '**Last Activity:** 2024-01-10',
  ].join('\n') + '\n';

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('advances plan counter when not on last plan', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), advanceFixture);

    const before = new Date().toISOString().split('T')[0];
    const result = captureOutput(() => cmdStateAdvancePlan(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.advanced, true, 'advanced should be true');
    assert.strictEqual(output.previous_plan, 1, 'previous_plan should be 1');
    assert.strictEqual(output.current_plan, 2, 'current_plan should be 2');
    assert.strictEqual(output.total_plans, 3, 'total_plans should be 3');

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('**Current Plan:** 2'), 'Current Plan should be updated to 2');
    assert.ok(updated.includes('**Status:** Ready to execute'), 'Status should be Ready to execute');
    const after = new Date().toISOString().split('T')[0];
    assert.ok(
      updated.includes(`**Last Activity:** ${before}`) || updated.includes(`**Last Activity:** ${after}`),
      `Last Activity should be today (${before}) or next day if midnight boundary (${after})`
    );
  });

  test('marks phase complete on last plan', () => {
    const lastPlanFixture = advanceFixture.replace('**Current Plan:** 1', '**Current Plan:** 3');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), lastPlanFixture);

    const result = captureOutput(() => cmdStateAdvancePlan(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.advanced, false, 'advanced should be false');
    assert.strictEqual(output.reason, 'last_plan', 'reason should be last_plan');
    assert.strictEqual(output.status, 'ready_for_verification', 'status should be ready_for_verification');

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('Phase complete'), 'Status should contain Phase complete');
  });

  test('returns error when STATE.md missing', () => {
    const result = captureOutput(() => cmdStateAdvancePlan(tmpDir, false));
    const output = JSON.parse(result);
    assert.ok(output.error !== undefined, 'output should have error field');
    assert.ok(output.error.includes('STATE.md'), 'error should mention STATE.md');
  });

  test('returns error when plan fields not parseable', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Status:** Active\n'
    );

    const result = captureOutput(() => cmdStateAdvancePlan(tmpDir, false));
    const output = JSON.parse(result);
    assert.ok(output.error !== undefined, 'output should have error field');
    assert.ok(output.error.toLowerCase().includes('cannot parse'), 'error should mention Cannot parse');
  });

  test('advances plan in compound "Plan: X of Y" format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State\n\nPlan: 2 of 5 in current phase\nStatus: In progress\nLast activity: 2025-01-01\n`
    );

    const result = captureOutput(() => cmdStateAdvancePlan(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.advanced, true, 'advanced should be true');
    assert.strictEqual(output.previous_plan, 2);
    assert.strictEqual(output.current_plan, 3);
    assert.strictEqual(output.total_plans, 5);

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('Plan: 3 of 5 in current phase'),
      'should preserve compound format with updated plan number');
    assert.ok(updated.includes('Status: Ready to execute'),
      'Status should be updated');
  });

  test('marks phase complete on last plan in compound format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State\n\nPlan: 3 of 3 in current phase\nStatus: In progress\nLast activity: 2025-01-01\n`
    );

    const result = captureOutput(() => cmdStateAdvancePlan(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.advanced, false);
    assert.strictEqual(output.reason, 'last_plan');

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('Phase complete'), 'Status should contain Phase complete');
  });
});

describe('cmdStateRecordMetric (state record-metric)', () => {
  let tmpDir;

  const metricsFixture = [
    '# Project State',
    '',
    '## Performance Metrics',
    '',
    '| Plan | Duration | Tasks | Files |',
    '|------|----------|-------|-------|',
    '| Phase 1 P1 | 3min | 2 tasks | 3 files |',
    '',
    '## Session Continuity',
  ].join('\n') + '\n';

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('appends metric row to existing table', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), metricsFixture);

    const result = captureOutput(() => cmdStateRecordMetric(tmpDir, {
      phase: '2', plan: '1', duration: '5min', tasks: '3', files: '4',
    }, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.recorded, true, 'recorded should be true');

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('| Phase 2 P1 | 5min | 3 tasks | 4 files |'), 'new row should be present');
    assert.ok(updated.includes('| Phase 1 P1 | 3min | 2 tasks | 3 files |'), 'existing row should still be present');
  });

  test('replaces None yet placeholder with first metric', () => {
    const noneYetFixture = [
      '# Project State',
      '',
      '## Performance Metrics',
      '',
      '| Plan | Duration | Tasks | Files |',
      '|------|----------|-------|-------|',
      'None yet',
      '',
      '## Session Continuity',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), noneYetFixture);

    captureOutput(() => cmdStateRecordMetric(tmpDir, {
      phase: '1', plan: '1', duration: '2min', tasks: '1', files: '2',
    }, false));

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(!updated.includes('None yet'), 'None yet placeholder should be removed');
    assert.ok(updated.includes('| Phase 1 P1 | 2min | 1 tasks | 2 files |'), 'new row should be present');
  });

  test('returns error when required fields missing', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), metricsFixture);

    const result = captureOutput(() => cmdStateRecordMetric(tmpDir, {
      phase: '1',
    }, false));
    const output = JSON.parse(result);
    assert.ok(output.error !== undefined, 'output should have error field');
    assert.ok(
      output.error.includes('phase') || output.error.includes('plan') || output.error.includes('duration'),
      'error should mention missing required fields'
    );
  });

  test('returns error when STATE.md missing', () => {
    const result = captureOutput(() => cmdStateRecordMetric(tmpDir, {
      phase: '1', plan: '1', duration: '2min',
    }, false));
    const output = JSON.parse(result);
    assert.ok(output.error !== undefined, 'output should have error field');
    assert.ok(output.error.includes('STATE.md'), 'error should mention STATE.md');
  });
});

describe('cmdStateUpdateProgress (state update-progress)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('calculates progress from plan/summary counts', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Progress:** [░░░░░░░░░░] 0%\n'
    );

    // Phase 01: 1 PLAN + 1 SUMMARY = completed
    const phase01Dir = path.join(tmpDir, '.planning', 'phases', '01');
    fs.mkdirSync(phase01Dir, { recursive: true });
    fs.writeFileSync(path.join(phase01Dir, '01-01-PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(phase01Dir, '01-01-SUMMARY.md'), '# Summary\n');

    // Phase 02: 1 PLAN only = not completed
    const phase02Dir = path.join(tmpDir, '.planning', 'phases', '02');
    fs.mkdirSync(phase02Dir, { recursive: true });
    fs.writeFileSync(path.join(phase02Dir, '02-01-PLAN.md'), '# Plan\n');

    const result = captureOutput(() => cmdStateUpdateProgress(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.updated, true, 'updated should be true');
    assert.strictEqual(output.percent, 50, 'percent should be 50');
    assert.strictEqual(output.completed, 1, 'completed should be 1');
    assert.strictEqual(output.total, 2, 'total should be 2');

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('50%'), 'STATE.md Progress should contain 50%');
  });

  test('handles zero plans gracefully', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Progress:** [░░░░░░░░░░] 0%\n'
    );

    const result = captureOutput(() => cmdStateUpdateProgress(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.percent, 0, 'percent should be 0 when no plans found');
  });

  test('returns error when Progress field missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Status:** Active\n'
    );

    const result = captureOutput(() => cmdStateUpdateProgress(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.updated, false, 'updated should be false');
    assert.ok(output.reason !== undefined, 'should have a reason');
  });

  test('returns error when STATE.md missing', () => {
    const result = captureOutput(() => cmdStateUpdateProgress(tmpDir, false));
    const output = JSON.parse(result);
    assert.ok(output.error !== undefined, 'output should have error field');
    assert.ok(output.error.includes('STATE.md'), 'error should mention STATE.md');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdStateResolveBlocker, cmdStateRecordSession
// ─────────────────────────────────────────────────────────────────────────────

describe('cmdStateResolveBlocker (state resolve-blocker)', () => {
  let tmpDir;

  const blockerFixture = [
    '# Project State',
    '',
    '## Blockers',
    '',
    '- Waiting for API credentials',
    '- Need design review for dashboard',
    '- Pending vendor approval',
    '',
    '## Session Continuity',
  ].join('\n') + '\n';

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('removes matching blocker line (case-insensitive substring match)', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), blockerFixture);

    const result = captureOutput(() => cmdStateResolveBlocker(tmpDir, 'api credentials', false));
    const output = JSON.parse(result);
    assert.strictEqual(output.resolved, true, 'resolved should be true');

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(!updated.includes('Waiting for API credentials'), 'matched blocker should be removed');
    assert.ok(updated.includes('Need design review for dashboard'), 'other blocker should still be present');
    assert.ok(updated.includes('Pending vendor approval'), 'other blocker should still be present');
  });

  test('adds None placeholder when last blocker resolved', () => {
    const singleBlockerFixture = [
      '# Project State',
      '',
      '## Blockers',
      '',
      '- Single blocker',
      '',
      '## Session Continuity',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), singleBlockerFixture);

    captureOutput(() => cmdStateResolveBlocker(tmpDir, 'single blocker', false));

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(!updated.includes('- Single blocker'), 'resolved blocker should be removed');

    // Section should contain "None" placeholder, not be empty
    const sectionMatch = updated.match(/## Blockers\n([\s\S]*?)(?=\n##|$)/i);
    assert.ok(sectionMatch, 'Blockers section should still exist');
    assert.ok(sectionMatch[1].includes('None'), 'Blockers section should contain None placeholder');
  });

  test('returns error when text not provided', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), blockerFixture);

    const result = captureOutput(() => cmdStateResolveBlocker(tmpDir, undefined, false));
    const output = JSON.parse(result);
    assert.ok(output.error !== undefined, 'output should have error field');
    assert.ok(
      output.error.toLowerCase().includes('text'),
      'error should mention text required'
    );
  });

  test('returns error when STATE.md missing', () => {
    const result = captureOutput(() => cmdStateResolveBlocker(tmpDir, 'anything', false));
    const output = JSON.parse(result);
    assert.ok(output.error !== undefined, 'output should have error field');
    assert.ok(output.error.includes('STATE.md'), 'error should mention STATE.md');
  });

  test('returns resolved true even if no line matches', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), blockerFixture);

    const result = captureOutput(() => cmdStateResolveBlocker(tmpDir, 'nonexistent blocker text', false));
    const output = JSON.parse(result);
    assert.strictEqual(output.resolved, true, 'resolved should be true even when no line matches');
  });
});

describe('cmdStateRecordSession (state record-session)', () => {
  let tmpDir;

  const sessionFixture = [
    '# Project State',
    '',
    '## Session Continuity',
    '',
    '**Last session:** 2024-01-10',
    '**Stopped at:** Phase 2, Plan 1',
    '**Resume file:** None',
  ].join('\n') + '\n';

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('updates session fields with stopped-at and resume-file', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), sessionFixture);

    const result = captureOutput(() => cmdStateRecordSession(tmpDir, {
      stopped_at: 'Phase 3, Plan 2',
      resume_file: '.planning/phases/03/03-02-PLAN.md',
    }, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.recorded, true, 'recorded should be true');
    assert.ok(Array.isArray(output.updated), 'updated should be an array');

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('Phase 3, Plan 2'), 'Stopped at should be updated');
    assert.ok(updated.includes('.planning/phases/03/03-02-PLAN.md'), 'Resume file should be updated');

    const today = new Date().toISOString().split('T')[0];
    assert.ok(updated.includes(today), 'Last session should be updated to today');
  });

  test('updates Last session timestamp even with no other options', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), sessionFixture);

    // CLI defaults resume_file to 'None' when not specified.
    const result = captureOutput(() => cmdStateRecordSession(tmpDir, {
      resume_file: 'None',
    }, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.recorded, true, 'recorded should be true');

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    const today = new Date().toISOString().split('T')[0];
    assert.ok(updated.includes(today), 'Last session should contain today\'s date');
  });

  test('sets Resume file to None when not specified', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), sessionFixture);

    captureOutput(() => cmdStateRecordSession(tmpDir, {
      stopped_at: 'Phase 1 complete',
      resume_file: 'None',
    }, false));

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(updated.includes('Phase 1 complete'), 'Stopped at should be updated');
    // Resume file should be set to None (default)
    const resumeMatch = updated.match(/\*\*Resume file:\*\*\s*(.*)/i);
    assert.ok(resumeMatch, 'Resume file field should exist');
    assert.ok(resumeMatch[1].trim() === 'None', 'Resume file should be None when not specified');
  });

  test('returns error when STATE.md missing', () => {
    const result = captureOutput(() => cmdStateRecordSession(tmpDir, {
      resume_file: 'None',
    }, false));
    const output = JSON.parse(result);
    assert.ok(output.error !== undefined, 'output should have error field');
    assert.ok(output.error.includes('STATE.md'), 'error should mention STATE.md');
  });

  test('returns recorded false when no session fields found', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Status:** Active\n**Phase:** 03\n'
    );

    const result = captureOutput(() => cmdStateRecordSession(tmpDir, {
      resume_file: 'None',
    }, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.recorded, false, 'recorded should be false when no session fields found');
    assert.ok(output.reason !== undefined, 'should have a reason');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Milestone-scoped phase counting in frontmatter
// ─────────────────────────────────────────────────────────────────────────────

describe('milestone-scoped phase counting in frontmatter', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('total_phases counts only current milestone phases', () => {
    // ROADMAP lists only phases 5-6 (current milestone)
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '## Roadmap v2.0: Next Release',
        '',
        '### Phase 5: Auth',
        '**Goal:** Add authentication',
        '',
        '### Phase 6: Dashboard',
        '**Goal:** Build dashboard',
      ].join('\n')
    );

    // Disk has dirs 01-06 (01-04 are leftover from previous milestone)
    for (let i = 1; i <= 6; i++) {
      const padded = String(i).padStart(2, '0');
      const phaseDir = path.join(tmpDir, '.planning', 'phases', `${padded}-phase-${i}`);
      fs.mkdirSync(phaseDir, { recursive: true });
      // Add a plan to each
      fs.writeFileSync(path.join(phaseDir, `${padded}-01-PLAN.md`), '# Plan');
      fs.writeFileSync(path.join(phaseDir, `${padded}-01-SUMMARY.md`), '# Summary');
    }

    // Write a STATE.md and trigger a write that will sync frontmatter
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Current Phase:** 05\n**Status:** In progress\n'
    );

    captureOutput(() => cmdStateUpdate(tmpDir, 'Status', 'Executing'));

    // Read the state json to check frontmatter
    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(Number(output.progress.total_phases), 2, 'should count only milestone phases (5 and 6), not all 6');
    assert.strictEqual(Number(output.progress.completed_phases), 2, 'both milestone phases have summaries');
  });

  test('total_phases includes ROADMAP phases without directories', () => {
    // ROADMAP lists 6 phases (5-10), but only 4 have directories on disk
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      [
        '## Roadmap v3.0',
        '',
        '### Phase 5: Auth',
        '### Phase 6: Dashboard',
        '### Phase 7: API',
        '### Phase 8: Notifications',
        '### Phase 9: Analytics',
        '### Phase 10: Polish',
      ].join('\n')
    );

    // Only phases 5-8 have directories (9 and 10 not yet planned)
    for (let i = 5; i <= 8; i++) {
      const padded = String(i).padStart(2, '0');
      const phaseDir = path.join(tmpDir, '.planning', 'phases', `${padded}-phase-${i}`);
      fs.mkdirSync(phaseDir, { recursive: true });
      fs.writeFileSync(path.join(phaseDir, `${padded}-01-PLAN.md`), '# Plan');
      fs.writeFileSync(path.join(phaseDir, `${padded}-01-SUMMARY.md`), '# Summary');
    }

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Current Phase:** 08\n**Status:** In progress\n'
    );

    captureOutput(() => cmdStateUpdate(tmpDir, 'Status', 'Executing'));

    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(Number(output.progress.total_phases), 6, 'should count all 6 ROADMAP phases, not just 4 with directories');
    assert.strictEqual(Number(output.progress.completed_phases), 4, 'only 4 phases have summaries');
  });

  test('without ROADMAP counts all phases (pass-all filter)', () => {
    // No ROADMAP.md — all phases should be counted
    for (let i = 1; i <= 4; i++) {
      const padded = String(i).padStart(2, '0');
      const phaseDir = path.join(tmpDir, '.planning', 'phases', `${padded}-phase-${i}`);
      fs.mkdirSync(phaseDir, { recursive: true });
      fs.writeFileSync(path.join(phaseDir, `${padded}-01-PLAN.md`), '# Plan');
    }

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Project State\n\n**Current Phase:** 01\n**Status:** Planning\n'
    );

    captureOutput(() => cmdStateUpdate(tmpDir, 'Status', 'In progress'));

    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(Number(output.progress.total_phases), 4, 'without ROADMAP should count all 4 phases');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// begin-phase — field preservation (#1365)
// ─────────────────────────────────────────────────────────────────────────────

describe('state begin-phase preserves Current Position fields (#1365)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('begin-phase preserves Status, Last activity, and Progress in Current Position', () => {
    const stateMd = `# Project State

**Current Phase:** 1
**Current Phase Name:** setup
**Total Phases:** 5
**Current Plan:** 0
**Total Plans in Phase:** 0
**Status:** Ready to plan
**Last Activity:** 2026-03-20
**Last Activity Description:** Roadmap created

## Current Position
Phase: 1 of 5 (setup)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-03-20 -- Roadmap created
Progress: [..........] 0%

## Decisions Made

| Phase | Decision | Rationale |
|-------|----------|-----------|
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateMd);

    captureOutput(() => cmdStateBeginPhase(tmpDir, '1', 'setup', 4, false));

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8'
    );

    // Extract the Current Position section
    const posMatch = content.match(/## Current Position\s*\n([\s\S]*?)(?=\n##|$)/i);
    assert.ok(posMatch, 'Current Position section should exist');
    const posSection = posMatch[1];

    // Phase and Plan lines should be updated
    assert.ok(/^Phase:.*EXECUTING/m.test(posSection), 'Phase line should say EXECUTING');
    assert.ok(/^Plan:.*1 of 4/m.test(posSection), 'Plan line should show 1 of 4');

    // Status, Last activity, and Progress must still be present (the bug destroys these)
    assert.ok(/^Status:/m.test(posSection),
      'Status field must be preserved in Current Position');
    assert.ok(/^Last activity:/m.test(posSection),
      'Last activity field must be preserved in Current Position');
    assert.ok(/^Progress:/m.test(posSection),
      'Progress field must be preserved in Current Position');
  });

  test('advance-plan can update Status after begin-phase', () => {
    // Simulates the full workflow: begin-phase then advance through all plans
    const stateMd = `# Project State

**Current Phase:** 1
**Current Phase Name:** setup
**Total Phases:** 5
**Current Plan:** 0
**Total Plans in Phase:** 0
**Status:** Ready to plan
**Last Activity:** 2026-03-20
**Last Activity Description:** Roadmap created

## Current Position
Phase: 1 of 5 (setup)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-03-20 -- Roadmap created
Progress: [..........] 0%

## Decisions Made

| Phase | Decision | Rationale |
|-------|----------|-----------|
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateMd);

    // Step 1: begin-phase
    captureOutput(() => cmdStateBeginPhase(tmpDir, '1', 'setup', 2, false));

    // Step 2: advance-plan to go from plan 1 to plan 2
    captureOutput(() => cmdStateAdvancePlan(tmpDir, false));

    // Step 3: advance-plan again — plan 2 of 2 is the last, should set "Phase complete"
    captureOutput(() => cmdStateAdvancePlan(tmpDir, false));

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8'
    );
    const posMatch = content.match(/## Current Position\s*\n([\s\S]*?)(?=\n##|$)/i);
    assert.ok(posMatch, 'Current Position section should exist after advance-plan');
    const posSection = posMatch[1];

    // After advancing past all plans, Status should say "Phase complete"
    assert.ok(/Status:.*Phase complete/i.test(posSection),
      'Status should be updated to "Phase complete" after last advance-plan');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signal-waiting and signal-resume commands
// ─────────────────────────────────────────────────────────────────────────────

describe('state signal-waiting command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('writes WAITING.json to .planning directory', () => {
    const result = captureOutput(() => cmdSignalWaiting(
      tmpDir, 'decision_point', 'Which DB?', 'Postgres|MySQL', '2', false
    ));
    const output = JSON.parse(result);
    assert.strictEqual(output.signaled, true);
    assert.ok(output.path.includes('WAITING.json'), 'path should contain WAITING.json');

    const waitingPath = path.join(tmpDir, '.planning', 'WAITING.json');
    assert.ok(fs.existsSync(waitingPath), 'WAITING.json should exist');
    const signal = JSON.parse(fs.readFileSync(waitingPath, 'utf-8'));
    assert.strictEqual(signal.status, 'waiting');
    assert.strictEqual(signal.type, 'decision_point');
    assert.strictEqual(signal.question, 'Which DB?');
    assert.deepStrictEqual(signal.options, ['Postgres', 'MySQL']);
    assert.strictEqual(signal.phase, '2');
    assert.ok(signal.since, 'should have since timestamp');
  });

  test('writes WAITING.json with defaults when no options provided', () => {
    const result = captureOutput(() => cmdSignalWaiting(
      tmpDir, undefined, undefined, undefined, undefined, false
    ));
    const output = JSON.parse(result);
    assert.strictEqual(output.signaled, true);

    const waitingPath = path.join(tmpDir, '.planning', 'WAITING.json');
    const signal = JSON.parse(fs.readFileSync(waitingPath, 'utf-8'));
    assert.strictEqual(signal.type, 'decision_point');
    assert.strictEqual(signal.question, null);
    assert.deepStrictEqual(signal.options, []);
    assert.strictEqual(signal.phase, null);
  });

  test('writes to .gsd directory if it exists', () => {
    const gsdDir = path.join(tmpDir, '.gsd');
    fs.mkdirSync(gsdDir, { recursive: true });
    const result = captureOutput(() => cmdSignalWaiting(
      tmpDir, 'approval', 'OK?', undefined, undefined, false
    ));
    const output = JSON.parse(result);
    assert.strictEqual(output.signaled, true);
    assert.ok(
      fs.existsSync(path.join(gsdDir, 'WAITING.json')),
      'WAITING.json should be in .gsd directory'
    );
  });
});

describe('state signal-resume command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('removes WAITING.json from .planning directory', () => {
    const waitingPath = path.join(tmpDir, '.planning', 'WAITING.json');
    fs.writeFileSync(waitingPath, JSON.stringify({ status: 'waiting' }));
    assert.ok(fs.existsSync(waitingPath), 'WAITING.json should exist before resume');

    const result = captureOutput(() => cmdSignalResume(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.resumed, true);
    assert.strictEqual(output.removed, true);
    assert.ok(!fs.existsSync(waitingPath), 'WAITING.json should be removed after resume');
  });

  test('removes WAITING.json from .gsd directory', () => {
    const gsdDir = path.join(tmpDir, '.gsd');
    fs.mkdirSync(gsdDir, { recursive: true });
    const waitingPath = path.join(gsdDir, 'WAITING.json');
    fs.writeFileSync(waitingPath, JSON.stringify({ status: 'waiting' }));

    const result = captureOutput(() => cmdSignalResume(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.resumed, true);
    assert.strictEqual(output.removed, true);
    assert.ok(!fs.existsSync(waitingPath), 'WAITING.json should be removed from .gsd');
  });

  test('returns removed=false when no WAITING.json exists', () => {
    const result = captureOutput(() => cmdSignalResume(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.resumed, true);
    assert.strictEqual(output.removed, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// begin-phase edge cases (lines 912-914, 930-931, 938-939)
// ─────────────────────────────────────────────────────────────────────────────

describe('state begin-phase additional branches', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('updates Current focus body text line', () => {
    const stateMd = `# Project State

**Current Phase:** 1
**Current Phase Name:** old
**Status:** Ready to plan
**Last Activity:** 2026-03-20

**Current focus:** Phase 1 — old

## Current Position
Phase: 1 (old)
Plan: 0 of ?
Status: Ready to plan
Last activity: 2026-03-20

## Decisions Made

| Phase | Decision | Rationale |
|-------|----------|-----------|
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateMd);

    const result = captureOutput(() => cmdStateBeginPhase(tmpDir, '2', 'API Layer', 3, false));
    const output = JSON.parse(result);
    assert.ok(output.updated.includes('Current focus'), 'should update Current focus');

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(content.includes('Phase 2 — API Layer'), 'Current focus should be updated');
  });

  test('inserts Phase line when not present in Current Position', () => {
    const stateMd = `# Project State

**Current Phase:** 1
**Status:** Ready to plan
**Last Activity:** 2026-03-20

## Current Position
Status: Ready to plan
Last activity: 2026-03-20

## Decisions Made
None yet
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateMd);

    captureOutput(() => cmdStateBeginPhase(tmpDir, '3', 'Testing', null, false));
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    assert.ok(content.includes('Phase: 3 (Testing)'), 'should insert Phase line');
  });

  test('inserts Plan line when not present in Current Position', () => {
    const stateMd = `# Project State

**Current Phase:** 1
**Status:** Ready to plan
**Last Activity:** 2026-03-20

## Current Position
Phase: 1 — EXECUTING
Status: Ready to plan

## Decisions Made
None yet
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), stateMd);

    captureOutput(() => cmdStateBeginPhase(tmpDir, '2', 'Build', 5, false));
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'STATE.md'), 'utf-8');
    // Plan line should be inserted after Phase line
    assert.ok(content.includes('Plan: 1 of 5'), 'should insert Plan line');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Direct import tests for uncovered branches in state.cjs
// ─────────────────────────────────────────────────────────────────────────────

const stateModule = require('../cap/bin/lib/state.cjs');

describe('buildStateFrontmatter status normalization (direct)', () => {
  let tmpDir;

  beforeEach(() => {
    const os = require('os');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-state-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('discussing status normalizes to discussing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Status:** Discussing architecture options\n**Last Activity:** 2026-01-01\n`
    );
    // Call cmdStateJson which triggers buildStateFrontmatter
    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.status, 'discussing');
  });

  test('paused status normalizes to paused', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Status:** Paused for review\n**Last Activity:** 2026-01-01\n`
    );
    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.status, 'paused');
  });

  test('verification status normalizes to verifying', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Status:** Verifying phase 2\n**Last Activity:** 2026-01-01\n`
    );
    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.status, 'verifying');
  });

  test('completed status normalizes to completed', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Status:** Complete\n**Last Activity:** 2026-01-01\n`
    );
    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.status, 'completed');
  });

  test('ready to execute normalizes to executing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Status:** Ready to execute\n**Last Activity:** 2026-01-01\n`
    );
    const result = captureOutput(() => cmdStateJson(tmpDir, false));
    const output = JSON.parse(result);
    assert.strictEqual(output.status, 'executing');
  });
});

describe('cmdSignalWaiting and cmdSignalResume direct (in-process)', () => {
  let tmpDir;

  beforeEach(() => {
    const os = require('os');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-signal-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('cmdSignalWaiting writes signal file in-process', () => {
    const origWrite = fs.writeSync;
    let captured = '';
    fs.writeSync = function(fd, data) {
      if (fd === 1 || fd === 2) { captured += data; return data.length; }
      return origWrite.apply(fs, arguments);
    };
    try {
      stateModule.cmdSignalWaiting(tmpDir, 'approval', 'Ship it?', 'Yes|No|Maybe', '3', false);
    } finally {
      fs.writeSync = origWrite;
    }
    const output = JSON.parse(captured);
    assert.strictEqual(output.signaled, true);
    const waitingPath = path.join(tmpDir, '.planning', 'WAITING.json');
    assert.ok(fs.existsSync(waitingPath), 'WAITING.json should exist');
    const signal = JSON.parse(fs.readFileSync(waitingPath, 'utf-8'));
    assert.strictEqual(signal.type, 'approval');
    assert.strictEqual(signal.question, 'Ship it?');
    assert.deepStrictEqual(signal.options, ['Yes', 'No', 'Maybe']);
    assert.strictEqual(signal.phase, '3');
  });

  test('cmdSignalResume removes signal file in-process', () => {
    const waitingPath = path.join(tmpDir, '.planning', 'WAITING.json');
    fs.writeFileSync(waitingPath, JSON.stringify({ status: 'waiting' }));

    const origWrite = fs.writeSync;
    let captured = '';
    fs.writeSync = function(fd, data) {
      if (fd === 1 || fd === 2) { captured += data; return data.length; }
      return origWrite.apply(fs, arguments);
    };
    try {
      stateModule.cmdSignalResume(tmpDir, false);
    } finally {
      fs.writeSync = origWrite;
    }
    const output = JSON.parse(captured);
    assert.strictEqual(output.resumed, true);
    assert.strictEqual(output.removed, true);
    assert.ok(!fs.existsSync(waitingPath));
  });

  test('cmdSignalResume returns removed=false when no file', () => {
    const origWrite = fs.writeSync;
    let captured = '';
    fs.writeSync = function(fd, data) {
      if (fd === 1 || fd === 2) { captured += data; return data.length; }
      return origWrite.apply(fs, arguments);
    };
    try {
      stateModule.cmdSignalResume(tmpDir, false);
    } finally {
      fs.writeSync = origWrite;
    }
    const output = JSON.parse(captured);
    assert.strictEqual(output.resumed, true);
    assert.strictEqual(output.removed, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// summary-extract command
// ─────────────────────────────────────────────────────────────────────────────
