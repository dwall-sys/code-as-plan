'use strict';

// @cap-feature(feature:F-048) Tests for cap-completeness.cjs — 4-signal scoring, threshold gate, perf.

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const comp = require('../cap/bin/lib/cap-completeness.cjs');

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

describe('isTestFile', () => {
  it('recognises *.test.js / .cjs / .mjs / .ts / .tsx', () => {
    assert.strictEqual(comp.isTestFile('foo.test.js'), true);
    assert.strictEqual(comp.isTestFile('foo.test.cjs'), true);
    assert.strictEqual(comp.isTestFile('foo.test.mjs'), true);
    assert.strictEqual(comp.isTestFile('foo.test.ts'), true);
    assert.strictEqual(comp.isTestFile('foo.test.tsx'), true);
  });

  it('recognises *.spec.*', () => {
    assert.strictEqual(comp.isTestFile('foo.spec.cjs'), true);
    assert.strictEqual(comp.isTestFile('foo.spec.tsx'), true);
  });

  it('recognises tests/ and /tests/ path segments', () => {
    assert.strictEqual(comp.isTestFile('tests/unit.cjs'), true);
    assert.strictEqual(comp.isTestFile('foo/tests/unit.cjs'), true);
    assert.strictEqual(comp.isTestFile('test/helper.cjs'), true);
  });

  it('does not flag plain source files', () => {
    assert.strictEqual(comp.isTestFile('cap/bin/lib/cap-deps.cjs'), false);
    assert.strictEqual(comp.isTestFile('src/main.ts'), false);
  });

  it('handles null / empty / non-string input safely', () => {
    assert.strictEqual(comp.isTestFile(null), false);
    assert.strictEqual(comp.isTestFile(''), false);
    assert.strictEqual(comp.isTestFile(42), false);
  });

  it('normalises Windows backslashes', () => {
    assert.strictEqual(comp.isTestFile('tests\\unit.cjs'), true);
  });
});

// ---------------------------------------------------------------------------
// scoreAc — per-signal logic
// ---------------------------------------------------------------------------

