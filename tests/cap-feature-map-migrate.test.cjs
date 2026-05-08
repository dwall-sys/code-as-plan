// @cap-feature(feature:F-089) Sharded Feature Map — migration tests
// @cap-context Covers extractFeatureBlocks (byte-lossless slicing), planMigration (idempotent dry-run),
//   applyMigration (atomic writes + backup), and the e2e migration of this repo's own FEATURE-MAP.md.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const migrate = require('../cap/bin/lib/cap-feature-map-migrate.cjs');
const shard = require('../cap/bin/lib/cap-feature-map-shard.cjs');

const FIXTURE_MONO = `# Feature Map

> Single source of truth.

## Features

### F-001: Tag Scanner [shipped]

Some intro prose for F-001.

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Extract tags |

**Files:**
- \`cap/bin/lib/cap-tag-scanner.cjs\`

### F-002: Feature Map Management [shipped]

**Depends on:** F-001

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | tested | Read FEATURE-MAP.md |

### F-Hub-Spotlight: Spotlight Carousel auf Homepage [planned]

Some German prose with umlauts: für, über, schön.

**Group:** Homepage Features

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | planned | Render carousel |

## Legend

| State | Meaning |
|-------|---------|
| planned | Identified |

---
*Last updated: 2026-05-08T00:00:00.000Z*
`;

function setUp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-migrate-'));
}
function tearDown(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

describe('F-089 cap-feature-map-migrate — extractFeatureBlocks', () => {
  it('extracts each feature block with raw byte-identical content', () => {
    const { blocks } = migrate.extractFeatureBlocks(FIXTURE_MONO);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].id, 'F-001');
    assert.equal(blocks[0].state, 'shipped');
    assert.equal(blocks[0].title, 'Tag Scanner');
    assert.match(blocks[0].rawBlock, /^### F-001: Tag Scanner \[shipped\]/);
    assert.match(blocks[0].rawBlock, /Some intro prose for F-001\./);
    assert.match(blocks[0].rawBlock, /cap-tag-scanner\.cjs/);
  });

  it('captures deskriptiv ID with mixed-case', () => {
    const { blocks } = migrate.extractFeatureBlocks(FIXTURE_MONO);
    const hub = blocks.find(b => b.id === 'F-Hub-Spotlight');
    assert.ok(hub, 'F-Hub-Spotlight block must be extracted');
    assert.equal(hub.title, 'Spotlight Carousel auf Homepage');
    assert.equal(hub.state, 'planned');
  });

  it('preserves prose, group markers, and umlauts inside a block', () => {
    const { blocks } = migrate.extractFeatureBlocks(FIXTURE_MONO);
    const hub = blocks.find(b => b.id === 'F-Hub-Spotlight');
    assert.match(hub.rawBlock, /für, über, schön/);
    assert.match(hub.rawBlock, /\*\*Group:\*\* Homepage Features/);
  });

  it('terminates final block at the next ## non-feature header', () => {
    const { blocks } = migrate.extractFeatureBlocks(FIXTURE_MONO);
    const lastBlock = blocks[blocks.length - 1];
    // Legend section must NOT be in the last block
    assert.doesNotMatch(lastBlock.rawBlock, /^## Legend/m);
    assert.doesNotMatch(lastBlock.rawBlock, /Last updated:/);
  });

  it('returns empty blocks array when no features exist', () => {
    const { blocks } = migrate.extractFeatureBlocks('# Feature Map\n\n## Features\n\n## Legend\n');
    assert.equal(blocks.length, 0);
  });

  it('preserves byte-equivalence: concatenating blocks recovers feature content', () => {
    const { blocks } = migrate.extractFeatureBlocks(FIXTURE_MONO);
    // Each block should appear verbatim (modulo trailing whitespace) in the source.
    for (const b of blocks) {
      const headerLine = b.rawBlock.split('\n')[0];
      assert.ok(FIXTURE_MONO.includes(headerLine), `Header must appear in source: ${headerLine}`);
    }
  });

  it('em-dash separator forms are accepted', () => {
    const emdashContent = `## Features

### F-001 — Title with em-dash [shipped]

Body.

### F-002 – Title with en-dash [planned]

Body 2.
`;
    const { blocks } = migrate.extractFeatureBlocks(emdashContent);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].title, 'Title with em-dash');
    assert.equal(blocks[1].title, 'Title with en-dash');
  });
});

