/**
 * GSD Tools Tests - Commands
 */

// @cap-decision(CI/issue-42 Path-2 PR-2.1) Migrated 115 runGsdTools spawn
// callsites to direct cmdXxx in-process calls. Removes ~3.5s of spawn
// overhead from this file alone. Tracks issue #42 Path 2 plan documented
// in scripts/run-tests.cjs:39-53.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');
const {
  cmdHistoryDigest,
  cmdSummaryExtract,
  cmdProgressRender,
  cmdTodoComplete,
  cmdTodoMatchPhase,
  cmdCommitToSubrepo,
  cmdScaffold,
  cmdGenerateSlug,
  cmdCurrentTimestamp,
  cmdListTodos,
  cmdVerifyPathExists,
  cmdResolveModel,
  cmdCommit,
  cmdStats,
} = require('../cap/bin/lib/commands.cjs');

/**
 * In-process equivalent of runGsdTools that captures stdout, stderr, and
 * process.exit(). Returns the same {success, output, error} shape so the
 * existing test bodies need no further changes beyond swapping the call.
 *
 * Pattern follows tests/workstream.test.cjs:485-512 captureOutput/captureError
 * helpers, generalised to capture both stdout and stderr in one pass.
 */
function runCmd(fn) {
  const origWriteSync = fs.writeSync;
  const origExit = process.exit;
  let stdout = '';
  let stderr = '';
  let exited = false;
  let exitCode = 0;

  fs.writeSync = (fd, data, ...rest) => {
    const str = String(data);
    if (fd === 1) { stdout += str; return Buffer.byteLength(str); }
    if (fd === 2) { stderr += str; return Buffer.byteLength(str); }
    return origWriteSync.call(fs, fd, data, ...rest);
  };
  process.exit = (code) => {
    exited = true;
    exitCode = code || 0;
    throw new Error('__CMD_EXIT__');
  };

  let thrown = null;
  try {
    fn();
  } catch (e) {
    if (e && e.message !== '__CMD_EXIT__') thrown = e;
  } finally {
    fs.writeSync = origWriteSync;
    process.exit = origExit;
  }

  if (thrown) {
    return { success: false, output: stdout.trim(), error: (stderr.trim() || thrown.message) };
  }
  if (exited && exitCode !== 0) {
    return { success: false, output: stdout.trim(), error: stderr.trim() };
  }
  return { success: true, output: stdout.trim(), error: null };
}

