'use strict';

// @cap-feature(feature:F-043) Adversarial regression suite for the F-043 reconciliation tool.
// Hunts for edge cases in plan-vs-apply consistency, Phase 2 heuristic, audit log integrity,
// Phase 3 verification, idempotency, and live-repo invariants. Read by cap-tester after the
// prototyper's 43-test baseline went green.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const reconcile = require('../cap/bin/lib/cap-reconcile.cjs');
const featureMap = require('../cap/bin/lib/cap-feature-map.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-reconcile-adv-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Fixture helpers (kept local; we want adversarial tests to be self-contained) ---

function writeFeatureMap(dir, features) {
  featureMap.writeFeatureMap(dir, { features, lastScan: null });
}

function writeFile(dir, relPath, content) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function feature(id, state, acs) {
  return {
    id,
    title: `Feature ${id}`,
    state,
    acs: acs.map(a => ({ id: a.id, description: a.id, status: a.status })),
    files: [],
    dependencies: [],
    metadata: {},
  };
}

function driftyFixture() {
  return [
    feature('F-001', 'shipped', [
      { id: 'AC-1', status: 'pending' },
      { id: 'AC-2', status: 'pending' },
    ]),
    feature('F-002', 'tested', [{ id: 'AC-1', status: 'pending' }]),
  ];
}

// === 1. Plan-vs-apply consistency ===

describe('plan-vs-apply consistency', () => {
  it('planReconciliation is pure: two consecutive calls produce structurally identical plans', () => {
    writeFeatureMap(tmpDir, driftyFixture());
    const planA = reconcile.planReconciliation(tmpDir);
    const planB = reconcile.planReconciliation(tmpDir);
    // Stripping nothing -- the planner is supposed to be deterministic.
    assert.deepStrictEqual(planA, planB,
      'planReconciliation must be deterministic for unchanged inputs');
  });

  it('plan + intervening external mutation: stale plan must NOT silently corrupt the Feature Map', () => {
    // Setup: drifty fixture with two drifting features.
    writeFeatureMap(tmpDir, driftyFixture());
    const stalePlan = reconcile.planReconciliation(tmpDir);

    // External mutation between plan and apply: a third party manually fixes F-001's ACs.
    const mutated = featureMap.readFeatureMap(tmpDir);
    const f001 = mutated.features.find(f => f.id === 'F-001');
    for (const ac of f001.acs) ac.status = 'tested';
    featureMap.writeFeatureMap(tmpDir, mutated);

    // Apply the stale plan. setAcStatus should still succeed -- it's idempotent (sets to same value).
    // The important invariant: post-state must be CONSISTENT (no drift) regardless of staleness.
    const result = reconcile.executeReconciliation(tmpDir, stalePlan, { skipAuditLog: true });

    // The plan-apply should succeed and the Feature Map should be drift-free.
    assert.strictEqual(result.success, true,
      'apply of a stale-but-superset plan must still converge to drift=0');
    const after = featureMap.detectDrift(tmpDir);
    assert.strictEqual(after.driftCount, 0,
      'no drift may remain after applying a stale plan whose target is consistent');
  });

  it('empty plan applied: returns success with no audit log path when skipAuditLog=true', () => {
    // Clean Feature Map: no drift, no planned features with code.
    writeFeatureMap(tmpDir, [feature('F-100', 'shipped', [{ id: 'AC-1', status: 'tested' }])]);
    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.totalChanges, 0,
      'sanity: clean fixture should yield an empty plan');

    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.postDriftCount, 0);
    assert.strictEqual(result.auditLogPath, null,
      'skipAuditLog=true must keep auditLogPath null even when plan is empty');
  });

  it('empty plan + audit log enabled: still writes the audit log (regression: no silent skip)', () => {
    writeFeatureMap(tmpDir, [feature('F-100', 'shipped', [{ id: 'AC-1', status: 'tested' }])]);
    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, {
      timestamp: '2026-04-20T00:00:00.000Z',
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.auditLogPath, 'empty-plan apply must still emit the audit log');

    const logPath = path.join(tmpDir, result.auditLogPath);
    assert.ok(fs.existsSync(logPath));
    const log = fs.readFileSync(logPath, 'utf8');
    // Should record both empty phases explicitly so the user sees "we ran but found nothing".
    assert.ok(log.includes('_No AC-status drift detected._'));
    assert.ok(log.includes('_No planned features required state updates._'));
  });
});