describe('scoreAc: per-signal scoring', () => {
  function ctx(overrides) {
    return {
      projectRoot: '/proj',
      acFileMap: overrides.acFileMap || {},
      fileToFeature: overrides.fileToFeature || new Map(),
      publicReachable: overrides.publicReachable || new Set(),
      importsByFile: new Map(),
    };
  }

  it('returns score 0 when AC has no files (not in map)', () => {
    const r = comp.scoreAc('F-001/AC-1', ctx({}));
    assert.strictEqual(r.score, 0);
    assert.strictEqual(r.signals.tag, false);
    assert.strictEqual(r.signals.test, false);
    assert.strictEqual(r.signals.testInvokesCode, false);
    assert.strictEqual(r.signals.reachable, false);
  });

  it('scores tag only when a non-test source file tags the AC', () => {
    const r = comp.scoreAc(
      'F-001/AC-1',
      ctx({
        acFileMap: {
          'F-001/AC-1': {
            files: ['cap/bin/lib/foo.cjs'],
            primary: 'cap/bin/lib/foo.cjs',
          },
        },
      })
    );
    assert.strictEqual(r.signals.tag, true);
    assert.strictEqual(r.signals.test, false);
    assert.strictEqual(r.score, 1);
  });

  it('scores tag + test when both a source and a test file tag it', () => {
    const r = comp.scoreAc(
      'F-001/AC-1',
      ctx({
        acFileMap: {
          'F-001/AC-1': {
            files: ['cap/bin/lib/foo.cjs', 'tests/foo.test.cjs'],
            primary: 'cap/bin/lib/foo.cjs',
          },
        },
      })
    );
    assert.strictEqual(r.signals.tag, true);
    assert.strictEqual(r.signals.test, true);
    assert.strictEqual(r.score, 2); // T + S, not I (context has no publicReachable / imports)
  });

  it('gives full 4/4 when tag+test exist, test reaches primary, primary reachable from public', () => {
    // Build a context where testReachesFile can walk from test to primary.
    const root = '/proj';
    const primary = path.resolve(root, 'cap/bin/lib/foo.cjs');
    const testFile = path.resolve(root, 'tests/foo.test.cjs');

    // Patch fs + cap-deps for this one test via a temporary directory
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-completeness-'));
    try {
      const libDir = path.join(tmp, 'cap/bin/lib');
      const testDir = path.join(tmp, 'tests');
      fs.mkdirSync(libDir, { recursive: true });
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(libDir, 'foo.cjs'), '// @cap-feature(feature:F-001)\nmodule.exports = {};\n');
      fs.writeFileSync(
        path.join(testDir, 'foo.test.cjs'),
        "const foo = require('../cap/bin/lib/foo.cjs');\n"
      );

      const acMap = {
        'F-001/AC-1': {
          files: [
            path.join(tmp, 'cap/bin/lib/foo.cjs'),
            path.join(tmp, 'tests/foo.test.cjs'),
          ],
          primary: path.join(tmp, 'cap/bin/lib/foo.cjs'),
        },
      };

      const r = comp.scoreAc('F-001/AC-1', {
        projectRoot: tmp,
        acFileMap: acMap,
        fileToFeature: new Map(),
        publicReachable: new Set([path.join(tmp, 'cap/bin/lib/foo.cjs')]),
        importsByFile: new Map(),
      });

      assert.strictEqual(r.signals.tag, true);
      assert.strictEqual(r.signals.test, true);
      assert.strictEqual(r.signals.testInvokesCode, true, 'test must import primary');
      assert.strictEqual(r.signals.reachable, true);
      assert.strictEqual(r.score, 4);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('scores testInvokesCode=false when test does not import primary within maxDepth', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-completeness-'));
    try {
      fs.mkdirSync(path.join(tmp, 'cap/bin/lib'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'cap/bin/lib/foo.cjs'), 'module.exports = {};\n');
      // Test imports something else entirely
      fs.writeFileSync(path.join(tmp, 'tests/foo.test.cjs'), "const x = require('node:fs');\n");

      const acMap = {
        'F-001/AC-1': {
          files: [path.join(tmp, 'cap/bin/lib/foo.cjs'), path.join(tmp, 'tests/foo.test.cjs')],
          primary: path.join(tmp, 'cap/bin/lib/foo.cjs'),
        },
      };

      const r = comp.scoreAc('F-001/AC-1', {
        projectRoot: tmp,
        acFileMap: acMap,
        fileToFeature: new Map(),
        publicReachable: new Set(),
        importsByFile: new Map(),
      });
      assert.strictEqual(r.signals.testInvokesCode, false);
      assert.strictEqual(r.signals.reachable, false);
      assert.strictEqual(r.score, 2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('emits a reason string for every signal', () => {
    const r = comp.scoreAc('F-001/AC-1', ctx({
      acFileMap: { 'F-001/AC-1': { files: ['src/foo.cjs'], primary: 'src/foo.cjs' } },
    }));
    assert.strictEqual(r.reasons.length, 4);
    for (const line of r.reasons) assert.ok(typeof line === 'string' && line.length > 0);
  });
});

// ---------------------------------------------------------------------------
// scoreFeature
// ---------------------------------------------------------------------------

describe('scoreFeature', () => {
  it('averages AC scores', () => {
    const feature = { id: 'F-100', state: 'tested', acs: [{ id: 'AC-1' }, { id: 'AC-2' }] };
    const ctx = {
      projectRoot: '/proj',
      acFileMap: {
        'F-100/AC-1': { files: ['a.cjs'], primary: 'a.cjs' }, // tag=1
        'F-100/AC-2': {
          files: ['b.cjs', 'tests/b.test.cjs'],
          primary: 'b.cjs',
        }, // tag=1, test=1
      },
      fileToFeature: new Map(),
      publicReachable: new Set(),
      importsByFile: new Map(),
    };
    const r = comp.scoreFeature(feature, ctx);
    assert.strictEqual(r.acCount, 2);
    assert.strictEqual(r.scoreSum, 3); // 1 + 2
    assert.strictEqual(r.averageScore, 1.5);
    assert.strictEqual(r.state, 'tested');
  });

  it('averageScore is NaN when the feature has no ACs', () => {
    const feature = { id: 'F-200', state: 'planned', acs: [] };
    const ctx = {
      projectRoot: '/proj',
      acFileMap: {},
      fileToFeature: new Map(),
      publicReachable: new Set(),
      importsByFile: new Map(),
    };
    const r = comp.scoreFeature(feature, ctx);
    assert.ok(Number.isNaN(r.averageScore));
    assert.strictEqual(r.acCount, 0);
  });
});

// ---------------------------------------------------------------------------
// formatFeatureBreakdown + formatCompletenessReport
// ---------------------------------------------------------------------------

describe('formatters', () => {
  function makeScore() {
    return [
      {
        featureId: 'F-100',
        state: 'tested',
        averageScore: 3.5,
        scoreSum: 7,
        acCount: 2,
        acs: [
          {
            acRef: 'F-100/AC-1',
            signals: { tag: true, test: true, testInvokesCode: true, reachable: true },
            score: 4,
            reasons: ['tag', 'test', 'invokes', 'reach'],
          },
          {
            acRef: 'F-100/AC-2',
            signals: { tag: true, test: true, testInvokesCode: true, reachable: false },
            score: 3,
            reasons: ['tag', 'test', 'invokes', 'no-reach'],
          },
        ],
      },
    ];
  }

  it('formatFeatureBreakdown shows per-feature avg and per-AC flags', () => {
    const out = comp.formatFeatureBreakdown(makeScore());
    assert.ok(out.includes('F-100 [tested]'));
    assert.ok(out.includes('avg=3.50/4'));
    assert.ok(out.includes('TSIR')); // all flags lit for AC-1
    assert.ok(out.includes('TSI·')); // R missing for AC-2
  });

  it('formatFeatureBreakdown handles empty input', () => {
    const out = comp.formatFeatureBreakdown([]);
    assert.ok(out.includes('No features'));
  });

  it('formatCompletenessReport produces a well-formed markdown table', () => {
    const out = comp.formatCompletenessReport(makeScore());
    assert.ok(out.startsWith('# Completeness Report'));
    assert.ok(out.includes('| Feature | State | ACs | Avg Score |'));
    assert.ok(out.includes('| F-100 | tested | 2 | 3.50 |'));
    assert.ok(out.includes('| F-100/AC-1 | ✓ | ✓ | ✓ | ✓ | 4/4 |'));
    assert.ok(out.includes('| F-100/AC-2 | ✓ | ✓ | ✓ | · | 3/4 |'));
  });
});

// ---------------------------------------------------------------------------
// loadCompletenessConfig
// ---------------------------------------------------------------------------

describe('loadCompletenessConfig', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-completeness-cfg-'));
    fs.mkdirSync(path.join(tmp, '.cap'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('returns defaults when config is missing', () => {
    const cfg = comp.loadCompletenessConfig(tmp);
    assert.strictEqual(cfg.enabled, false);
    assert.strictEqual(cfg.shipThreshold, 3.5);
  });

  it('reads enabled=true + custom threshold', () => {
    fs.writeFileSync(
      path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ completenessScore: { enabled: true, shipThreshold: 2.5 } })
    );
    const cfg = comp.loadCompletenessConfig(tmp);
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.shipThreshold, 2.5);
  });

  it('ignores non-number shipThreshold', () => {
    fs.writeFileSync(
      path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ completenessScore: { enabled: true, shipThreshold: 'high' } })
    );
    const cfg = comp.loadCompletenessConfig(tmp);
    assert.strictEqual(cfg.shipThreshold, 3.5);
  });

  it('ignores malformed JSON', () => {
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'), 'not json');
    const cfg = comp.loadCompletenessConfig(tmp);
    assert.strictEqual(cfg.enabled, false);
  });
});

// ---------------------------------------------------------------------------
// checkShipGate — threshold enforcement
// ---------------------------------------------------------------------------

describe('checkShipGate', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-completeness-gate-'));
    fs.mkdirSync(path.join(tmp, '.cap'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('allows non-shipped transitions regardless of config', () => {
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ completenessScore: { enabled: true, shipThreshold: 3.9 } }));
    const gate = comp.checkShipGate('F-001', 'tested', tmp);
    assert.strictEqual(gate.allowed, true);
  });

  it('allows when config is disabled (opt-in default)', () => {
    const gate = comp.checkShipGate('F-001', 'shipped', tmp);
    assert.strictEqual(gate.allowed, true);
  });

  it('blocks shipped when averageScore < threshold', () => {
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ completenessScore: { enabled: true, shipThreshold: 3.9 } }));
    const ctx = {
      projectRoot: tmp,
      featureMap: { features: [{ id: 'F-001', state: 'tested', acs: [{ id: 'AC-1' }] }] },
      acFileMap: { 'F-001/AC-1': { files: ['src/foo.cjs'], primary: 'src/foo.cjs' } },
      fileToFeature: new Map(),
      publicReachable: new Set(),
      importsByFile: new Map(),
    };
    const gate = comp.checkShipGate('F-001', 'shipped', tmp, ctx);
    assert.strictEqual(gate.allowed, false);
    assert.ok(gate.reason.includes('below the configured shipThreshold'));
    assert.strictEqual(gate.score, 1);
  });

  it('allows shipped when averageScore >= threshold', () => {
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ completenessScore: { enabled: true, shipThreshold: 1.0 } }));
    const ctx = {
      projectRoot: tmp,
      featureMap: { features: [{ id: 'F-001', state: 'tested', acs: [{ id: 'AC-1' }] }] },
      acFileMap: { 'F-001/AC-1': { files: ['src/foo.cjs'], primary: 'src/foo.cjs' } },
      fileToFeature: new Map(),
      publicReachable: new Set(),
      importsByFile: new Map(),
    };
    const gate = comp.checkShipGate('F-001', 'shipped', tmp, ctx);
    assert.strictEqual(gate.allowed, true);
    assert.strictEqual(gate.score, 1);
  });

  it('allows features with zero ACs through (no obligations)', () => {
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ completenessScore: { enabled: true, shipThreshold: 3.9 } }));
    const ctx = {
      projectRoot: tmp,
      featureMap: { features: [{ id: 'F-001', state: 'tested', acs: [] }] },
      acFileMap: {},
      fileToFeature: new Map(),
      publicReachable: new Set(),
      importsByFile: new Map(),
    };
    const gate = comp.checkShipGate('F-001', 'shipped', tmp, ctx);
    assert.strictEqual(gate.allowed, true);
  });

  it('allows unknown feature id (no-op)', () => {
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ completenessScore: { enabled: true } }));
    const ctx = {
      projectRoot: tmp,
      featureMap: { features: [] },
      acFileMap: {},
      fileToFeature: new Map(),
      publicReachable: new Set(),
      importsByFile: new Map(),
    };
    const gate = comp.checkShipGate('F-999', 'shipped', tmp, ctx);
    assert.strictEqual(gate.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// collectPublicSurfaceFiles
// ---------------------------------------------------------------------------

describe('collectPublicSurfaceFiles', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-completeness-public-'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('returns package.json bin entries', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'),
      JSON.stringify({ bin: { cap: 'bin/install.js' } }));
    fs.mkdirSync(path.join(tmp, 'bin'));
    fs.writeFileSync(path.join(tmp, 'bin/install.js'), '');
    const roots = comp.collectPublicSurfaceFiles(tmp);
    assert.ok(roots.includes(path.join(tmp, 'bin/install.js')));
  });

  it('returns hooks/*.js files', () => {
    fs.mkdirSync(path.join(tmp, 'hooks'));
    fs.writeFileSync(path.join(tmp, 'hooks/foo.js'), '');
    fs.writeFileSync(path.join(tmp, 'hooks/bar.cjs'), '');
    const roots = comp.collectPublicSurfaceFiles(tmp);
    assert.ok(roots.includes(path.join(tmp, 'hooks/foo.js')));
    assert.ok(roots.includes(path.join(tmp, 'hooks/bar.cjs')));
  });

  it('handles absent package.json + hooks dir gracefully', () => {
    const roots = comp.collectPublicSurfaceFiles(tmp);
    assert.deepStrictEqual(roots, []);
  });

  it('handles package.json with string bin (not object)', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'),
      JSON.stringify({ bin: 'bin/install.js' }));
    fs.mkdirSync(path.join(tmp, 'bin'));
    fs.writeFileSync(path.join(tmp, 'bin/install.js'), '');
    const roots = comp.collectPublicSurfaceFiles(tmp);
    assert.ok(roots.includes(path.join(tmp, 'bin/install.js')));
  });
});

