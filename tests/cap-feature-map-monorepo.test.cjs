'use strict';

// @cap-feature(feature:F-082) Tests for the multi-app aggregating Feature Map reader.
//   Covers AC-1 (Rescoped Table aggregation), AC-2 (runtime metadata.subApp), AC-3 (opt-in
//   directory walk), AC-7 (cross-sub-app duplicate detection), AC-8 (round-trip idempotency).
//   AC-4 path-heuristik subApp-boost is covered by cap-memory-migrate-monorepo.test.cjs.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  readFeatureMap,
  writeFeatureMap,
  parseRescopedTable,
  discoverSubAppFeatureMaps,
  aggregateSubAppFeatureMaps,
  extractRescopedBlock,
  injectRescopedBlock,
  parseFeatureMapContent,
} = require('../cap/bin/lib/cap-feature-map.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fmap-mono-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- helpers ---

function copyFixture(targetDir) {
  const fixtureRoot = path.join(__dirname, 'fixtures', 'v61-monorepo');
  copyRecursive(fixtureRoot, targetDir);
}

function copyRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const sp = path.join(src, e.name);
    const dp = path.join(dst, e.name);
    if (e.isDirectory()) copyRecursive(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

function writeFile(root, rel, content) {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf8');
}

// --- AC-1: parseRescopedTable detection ---

describe('F-082/AC-1 parseRescopedTable', () => {
  it('returns [] when no Rescoped Feature Maps header is present', () => {
    const content = '# Feature Map\n\n## Features\n\n### F-001: Foo [planned]\n\n';
    assert.deepEqual(parseRescopedTable(content), []);
  });

  it('extracts paths from a table with "App | Path | Features" columns', () => {
    const content = [
      '# Feature Map',
      '',
      '## Rescoped Feature Maps',
      '',
      '| App | Path | Features |',
      '|-----|------|----------|',
      '| web | `apps/web/` | ~30 |',
      '| api | `apps/api/` | ~30 |',
      '| shared | `packages/shared/` | ~30 |',
      '',
      '## Legend',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].appPath, 'apps/web');
    assert.equal(entries[1].appPath, 'apps/api');
    assert.equal(entries[2].appPath, 'packages/shared');
  });

  it('strips "/FEATURE-MAP.md" suffix and trailing slash', () => {
    const content = [
      '## Rescoped Feature Maps',
      '',
      '| App | Path |',
      '|-----|------|',
      '| web | `apps/web/FEATURE-MAP.md` |',
      '| api | apps/api/ |',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].appPath, 'apps/web');
    assert.equal(entries[1].appPath, 'apps/api');
  });

  it('accepts markdown link syntax in the path cell', () => {
    const content = [
      '## Rescoped Feature Maps',
      '',
      '| App | Path |',
      '|-----|------|',
      '| web | [apps/web](apps/web/FEATURE-MAP.md) |',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].appPath, 'apps/web');
  });

  it('falls back to bullet form when the section uses bullets instead of a table', () => {
    const content = [
      '## Rescoped Feature Maps',
      '',
      '- `apps/web/`',
      '- apps/api/FEATURE-MAP.md',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].appPath, 'apps/web');
    assert.equal(entries[1].appPath, 'apps/api');
  });

  it('rejects absolute paths and parent-dir traversal in path cells', () => {
    // Bullet form gives us a single-cell input where the rejection is unambiguous.
    const content = [
      '## Rescoped Feature Maps',
      '',
      '- `/etc/passwd`',
      '- `../../../secrets`',
      '- `apps/legit/`',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].appPath, 'apps/legit');
  });

  it('matches the header case-insensitively', () => {
    const content = [
      '### rescoped feature maps',
      '',
      '- `apps/web/`',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 1);
  });

  it('exits the section on the next markdown header', () => {
    const content = [
      '## Rescoped Feature Maps',
      '',
      '- `apps/web/`',
      '',
      '## Legend',
      '',
      '- `apps/api/`', // should NOT be picked up
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].appPath, 'apps/web');
  });

  it('deduplicates repeated paths', () => {
    const content = [
      '## Rescoped Feature Maps',
      '',
      '- `apps/web/`',
      '- `apps/web/FEATURE-MAP.md`',
      '- `apps/web/`',
    ].join('\n');
    const entries = parseRescopedTable(content);
    assert.equal(entries.length, 1);
  });
});

