'use strict';

// @cap-feature(feature:F-043) Reconcile Status Drift in Existing Feature Map -- regression suite
// for the one-shot reconciliation tool.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const reconcile = require('../cap/bin/lib/cap-reconcile.cjs');
const featureMap = require('../cap/bin/lib/cap-feature-map.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-reconcile-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- Fixture helpers ---

function writeFeatureMap(dir, features) {
  featureMap.writeFeatureMap(dir, { features, lastScan: null });
}

function writeFile(dir, relPath, content) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

// Build a feature map with some drift so Phase 1 has work to do.
function fixtureWithDrift() {
  return [
    {
      id: 'F-001',
      title: 'Initialize project',
      state: 'shipped',
      acs: [
        { id: 'AC-1', description: 'Create config', status: 'pending' },
        { id: 'AC-2', description: 'Print banner', status: 'pending' },
      ],
      files: [],
      dependencies: [],
      metadata: {},
    },
    {
      id: 'F-002',
      title: 'Auth module',
      state: 'tested',
      acs: [
        { id: 'AC-1', description: 'Login works', status: 'pending' },
      ],
      files: [],
      dependencies: [],
      metadata: {},
    },
    {
      id: 'F-003',
      title: 'Logout',
      state: 'shipped',
      acs: [
        { id: 'AC-1', description: 'Logout works', status: 'tested' },
      ],
      files: [],
      dependencies: [],
      metadata: {},
    },
  ];
}

// --- isTestFile ---

describe('isTestFile', () => {
  it('detects .test.cjs files', () => {
    assert.strictEqual(reconcile.isTestFile('tests/foo.test.cjs'), true);
  });

  it('detects .test.js files', () => {
    assert.strictEqual(reconcile.isTestFile('tests/foo.test.js'), true);
  });

  it('detects .test.ts files', () => {
    assert.strictEqual(reconcile.isTestFile('packages/foo.test.ts'), true);
  });

  it('does not flag impl files', () => {
    assert.strictEqual(reconcile.isTestFile('cap/bin/lib/cap-feature-map.cjs'), false);
  });

  it('returns false for falsy input', () => {
    assert.strictEqual(reconcile.isTestFile(''), false);
    assert.strictEqual(reconcile.isTestFile(null), false);
  });
});

// --- canonicalizePath ---

describe('canonicalizePath', () => {
  it('strips the .claude/ mirror prefix', () => {
    const raw = '.claude' + path.sep + 'cap' + path.sep + 'bin' + path.sep + 'lib' + path.sep + 'cap-x.cjs';
    const expected = 'cap' + path.sep + 'bin' + path.sep + 'lib' + path.sep + 'cap-x.cjs';
    assert.strictEqual(reconcile.canonicalizePath(raw), expected);
  });

  it('leaves canonical paths unchanged', () => {
    const p = path.join('cap', 'bin', 'lib', 'cap-x.cjs');
    assert.strictEqual(reconcile.canonicalizePath(p), p);
  });
});

// --- groupTagsByFeatureFiles ---

describe('groupTagsByFeatureFiles', () => {
  it('groups @cap-feature tags by feature ID', () => {
    const tags = [
      { type: 'feature', file: 'cap/bin/lib/a.cjs', metadata: { feature: 'F-100' } },
      { type: 'feature', file: 'cap/bin/lib/b.cjs', metadata: { feature: 'F-100' } },
      { type: 'feature', file: 'cap/bin/lib/c.cjs', metadata: { feature: 'F-200' } },
    ];
    const groups = reconcile.groupTagsByFeatureFiles(tags);
    assert.strictEqual(groups['F-100'].impl.length, 2);
    assert.strictEqual(groups['F-200'].impl.length, 1);
  });

  it('dedupes mirror copies via canonicalization', () => {
    const tags = [
      { type: 'feature', file: 'cap/bin/lib/a.cjs', metadata: { feature: 'F-100' } },
      { type: 'feature', file: '.claude/cap/bin/lib/a.cjs', metadata: { feature: 'F-100' } },
    ];
    const groups = reconcile.groupTagsByFeatureFiles(tags);
    assert.strictEqual(groups['F-100'].impl.length, 1);
  });

  it('ignores non-feature tags', () => {
    const tags = [
      { type: 'todo', file: 'cap/bin/lib/a.cjs', metadata: { ac: 'F-100/AC-1' } },
    ];
    const groups = reconcile.groupTagsByFeatureFiles(tags);
    assert.strictEqual(groups['F-100'], undefined);
  });

  it('skips test files even when they carry feature tags', () => {
    const tags = [
      { type: 'feature', file: 'tests/foo.test.cjs', metadata: { feature: 'F-100' } },
    ];
    const groups = reconcile.groupTagsByFeatureFiles(tags);
    assert.strictEqual(groups['F-100'], undefined);
  });
});

// --- detectTestFileForImpl ---

describe('detectTestFileForImpl', () => {
  it('finds a sibling test file in tests/', () => {
    writeFile(tmpDir, 'cap/bin/lib/foo.cjs', '// impl');
    writeFile(tmpDir, 'tests/foo.test.cjs', '// test');
    const result = reconcile.detectTestFileForImpl(tmpDir, 'cap/bin/lib/foo.cjs');
    assert.strictEqual(result, path.join('tests', 'foo.test.cjs'));
  });

  it('returns null when no test file exists', () => {
    writeFile(tmpDir, 'cap/bin/lib/foo.cjs', '// impl');
    const result = reconcile.detectTestFileForImpl(tmpDir, 'cap/bin/lib/foo.cjs');
    assert.strictEqual(result, null);
  });

  it('falls back to other test extensions', () => {
    writeFile(tmpDir, 'src/widget.ts', '// impl');
    writeFile(tmpDir, 'tests/widget.test.ts', '// test');
    const result = reconcile.detectTestFileForImpl(tmpDir, 'src/widget.ts');
    assert.strictEqual(result, path.join('tests', 'widget.test.ts'));
  });
});

// --- lifecyclePath ---

describe('lifecyclePath', () => {
  it('returns the planned->prototyped->tested path', () => {
    assert.deepStrictEqual(reconcile.lifecyclePath('planned', 'tested'), ['prototyped', 'tested']);
  });

  it('returns a single hop when adjacent', () => {
    assert.deepStrictEqual(reconcile.lifecyclePath('planned', 'prototyped'), ['prototyped']);
  });

  it('returns an empty path for from === to', () => {
    assert.deepStrictEqual(reconcile.lifecyclePath('tested', 'tested'), []);
  });

  it('returns null for backwards transitions', () => {
    assert.strictEqual(reconcile.lifecyclePath('shipped', 'planned'), null);
  });

  it('returns null for unknown states', () => {
    assert.strictEqual(reconcile.lifecyclePath('planned', 'doesnotexist'), null);
  });
});

// --- planReconciliation ---

describe('planReconciliation', () => {
  // @cap-todo(ac:F-043/AC-1) Phase 1 produces an entry for every drifting feature with a list of
  // pending->tested promotions.
  it('Phase 1 promotes every pending AC of a shipped/tested feature', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);

    assert.strictEqual(plan.phase1.length, 2);

    const f001 = plan.phase1.find(e => e.featureId === 'F-001');
    assert.ok(f001);
    assert.strictEqual(f001.acChanges.length, 2);
    assert.deepStrictEqual(f001.acChanges.map(c => c.acId), ['AC-1', 'AC-2']);
    assert.ok(f001.acChanges.every(c => c.from === 'pending' && c.to === 'tested'));

    const f002 = plan.phase1.find(e => e.featureId === 'F-002');
    assert.ok(f002);
    assert.strictEqual(f002.acChanges.length, 1);
  });

  it('Phase 1 ignores features with no pending ACs (F-003)', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase1.find(e => e.featureId === 'F-003'), undefined);
  });

  // @cap-todo(ac:F-043/AC-3) Phase 2 promotes planned features to tested when impl + test files
  // are detected.
  it('Phase 2 promotes planned -> tested when impl and test files are detected', () => {
    const features = [{
      id: 'F-100',
      title: 'Sample feature',
      state: 'planned',
      acs: [
        { id: 'AC-1', description: 'Does the thing', status: 'pending' },
        { id: 'AC-2', description: 'Does another thing', status: 'pending' },
      ],
      files: [],
      dependencies: [],
      metadata: {},
    }];
    writeFeatureMap(tmpDir, features);
    writeFile(tmpDir, 'cap/bin/lib/widget.cjs', '// @cap-feature(feature:F-100)\nmodule.exports = {};\n');
    writeFile(tmpDir, 'tests/widget.test.cjs', '// test');

    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 1);
    const entry = plan.phase2[0];
    assert.strictEqual(entry.featureId, 'F-100');
    assert.strictEqual(entry.fromState, 'planned');
    assert.strictEqual(entry.toState, 'tested');
    assert.strictEqual(entry.implFiles.length, 1);
    assert.strictEqual(entry.testFiles.length, 1);
    assert.strictEqual(entry.propagatedAcChanges.length, 2);
  });

  it('Phase 2 caps at prototyped when no test file is present', () => {
    const features = [{
      id: 'F-100',
      title: 'Half-baked feature',
      state: 'planned',
      acs: [{ id: 'AC-1', description: 'Does the thing', status: 'pending' }],
      files: [],
      dependencies: [],
      metadata: {},
    }];
    writeFeatureMap(tmpDir, features);
    writeFile(tmpDir, 'cap/bin/lib/halfbaked.cjs', '// @cap-feature(feature:F-100)\nmodule.exports = {};\n');

    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 1);
    const entry = plan.phase2[0];
    assert.strictEqual(entry.toState, 'prototyped');
    assert.strictEqual(entry.testFiles.length, 0);
    // No AC propagation when toState != tested.
    assert.strictEqual(entry.propagatedAcChanges.length, 0);
  });

  it('Phase 2 excludes F-043 from self-promotion', () => {
    const features = [{
      id: 'F-043',
      title: 'Reconciliation tool',
      state: 'planned',
      acs: [{ id: 'AC-1', description: 'Reconciles', status: 'pending' }],
      files: [],
      dependencies: [],
      metadata: {},
    }];
    writeFeatureMap(tmpDir, features);
    writeFile(tmpDir, 'cap/bin/lib/cap-reconcile.cjs', '// @cap-feature(feature:F-043)\nmodule.exports = {};\n');
    writeFile(tmpDir, 'tests/cap-reconcile.test.cjs', '// test');

    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 0);
  });

  it('Phase 2 ignores planned features with no implementation files', () => {
    const features = [{
      id: 'F-100',
      title: 'Pure plan',
      state: 'planned',
      acs: [{ id: 'AC-1', description: 'TBD', status: 'pending' }],
      files: [],
      dependencies: [],
      metadata: {},
    }];
    writeFeatureMap(tmpDir, features);
    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.phase2.length, 0);
  });

  it('counts totalChanges = totalAcPromotions + totalStateUpdates', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.totalChanges, plan.totalAcPromotions + plan.totalStateUpdates);
  });

  it('records preDriftCount from detectDrift', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);
    // F-001 + F-002 are drifting; F-003 is consistent.
    assert.strictEqual(plan.preDriftCount, 2);
  });

  it('exposes the audit log target path', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);
    assert.strictEqual(plan.auditLogPath, reconcile.AUDIT_LOG_RELATIVE);
  });
});