// ---------------------------------------------------------------------------
// Integration + perf: real repo
// ---------------------------------------------------------------------------

describe('integration: real repo scoring', () => {
  it('buildContext + scoreAllFeatures completes under 5s (F-048 AC-4)', () => {
    const root = path.resolve(__dirname, '..');
    const t0 = Date.now();
    const ctx = comp.buildContext(root);
    const scores = comp.scoreAllFeatures(ctx);
    const elapsed = Date.now() - t0;

    assert.ok(Array.isArray(scores));
    assert.ok(scores.length > 0, 'should score at least one feature');
    assert.ok(elapsed < 5000, `perf budget: ${elapsed}ms (limit 5000)`);

    // Each feature must have a numeric averageScore (or NaN when no ACs)
    for (const s of scores) {
      if (s.acCount === 0) {
        assert.ok(Number.isNaN(s.averageScore));
      } else {
        assert.ok(Number.isFinite(s.averageScore));
        assert.ok(s.averageScore >= 0 && s.averageScore <= 4);
      }
    }
  });

  it('produces at least one feature with a non-zero score on the real repo', () => {
    const root = path.resolve(__dirname, '..');
    const ctx = comp.buildContext(root);
    const scores = comp.scoreAllFeatures(ctx);
    const anyNonzero = scores.some((s) => Number.isFinite(s.averageScore) && s.averageScore > 0);
    assert.ok(anyNonzero, 'at least one feature on the real repo should score > 0');
  });
});

// ---------------------------------------------------------------------------
// transitionWithReason integration via cap-feature-map
// ---------------------------------------------------------------------------

describe('integration: cap-feature-map.transitionWithReason with completeness gate', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-comp-gate-'));
    fs.mkdirSync(path.join(tmp, '.cap'));
    // Enable the gate with an impossibly high threshold so any feature fails.
    fs.writeFileSync(path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ completenessScore: { enabled: true, shipThreshold: 3.99 } }));
    // Minimal FEATURE-MAP.md: one feature ready to ship (all ACs tested).
    fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), [
      '# Feature Map',
      '',
      '### F-100: Gated [tested]',
      '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | tested | The feature works |',
      '',
    ].join('\n'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('transitionWithReason returns { ok:false, reason } when completeness score is below threshold', () => {
    const fm = require('../cap/bin/lib/cap-feature-map.cjs');
    const r = fm.transitionWithReason(tmp, 'F-100', 'shipped');
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason && r.reason.includes('Completeness score'));
  });

  it('updateFeatureState silently returns false under the same gate', () => {
    const fm = require('../cap/bin/lib/cap-feature-map.cjs');
    const ok = fm.updateFeatureState(tmp, 'F-100', 'shipped');
    assert.strictEqual(ok, false);
  });
});