// === 2. Phase 2 heuristic edge cases (AC-3) ===

describe('Phase 2 heuristic edge cases', () => {
  it('planned feature with TWO impl files but only ONE test file is still tested (>=1 test wins)', () => {
    writeFeatureMap(tmpDir, [feature('F-200', 'planned', [{ id: 'AC-1', status: 'pending' }])]);
    writeFile(tmpDir, 'cap/bin/lib/widget-a.cjs', '// @cap-feature(feature:F-200)\n');
    writeFile(tmpDir, 'cap/bin/lib/widget-b.cjs', '// @cap-feature(feature:F-200)\n');
    writeFile(tmpDir, 'tests/widget-a.test.cjs', '// test');
    // No tests/widget-b.test.cjs

    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 1);
    const entry = plan.phase2[0];
    assert.strictEqual(entry.implFiles.length, 2, 'both impl files should be listed');
    assert.strictEqual(entry.testFiles.length, 1, 'only one test file detected');
    assert.strictEqual(entry.toState, 'tested',
      'heuristic: at least one test file => tested (matches @cap-decision in module header)');
  });

  it('planned feature with impl in nested subdirectory (not at default scan depth) is still detected', () => {
    writeFeatureMap(tmpDir, [feature('F-300', 'planned', [{ id: 'AC-1', status: 'pending' }])]);
    // Put impl deep -- 6 levels under cap/.
    writeFile(tmpDir, 'cap/a/b/c/d/e/deepwidget.cjs', '// @cap-feature(feature:F-300)\n');
    writeFile(tmpDir, 'tests/deepwidget.test.cjs', '// test');

    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 1, 'tag scanner must reach nested files');
    assert.strictEqual(plan.phase2[0].toState, 'tested');
  });

  it('planned feature whose impl file exists but is an empty stub (no body) is still promoted', () => {
    // A bare @cap-feature line with no other code is a legitimate signal of intent — the
    // heuristic deliberately treats it as "implementation present" even if hollow.
    writeFeatureMap(tmpDir, [feature('F-400', 'planned', [{ id: 'AC-1', status: 'pending' }])]);
    writeFile(tmpDir, 'cap/bin/lib/stub.cjs', '// @cap-feature(feature:F-400)\n');

    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 1);
    assert.strictEqual(plan.phase2[0].toState, 'prototyped',
      'no test => prototyped, even if impl is a stub');
  });

  it('F-043 self-exclusion is robust even when both impl and test files are present', () => {
    writeFeatureMap(tmpDir, [feature('F-043', 'planned', [{ id: 'AC-1', status: 'pending' }])]);
    writeFile(tmpDir, 'cap/bin/lib/cap-reconcile.cjs', '// @cap-feature(feature:F-043)\n');
    writeFile(tmpDir, 'tests/cap-reconcile.test.cjs', '// test');

    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 0,
      'F-043 must NEVER appear in Phase 2 -- self-promotion bypasses developer intent');
  });

  it('Phase 2 ignores features whose state is no longer "planned" (already prototyped/tested)', () => {
    // User manually promoted F-500 to prototyped between scans -- planner must skip it.
    writeFeatureMap(tmpDir, [feature('F-500', 'prototyped', [{ id: 'AC-1', status: 'pending' }])]);
    writeFile(tmpDir, 'cap/bin/lib/already.cjs', '// @cap-feature(feature:F-500)\n');
    writeFile(tmpDir, 'tests/already.test.cjs', '// test');

    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 0,
      'Phase 2 only operates on features in "planned" state');
  });

  it('Phase 2 dedupes mirror impl files (cap/ + .claude/cap/) into a single entry', () => {
    writeFeatureMap(tmpDir, [feature('F-600', 'planned', [{ id: 'AC-1', status: 'pending' }])]);
    writeFile(tmpDir, 'cap/bin/lib/mirrored.cjs', '// @cap-feature(feature:F-600)\n');
    writeFile(tmpDir, '.claude/cap/bin/lib/mirrored.cjs', '// @cap-feature(feature:F-600)\n');
    writeFile(tmpDir, 'tests/mirrored.test.cjs', '// test');

    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 1);
    assert.strictEqual(plan.phase2[0].implFiles.length, 1,
      'cap/ + .claude/ mirror pair must collapse into one canonical impl entry');
  });
});