// --- formatPlan ---

describe('formatPlan', () => {
  it('renders a Dry Run banner', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);
    const out = reconcile.formatPlan(plan);
    assert.ok(out.includes('Status Drift Reconciliation -- Dry Run'));
  });

  it('lists every Phase 1 entry', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);
    const out = reconcile.formatPlan(plan);
    assert.ok(out.includes('F-001 [shipped]'));
    assert.ok(out.includes('F-002 [tested]'));
  });

  it('shows totals', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);
    const out = reconcile.formatPlan(plan);
    assert.ok(out.includes('Total proposed changes:'));
    assert.ok(out.includes('Run with --apply to commit changes.'));
  });

  it('handles empty plans gracefully', () => {
    writeFeatureMap(tmpDir, [{
      id: 'F-001',
      title: 'Clean feature',
      state: 'shipped',
      acs: [{ id: 'AC-1', description: 'Done', status: 'tested' }],
      files: [],
      dependencies: [],
      metadata: {},
    }]);
    const plan = reconcile.planReconciliation(tmpDir);
    const out = reconcile.formatPlan(plan);
    assert.ok(out.includes('(no AC-status drift detected)'));
  });

  it('returns a friendly message for nullish input', () => {
    assert.strictEqual(reconcile.formatPlan(null), 'Status Drift Reconciliation -- no plan available.');
  });
});