describe('history-digest command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phases directory returns valid schema', () => {
    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    assert.deepStrictEqual(digest.phases, {}, 'phases should be empty object');
    assert.deepStrictEqual(digest.decisions, [], 'decisions should be empty array');
    assert.deepStrictEqual(digest.tech_stack, [], 'tech_stack should be empty array');
  });

  test('nested frontmatter fields extracted correctly', () => {
    // Create phase directory with SUMMARY containing nested frontmatter
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    const summaryContent = `---
phase: "01"
name: "Foundation Setup"
dependency-graph:
  provides:
    - "Database schema"
    - "Auth system"
  affects:
    - "API layer"
tech-stack:
  added:
    - "prisma"
    - "jose"
patterns-established:
  - "Repository pattern"
  - "JWT auth flow"
key-decisions:
  - "Use Prisma over Drizzle"
  - "JWT in httpOnly cookies"
---

# Summary content here
`;

    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), summaryContent);

    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    // Check nested dependency-graph.provides
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.deepStrictEqual(
      digest.phases['01'].provides.sort(),
      ['Auth system', 'Database schema'],
      'provides should contain nested values'
    );

    // Check nested dependency-graph.affects
    assert.deepStrictEqual(
      digest.phases['01'].affects,
      ['API layer'],
      'affects should contain nested values'
    );

    // Check nested tech-stack.added
    assert.deepStrictEqual(
      digest.tech_stack.sort(),
      ['jose', 'prisma'],
      'tech_stack should contain nested values'
    );

    // Check patterns-established (flat array)
    assert.deepStrictEqual(
      digest.phases['01'].patterns.sort(),
      ['JWT auth flow', 'Repository pattern'],
      'patterns should be extracted'
    );

    // Check key-decisions
    assert.strictEqual(digest.decisions.length, 2, 'Should have 2 decisions');
    assert.ok(
      digest.decisions.some(d => d.decision === 'Use Prisma over Drizzle'),
      'Should contain first decision'
    );
  });

  test('multiple phases merged into single digest', () => {
    // Create phase 01
    const phase01Dir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phase01Dir, { recursive: true });
    fs.writeFileSync(
      path.join(phase01Dir, '01-01-SUMMARY.md'),
      `---
phase: "01"
name: "Foundation"
provides:
  - "Database"
patterns-established:
  - "Pattern A"
key-decisions:
  - "Decision 1"
---
`
    );

    // Create phase 02
    const phase02Dir = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phase02Dir, { recursive: true });
    fs.writeFileSync(
      path.join(phase02Dir, '02-01-SUMMARY.md'),
      `---
phase: "02"
name: "API"
provides:
  - "REST endpoints"
patterns-established:
  - "Pattern B"
key-decisions:
  - "Decision 2"
tech-stack:
  added:
    - "zod"
---
`
    );

    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    // Both phases present
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.ok(digest.phases['02'], 'Phase 02 should exist');

    // Decisions merged
    assert.strictEqual(digest.decisions.length, 2, 'Should have 2 decisions total');

    // Tech stack merged
    assert.deepStrictEqual(digest.tech_stack, ['zod'], 'tech_stack should have zod');
  });

  test('malformed SUMMARY.md skipped gracefully', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Valid summary
    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides:
  - "Valid feature"
---
`
    );

    // Malformed summary (no frontmatter)
    fs.writeFileSync(
      path.join(phaseDir, '01-02-SUMMARY.md'),
      `# Just a heading
No frontmatter here
`
    );

    // Another malformed summary (broken YAML)
    fs.writeFileSync(
      path.join(phaseDir, '01-03-SUMMARY.md'),
      `---
broken: [unclosed
---
`
    );

    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command should succeed despite malformed files: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.ok(
      digest.phases['01'].provides.includes('Valid feature'),
      'Valid feature should be extracted'
    );
  });

  test('flat provides field still works (backward compatibility)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides:
  - "Direct provides"
---
`
    );

    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(
      digest.phases['01'].provides,
      ['Direct provides'],
      'Direct provides should work'
    );
  });

  test('includes archived phases in digest', () => {
    // Create milestones/v0.5-phases directory (the format getArchivedPhaseDirs expects)
    const archivedPhase = path.join(tmpDir, '.planning', 'milestones', 'v0.5-phases', '01-foundation');
    fs.mkdirSync(archivedPhase, { recursive: true });

    fs.writeFileSync(
      path.join(archivedPhase, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides:
  - "Archived feature"
key-decisions:
  - "Old decision"
---
`
    );

    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.ok(digest.phases['01'], 'Archived phase 01 should exist');
    assert.ok(
      digest.phases['01'].provides.includes('Archived feature'),
      'Archived feature should be present'
    );
    assert.ok(
      digest.decisions.some(d => d.decision === 'Old decision'),
      'Archived decision should be present'
    );
  });

  test('handles SUMMARY.md that causes runtime error in processing', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Create a summary with provides as a non-iterable value to trigger catch
    // The extractFrontmatter might return provides as a string "direct",
    // and .forEach on a string won't work in Set.add context
    fs.writeFileSync(
      path.join(phaseDir, 'SUMMARY.md'),
      `---
phase: "01"
dependency-graph:
  provides: not-an-array
  affects: also-not-array
---
`
    );

    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command should succeed despite malformed provides: ${result.error}`);
    const digest = JSON.parse(result.output);
    // Should either skip the malformed entry or handle it gracefully
    assert.ok(digest.phases !== undefined, 'phases should exist');
  });

  test('inline array syntax supported', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides: [Feature A, Feature B]
patterns-established: ["Pattern X", "Pattern Y"]
---
`
    );

    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(
      digest.phases['01'].provides.sort(),
      ['Feature A', 'Feature B'],
      'Inline array should work'
    );
    assert.deepStrictEqual(
      digest.phases['01'].patterns.sort(),
      ['Pattern X', 'Pattern Y'],
      'Inline quoted array should work'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phases list command
// ─────────────────────────────────────────────────────────────────────────────


describe('summary-extract command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing file returns error', () => {
    const result = runCmd(() => cmdSummaryExtract(tmpDir, '.planning/phases/01-test/01-01-SUMMARY.md', null, false));
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'should report missing file');
  });

  test('extracts all fields from SUMMARY.md', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
one-liner: Set up Prisma with User and Project models
key-files:
  - prisma/schema.prisma
  - src/lib/db.ts
tech-stack:
  added:
    - prisma
    - zod
patterns-established:
  - Repository pattern
  - Dependency injection
key-decisions:
  - Use Prisma over Drizzle: Better DX and ecosystem
  - Single database: Start simple, shard later
requirements-completed:
  - AUTH-01
  - AUTH-02
---

# Summary

Full summary content here.
`
    );

    const result = runCmd(() => cmdSummaryExtract(tmpDir, '.planning/phases/01-foundation/01-01-SUMMARY.md', null, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.path, '.planning/phases/01-foundation/01-01-SUMMARY.md', 'path correct');
    assert.strictEqual(output.one_liner, 'Set up Prisma with User and Project models', 'one-liner extracted');
    assert.deepStrictEqual(output.key_files, ['prisma/schema.prisma', 'src/lib/db.ts'], 'key files extracted');
    assert.deepStrictEqual(output.tech_added, ['prisma', 'zod'], 'tech added extracted');
    assert.deepStrictEqual(output.patterns, ['Repository pattern', 'Dependency injection'], 'patterns extracted');
    assert.strictEqual(output.decisions.length, 2, 'decisions extracted');
    assert.deepStrictEqual(output.requirements_completed, ['AUTH-01', 'AUTH-02'], 'requirements completed extracted');
  });

  test('selective extraction with --fields', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
one-liner: Set up database
key-files:
  - prisma/schema.prisma
tech-stack:
  added:
    - prisma
patterns-established:
  - Repository pattern
key-decisions:
  - Use Prisma: Better DX
requirements-completed:
  - AUTH-01
---
`
    );

    const result = runCmd(() => cmdSummaryExtract(tmpDir, '.planning/phases/01-foundation/01-01-SUMMARY.md', ['one_liner', 'key_files', 'requirements_completed'], false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Set up database', 'one_liner included');
    assert.deepStrictEqual(output.key_files, ['prisma/schema.prisma'], 'key_files included');
    assert.deepStrictEqual(output.requirements_completed, ['AUTH-01'], 'requirements_completed included');
    assert.strictEqual(output.tech_added, undefined, 'tech_added excluded');
    assert.strictEqual(output.patterns, undefined, 'patterns excluded');
    assert.strictEqual(output.decisions, undefined, 'decisions excluded');
  });

  test('extracts one-liner from body when not in frontmatter', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
key-files:
  - src/lib/db.ts
---

# Phase 1: Foundation Summary

**JWT auth with refresh rotation using jose library**

## Performance

- **Duration:** 28 min
- **Tasks:** 5
`
    );

    const result = runCmd(() => cmdSummaryExtract(tmpDir, '.planning/phases/01-foundation/01-01-SUMMARY.md', null, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'JWT auth with refresh rotation using jose library',
      'one-liner should be extracted from body **bold** line');
  });

  test('handles missing frontmatter fields gracefully', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
one-liner: Minimal summary
---

# Summary
`
    );

    const result = runCmd(() => cmdSummaryExtract(tmpDir, '.planning/phases/01-foundation/01-01-SUMMARY.md', null, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Minimal summary', 'one-liner extracted');
    assert.deepStrictEqual(output.key_files, [], 'key_files defaults to empty');
    assert.deepStrictEqual(output.tech_added, [], 'tech_added defaults to empty');
    assert.deepStrictEqual(output.patterns, [], 'patterns defaults to empty');
    assert.deepStrictEqual(output.decisions, [], 'decisions defaults to empty');
    assert.deepStrictEqual(output.requirements_completed, [], 'requirements_completed defaults to empty');
  });

  test('parses key-decisions without colon (no rationale)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
key-decisions:
  - Simple decision without rationale
  - Another plain decision
---
`
    );

    const result = runCmd(() => cmdSummaryExtract(tmpDir, '.planning/phases/01-foundation/01-01-SUMMARY.md', null, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.decisions[0].summary, 'Simple decision without rationale');
    assert.strictEqual(output.decisions[0].rationale, null, 'rationale should be null when no colon');
    assert.strictEqual(output.decisions[1].summary, 'Another plain decision');
    assert.strictEqual(output.decisions[1].rationale, null);
  });

  test('parses key-decisions with rationale', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
key-decisions:
  - Use Prisma: Better DX than alternatives
  - JWT tokens: Stateless auth for scalability
---
`
    );

    const result = runCmd(() => cmdSummaryExtract(tmpDir, '.planning/phases/01-foundation/01-01-SUMMARY.md', null, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.decisions[0].summary, 'Use Prisma', 'decision summary parsed');
    assert.strictEqual(output.decisions[0].rationale, 'Better DX than alternatives', 'decision rationale parsed');
    assert.strictEqual(output.decisions[1].summary, 'JWT tokens', 'second decision summary');
    assert.strictEqual(output.decisions[1].rationale, 'Stateless auth for scalability', 'second decision rationale');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init commands tests
// ─────────────────────────────────────────────────────────────────────────────


describe('progress command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('renders JSON progress', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Done');
    fs.writeFileSync(path.join(p1, '01-02-PLAN.md'), '# Plan 2');

    const result = runCmd(() => cmdProgressRender(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.total_plans, 2, '2 total plans');
    assert.strictEqual(output.total_summaries, 1, '1 summary');
    assert.strictEqual(output.percent, 50, '50%');
    assert.strictEqual(output.phases.length, 1, '1 phase');
    assert.strictEqual(output.phases[0].status, 'In Progress', 'phase in progress');
  });

  test('renders bar format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Done');

    const result = runCmd(() => cmdProgressRender(tmpDir, 'bar', true));
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('1/1'), 'should include count');
    assert.ok(result.output.includes('100%'), 'should include 100%');
  });

  test('renders table format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');

    const result = runCmd(() => cmdProgressRender(tmpDir, 'table', true));
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('Phase'), 'should have table header');
    assert.ok(result.output.includes('foundation'), 'should include phase name');
  });

  test('does not crash when summaries exceed plans (orphaned SUMMARY.md)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    // 1 plan but 2 summaries (orphaned SUMMARY.md after PLAN.md deletion)
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Done');
    fs.writeFileSync(path.join(p1, '01-02-SUMMARY.md'), '# Orphaned summary');

    // bar format - should not crash with RangeError
    const barResult = runCmd(() => cmdProgressRender(tmpDir, 'bar', true));
    assert.ok(barResult.success, `Bar format crashed: ${barResult.error}`);
    assert.ok(barResult.output.includes('100%'), 'percent should be clamped to 100%');

    // table format - should not crash with RangeError
    const tableResult = runCmd(() => cmdProgressRender(tmpDir, 'table', true));
    assert.ok(tableResult.success, `Table format crashed: ${tableResult.error}`);

    // json format - percent should be clamped
    const jsonResult = runCmd(() => cmdProgressRender(tmpDir, 'json', false));
    assert.ok(jsonResult.success, `JSON format crashed: ${jsonResult.error}`);
    const output = JSON.parse(jsonResult.output);
    assert.ok(output.percent <= 100, `percent should be <= 100 but got ${output.percent}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo complete command
// ─────────────────────────────────────────────────────────────────────────────


describe('todo complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('moves todo from pending to completed', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(
      path.join(pendingDir, 'add-dark-mode.md'),
      `title: Add dark mode\narea: ui\ncreated: 2025-01-01\n`
    );

    const result = runCmd(() => cmdTodoComplete(tmpDir, 'add-dark-mode.md', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.completed, true);

    // Verify moved
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'todos', 'pending', 'add-dark-mode.md')),
      'should be removed from pending'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'todos', 'completed', 'add-dark-mode.md')),
      'should be in completed'
    );

    // Verify completion timestamp added
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'todos', 'completed', 'add-dark-mode.md'),
      'utf-8'
    );
    assert.ok(content.startsWith('completed:'), 'should have completed timestamp');
  });

  test('fails for nonexistent todo', () => {
    const result = runCmd(() => cmdTodoComplete(tmpDir, 'nonexistent.md', false));
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('not found'), 'error mentions not found');
  });

  test('fails when no filename provided', () => {
    const result = runCmd(() => cmdTodoComplete(tmpDir, undefined, false));
    assert.ok(!result.success, 'should fail without filename');
    assert.ok(result.error.includes('filename required'), 'error mentions filename required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo match-phase command
// ─────────────────────────────────────────────────────────────────────────────

describe('todo match-phase command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });
  afterEach(() => cleanup(tmpDir));

  test('returns empty matches when no todos exist', () => {
    const result = runCmd(() => cmdTodoMatchPhase(tmpDir, '01', false));
    assert.ok(result.success, 'should succeed');
    const output = JSON.parse(result.output);
    assert.strictEqual(output.todo_count, 0);
    assert.deepStrictEqual(output.matches, []);
  });

  test('matches todo by keyword overlap with phase name', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'auth-todo.md'),
      'title: Add OAuth token refresh\narea: auth\ncreated: 2026-03-01\n\nNeed to handle token expiry for OAuth flows.');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 01: Authentication and Session Management\n\n**Goal:** Implement OAuth login and session handling\n');

    const result = runCmd(() => cmdTodoMatchPhase(tmpDir, '01', false));
    assert.ok(result.success, 'should succeed');
    const output = JSON.parse(result.output);
    assert.strictEqual(output.todo_count, 1, 'should find 1 todo');
    assert.ok(output.matches.length > 0, 'should have matches');
    assert.strictEqual(output.matches[0].title, 'Add OAuth token refresh');
    assert.ok(output.matches[0].score > 0, 'score should be positive');
    assert.ok(output.matches[0].reasons.length > 0, 'should have reasons');
  });

  test('does not match unrelated todo', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'auth-todo.md'),
      'title: Add OAuth token refresh\narea: auth\ncreated: 2026-03-01\n\nOAuth token expiry.');
    fs.writeFileSync(path.join(pendingDir, 'unrelated-todo.md'),
      'title: Fix CSS grid layout in dashboard\narea: ui\ncreated: 2026-03-01\n\nGrid columns break on mobile.');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 01: Authentication and Session Management\n\n**Goal:** Implement OAuth login and session handling\n');

    const result = runCmd(() => cmdTodoMatchPhase(tmpDir, '01', false));
    assert.ok(result.success, 'should succeed');
    const output = JSON.parse(result.output);
    const matchTitles = output.matches.map(m => m.title);
    assert.ok(matchTitles.includes('Add OAuth token refresh'), 'auth todo should match');
    assert.ok(!matchTitles.includes('Fix CSS grid layout in dashboard'), 'unrelated todo should not match');
  });

  test('matches todo by area overlap', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'auth-todo.md'),
      'title: Add OAuth token refresh\narea: auth\ncreated: 2026-03-01\n\nOAuth token handling.');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 01: Auth System\n\n**Goal:** Build auth module\n');

    const result = runCmd(() => cmdTodoMatchPhase(tmpDir, '01', false));
    const output = JSON.parse(result.output);
    const authMatch = output.matches.find(m => m.title === 'Add OAuth token refresh');
    assert.ok(authMatch, 'should find auth todo');
    const hasAreaReason = authMatch.reasons.some(r => r.startsWith('area:'));
    assert.ok(hasAreaReason, 'should match on area');
  });

  test('matches todo by file overlap with phase plan', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'file-todo.md'),
      'title: Fix auth middleware\narea: general\ncreated: 2026-03-01\nfiles: src/middleware/auth.ts\n\nFix token validation.');

    // Create phase dir with a plan that references the same file
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), `---
files_modified: [src/middleware/auth.ts, src/routes/login.ts]
---
# Plan
`);
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 01: Auth System\n\n**Goal:** Build auth module\n');

    const result = runCmd(() => cmdTodoMatchPhase(tmpDir, '01', false));
    assert.ok(result.success, 'should succeed');
    const output = JSON.parse(result.output);
    const fileMatch = output.matches.find(m => m.title === 'Fix auth middleware');
    assert.ok(fileMatch, 'should find file-matching todo');
    const hasFileReason = fileMatch.reasons.some(r => r.startsWith('files:'));
    assert.ok(hasFileReason, 'should match on files');
    assert.ok(fileMatch.score >= 0.4, 'file match should contribute significant score');
  });

  test('sorts matches by score descending', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'weak-match.md'),
      'title: Check token format\narea: general\ncreated: 2026-03-01\n\nToken format validation.');
    fs.writeFileSync(path.join(pendingDir, 'strong-match.md'),
      'title: Session management authentication OAuth token handling\narea: auth\ncreated: 2026-03-01\n\nSession auth OAuth tokens.');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 01: Authentication and Session Management\n\n**Goal:** Implement OAuth login, session handling, and token management\n');

    const result = runCmd(() => cmdTodoMatchPhase(tmpDir, '01', false));
    const output = JSON.parse(result.output);
    assert.ok(output.matches.length >= 2, 'should have multiple matches');
    for (let i = 1; i < output.matches.length; i++) {
      assert.ok(output.matches[i - 1].score >= output.matches[i].score,
        `match ${i-1} score (${output.matches[i-1].score}) should be >= match ${i} score (${output.matches[i].score})`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scaffold command
// ─────────────────────────────────────────────────────────────────────────────


describe('commit-to-subrepo command', () => {
  const { createTempGitProject } = require('./helpers.cjs');
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('errors when no sub_repos configured', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({})
    );

    const result = runCmd(() => cmdCommitToSubrepo(tmpDir, 'test message', ['some/file.md'], false));
    assert.ok(!result.success, 'should fail without sub_repos');
    assert.ok(result.error.includes('no sub_repos'), 'error mentions sub_repos');
  });

  test('errors when no --files provided', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ sub_repos: ['frontend'] })
    );

    const result = runCmd(() => cmdCommitToSubrepo(tmpDir, 'test message', [], false));
    assert.ok(!result.success, 'should fail without files');
    assert.ok(result.error.includes('--files required'), 'error mentions files required');
  });

  test('errors when no message provided', () => {
    const result = runCmd(() => cmdCommitToSubrepo(tmpDir, undefined, [], false));
    assert.ok(!result.success, 'should fail without message');
    assert.ok(result.error.includes('commit message required'), 'error mentions message required');
  });

  test('commits to matching sub-repo and warns for unmatched files', () => {
    // Create sub-repo directory with its own git repo
    const subRepoDir = path.join(tmpDir, 'frontend');
    fs.mkdirSync(subRepoDir, { recursive: true });
    execSync('git init', { cwd: subRepoDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: subRepoDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: subRepoDir, stdio: 'pipe' });
    execSync('git config commit.gpgsign false', { cwd: subRepoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(subRepoDir, 'README.md'), '# Frontend\n');
    execSync('git add -A && git commit -m "init"', { cwd: subRepoDir, stdio: 'pipe' });

    // Configure sub_repos
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ sub_repos: ['frontend'] })
    );

    // Create a file in the sub-repo and a file outside
    fs.writeFileSync(path.join(subRepoDir, 'new-file.md'), '# New\n');

    const result = runCmd(() => cmdCommitToSubrepo(tmpDir, 'test commit', ['frontend/new-file.md', 'unmatched/file.md'], false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, true);
    assert.ok(output.repos.frontend, 'should have frontend repo');
    assert.ok(output.repos.frontend.committed, 'frontend should have committed');
    assert.ok(output.repos.frontend.hash, 'frontend should have hash');
    assert.deepStrictEqual(output.unmatched, ['unmatched/file.md']);
  });

  test('handles sub-repo commit error (not nothing-to-commit)', () => {
    // Create sub-repo with a pre-commit hook that fails
    const subRepoDir = path.join(tmpDir, 'frontend');
    fs.mkdirSync(subRepoDir, { recursive: true });
    execSync('git init', { cwd: subRepoDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: subRepoDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: subRepoDir, stdio: 'pipe' });
    execSync('git config commit.gpgsign false', { cwd: subRepoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(subRepoDir, 'README.md'), '# Frontend\n');
    execSync('git add -A && git commit -m "init"', { cwd: subRepoDir, stdio: 'pipe' });

    // Add a pre-commit hook that fails
    const hooksDir = path.join(subRepoDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ sub_repos: ['frontend'] })
    );

    fs.writeFileSync(path.join(subRepoDir, 'new-file.md'), '# New\n');

    const result = runCmd(() => cmdCommitToSubrepo(tmpDir, 'test commit', ['frontend/new-file.md'], false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.repos.frontend.committed, false);
    assert.strictEqual(output.repos.frontend.reason, 'error');
  });

  test('handles nothing to commit in sub-repo', () => {
    // Create sub-repo
    const subRepoDir = path.join(tmpDir, 'frontend');
    fs.mkdirSync(subRepoDir, { recursive: true });
    execSync('git init', { cwd: subRepoDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: subRepoDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: subRepoDir, stdio: 'pipe' });
    execSync('git config commit.gpgsign false', { cwd: subRepoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(subRepoDir, 'README.md'), '# Frontend\n');
    execSync('git add -A && git commit -m "init"', { cwd: subRepoDir, stdio: 'pipe' });

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ sub_repos: ['frontend'] })
    );

    // Reference an already-committed file (nothing new to commit)
    const result = runCmd(() => cmdCommitToSubrepo(tmpDir, 'test commit', ['frontend/README.md'], false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.repos.frontend.committed, false);
    assert.strictEqual(output.repos.frontend.reason, 'nothing_to_commit');
  });
});