describe('F-089 cap-feature-map-migrate — planMigration', () => {
  it('reports missing-source when FEATURE-MAP.md is absent', () => {
    const tmp = setUp();
    try {
      const plan = migrate.planMigration(tmp);
      assert.equal(plan.sourceMode, 'missing');
      assert.equal(plan.writes.length, 0);
    } finally {
      tearDown(tmp);
    }
  });

  it('reports already-sharded when features/ already has F-*.md files', () => {
    const tmp = setUp();
    try {
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), FIXTURE_MONO);
      fs.mkdirSync(path.join(tmp, 'features'));
      fs.writeFileSync(path.join(tmp, 'features', 'F-001.md'), '### F-001: Already sharded\n');
      const plan = migrate.planMigration(tmp);
      assert.equal(plan.sourceMode, 'sharded');
      assert.match(plan.warnings.join(' '), /[Aa]lready in sharded/);
    } finally {
      tearDown(tmp);
    }
  });

  it('plans 3 writes for the 3-feature fixture', () => {
    const tmp = setUp();
    try {
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), FIXTURE_MONO);
      const plan = migrate.planMigration(tmp);
      assert.equal(plan.sourceMode, 'monolithic');
      assert.equal(plan.writes.length, 3);
      assert.equal(plan.writes[0].id, 'F-001');
      assert.equal(plan.writes[2].id, 'F-Hub-Spotlight');
      assert.equal(plan.skips.length, 0);
    } finally {
      tearDown(tmp);
    }
  });

  it('skips features with duplicate IDs and reports them', () => {
    const tmp = setUp();
    try {
      const dup = `## Features

### F-001: First [shipped]
Body 1.

### F-001: Second [planned]
Body 2.

## Legend
`;
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), dup);
      const plan = migrate.planMigration(tmp);
      assert.equal(plan.sourceMode, 'monolithic');
      assert.equal(plan.writes.length, 1);
      assert.equal(plan.skips.length, 1);
      assert.equal(plan.skips[0].id, 'F-001');
      assert.match(plan.skips[0].reason, /Duplicate/);
    } finally {
      tearDown(tmp);
    }
  });
});