// --- executeReconciliation ---

describe('executeReconciliation', () => {
  // @cap-todo(ac:F-043/AC-1) Phase 1 mutations are applied via setAcStatus and the resulting
  // FEATURE-MAP.md reflects all promotions.
  it('applies Phase 1 AC promotions to the on-disk Feature Map', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.postDriftCount, 0);

    const fm = featureMap.readFeatureMap(tmpDir);
    const f001 = fm.features.find(f => f.id === 'F-001');
    assert.ok(f001.acs.every(ac => ac.status === 'tested'));
    const f002 = fm.features.find(f => f.id === 'F-002');
    assert.ok(f002.acs.every(ac => ac.status === 'tested'));
  });

  // @cap-todo(ac:F-043/AC-3) Phase 2 walks the lifecycle path and ends in the proposed state.
  it('applies Phase 2 state transitions through the lifecycle (planned -> tested)', () => {
    const features = [{
      id: 'F-100',
      title: 'Sample feature',
      state: 'planned',
      acs: [
        { id: 'AC-1', description: 'A', status: 'pending' },
        { id: 'AC-2', description: 'B', status: 'pending' },
      ],
      files: [],
      dependencies: [],
      metadata: {},
    }];
    writeFeatureMap(tmpDir, features);
    writeFile(tmpDir, 'cap/bin/lib/widget.cjs', '// @cap-feature(feature:F-100)\nmodule.exports = {};\n');
    writeFile(tmpDir, 'tests/widget.test.cjs', '// test');

    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });
    assert.strictEqual(result.success, true);

    const fm = featureMap.readFeatureMap(tmpDir);
    const f100 = fm.features.find(f => f.id === 'F-100');
    assert.strictEqual(f100.state, 'tested');
    assert.ok(f100.acs.every(ac => ac.status === 'tested'));
  });

  it('caps at prototyped when no test file is present', () => {
    const features = [{
      id: 'F-100',
      title: 'Half-baked',
      state: 'planned',
      acs: [{ id: 'AC-1', description: 'A', status: 'pending' }],
      files: [],
      dependencies: [],
      metadata: {},
    }];
    writeFeatureMap(tmpDir, features);
    writeFile(tmpDir, 'cap/bin/lib/halfbaked.cjs', '// @cap-feature(feature:F-100)\nmodule.exports = {};\n');

    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });
    assert.strictEqual(result.success, true);

    const fm = featureMap.readFeatureMap(tmpDir);
    const f100 = fm.features.find(f => f.id === 'F-100');
    assert.strictEqual(f100.state, 'prototyped');
    // ACs should NOT have been promoted -- only 'tested' transitions promote ACs.
    assert.strictEqual(f100.acs[0].status, 'pending');
  });

  // @cap-todo(ac:F-043/AC-4) Audit log is emitted with both phases recorded.
  it('writes the audit log to .cap/memory/reconciliation-2026-04.md when not skipped', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());
    const plan = reconcile.planReconciliation(tmpDir);
    const stamp = '2026-04-20T12:34:56.000Z';
    const result = reconcile.executeReconciliation(tmpDir, plan, { timestamp: stamp });
    assert.strictEqual(result.success, true);

    const logPath = path.join(tmpDir, reconcile.AUDIT_LOG_RELATIVE);
    assert.ok(fs.existsSync(logPath));
    const log = fs.readFileSync(logPath, 'utf8');
    assert.ok(log.includes('# Status Drift Reconciliation Audit'));
    assert.ok(log.includes(stamp));
    assert.ok(log.includes('## Phase 1 -- AC Promotions'));
    assert.ok(log.includes('## Phase 2 -- Feature State Updates'));
    assert.ok(log.includes('## Phase 3 -- Verification'));
    assert.ok(log.includes('Pre-reconciliation drift count: 2'));
    assert.ok(log.includes('Post-reconciliation drift count: 0'));
    assert.ok(log.includes('All drift resolved'));
  });

  it('handles empty plans without crashing', () => {
    writeFeatureMap(tmpDir, [{
      id: 'F-001',
      title: 'Clean feature',
      state: 'shipped',
      acs: [{ id: 'AC-1', description: 'Done', status: 'tested' }],
      files: [],
      dependencies: [],
      metadata: {},
    }]);
    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.postDriftCount, 0);
  });

  it('returns failure when plan is null', () => {
    const result = reconcile.executeReconciliation(tmpDir, null);
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });
});