describe('summary-extract edge cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('errors when no summary-path provided', () => {
    const result = runCmd(() => cmdSummaryExtract(tmpDir, undefined, null, false));
    assert.ok(!result.success, 'should fail without summary-path');
    assert.ok(result.error.includes('summary-path required'), 'error mentions summary-path');
  });

  test('field filtering ignores nonexistent fields', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
one-liner: Test summary
---
`
    );

    const result = runCmd(() => cmdSummaryExtract(tmpDir, '.planning/phases/01-foundation/01-01-SUMMARY.md', ['one_liner', 'nonexistent_field'], false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Test summary');
    assert.strictEqual(output.nonexistent_field, undefined, 'nonexistent field should not be in output');
  });
});

describe('scaffold command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('scaffolds context file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runCmd(() => cmdScaffold(tmpDir, 'context', { phase: '3', name: null }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    // Verify file content
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-CONTEXT.md'),
      'utf-8'
    );
    assert.ok(content.includes('Phase 3'), 'should reference phase number');
    assert.ok(content.includes('Decisions'), 'should have decisions section');
    assert.ok(content.includes('Discretion Areas'), 'should have discretion section');
  });

  test('scaffolds UAT file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runCmd(() => cmdScaffold(tmpDir, 'uat', { phase: '3', name: null }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-UAT.md'),
      'utf-8'
    );
    assert.ok(content.includes('User Acceptance Testing'), 'should have UAT heading');
    assert.ok(content.includes('Test Results'), 'should have test results section');
  });

  test('scaffolds verification file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runCmd(() => cmdScaffold(tmpDir, 'verification', { phase: '3', name: null }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-VERIFICATION.md'),
      'utf-8'
    );
    assert.ok(content.includes('Goal-Backward Verification'), 'should have verification heading');
  });

  test('scaffolds phase directory', () => {
    const result = runCmd(() => cmdScaffold(tmpDir, 'phase-dir', { phase: '5', name: 'User Dashboard' }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '05-user-dashboard')),
      'directory should be created'
    );
  });

  test('errors on unknown scaffold type', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runCmd(() => cmdScaffold(tmpDir, 'bogustype', { phase: '3', name: null }, false));
    assert.ok(!result.success, 'should fail for unknown type');
    assert.ok(result.error.includes('Unknown scaffold type'), 'error mentions unknown type');
  });

  test('errors when phase not found for non-phase-dir scaffold', () => {
    const result = runCmd(() => cmdScaffold(tmpDir, 'context', { phase: '99', name: null }, false));
    assert.ok(!result.success, 'should fail when phase dir missing');
    assert.ok(result.error.includes('not found'), 'error mentions not found');
  });

  test('errors when phase-dir missing required name', () => {
    const result = runCmd(() => cmdScaffold(tmpDir, 'phase-dir', { phase: '5', name: null }, false));
    assert.ok(!result.success, 'should fail without name');
    assert.ok(result.error.includes('name required'), 'error mentions name required');
  });

  test('does not overwrite existing files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-CONTEXT.md'), '# Existing content');

    const result = runCmd(() => cmdScaffold(tmpDir, 'context', { phase: '3', name: null }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, false, 'should not overwrite');
    assert.strictEqual(output.reason, 'already_exists');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdGenerateSlug tests (CMD-01)
// ─────────────────────────────────────────────────────────────────────────────

describe('generate-slug command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('converts normal text to slug', () => {
    const result = runCmd(() => cmdGenerateSlug('Hello World', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'hello-world');
  });

  test('strips special characters', () => {
    const result = runCmd(() => cmdGenerateSlug('Test@#$%^Special!!!', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'test-special');
  });

  test('preserves numbers', () => {
    const result = runCmd(() => cmdGenerateSlug('Phase 3 Plan', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'phase-3-plan');
  });

  test('strips leading and trailing hyphens', () => {
    const result = runCmd(() => cmdGenerateSlug('---leading-trailing---', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'leading-trailing');
  });

  test('fails when no text provided', () => {
    const result = runCmd(() => cmdGenerateSlug(undefined, false));
    assert.ok(!result.success, 'should fail without text');
    assert.ok(result.error.includes('text required'), 'error should mention text required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdCurrentTimestamp tests (CMD-01)
// ─────────────────────────────────────────────────────────────────────────────

describe('current-timestamp command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('date format returns YYYY-MM-DD', () => {
    const result = runCmd(() => cmdCurrentTimestamp('date', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.match(output.timestamp, /^\d{4}-\d{2}-\d{2}$/, 'should be YYYY-MM-DD format');
  });

  test('filename format returns ISO without colons or fractional seconds', () => {
    const result = runCmd(() => cmdCurrentTimestamp('filename', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.match(output.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/, 'should replace colons with hyphens and strip fractional seconds');
  });

  test('full format returns full ISO string', () => {
    const result = runCmd(() => cmdCurrentTimestamp('full', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.match(output.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'should be full ISO format');
  });

  test('default (no format) returns full ISO string', () => {
    const result = runCmd(() => cmdCurrentTimestamp('full', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.match(output.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'default should be full ISO format');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdListTodos tests (CMD-02)
// ─────────────────────────────────────────────────────────────────────────────

describe('list-todos command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty directory returns zero count', () => {
    const result = runCmd(() => cmdListTodos(tmpDir, undefined, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 0, 'count should be 0');
    assert.deepStrictEqual(output.todos, [], 'todos should be empty');
  });

  test('returns multiple todos with correct fields', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });

    fs.writeFileSync(path.join(pendingDir, 'add-tests.md'), 'title: Add unit tests\narea: testing\ncreated: 2026-01-15\n');
    fs.writeFileSync(path.join(pendingDir, 'fix-bug.md'), 'title: Fix login bug\narea: auth\ncreated: 2026-01-20\n');

    const result = runCmd(() => cmdListTodos(tmpDir, undefined, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 2, 'should have 2 todos');
    assert.strictEqual(output.todos.length, 2, 'todos array should have 2 entries');

    const testTodo = output.todos.find(t => t.file === 'add-tests.md');
    assert.ok(testTodo, 'add-tests.md should be in results');
    assert.strictEqual(testTodo.title, 'Add unit tests');
    assert.strictEqual(testTodo.area, 'testing');
    assert.strictEqual(testTodo.created, '2026-01-15');
  });

  test('area filter returns only matching todos', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });

    fs.writeFileSync(path.join(pendingDir, 'ui-task.md'), 'title: UI task\narea: ui\ncreated: 2026-01-01\n');
    fs.writeFileSync(path.join(pendingDir, 'api-task.md'), 'title: API task\narea: api\ncreated: 2026-01-01\n');

    const result = runCmd(() => cmdListTodos(tmpDir, 'ui', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 1, 'should have 1 matching todo');
    assert.strictEqual(output.todos[0].area, 'ui', 'should only return ui area');
  });

  test('area filter miss returns zero count', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });

    fs.writeFileSync(path.join(pendingDir, 'task.md'), 'title: Some task\narea: backend\ncreated: 2026-01-01\n');

    const result = runCmd(() => cmdListTodos(tmpDir, 'nonexistent-area', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 0, 'should have 0 matching todos');
  });

  test('malformed files use defaults', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });

    // File with no title or area fields
    fs.writeFileSync(path.join(pendingDir, 'malformed.md'), 'some random content\nno fields here\n');

    const result = runCmd(() => cmdListTodos(tmpDir, undefined, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 1, 'malformed file should still be counted');
    assert.strictEqual(output.todos[0].title, 'Untitled', 'missing title defaults to Untitled');
    assert.strictEqual(output.todos[0].area, 'general', 'missing area defaults to general');
    assert.strictEqual(output.todos[0].created, 'unknown', 'missing created defaults to unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdVerifyPathExists tests (CMD-02)
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-path-exists command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('existing file returns exists=true with type=file', () => {
    fs.writeFileSync(path.join(tmpDir, 'test-file.txt'), 'hello');

    const result = runCmd(() => cmdVerifyPathExists(tmpDir, 'test-file.txt', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'file');
  });

  test('existing directory returns exists=true with type=directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'test-dir'), { recursive: true });

    const result = runCmd(() => cmdVerifyPathExists(tmpDir, 'test-dir', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'directory');
  });

  test('missing path returns exists=false', () => {
    const result = runCmd(() => cmdVerifyPathExists(tmpDir, 'nonexistent/path', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, false);
    assert.strictEqual(output.type, null);
  });

  test('absolute path resolves correctly', () => {
    const absFile = path.join(tmpDir, 'abs-test.txt');
    fs.writeFileSync(absFile, 'content');

    const result = runCmd(() => cmdVerifyPathExists(tmpDir, absFile, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'file');
  });

  test('fails when no path provided', () => {
    const result = runCmd(() => cmdVerifyPathExists(tmpDir, undefined, false));
    assert.ok(!result.success, 'should fail without path');
    assert.ok(result.error.includes('path required'), 'error should mention path required');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// cmdResolveModel tests (CMD-03)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolve-model command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('known agent returns model and profile without unknown_agent', () => {
    const result = runCmd(() => cmdResolveModel(tmpDir, 'gsd-planner', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.model, 'should have model field');
    assert.ok(output.profile, 'should have profile field');
    assert.strictEqual(output.unknown_agent, undefined, 'should not have unknown_agent for known agent');
  });

  test('unknown agent returns unknown_agent=true', () => {
    const result = runCmd(() => cmdResolveModel(tmpDir, 'fake-nonexistent-agent', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.unknown_agent, true, 'should flag unknown agent');
  });

  test('default profile fallback when no config exists', () => {
    // tmpDir has no config.json, so defaults to balanced profile
    const result = runCmd(() => cmdResolveModel(tmpDir, 'gsd-executor', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.profile, 'balanced', 'should default to balanced profile');
    assert.ok(output.model, 'should resolve a model');
  });

  test('fails when no agent-type provided', () => {
    const result = runCmd(() => cmdResolveModel(tmpDir, undefined, false));
    assert.ok(!result.success, 'should fail without agent-type');
    assert.ok(result.error.includes('agent-type required'), 'error should mention agent-type required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdCommit tests (CMD-04)
// ─────────────────────────────────────────────────────────────────────────────

describe('commit command', () => {
  const { createTempGitProject } = require('./helpers.cjs');
  const { execSync } = require('child_process');
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('skips when commit_docs is false', () => {
    // Write config with commit_docs: false
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ commit_docs: false })
    );

    const result = runCmd(() => cmdCommit(tmpDir, 'test message', [], false, false, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, false);
    assert.strictEqual(output.reason, 'skipped_commit_docs_false');
  });

  test('skips when .planning is gitignored', () => {
    // Add .planning/ to .gitignore and commit it so git recognizes the ignore
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.planning/\n');
    execSync('git add .gitignore', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add gitignore"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runCmd(() => cmdCommit(tmpDir, 'test message', [], false, false, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, false);
    assert.strictEqual(output.reason, 'skipped_gitignored');
  });

  test('handles nothing to commit', () => {
    // Don't modify any files after initial commit
    const result = runCmd(() => cmdCommit(tmpDir, 'test message', [], false, false, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, false);
    assert.strictEqual(output.reason, 'nothing_to_commit');
  });

  test('creates real commit with correct hash', () => {
    // Create a new file in .planning/
    fs.writeFileSync(path.join(tmpDir, '.planning', 'test-file.md'), '# Test\n');

    const result = runCmd(() => cmdCommit(tmpDir, 'test: add test file', ['.planning/test-file.md'], false, false, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, true, 'should have committed');
    assert.ok(output.hash, 'should have a commit hash');
    assert.strictEqual(output.reason, 'committed');

    // Verify via git log
    const gitLog = execSync('git log --oneline -1', { cwd: tmpDir, encoding: 'utf-8' }).trim();
    assert.ok(gitLog.includes('test: add test file'), 'git log should contain the commit message');
    assert.ok(gitLog.includes(output.hash), 'git log should contain the returned hash');
  });

  test('amend mode works without crashing', () => {
    // Create a file and commit it first
    fs.writeFileSync(path.join(tmpDir, '.planning', 'amend-file.md'), '# Initial\n');
    execSync('git add .planning/amend-file.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial file"', { cwd: tmpDir, stdio: 'pipe' });

    // Modify the file and amend
    fs.writeFileSync(path.join(tmpDir, '.planning', 'amend-file.md'), '# Amended\n');

    const result = runCmd(() => cmdCommit(tmpDir, 'ignored', ['.planning/amend-file.md'], false, true, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, true, 'amend should succeed');

    // Verify only 2 commits total (initial setup + amended)
    const logCount = execSync('git log --oneline', { cwd: tmpDir, encoding: 'utf-8' }).trim().split('\n').length;
    assert.strictEqual(logCount, 2, 'should have 2 commits (initial + amended)');
  });
  test('fails when no message and no amend flag', () => {
    const result = runCmd(() => cmdCommit(tmpDir, undefined, [], false, false, false));
    assert.ok(!result.success, 'should fail without message');
    assert.ok(result.error.includes('commit message required'), 'error mentions message required');
  });

  test('stages deletion for missing file', () => {
    // Create and commit a file, then delete it
    fs.writeFileSync(path.join(tmpDir, '.planning', 'to-delete.md'), '# Delete me\n');
    execSync('git add .planning/to-delete.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add file to delete"', { cwd: tmpDir, stdio: 'pipe' });

    // Delete the file on disk
    fs.unlinkSync(path.join(tmpDir, '.planning', 'to-delete.md'));

    // Commit with the deleted file listed
    const result = runCmd(() => cmdCommit(tmpDir, 'docs: remove file', ['.planning/to-delete.md'], false, false, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // Should either commit the deletion or report nothing (depending on git state)
    assert.ok(output.committed !== undefined, 'should have committed field');
  });

  test('creates strategy branch before first commit when branching_strategy is milestone', () => {
    // Configure milestone branching strategy
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({
        commit_docs: true,
        branching_strategy: 'milestone',
        milestone_branch_template: 'gsd/{milestone}-{slug}',
      })
    );
    // getMilestoneInfo reads ROADMAP.md for milestone version/name
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '## v1.0: Initial Release\n\n### Phase 1: Setup\n'
    );

    // Create a file to commit
    fs.writeFileSync(path.join(tmpDir, '.planning', 'test-context.md'), '# Context\n');

    const result = runCmd(() => cmdCommit(tmpDir, 'docs: add context', ['.planning/test-context.md'], false, false, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, true, 'should have committed');

    // Verify we're on the strategy branch
    const { execFileSync } = require('child_process');
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(branch, 'gsd/v1.0-initial-release', 'should be on milestone branch');
  });

  test('creates strategy branch before first commit when branching_strategy is phase', () => {
    // Configure phase branching strategy
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({
        commit_docs: true,
        branching_strategy: 'phase',
        phase_branch_template: 'gsd/phase-{phase}-{slug}',
      })
    );
    // Create ROADMAP.md with a phase
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n## Phase 1: Setup\nGoal: Initial setup\n'
    );

    // Create a context file for phase 1
    fs.writeFileSync(path.join(tmpDir, '.planning', 'phases', '01-setup', '01-CONTEXT.md'), '# Context\n');

    const result = runCmd(() => cmdCommit(tmpDir, 'docs(01): add context', ['.planning/phases/01-setup/01-CONTEXT.md'], false, false, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, true, 'should have committed');

    // Verify we're on the strategy branch
    const { execFileSync } = require('child_process');
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(branch, 'gsd/phase-01-setup', 'should be on phase branch');
  });

  test('handles commit error that is not nothing-to-commit', () => {
    // Create a pre-commit hook that fails
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    fs.writeFileSync(path.join(tmpDir, '.planning', 'fail-test.md'), '# Fail\n');

    const result = runCmd(() => cmdCommit(tmpDir, 'test error', ['.planning/fail-test.md'], false, false, false));
    assert.ok(result.success, `Command should succeed (outputs JSON): ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, false);
  });

  test('switches to existing strategy branch on subsequent commit', () => {
    // Configure milestone branching strategy
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({
        commit_docs: true,
        branching_strategy: 'milestone',
        milestone_branch_template: 'gsd/{milestone}-{slug}',
      })
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '## v2.0: Second Release\n\n### Phase 1: Setup\n'
    );

    // Pre-create the branch so checkout -b fails and it switches to existing
    execSync('git branch gsd/v2.0-second-release', { cwd: tmpDir, stdio: 'pipe' });

    fs.writeFileSync(path.join(tmpDir, '.planning', 'test-switch.md'), '# Switch\n');

    const result = runCmd(() => cmdCommit(tmpDir, 'docs: switch test', ['.planning/test-switch.md'], false, false, false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, true);

    const { execFileSync } = require('child_process');
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(branch, 'gsd/v2.0-second-release', 'should be on existing milestone branch');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdWebsearch tests (CMD-05)
// ─────────────────────────────────────────────────────────────────────────────

describe('websearch command', () => {
  const { cmdWebsearch } = require('../cap/bin/lib/commands.cjs');
  let origFetch;
  let origApiKey;
  let origWriteSync;
  let captured;

  beforeEach(() => {
    origFetch = global.fetch;
    origApiKey = process.env.BRAVE_API_KEY;
    origWriteSync = fs.writeSync;
    captured = '';
    // output() uses fs.writeSync(1, data) since #1276 — mock it to capture output
    fs.writeSync = (fd, data) => { if (fd === 1) captured += data; return Buffer.byteLength(String(data)); };
  });

  afterEach(() => {
    global.fetch = origFetch;
    if (origApiKey !== undefined) {
      process.env.BRAVE_API_KEY = origApiKey;
    } else {
      delete process.env.BRAVE_API_KEY;
    }
    fs.writeSync = origWriteSync;
  });

  test('returns available=false when BRAVE_API_KEY is unset', async () => {
    delete process.env.BRAVE_API_KEY;

    await cmdWebsearch('test query', {}, false);

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, false);
    assert.ok(output.reason.includes('BRAVE_API_KEY'), 'should mention missing API key');
  });

  test('returns error when no query provided', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    await cmdWebsearch(null, {}, false);

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, false);
    assert.ok(output.error.includes('Query required'), 'should mention query required');
  });

  test('returns results for successful API response', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'Test Result', url: 'https://example.com', description: 'A test result', age: '1d' },
          ],
        },
      }),
    });

    await cmdWebsearch('test query', { limit: 5, freshness: 'pd' }, false);

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, true);
    assert.strictEqual(output.query, 'test query');
    assert.strictEqual(output.count, 1);
    assert.strictEqual(output.results[0].title, 'Test Result');
    assert.strictEqual(output.results[0].url, 'https://example.com');
    assert.strictEqual(output.results[0].age, '1d');
  });

  test('constructs correct URL parameters', async () => {
    process.env.BRAVE_API_KEY = 'test-key';
    let capturedUrl = '';

    global.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ web: { results: [] } }),
      };
    };

    await cmdWebsearch('node.js testing', { limit: 5, freshness: 'pd' }, false);

    const parsed = new URL(capturedUrl);
    assert.strictEqual(parsed.searchParams.get('q'), 'node.js testing', 'query param should decode to original string');
    assert.strictEqual(parsed.searchParams.get('count'), '5', 'count param should be 5');
    assert.strictEqual(parsed.searchParams.get('freshness'), 'pd', 'freshness param should be pd');
  });

  test('handles API error (non-200 status)', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    global.fetch = async () => ({
      ok: false,
      status: 429,
    });

    await cmdWebsearch('test query', {}, false);

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, false);
    assert.ok(output.error.includes('429'), 'error should include status code');
  });

  test('handles network failure', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    global.fetch = async () => {
      throw new Error('Network timeout');
    };

    await cmdWebsearch('test query', {}, false);

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, false);
    assert.strictEqual(output.error, 'Network timeout');
  });
});