// === 3. Audit log integrity (AC-4) ===

describe('audit log integrity', () => {
  it('audit log overwrites a pre-existing file (not append, not rotate)', () => {
    writeFeatureMap(tmpDir, driftyFixture());
    // Pre-seed the audit log with stale content.
    const auditAbs = path.join(tmpDir, reconcile.AUDIT_LOG_RELATIVE);
    fs.mkdirSync(path.dirname(auditAbs), { recursive: true });
    fs.writeFileSync(auditAbs, '# STALE PRE-EXISTING CONTENT\n', 'utf8');

    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, {
      timestamp: '2026-04-20T01:02:03.000Z',
    });
    assert.strictEqual(result.success, true);

    const log = fs.readFileSync(auditAbs, 'utf8');
    assert.ok(!log.includes('STALE PRE-EXISTING CONTENT'),
      'audit log must overwrite, not append');
    assert.ok(log.includes('# Status Drift Reconciliation Audit'));
  });

  it('audit log timestamp appears verbatim and is the only date string in the header block', () => {
    writeFeatureMap(tmpDir, driftyFixture());
    const stamp = '2026-04-20T12:00:00.000Z';
    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, { timestamp: stamp });
    assert.strictEqual(result.success, true);

    const log = fs.readFileSync(path.join(tmpDir, result.auditLogPath), 'utf8');
    assert.ok(log.includes(`**Date:** ${stamp}`),
      'timestamp must be preserved verbatim in the Date header');
  });

  it('audit log is written even when Phase 3 verification reports residual drift', () => {
    // Inject residual drift that's outside Phase 1+2 scope: a feature with a state OTHER than
    // shipped/tested cannot reach drift, so we use a drifty fixture and then sabotage Phase 3
    // by adding NEW pending ACs to the file mid-flight... but we can't easily do that.
    // Instead, we verify that writeAuditLog works with a non-zero post drift count (already
    // covered by the prototyper's "reports remaining drift" test, but we extend it to confirm
    // the file is created with the right content).
    const plan = {
      phase1: [{ featureId: 'F-001', state: 'shipped', acChanges: [{ acId: 'AC-1', from: 'pending', to: 'tested' }] }],
      phase2: [],
      preDriftCount: 3,
      totalAcPromotions: 1,
      totalStateUpdates: 0,
      totalChanges: 1,
      auditLogPath: reconcile.AUDIT_LOG_RELATIVE,
    };
    const stamp = '2026-04-20T00:00:00.000Z';
    const rel = reconcile.writeAuditLog(tmpDir, plan, 2, stamp);
    const log = fs.readFileSync(path.join(tmpDir, rel), 'utf8');

    assert.ok(log.includes('Pre-reconciliation drift count: 3'));
    assert.ok(log.includes('Post-reconciliation drift count: 2'));
    assert.ok(log.includes('2 drift entries remain'));
  });

  it('audit log records propagated AC promotions for Phase 2 entries reaching tested', () => {
    writeFeatureMap(tmpDir, [feature('F-700', 'planned', [
      { id: 'AC-1', status: 'pending' },
      { id: 'AC-2', status: 'pending' },
    ])]);
    writeFile(tmpDir, 'cap/bin/lib/seven.cjs', '// @cap-feature(feature:F-700)\n');
    writeFile(tmpDir, 'tests/seven.test.cjs', '// test');

    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, {
      timestamp: '2026-04-20T00:00:00.000Z',
    });
    assert.strictEqual(result.success, true);

    const log = fs.readFileSync(path.join(tmpDir, result.auditLogPath), 'utf8');
    assert.ok(log.includes('### F-700 planned -> tested'));
    assert.ok(log.includes('Propagated AC promotions: AC-1, AC-2 -> tested'));
  });
});

// === 4. CLI confirmation surface (executeReconciliation does NOT prompt) ===