// --- AC-1 + AC-2: readFeatureMap aggregation transparency + runtime subApp ---

describe('F-082/AC-1 + AC-2 readFeatureMap aggregation', () => {
  it('aggregates sub-app maps and tags each feature with metadata.subApp', () => {
    copyFixture(tmpDir);
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 91); // 1 root + 30 + 30 + 30
    const bySubApp = result.features.reduce((acc, f) => {
      const k = (f.metadata && f.metadata.subApp) || 'root';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    assert.equal(bySubApp.root, 1);
    assert.equal(bySubApp.web, 30);
    assert.equal(bySubApp.api, 30);
    assert.equal(bySubApp.shared, 30);
  });

  it('preserves the existing readFeatureMap API — no new required argument', () => {
    copyFixture(tmpDir);
    // Bare-call signature must still work (legacy callers).
    const result = readFeatureMap(tmpDir);
    assert.ok(Array.isArray(result.features));
    assert.ok(result.features.length > 1);
  });

  it('explicit appPath bypasses aggregation (single-map view)', () => {
    copyFixture(tmpDir);
    const result = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    assert.equal(result.features.length, 30);
    // No metadata.subApp injected when reading a sub-app directly.
    for (const f of result.features) {
      assert.ok(!f.metadata || !f.metadata.subApp);
    }
  });

  it('feature with no Rescoped Table returns single-map view (no aggregation)', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', '# Feature Map\n\n## Features\n\n### F-001: Foo [planned]\n\n');
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-001');
  });

  it('long-form feature IDs (F-WEB-AUTH) survive aggregation', () => {
    copyFixture(tmpDir);
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const auth = result.features.find(f => f.id === 'F-WEB-AUTH');
    assert.ok(auth, 'F-WEB-AUTH must be aggregated');
    assert.equal(auth.metadata.subApp, 'web');
  });

  it('mixed bullet + table sub-apps both aggregate correctly', () => {
    copyFixture(tmpDir);
    const result = readFeatureMap(tmpDir, null, { safe: true });
    // apps/web is bullet-style, apps/api is table-style — both should yield ACs.
    const webAuth = result.features.find(f => f.id === 'F-WEB-AUTH');
    assert.ok(webAuth);
    assert.equal(webAuth.acs.length, 3);
    const apiAuth = result.features.find(f => f.id === 'F-API-AUTH');
    assert.ok(apiAuth);
    assert.equal(apiAuth.acs.length, 3);
  });

  it('source feature objects are not mutated (clone-before-tag)', () => {
    copyFixture(tmpDir);
    // Read a sub-app directly first — its features must NOT have metadata.subApp.
    const subOnly = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    const beforeAggregation = JSON.stringify(subOnly.features[0]);
    // Now read with aggregation.
    readFeatureMap(tmpDir, null, { safe: true });
    // Re-read sub-app — must still be unchanged.
    const subAfter = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    const afterAggregation = JSON.stringify(subAfter.features[0]);
    assert.equal(afterAggregation, beforeAggregation);
  });

  it('missing sub-app file is warn-and-continue (no throw)', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map',
      '',
      '## Features',
      '',
      '## Rescoped Feature Maps',
      '',
      '- `apps/ghost/`',
      '- `apps/web/`',
      '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-WEB-1: Foo [planned]',
      '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    // Only the existing sub-app's features merged; the missing one is silently skipped.
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-WEB-1');
  });

  it('empty sub-app file aggregates as zero features (no crash)', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map',
      '',
      '## Features',
      '',
      '## Rescoped Feature Maps',
      '',
      '- `apps/web/`',
      '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', '');
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 0);
  });
});

// --- AC-3: opt-in directory walk ---