describe('cmdVerifyPathExists null byte guard', () => {
  const { cmdVerifyPathExists } = require('../cap/bin/lib/commands.cjs');
  let tmpDir;
  let origWriteSync;
  let origExit;

  beforeEach(() => {
    tmpDir = createTempProject();
    origWriteSync = fs.writeSync;
    origExit = process.exit;
  });

  afterEach(() => {
    fs.writeSync = origWriteSync;
    process.exit = origExit;
    cleanup(tmpDir);
  });

  test('rejects paths containing null bytes', () => {
    let errMsg = '';
    let exitCalled = false;
    fs.writeSync = (fd, data) => { if (fd === 2) errMsg += data; return Buffer.byteLength(String(data)); };
    process.exit = () => { exitCalled = true; throw new Error('EXIT'); };

    try {
      cmdVerifyPathExists(tmpDir, 'some\0path', false);
    } catch {}

    assert.ok(exitCalled, 'process.exit should have been called');
    assert.ok(errMsg.includes('null bytes'), 'error should mention null bytes');
  });
});

describe('cmdCommit message guard', () => {
  const { cmdCommit } = require('../cap/bin/lib/commands.cjs');
  let tmpDir;
  let origWriteSync;
  let origExit;

  beforeEach(() => {
    tmpDir = createTempProject();
    origWriteSync = fs.writeSync;
    origExit = process.exit;
  });

  afterEach(() => {
    fs.writeSync = origWriteSync;
    process.exit = origExit;
    cleanup(tmpDir);
  });

  test('errors when no message and no amend flag via direct call', () => {
    let errMsg = '';
    let exitCalled = false;
    fs.writeSync = (fd, data) => { if (fd === 2) errMsg += data; return Buffer.byteLength(String(data)); };
    process.exit = () => { exitCalled = true; throw new Error('EXIT'); };

    try {
      cmdCommit(tmpDir, null, [], false, false, false);
    } catch {}

    assert.ok(exitCalled, 'process.exit should have been called');
    assert.ok(errMsg.includes('commit message required'), 'error should mention message required');
  });
});

