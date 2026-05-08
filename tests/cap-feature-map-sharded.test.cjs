// @cap-feature(feature:F-089) Sharded mode integration — readFeatureMap, writeFeatureMap, and
//   applySurgicalPatches all dispatching to the per-feature layout.
// @cap-context End-to-end RED-GREEN tests against the dispatchers in cap-feature-map.cjs.
//   Pure-helper unit tests live in tests/cap-feature-map-shard.test.cjs.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fm = require('../cap/bin/lib/cap-feature-map.cjs');
const shard = require('../cap/bin/lib/cap-feature-map-shard.cjs');
const migrate = require('../cap/bin/lib/cap-feature-map-migrate.cjs');

function setUp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-sharded-'));
}
function tearDown(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function buildShardedProject(tmp, features) {
  // Bootstrap a sharded layout directly (skip migrate to keep this test focused on read/write).
  fs.mkdirSync(path.join(tmp, 'features'), { recursive: true });
  for (const f of features) {
    const block = `### ${f.id}: ${f.title} [${f.state}]

| AC | Status | Description |
|----|--------|-------------|
${(f.acs || [])
  .map(a => `| ${a.id} | ${a.status} | ${a.description} |`)
  .join('\n')}
`;
    fs.writeFileSync(path.join(tmp, 'features', f.id + '.md'), block);
  }
  const idx = shard.serializeIndex(
    features.map(f => ({ id: f.id, state: f.state, title: f.title }))
  );
  fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), idx);
}

describe('F-089 sharded mode — readFeatureMap dispatches to sharded loader', () => {
  it('reads features from per-feature files via the index', () => {
    const tmp = setUp();
    try {
      buildShardedProject(tmp, [
        {
          id: 'F-001',
          title: 'Tag Scanner',
          state: 'shipped',
          acs: [{ id: 'AC-1', status: 'tested', description: 'extract tags' }],
        },
        {
          id: 'F-Hub-Spotlight',
          title: 'Spotlight Carousel',
          state: 'planned',
          acs: [{ id: 'AC-1', status: 'planned', description: 'render carousel' }],
        },
      ]);
      const result = fm.readFeatureMap(tmp);
      assert.equal(result.features.length, 2);
      assert.equal(result.features[0].id, 'F-001');
      assert.equal(result.features[0].state, 'shipped');
      assert.equal(result.features[0].acs[0].id, 'AC-1');
      assert.equal(result.features[1].id, 'F-Hub-Spotlight');
      assert.equal(result.features[1].state, 'planned');
    } finally {
      tearDown(tmp);
    }
  });

  it('falls back to monolithic mode when features/ is absent (AC-7)', () => {
    const tmp = setUp();
    try {
      const monolithic = `# Feature Map

## Features

### F-001: Tag Scanner [shipped]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | extract |

## Legend
`;
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), monolithic);
      const result = fm.readFeatureMap(tmp);
      assert.equal(result.features.length, 1);
      assert.equal(result.features[0].id, 'F-001');
      assert.equal(result.features[0].state, 'shipped');
    } finally {
      tearDown(tmp);
    }
  });

  it('survives a missing per-feature file referenced by index (warns + skips)', () => {
    const tmp = setUp();
    try {
      buildShardedProject(tmp, [
        { id: 'F-001', title: 'OK', state: 'shipped', acs: [] },
        { id: 'F-002', title: 'Missing', state: 'planned', acs: [] },
      ]);
      // Delete F-002.md but leave it in the index
      fs.unlinkSync(path.join(tmp, 'features', 'F-002.md'));
      const origWarn = console.warn;
      const warnings = [];
      console.warn = (msg) => warnings.push(msg);
      try {
        const result = fm.readFeatureMap(tmp);
        assert.equal(result.features.length, 1);
        assert.equal(result.features[0].id, 'F-001');
        assert.ok(warnings.some(w => /F-002/.test(w)), 'should warn about missing F-002');
      } finally {
        console.warn = origWarn;
      }
    } finally {
      tearDown(tmp);
    }
  });
});

describe('F-089 sharded mode — updateFeatureState surgical-patches per-feature file + index', () => {
  it('flips state from planned → prototyped via surgical patch on per-feature file', () => {
    const tmp = setUp();
    try {
      buildShardedProject(tmp, [
        {
          id: 'F-001',
          title: 'Tag Scanner',
          state: 'planned',
          acs: [{ id: 'AC-1', status: 'tested', description: 'x' }],
        },
      ]);
      const ok = fm.updateFeatureState(tmp, 'F-001', 'prototyped');
      assert.equal(ok, true);
      // Per-feature file should reflect new state
      const featureContent = fs.readFileSync(path.join(tmp, 'features', 'F-001.md'), 'utf8');
      assert.match(featureContent, /\[prototyped\]/);
      // Index should also reflect new state
      const indexContent = fs.readFileSync(path.join(tmp, 'FEATURE-MAP.md'), 'utf8');
      assert.match(indexContent, /- F-001 \| prototyped \| Tag Scanner/);
    } finally {
      tearDown(tmp);
    }
  });

  it('respects shipped-gate: shipped requires all ACs tested', () => {
    const tmp = setUp();
    try {
      buildShardedProject(tmp, [
        {
          id: 'F-002',
          title: 'Pending Feature',
          state: 'tested',
          acs: [{ id: 'AC-1', status: 'pending', description: 'x' }],
        },
      ]);
      const ok = fm.updateFeatureState(tmp, 'F-002', 'shipped');
      assert.equal(ok, false, 'shipped must be rejected when an AC is pending');
      const indexContent = fs.readFileSync(path.join(tmp, 'FEATURE-MAP.md'), 'utf8');
      assert.match(indexContent, /- F-002 \| tested \|/, 'index unchanged on rejection');
    } finally {
      tearDown(tmp);
    }
  });
});