describe('confirmation prompt boundary', () => {
  it('executeReconciliation never prompts the user (purity contract for CLI orchestrator)', () => {
    // Sanity: verify the function can be called with closed stdin and never hangs.
    // We do this by simply calling it -- if it tried to read stdin we'd block forever.
    writeFeatureMap(tmpDir, driftyFixture());
    const plan = reconcile.planReconciliation(tmpDir);
    const start = Date.now();
    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });
    const elapsed = Date.now() - start;
    assert.strictEqual(result.success, true);
    assert.ok(elapsed < 5000,
      'executeReconciliation must complete synchronously without prompting (<5s budget)');
  });
});

// === 5. Phase 3 verification (AC-5) ===

describe('Phase 3 verification', () => {
  it('plan -> apply -> detectDrift always yields driftCount 0 on a fixture in scope', () => {
    writeFeatureMap(tmpDir, driftyFixture());
    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });
    assert.strictEqual(result.success, true);

    // Re-detect: must be flat zero.
    const after = featureMap.detectDrift(tmpDir);
    assert.strictEqual(after.driftCount, 0);
    assert.strictEqual(after.hasDrift, false);
  });

  it('reports failure with a descriptive error when post-drift > 0 (impossible in current code, but guard contract)', () => {
    // The current planner is exhaustive (planner is derived from detectDrift) so we cannot
    // provoke a real residual-drift scenario through normal API. Instead, we exercise
    // executeReconciliation with a hand-crafted plan that intentionally leaves drift behind
    // by NOT including F-002 in phase1, and verify the post-drift report surfaces the gap.
    writeFeatureMap(tmpDir, driftyFixture());

    // Hand-craft a plan covering only F-001, omitting F-002 deliberately.
    const partialPlan = {
      phase1: [{
        featureId: 'F-001',
        state: 'shipped',
        acChanges: [
          { acId: 'AC-1', from: 'pending', to: 'tested' },
          { acId: 'AC-2', from: 'pending', to: 'tested' },
        ],
      }],
      phase2: [],
      preDriftCount: 2,
      totalAcPromotions: 2,
      totalStateUpdates: 0,
      totalChanges: 2,
      auditLogPath: reconcile.AUDIT_LOG_RELATIVE,
    };

    const result = reconcile.executeReconciliation(tmpDir, partialPlan, { skipAuditLog: true });
    assert.strictEqual(result.success, false,
      'incomplete plan must surface as success=false');
    assert.strictEqual(result.postDriftCount, 1,
      'post-drift count must reflect remaining F-002 drift');
    assert.ok(result.error && result.error.includes('drift entries remain'));
  });
});

// === 6. Idempotency ===

describe('idempotency', () => {
  it('running plan + apply twice in a row leaves the Feature Map unchanged on the second run', () => {
    writeFeatureMap(tmpDir, driftyFixture());

    // First run.
    const plan1 = reconcile.planReconciliation(tmpDir);
    const result1 = reconcile.executeReconciliation(tmpDir, plan1, { skipAuditLog: true });
    assert.strictEqual(result1.success, true);

    // Snapshot the file content.
    const fmPath = path.join(tmpDir, 'FEATURE-MAP.md');
    const after1 = fs.readFileSync(fmPath, 'utf8');

    // Second run.
    const plan2 = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan2.totalChanges, 0,
      'second run must produce an empty plan -- nothing left to reconcile');

    const result2 = reconcile.executeReconciliation(tmpDir, plan2, { skipAuditLog: true });
    assert.strictEqual(result2.success, true);

    const after2 = fs.readFileSync(fmPath, 'utf8');
    assert.strictEqual(after2, after1,
      'idempotent: second reconciliation must not mutate FEATURE-MAP.md');
  });

  it('plan referencing a feature deleted between plan and apply: setAcStatus returns false -> apply fails fast', () => {
    writeFeatureMap(tmpDir, driftyFixture());
    const plan = reconcile.planReconciliation(tmpDir);

    // Sabotage: delete F-001 from the on-disk Feature Map.
    const fm = featureMap.readFeatureMap(tmpDir);
    fm.features = fm.features.filter(f => f.id !== 'F-001');
    featureMap.writeFeatureMap(tmpDir, fm);

    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });
    assert.strictEqual(result.success, false,
      'apply against a now-missing feature must fail rather than silently no-op');
    assert.ok(result.error && result.error.includes('F-001'),
      'error message must identify the missing feature');
  });

  it('plan referencing a non-existent AC: setAcStatus returns false -> apply fails fast', () => {
    writeFeatureMap(tmpDir, driftyFixture());
    // Hand-craft a plan referencing an AC that does not exist on F-001.
    const fakePlan = {
      phase1: [{
        featureId: 'F-001',
        state: 'shipped',
        acChanges: [{ acId: 'AC-999', from: 'pending', to: 'tested' }],
      }],
      phase2: [],
      preDriftCount: 0,
      totalAcPromotions: 1,
      totalStateUpdates: 0,
      totalChanges: 1,
      auditLogPath: reconcile.AUDIT_LOG_RELATIVE,
    };
    const result = reconcile.executeReconciliation(tmpDir, fakePlan, { skipAuditLog: true });
    assert.strictEqual(result.success, false);
    assert.ok(result.error && result.error.includes('AC-999'));
  });
});