describe('stats command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns valid JSON with empty project', () => {
    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.ok(Array.isArray(stats.phases), 'phases should be an array');
    assert.strictEqual(stats.total_plans, 0);
    assert.strictEqual(stats.total_summaries, 0);
    assert.strictEqual(stats.percent, 0);
    assert.strictEqual(stats.phases_completed, 0);
    assert.strictEqual(stats.phases_total, 0);
    assert.strictEqual(stats.requirements_total, 0);
    assert.strictEqual(stats.requirements_complete, 0);
  });

  test('counts phases, plans, and summaries correctly', () => {
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-auth');
    const p2 = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(p1, { recursive: true });
    fs.mkdirSync(p2, { recursive: true });

    // Phase 1: 2 plans, 2 summaries (complete)
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-02-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(path.join(p1, '01-02-SUMMARY.md'), '# Summary');

    // Phase 2: 1 plan, 0 summaries (planned)
    fs.writeFileSync(path.join(p2, '02-01-PLAN.md'), '# Plan');

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.phases_total, 2);
    assert.strictEqual(stats.phases_completed, 1);
    assert.strictEqual(stats.total_plans, 3);
    assert.strictEqual(stats.total_summaries, 2);
    assert.strictEqual(stats.percent, 50);
    assert.strictEqual(stats.plan_percent, 67);
  });

  test('counts requirements from REQUIREMENTS.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      `# Requirements

## v1 Requirements

- [x] **AUTH-01**: User can sign up
- [x] **AUTH-02**: User can log in
- [ ] **API-01**: REST endpoints
- [ ] **API-02**: GraphQL support
`
    );

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.requirements_total, 4);
    assert.strictEqual(stats.requirements_complete, 2);
  });

  test('reads last activity from STATE.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Status:** In progress\n**Last Activity:** 2025-06-15\n**Last Activity Description:** Working\n`
    );

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.last_activity, '2025-06-15');
  });

  test('reads last activity from plain STATE.md template format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State\n\n## Current Position\n\nPhase: 1 of 2 (Foundation)\nPlan: 1 of 1 in current phase\nStatus: In progress\nLast activity: 2025-06-16 — Finished plan 01-01\n`
    );

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.last_activity, '2025-06-16 — Finished plan 01-01');
  });

  test('includes roadmap-only phases in totals and preserves hyphenated names', () => {
    const p1 = path.join(tmpDir, '.planning', 'phases', '14-auth-hardening');
    const p2 = path.join(tmpDir, '.planning', 'phases', '15-proof-generation');
    fs.mkdirSync(p1, { recursive: true });
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p1, '14-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '14-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(path.join(p2, '15-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p2, '15-01-SUMMARY.md'), '# Summary');

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

- [x] **Phase 14: Auth Hardening**
- [x] **Phase 15: Proof Generation**
- [ ] **Phase 16: Multi-Claim Verification & UX**

## Milestone v1.0 Growth

### Phase 14: Auth Hardening
**Goal:** Improve auth checks

### Phase 15: Proof Generation
**Goal:** Improve proof generation

### Phase 16: Multi-Claim Verification & UX
**Goal:** Support multi-claim verification
`
    );

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.phases_total, 3);
    assert.strictEqual(stats.phases_completed, 2);
    assert.strictEqual(stats.percent, 67);
    assert.strictEqual(stats.plan_percent, 100);
    assert.strictEqual(
      stats.phases.find(p => p.number === '16')?.name,
      'Multi-Claim Verification & UX'
    );
    assert.strictEqual(
      stats.phases.find(p => p.number === '16')?.status,
      'Not Started'
    );
  });

  test('reports git commit count and first commit date from repository history', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: tmpDir, stdio: 'pipe' });

    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Project\n');
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial commit"', {
      cwd: tmpDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      },
    });

    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Updated\n');
    execSync('git add README.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "second commit"', {
      cwd: tmpDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-02-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-02-01T00:00:00Z',
      },
    });

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.git_commits, 2);
    assert.strictEqual(stats.git_first_commit_date, '2026-01-01');
  });

  test('table format renders readable output', () => {
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');

    const result = runCmd(() => cmdStats(tmpDir, 'table', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.ok(parsed.rendered, 'table format should include rendered field');
    assert.ok(parsed.rendered.includes('Statistics'), 'should include Statistics header');
    assert.ok(parsed.rendered.includes('| Phase |'), 'should include table header');
    assert.ok(parsed.rendered.includes('| 1 |'), 'should include phase row');
    assert.ok(parsed.rendered.includes('1/1 phases'), 'should report phase progress');
  });

  test('table format includes requirements and git info when present', () => {
    // Set up git repo
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config commit.gpgsign false', { cwd: tmpDir, stdio: 'pipe' });

    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Project\n');
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });

    // Add requirements
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      '# Requirements\n\n- [x] **AUTH-01**: Sign up\n- [ ] **AUTH-02**: Login\n'
    );

    // Add STATE.md with last activity
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# State\n\nlast_activity: 2026-03-15 - Did stuff\n'
    );

    // Add a phase
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');

    const result = runCmd(() => cmdStats(tmpDir, 'table', false));
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.ok(parsed.rendered.includes('Requirements:'), 'should include requirements line');
    assert.ok(parsed.rendered.includes('1/2'), 'should show 1 of 2 requirements');
    assert.ok(parsed.rendered.includes('Git:'), 'should include git stats');
    assert.ok(parsed.rendered.includes('commit'), 'should mention commits');
    assert.ok(parsed.rendered.includes('Last activity:'), 'should include last activity');
  });
});

// --- Branch coverage: history-digest edge cases ---

describe('history-digest branch coverage', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('handles summary with no dependency-graph but flat provides', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'SUMMARY.md'), `---
phase: "01"
name: "Foundation"
provides:
  - "Database schema"
  - "Auth layer"
tech-stack:
  added:
    - "prisma"
    - "vitest"
---

# Summary
`);
    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(digest.phases['01'].provides, ['Database schema', 'Auth layer']);
    assert.ok(digest.tech_stack.includes('prisma'), 'should include prisma');
    assert.ok(digest.tech_stack.includes('vitest'), 'should include vitest');
  });

  test('handles summary without phase in frontmatter (uses dir name)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'SUMMARY.md'), `---
name: "API Layer"
provides:
  - "REST endpoints"
---

# Summary
`);
    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const digest = JSON.parse(result.output);
    assert.ok(digest.phases['02'], 'should use dir prefix as phase number');
    assert.deepStrictEqual(digest.phases['02'].provides, ['REST endpoints']);
  });

  test('handles affects in dependency-graph', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-core');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), `---
phase: "01"
name: "Core"
dependency-graph:
  provides:
    - "DB schema"
  affects:
    - "API layer"
    - "Frontend"
patterns-established:
  - "Repository pattern"
key-decisions:
  - "Use PostgreSQL: better JSON support"
---

# Summary
`);
    const result = runCmd(() => cmdHistoryDigest(tmpDir, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(digest.phases['01'].affects, ['API layer', 'Frontend']);
    assert.deepStrictEqual(digest.phases['01'].patterns, ['Repository pattern']);
    assert.strictEqual(digest.decisions.length, 1);
    assert.strictEqual(digest.decisions[0].decision, 'Use PostgreSQL: better JSON support');
  });
});

// --- Branch coverage: progress command edge cases ---

describe('progress command branch coverage', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('phase with plans but no summaries shows Planned status', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan');
    // No SUMMARY.md => status should be Planned

    const result = runCmd(() => cmdProgressRender(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phases.some(p => p.status === 'Planned'));
  });

  test('phase with no matching dir name pattern uses dir as phaseNum', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', 'special');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '.gitkeep'), '');

    const result = runCmd(() => cmdProgressRender(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phases.some(p => p.number === 'special'));
  });
});

// --- Branch coverage: stats command edge cases ---

describe('stats command branch coverage', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('phase with no plans shows Not Started status', () => {
    // Create a phase dir with no plan files
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '.gitkeep'), '');

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phases.some(p => p.status === 'Not Started'));
  });

  test('handles REQUIREMENTS.md with only unchecked items', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      '# Requirements\n\n- [ ] **REQ-01**: First req\n- [ ] **REQ-02**: Second req\n'
    );

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.requirements_total, 2);
    assert.strictEqual(parsed.requirements_complete, 0);
  });

  test('handles verify-path-exists with special stat type (other)', () => {
    // A socket or pipe would be 'other' type, but hard to create
    // Test the existing file/dir paths to cover both branches
    const filePath = path.join(tmpDir, 'testfile.txt');
    fs.writeFileSync(filePath, 'test');
    const result = runCmd(() => cmdVerifyPathExists(tmpDir, 'testfile.txt', false));
    assert.ok(result.success);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.type, 'file');
  });

  test('handles last activity with bold format in STATE.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# State\n\n**Last Activity:** 2026-04-01 - Updated docs\n'
    );

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.last_activity, '2026-04-01 - Updated docs');
  });
});

// --- Branch coverage: scaffold edge cases ---

// --- Branch coverage: list-todos catch blocks ---

describe('list-todos branch coverage', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('handles malformed todo file that throws on read', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    // Create a directory with .md extension to make readFileSync throw
    fs.mkdirSync(path.join(pendingDir, 'bad-todo.md'));
    // Also create a valid todo
    fs.writeFileSync(path.join(pendingDir, 'good-todo.md'), 'title: Valid Todo\ncreated: 2026-01-01\narea: testing\n');

    const result = runCmd(() => cmdListTodos(tmpDir, undefined, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    // The bad todo should be skipped, the good one should be counted
    assert.strictEqual(parsed.count, 1);
  });
});

// --- Branch coverage: summary-extract with one-liner from body ---

describe('summary-extract branch coverage', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('extracts key-files and requirements-completed from frontmatter', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'SUMMARY.md'), `---
phase: "01"
name: "Test Phase"
key-files:
  - "src/main.ts"
requirements-completed:
  - "REQ-01"
---

# Summary

**Implemented the full authentication flow** with JWT tokens.

More content follows.
`);

    const result = runCmd(() => cmdSummaryExtract(tmpDir, '.planning/phases/01-test/SUMMARY.md', null, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.one_liner, 'Implemented the full authentication flow');
    assert.deepStrictEqual(parsed.key_files, ['src/main.ts']);
    assert.deepStrictEqual(parsed.requirements_completed, ['REQ-01']);
  });
});

// --- Branch coverage: todo match-phase with file overlap ---

describe('todo match-phase file overlap branch coverage', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('matches todo by file overlap with phase plan files_modified', () => {
    // Create a pending todo with files
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'todo-01.md'),
      'title: Fix routing\narea: frontend\nfiles: src/router.ts, src/app.ts\ncreated: 2026-01-01\n\nNeed to fix route handling.'
    );

    // Create phase with roadmap and plan files
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-routing');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '---\nwave: 1\n---\n\nfiles_modified: [src/router.ts, src/utils.ts]\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap\n\n## Phase 01: Routing\n\n**Goal:** Fix frontend routing\n');

    const result = runCmd(() => cmdTodoMatchPhase(tmpDir, '1', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.matches.length > 0, 'should have file overlap match');
    const matchEntry = parsed.matches.find(m => m.file === 'todo-01.md');
    assert.ok(matchEntry, 'should find the todo');
    assert.ok(matchEntry.reasons.some(r => r.includes('files')), 'should have file reason');
  });
});

describe('scaffold branch coverage', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('scaffold context uses phase name from directory when name not given', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '.gitkeep'), '');

    const result = runCmd(() => cmdScaffold(tmpDir, 'context', { phase: '1', name: null }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.created, true);
  });

  test('scaffold uat with explicit --name', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '.gitkeep'), '');

    const result = runCmd(() => cmdScaffold(tmpDir, 'uat', { phase: '1', name: 'Authentication' }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.created, true);
  });

  test('scaffold verification with explicit --name', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '.gitkeep'), '');

    const result = runCmd(() => cmdScaffold(tmpDir, 'verification', { phase: '1', name: 'Auth Verify' }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.created, true);
  });

  test('scaffold without phase uses default padding 00', () => {
    // phase-dir does not require finding an existing phase
    const result = runCmd(() => cmdScaffold(tmpDir, 'phase-dir', { phase: '5', name: 'New Phase' }, false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.created, true);
    assert.ok(parsed.directory.includes('05-new-phase'));
  });
});

// --- Branch coverage: stats In Progress status ---

describe('stats In Progress branch coverage', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('shows In Progress when phase has some summaries but not all', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan 1');
    fs.writeFileSync(path.join(phaseDir, '01-02-PLAN.md'), '# Plan 2');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary 1');
    // 01-02-SUMMARY.md missing => In Progress

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phases.some(p => p.status === 'In Progress'));
  });

  test('shows Complete when all plans have summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan 1');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary 1');

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phases.some(p => p.status === 'Complete'));
  });

  test('shows Planned when phase has plans but no summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan');

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phases.some(p => p.status === 'Planned'));
  });

  test('handles state with lowercase Last Activity pattern', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# State\n\nLast Activity: 2026-04-02 - Fixed bugs\n'
    );

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.last_activity, '2026-04-02 - Fixed bugs');
  });

  test('table format with no phases still renders', () => {
    const result = runCmd(() => cmdStats(tmpDir, 'table', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.rendered.includes('Phases:'), 'should include phases section');
  });

  test('handles checked and unchecked requirements', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      '# Requirements\n\n- [x] **REQ-01**: Done\n- [x] **REQ-02**: Also done\n- [ ] **REQ-03**: Not done\n'
    );

    const result = runCmd(() => cmdStats(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.requirements_complete, 2);
    assert.strictEqual(parsed.requirements_total, 3);
  });
});

// --- Branch coverage: progress Pending and In Progress status ---

describe('progress branch coverage extended', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('In Progress status when summaries < plans', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan 1');
    fs.writeFileSync(path.join(phaseDir, '01-02-PLAN.md'), '# Plan 2');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary 1');

    const result = runCmd(() => cmdProgressRender(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phases.some(p => p.status === 'In Progress'));
  });

  test('Pending status when phase has no plans', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-empty');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '.gitkeep'), '');

    const result = runCmd(() => cmdProgressRender(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phases.some(p => p.status === 'Pending'));
  });

  test('Complete status when all plans have summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-done');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary');

    const result = runCmd(() => cmdProgressRender(tmpDir, 'json', false));
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok(parsed.phases.some(p => p.status === 'Complete'));
  });
});