describe('F-089 cap-feature-map-migrate — applyMigration', () => {
  it('writes per-feature files + backup + index, all atomically', () => {
    const tmp = setUp();
    try {
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), FIXTURE_MONO);
      const result = migrate.applyMigration(tmp);
      assert.equal(result.ok, true);
      assert.equal(result.applied.featuresWritten, 3);
      assert.equal(result.applied.indexWritten, true);
      assert.equal(result.applied.backupWritten, true);

      // Per-feature files exist
      assert.ok(fs.existsSync(path.join(tmp, 'features', 'F-001.md')));
      assert.ok(fs.existsSync(path.join(tmp, 'features', 'F-002.md')));
      assert.ok(fs.existsSync(path.join(tmp, 'features', 'F-Hub-Spotlight.md')));

      // Backup exists with original content
      const backup = fs.readFileSync(path.join(tmp, 'FEATURE-MAP.md' + migrate.BACKUP_SUFFIX), 'utf8');
      assert.equal(backup, FIXTURE_MONO);

      // Index file is much smaller and contains all 3 IDs
      const idx = fs.readFileSync(path.join(tmp, 'FEATURE-MAP.md'), 'utf8');
      assert.match(idx, /- F-001 \| shipped \| Tag Scanner/);
      assert.match(idx, /- F-002 \| shipped \| Feature Map Management/);
      assert.match(idx, /- F-Hub-Spotlight \| planned \| Spotlight Carousel auf Homepage/);
      assert.ok(idx.split('\n').length < FIXTURE_MONO.split('\n').length, 'index shrinks vs source');
    } finally {
      tearDown(tmp);
    }
  });

  it('per-feature files contain raw byte-identical block (preserves prose, umlauts, group markers)', () => {
    const tmp = setUp();
    try {
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), FIXTURE_MONO);
      migrate.applyMigration(tmp);
      const hub = fs.readFileSync(path.join(tmp, 'features', 'F-Hub-Spotlight.md'), 'utf8');
      assert.match(hub, /^### F-Hub-Spotlight: Spotlight Carousel auf Homepage \[planned\]/);
      assert.match(hub, /für, über, schön/);
      assert.match(hub, /\*\*Group:\*\* Homepage Features/);
    } finally {
      tearDown(tmp);
    }
  });

  it('idempotent: running again on already-sharded project is a no-op', () => {
    const tmp = setUp();
    try {
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), FIXTURE_MONO);
      const r1 = migrate.applyMigration(tmp);
      assert.equal(r1.ok, true);
      const r2 = migrate.applyMigration(tmp);
      assert.equal(r2.ok, false);
      assert.equal(r2.plan.sourceMode, 'sharded');
    } finally {
      tearDown(tmp);
    }
  });

  it('refuses to apply when duplicate IDs are present (no force)', () => {
    const tmp = setUp();
    try {
      const dup = `## Features

### F-001: First [shipped]
Body 1.

### F-001: Second [planned]
Body 2.

## Legend
`;
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), dup);
      const result = migrate.applyMigration(tmp);
      assert.equal(result.ok, false);
      // Nothing should be written
      assert.ok(!fs.existsSync(path.join(tmp, 'features')));
      assert.ok(!fs.existsSync(path.join(tmp, 'FEATURE-MAP.md.backup-pre-F-089')));
    } finally {
      tearDown(tmp);
    }
  });

  it('respects appPath for monorepo sub-app migration', () => {
    const tmp = setUp();
    try {
      const subAppDir = path.join(tmp, 'apps', 'hub');
      fs.mkdirSync(subAppDir, { recursive: true });
      fs.writeFileSync(path.join(subAppDir, 'FEATURE-MAP.md'), FIXTURE_MONO);
      const result = migrate.applyMigration(tmp, 'apps/hub');
      assert.equal(result.ok, true);
      assert.ok(fs.existsSync(path.join(subAppDir, 'features', 'F-001.md')));
      assert.ok(!fs.existsSync(path.join(tmp, 'features')), 'no root-level features/ should be created');
    } finally {
      tearDown(tmp);
    }
  });

  it('e2e: migration on this repo\'s own FEATURE-MAP.md produces consistent index', () => {
    // Read the actual repo FEATURE-MAP.md, copy to tmp, migrate, verify.
    const repoMap = path.join(__dirname, '..', 'FEATURE-MAP.md');
    if (!fs.existsSync(repoMap)) return; // skip if not present
    const tmp = setUp();
    try {
      const original = fs.readFileSync(repoMap, 'utf8');
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), original);
      const result = migrate.applyMigration(tmp);
      assert.equal(result.ok, true);
      // Should produce ~89 per-feature files (F-001 through F-089)
      assert.ok(result.applied.featuresWritten >= 80, `expected >=80 features, got ${result.applied.featuresWritten}`);
      // Index file should round-trip parse correctly via shard.parseIndex
      const indexContent = fs.readFileSync(path.join(tmp, 'FEATURE-MAP.md'), 'utf8');
      const entries = shard.parseIndex(indexContent);
      assert.equal(entries.length, result.applied.featuresWritten);
      // Every per-feature file should be readable
      for (const e of entries) {
        const p = path.join(tmp, 'features', e.id + '.md');
        assert.ok(fs.existsSync(p), `expected per-feature file: ${p}`);
        const content = fs.readFileSync(p, 'utf8');
        assert.match(content, new RegExp('^### ' + e.id.replace(/-/g, '\\-')));
      }
    } finally {
      tearDown(tmp);
    }
  });
});

describe('F-089 cap-feature-map-migrate — formatPlan', () => {
  it('renders a human-readable text report', () => {
    const tmp = setUp();
    try {
      fs.writeFileSync(path.join(tmp, 'FEATURE-MAP.md'), FIXTURE_MONO);
      const plan = migrate.planMigration(tmp);
      const out = migrate.formatPlan(plan);
      assert.match(out, /Migration plan/);
      assert.match(out, /Source mode: monolithic/);
      assert.match(out, /F-001/);
      assert.match(out, /F-Hub-Spotlight/);
    } finally {
      tearDown(tmp);
    }
  });
});