// --- AC-5 regression: post-reconciliation parser produces zero drift ---

describe('AC-5 regression: parser produces zero drift after reconciliation', () => {
  // @cap-todo(ac:F-043/AC-5) After running plan + execute against a drifty fixture, parsing the
  // resulting FEATURE-MAP.md must yield driftCount === 0 from detectDrift.
  it('detectDrift returns hasDrift=false after reconciliation of a drifty fixture', () => {
    writeFeatureMap(tmpDir, fixtureWithDrift());

    // Sanity: starts drifty.
    const before = featureMap.detectDrift(tmpDir);
    assert.ok(before.hasDrift);
    assert.strictEqual(before.driftCount, 2);

    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });
    assert.strictEqual(result.success, true);

    // After: zero drift.
    const after = featureMap.detectDrift(tmpDir);
    assert.strictEqual(after.hasDrift, false);
    assert.strictEqual(after.driftCount, 0);
  });

  it('also resolves drift across mixed Phase 1 + Phase 2 fixtures', () => {
    const features = [
      // Phase 1 cases.
      ...fixtureWithDrift(),
      // Phase 2 case (planned with code + tests).
      {
        id: 'F-100',
        title: 'Sample feature',
        state: 'planned',
        acs: [{ id: 'AC-1', description: 'A', status: 'pending' }],
        files: [],
        dependencies: [],
        metadata: {},
      },
    ];
    writeFeatureMap(tmpDir, features);
    writeFile(tmpDir, 'cap/bin/lib/widget.cjs', '// @cap-feature(feature:F-100)\nmodule.exports = {};\n');
    writeFile(tmpDir, 'tests/widget.test.cjs', '// test');

    const plan = reconcile.planReconciliation(tmpDir);
    const result = reconcile.executeReconciliation(tmpDir, plan, { skipAuditLog: true });
    assert.strictEqual(result.success, true);

    const after = featureMap.detectDrift(tmpDir);
    assert.strictEqual(after.driftCount, 0);
  });
});