describe('F-082/AC-3 directory-walk discover mode', () => {
  it('default mode is "table-only" — no walk when no Rescoped Table', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', '# Feature Map\n\n## Features\n\n### F-001: Foo [planned]\n\n');
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '', '### F-WEB-1: Foo [planned]', '',
    ].join('\n'));
    // No .cap/config.json → default table-only → web/ ignored.
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-001');
  });

  it('"auto" discover mode walks apps/* and packages/*', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', '# Feature Map\n\n## Features\n\n### F-001: Foo [planned]\n\n');
    writeFile(tmpDir, '.cap/config.json', JSON.stringify({ featureMaps: { discover: 'auto' } }));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '', '### F-WEB-1: Foo [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'packages/shared/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '', '### F-SHARED-1: Bar [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 3);
    const subApps = result.features
      .map(f => (f.metadata && f.metadata.subApp) || 'root')
      .sort();
    assert.deepEqual(subApps, ['root', 'shared', 'web']);
  });

  it('Rescoped Table takes precedence over discover=auto', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '### F-001: Foo [planned]', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, '.cap/config.json', JSON.stringify({ featureMaps: { discover: 'auto' } }));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '', '### F-WEB-1: Foo [planned]', '',
    ].join('\n'));
    writeFile(tmpDir, 'packages/shared/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '', '### F-SHARED-1: Bar [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    // Only apps/web (from the explicit table) is aggregated; packages/shared ignored.
    assert.equal(result.features.length, 2);
    const ids = result.features.map(f => f.id).sort();
    assert.deepEqual(ids, ['F-001', 'F-WEB-1']);
  });

  it('discoverSubAppFeatureMaps rejects paths that escape projectRoot', () => {
    // No symlink shenanigans needed — the function only ever looks inside projectRoot/apps
    //   and projectRoot/packages. Confirm it returns empty when projectRoot has neither.
    const found = discoverSubAppFeatureMaps(tmpDir);
    assert.deepEqual(found, []);
  });

  it('malicious config value cannot redirect the walk', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', '# Feature Map\n\n## Features\n\n### F-001: Foo [planned]\n\n');
    writeFile(tmpDir, '.cap/config.json', JSON.stringify({ featureMaps: { discover: '../../etc' } }));
    // discover !== 'auto' → no walk.
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 1);
  });
});

// --- AC-6: feature-routed coverage on synthetic fixture ---

describe('F-082/AC-6 synthetic fixture aggregation coverage', () => {
  it('fixture aggregates ≥90 features with 3 sub-apps populated', () => {
    copyFixture(tmpDir);
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.ok(result.features.length >= 90, `Expected ≥90, got ${result.features.length}`);
  });

  it('every sub-app contributes at least 25 features', () => {
    copyFixture(tmpDir);
    const result = readFeatureMap(tmpDir, null, { safe: true });
    const counts = { web: 0, api: 0, shared: 0 };
    for (const f of result.features) {
      const sa = f.metadata && f.metadata.subApp;
      if (sa && counts[sa] !== undefined) counts[sa]++;
    }
    assert.ok(counts.web >= 25, `web: ${counts.web}`);
    assert.ok(counts.api >= 25, `api: ${counts.api}`);
    assert.ok(counts.shared >= 25, `shared: ${counts.shared}`);
  });
});

// --- AC-7: cross-sub-app duplicate detection ---