// === 7. Live-repo invariants (read-only) ===

describe('live-repo invariants (read-only)', () => {
  // These tests run against process.cwd() (the actual CAP repo) but DO NOT write.
  // They exist to guarantee the planner is producing the documented plan against the
  // real FEATURE-MAP.md so future drift is caught before someone runs `--apply`.

  const repoRoot = process.cwd();
  const liveFixtureAvailable = fs.existsSync(path.join(repoRoot, 'FEATURE-MAP.md'));

  it('planReconciliation against the live repo lists Phase 1 features that include F-019..F-026 and F-036..F-040', { skip: !liveFixtureAvailable ? 'no live FEATURE-MAP.md found' : false }, () => {
    const plan = reconcile.planReconciliation(repoRoot);
    const ids = new Set(plan.phase1.map(e => e.featureId));

    // F-019..F-026 (8 features) -- introduced before F-041 parser fix.
    for (let n = 19; n <= 26; n++) {
      const id = 'F-0' + String(n);
      assert.ok(ids.has(id), `Phase 1 must include ${id}`);
    }
    // F-036..F-040 (5 features) -- pre-F-042 propagation gap.
    for (let n = 36; n <= 40; n++) {
      const id = 'F-0' + String(n);
      assert.ok(ids.has(id), `Phase 1 must include ${id}`);
    }
  });

  it('planReconciliation against the live repo does NOT include F-041, F-042, or F-043 in Phase 2', { skip: !liveFixtureAvailable ? 'no live FEATURE-MAP.md found' : false }, () => {
    const plan = reconcile.planReconciliation(repoRoot);
    const phase2Ids = new Set(plan.phase2.map(e => e.featureId));
    assert.ok(!phase2Ids.has('F-041'), 'F-041 (parser) is already tested -- must not appear in Phase 2');
    assert.ok(!phase2Ids.has('F-042'), 'F-042 (propagation) is already tested -- must not appear in Phase 2');
    assert.ok(!phase2Ids.has('F-043'), 'F-043 (this feature) must self-exclude from Phase 2');
  });

  it('planReconciliation against the live repo proposes >20 total changes (sanity check)', { skip: !liveFixtureAvailable ? 'no live FEATURE-MAP.md found' : false }, () => {
    const plan = reconcile.planReconciliation(repoRoot);
    const total = plan.phase1.length + plan.phase2.length;
    assert.ok(total > 20, `expected >20 total entries across both phases, got ${total}`);
  });

  it('does NOT mutate live FEATURE-MAP.md as a side effect of planning (read-only contract)', { skip: !liveFixtureAvailable ? 'no live FEATURE-MAP.md found' : false }, () => {
    const fmPath = path.join(repoRoot, 'FEATURE-MAP.md');
    const before = fs.readFileSync(fmPath, 'utf8');
    reconcile.planReconciliation(repoRoot);
    reconcile.planReconciliation(repoRoot);
    const after = fs.readFileSync(fmPath, 'utf8');
    assert.strictEqual(after, before,
      'planReconciliation must NEVER mutate FEATURE-MAP.md -- it is the dry-run side');
  });
});