// --- writeAuditLog standalone ---

describe('writeAuditLog', () => {
  it('writes a markdown file with phase headers and creates parent dirs', () => {
    const plan = {
      phase1: [{ featureId: 'F-001', state: 'shipped', acChanges: [{ acId: 'AC-1', from: 'pending', to: 'tested' }] }],
      phase2: [],
      preDriftCount: 1,
      totalAcPromotions: 1,
      totalStateUpdates: 0,
      totalChanges: 1,
      auditLogPath: reconcile.AUDIT_LOG_RELATIVE,
    };
    const stamp = '2026-04-20T00:00:00.000Z';
    const rel = reconcile.writeAuditLog(tmpDir, plan, 0, stamp);
    assert.strictEqual(rel, reconcile.AUDIT_LOG_RELATIVE);

    const abs = path.join(tmpDir, rel);
    assert.ok(fs.existsSync(abs));
    const content = fs.readFileSync(abs, 'utf8');
    assert.ok(content.includes('## Phase 1 -- AC Promotions'));
    assert.ok(content.includes('### F-001 (shipped)'));
    assert.ok(content.includes('AC-1: pending -> tested'));
    assert.ok(content.includes('All drift resolved'));
  });

  it('reports remaining drift when post-count > 0', () => {
    const plan = {
      phase1: [], phase2: [], preDriftCount: 5, totalAcPromotions: 0, totalStateUpdates: 0, totalChanges: 0,
      auditLogPath: reconcile.AUDIT_LOG_RELATIVE,
    };
    reconcile.writeAuditLog(tmpDir, plan, 5, '2026-04-20T00:00:00.000Z');
    const content = fs.readFileSync(path.join(tmpDir, reconcile.AUDIT_LOG_RELATIVE), 'utf8');
    assert.ok(content.includes('5 drift entries remain'));
  });
});