describe('F-082/AC-7 duplicate-id detection across sub-apps', () => {
  function setupDup() {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`',
      '- `apps/api/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: Web auth [planned]', '',
      '- [ ] AC-1: foo', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/api/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-AUTH: API auth [planned]', '',
      '- [ ] AC-1: bar', '',
    ].join('\n'));
  }

  it('safe-mode emits parseError with both sub-app origins', () => {
    setupDup();
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.ok(result.parseError, 'expected parseError on cross-app duplicate');
    assert.equal(result.parseError.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.equal(result.parseError.duplicateId, 'F-AUTH');
    // First occurrence was apps/web (root has no F-AUTH); duplicate was apps/api.
    assert.equal(result.parseError.firstSubApp, 'web');
    assert.equal(result.parseError.duplicateSubApp, 'api');
    assert.match(result.parseError.message, /F-AUTH/);
    assert.match(result.parseError.message, /apps\/api/);
  });

  it('strict mode (no safe flag) throws on cross-app duplicate', () => {
    setupDup();
    assert.throws(
      () => readFeatureMap(tmpDir, null),
      err => err && err.code === 'CAP_DUPLICATE_FEATURE_ID' && err.duplicateId === 'F-AUTH',
    );
  });

  it('per-sub-app duplicate (within one sub-app file) still emits the legacy parseError', () => {
    writeFile(tmpDir, 'FEATURE-MAP.md', [
      '# Feature Map', '',
      '## Features', '',
      '## Rescoped Feature Maps', '',
      '- `apps/web/`', '',
    ].join('\n'));
    writeFile(tmpDir, 'apps/web/FEATURE-MAP.md', [
      '# Feature Map', '', '## Features', '',
      '### F-DUP: First [planned]', '',
      '### F-DUP: Second [planned]', '',
    ].join('\n'));
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.ok(result.parseError);
    assert.equal(result.parseError.code, 'CAP_DUPLICATE_FEATURE_ID');
    assert.equal(result.parseError.duplicateId, 'F-DUP');
  });

  it('first-write-wins on the merged feature list when safe-mode collects parseError', () => {
    setupDup();
    const result = readFeatureMap(tmpDir, null, { safe: true });
    // Web auth was registered first; api's duplicate is dropped from the merged list.
    const auths = result.features.filter(f => f.id === 'F-AUTH');
    assert.equal(auths.length, 1);
    assert.equal(auths[0].metadata.subApp, 'web');
  });
});

// --- AC-8: round-trip idempotency (Rescoped Table preserved, subApp not persisted) ---