describe('F-089 sharded mode — setAcStatus surgical-patches per-feature file', () => {
  it('flips a single AC status without touching siblings', () => {
    const tmp = setUp();
    try {
      buildShardedProject(tmp, [
        {
          id: 'F-001',
          title: 'Multi AC',
          state: 'planned',
          acs: [
            { id: 'AC-1', status: 'pending', description: 'first' },
            { id: 'AC-2', status: 'pending', description: 'second' },
          ],
        },
      ]);
      const ok = fm.setAcStatus(tmp, 'F-001', 'AC-2', 'tested');
      assert.equal(ok, true);
      const content = fs.readFileSync(path.join(tmp, 'features', 'F-001.md'), 'utf8');
      assert.match(content, /\| AC-1 \| pending \| first \|/);
      assert.match(content, /\| AC-2 \| tested \| second \|/);
    } finally {
      tearDown(tmp);
    }
  });

  it('AC updates do NOT modify the index (state column unchanged)', () => {
    const tmp = setUp();
    try {
      buildShardedProject(tmp, [
        {
          id: 'F-001',
          title: 'Stable',
          state: 'planned',
          acs: [{ id: 'AC-1', status: 'pending', description: 'x' }],
        },
      ]);
      const indexBefore = fs.readFileSync(path.join(tmp, 'FEATURE-MAP.md'), 'utf8');
      fm.setAcStatus(tmp, 'F-001', 'AC-1', 'tested');
      const indexAfter = fs.readFileSync(path.join(tmp, 'FEATURE-MAP.md'), 'utf8');
      assert.equal(indexAfter, indexBefore);
    } finally {
      tearDown(tmp);
    }
  });
});

describe('F-089 sharded mode — round-trip stability (50 features × 50 updates)', () => {
  it('50 sequential state updates produce zero line-count drift in any per-feature file', () => {
    const tmp = setUp();
    try {
      const features = [];
      for (let i = 1; i <= 50; i++) {
        const id = 'F-' + String(i).padStart(3, '0');
        features.push({
          id,
          title: 'Feature ' + i,
          state: 'planned',
          acs: [{ id: 'AC-1', status: 'tested', description: 'desc ' + i }],
        });
      }
      buildShardedProject(tmp, features);

      // Capture initial line counts per file
      const linesBefore = new Map();
      for (const f of features) {
        const p = path.join(tmp, 'features', f.id + '.md');
        linesBefore.set(f.id, fs.readFileSync(p, 'utf8').split('\n').length);
      }
      const indexLinesBefore = fs
        .readFileSync(path.join(tmp, 'FEATURE-MAP.md'), 'utf8')
        .split('\n').length;

      // Run 50 updates: planned → prototyped on every feature
      for (const f of features) {
        const ok = fm.updateFeatureState(tmp, f.id, 'prototyped');
        assert.equal(ok, true, 'update must succeed for ' + f.id);
      }

      // Line counts must match exactly (surgical-patch invariant)
      for (const f of features) {
        const p = path.join(tmp, 'features', f.id + '.md');
        const linesAfter = fs.readFileSync(p, 'utf8').split('\n').length;
        assert.equal(linesAfter, linesBefore.get(f.id), 'no line drift in ' + f.id);
      }
      const indexLinesAfter = fs
        .readFileSync(path.join(tmp, 'FEATURE-MAP.md'), 'utf8')
        .split('\n').length;
      assert.equal(indexLinesAfter, indexLinesBefore, 'index line count stable');
    } finally {
      tearDown(tmp);
    }
  });
});

describe('F-089 sharded mode — preserves prose in per-feature files', () => {
  it('round-trip via migrate + updateFeatureState preserves Group markers and umlauts', () => {
    const tmp = setUp();
    try {
      const monolithic = `# Feature Map

## Features

### F-001: Tag Scanner [planned]

Some intro prose with umlauts: für, über, schön.

**Group:** Foundation

**Depends on:** F-002

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | extract tags |

## Legend
`;
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), monolithic);
      // Migrate
      const r = migrate.applyMigration(tmp);
      assert.equal(r.ok, true);
      // Update state
      const ok = fm.updateFeatureState(tmp, 'F-001', 'prototyped');
      assert.equal(ok, true);
      // Verify prose preserved
      const content = fs.readFileSync(path.join(tmp, 'features', 'F-001.md'), 'utf8');
      assert.match(content, /für, über, schön/);
      assert.match(content, /\*\*Group:\*\* Foundation/);
      assert.match(content, /\[prototyped\]/);
    } finally {
      tearDown(tmp);
    }
  });
});

describe('F-089 sharded mode — index round-trip via parseIndex', () => {
  it('every entry in the index has a matching per-feature file', () => {
    const tmp = setUp();
    try {
      const features = [
        { id: 'F-001', title: 'A', state: 'shipped', acs: [] },
        { id: 'F-Hub-Spotlight', title: 'B', state: 'planned', acs: [] },
        { id: 'F-DEPLOY', title: 'C', state: 'tested', acs: [] },
      ];
      buildShardedProject(tmp, features);
      const indexContent = fs.readFileSync(path.join(tmp, 'FEATURE-MAP.md'), 'utf8');
      const entries = shard.parseIndex(indexContent);
      assert.equal(entries.length, 3);
      for (const e of entries) {
        const filePath = path.join(tmp, 'features', e.id + '.md');
        assert.ok(fs.existsSync(filePath), 'feature file must exist for ' + e.id);
      }
    } finally {
      tearDown(tmp);
    }
  });
});