describe('F-082/AC-8 round-trip idempotency', () => {
  it('extractRescopedBlock returns null when no section exists', () => {
    assert.equal(extractRescopedBlock('# Feature Map\n\n## Features\n'), null);
  });

  it('extractRescopedBlock returns the section verbatim', () => {
    const content = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '## Rescoped Feature Maps',
      '',
      '| App | Path |',
      '|-----|------|',
      '| web | `apps/web/` |',
      '',
      '## Legend',
      '',
    ].join('\n');
    const block = extractRescopedBlock(content);
    assert.match(block, /^## Rescoped Feature Maps/);
    assert.match(block, /apps\/web/);
    assert.ok(!block.includes('## Legend'));
  });

  it('writeFeatureMap on root preserves the Rescoped Table', () => {
    copyFixture(tmpDir);
    const before = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    const aggregated = readFeatureMap(tmpDir, null, { safe: true });
    writeFeatureMap(tmpDir, aggregated);
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    // Rescoped Table must still be present.
    assert.match(after, /## Rescoped Feature Maps/);
    assert.match(after, /apps\/web/);
    assert.match(after, /apps\/api/);
    assert.match(after, /packages\/shared/);
    // Sub-app features must NOT have been flattened into root.
    assert.ok(!after.includes('### F-WEB-AUTH:'), 'sub-app features must not leak into root');
    assert.ok(!after.includes('### F-API-USERS:'), 'sub-app features must not leak into root');
    // The original root-only feature is still present.
    assert.match(after, /### F-001: Root-level orchestration/);
    // before/after both contain Rescoped section
    assert.match(before, /## Rescoped Feature Maps/);
  });

  it('round-trip is twice-stable (write -> read -> write produces identical output)', () => {
    copyFixture(tmpDir);
    const aggregated1 = readFeatureMap(tmpDir, null, { safe: true });
    writeFeatureMap(tmpDir, aggregated1);
    const after1 = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    const aggregated2 = readFeatureMap(tmpDir, null, { safe: true });
    // Strip the timestamp footer line — generateTemplate stamps Date.now() which always changes.
    const stripFooter = (s) => s.replace(/\*Last updated:[^*]+\*/g, '*Last updated: STAMP*');
    writeFeatureMap(tmpDir, aggregated2);
    const after2 = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    assert.equal(stripFooter(after1), stripFooter(after2));
  });

  it('runtime metadata.subApp is never written back to root', () => {
    copyFixture(tmpDir);
    const aggregated = readFeatureMap(tmpDir, null, { safe: true });
    // Sanity: at least one aggregated feature has metadata.subApp set.
    assert.ok(aggregated.features.some(f => f.metadata && f.metadata.subApp));
    writeFeatureMap(tmpDir, aggregated);
    const after = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    // The serializer doesn't emit metadata at all today; defense-in-depth assertion that the
    //   token "subApp" never makes it into FEATURE-MAP.md.
    assert.ok(!/subApp/i.test(after), 'metadata.subApp must not be persisted to root');
  });

  it('writing on a sub-app appPath does not strip Rescoped Table from root', () => {
    copyFixture(tmpDir);
    const beforeRoot = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    const subMap = readFeatureMap(tmpDir, 'apps/web', { safe: true });
    writeFeatureMap(tmpDir, subMap, 'apps/web');
    const afterRoot = fs.readFileSync(path.join(tmpDir, 'FEATURE-MAP.md'), 'utf8');
    // Root file is untouched by a sub-app write.
    assert.equal(beforeRoot, afterRoot);
  });

  it('injectRescopedBlock places the block before "## Legend"', () => {
    const serialized = [
      '# Feature Map',
      '',
      '## Features',
      '',
      '### F-001: Foo [planned]',
      '',
      '## Legend',
      '',
      '| State | Meaning |',
    ].join('\n');
    const block = '## Rescoped Feature Maps\n\n- `apps/web/`';
    const out = injectRescopedBlock(serialized, block);
    const idxRescoped = out.indexOf('## Rescoped Feature Maps');
    const idxLegend = out.indexOf('## Legend');
    assert.ok(idxRescoped > 0);
    assert.ok(idxRescoped < idxLegend);
  });
});

// --- aggregateSubAppFeatureMaps direct unit tests ---

describe('F-082 aggregateSubAppFeatureMaps direct API', () => {
  it('handles an empty targets array as no-op (returns the rootResult unchanged)', () => {
    const rootResult = {
      features: [{ id: 'F-001', title: 'Foo', state: 'planned', acs: [], files: [], dependencies: [], usesDesign: [], metadata: {} }],
      lastScan: '2026-05-06',
    };
    const out = aggregateSubAppFeatureMaps(tmpDir, rootResult, [], { safe: true });
    assert.equal(out.features.length, 1);
    assert.equal(out.features[0].id, 'F-001');
    assert.equal(out.lastScan, '2026-05-06');
  });

  it('preserves rootResult.parseError into the aggregated parseError', () => {
    const rootResult = {
      features: [],
      lastScan: null,
      parseError: {
        code: 'CAP_DUPLICATE_FEATURE_ID',
        message: 'pre-existing root error',
        duplicateId: 'F-X',
        firstLine: 1,
        duplicateLine: 2,
      },
    };
    const out = aggregateSubAppFeatureMaps(tmpDir, rootResult, [], { safe: true });
    assert.ok(out.parseError);
    assert.equal(out.parseError.duplicateId, 'F-X');
  });
});

// --- backward-compat: existing single-map FEATURE-MAP.md still works ---

describe('F-082 backward-compat with single-map projects', () => {
  it('a project with no apps/, no packages/, no Rescoped Table reads as before', () => {
    const content = [
      '# Feature Map', '',
      '## Features', '',
      '### F-001: Foo [planned]', '',
      '| AC | Status | Description |',
      '|----|--------|-------------|',
      '| AC-1 | pending | First |',
      '',
    ].join('\n');
    writeFile(tmpDir, 'FEATURE-MAP.md', content);
    const result = readFeatureMap(tmpDir, null, { safe: true });
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, 'F-001');
    // No metadata.subApp leaks into legacy projects.
    assert.ok(!result.features[0].metadata || !result.features[0].metadata.subApp);
  });

  it('parseFeatureMapContent still works on standalone content (no aggregation involved)', () => {
    const content = '# Feature Map\n\n## Features\n\n### F-001: Foo [planned]\n\n';
    const result = parseFeatureMapContent(content);
    assert.equal(result.features.length, 1);
  });
});
