'use strict';

// @cap-feature(feature:F-047) Tests for cap-migrate-tags.cjs — fragmented-to-unified converter.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const migrate = require('../cap/bin/lib/cap-migrate-tags.cjs');
const anchor = require('../cap/bin/lib/cap-anchor.cjs');

// ---------------------------------------------------------------------------
// commentStyleForFile
// ---------------------------------------------------------------------------

describe('commentStyleForFile', () => {
  it('picks line style for Python/Ruby/Shell', () => {
    assert.strictEqual(migrate.commentStyleForFile('x.py'), 'line');
    assert.strictEqual(migrate.commentStyleForFile('x.rb'), 'line');
    assert.strictEqual(migrate.commentStyleForFile('x.sh'), 'line');
  });

  it('picks html style for HTML/XML/Vue/Markdown', () => {
    assert.strictEqual(migrate.commentStyleForFile('x.html'), 'html');
    assert.strictEqual(migrate.commentStyleForFile('x.xml'), 'html');
    assert.strictEqual(migrate.commentStyleForFile('x.md'), 'html');
  });

  it('defaults to block for JS/TS/CSS', () => {
    assert.strictEqual(migrate.commentStyleForFile('x.cjs'), 'block');
    assert.strictEqual(migrate.commentStyleForFile('x.ts'), 'block');
    assert.strictEqual(migrate.commentStyleForFile('x.css'), 'block');
  });
});

// ---------------------------------------------------------------------------
// consolidateGroup
// ---------------------------------------------------------------------------

describe('consolidateGroup', () => {
  it('returns null when no ACs and no primary role', () => {
    const r = migrate.consolidateGroup('F-001', [
      { type: 'feature', metadata: { feature: 'F-001' } },
    ]);
    assert.strictEqual(r, null);
  });

  it('collects ACs from todo tags', () => {
    const r = migrate.consolidateGroup('F-001', [
      { type: 'todo', metadata: { ac: 'F-001/AC-2' } },
      { type: 'todo', metadata: { ac: 'F-001/AC-1' } },
    ]);
    assert.strictEqual(r.feature, 'F-001');
    assert.deepStrictEqual(r.acs, ['AC-1', 'AC-2']); // sorted numerically
  });

  it('picks up role:primary from @cap-feature tag', () => {
    const r = migrate.consolidateGroup('F-001', [
      { type: 'feature', metadata: { feature: 'F-001', primary: true } },
      { type: 'todo', metadata: { ac: 'F-001/AC-1' } },
    ]);
    assert.strictEqual(r.role, 'primary');
  });

  it('handles bare AC-N format (no F-XXX prefix)', () => {
    const r = migrate.consolidateGroup('F-050', [
      { type: 'todo', metadata: { ac: 'AC-3' } },
    ]);
    assert.deepStrictEqual(r.acs, ['AC-3']);
  });

  it('ignores duplicate AC references', () => {
    const r = migrate.consolidateGroup('F-001', [
      { type: 'todo', metadata: { ac: 'F-001/AC-1' } },
      { type: 'todo', metadata: { ac: 'F-001/AC-1' } },
    ]);
    assert.deepStrictEqual(r.acs, ['AC-1']);
  });

  it('sorts AC ids numerically (AC-2 before AC-10)', () => {
    const r = migrate.consolidateGroup('F-001', [
      { type: 'todo', metadata: { ac: 'F-001/AC-10' } },
      { type: 'todo', metadata: { ac: 'F-001/AC-2' } },
    ]);
    assert.deepStrictEqual(r.acs, ['AC-2', 'AC-10']);
  });
});

// ---------------------------------------------------------------------------
// findInsertionIndex
// ---------------------------------------------------------------------------

describe('findInsertionIndex', () => {
  it('returns 0 on empty file', () => {
    assert.strictEqual(migrate.findInsertionIndex([]), 0);
  });

  it('skips shebang line', () => {
    const lines = ['#!/usr/bin/env node', 'const x = 1;'];
    assert.strictEqual(migrate.findInsertionIndex(lines), 1);
  });

  it('skips use strict directive', () => {
    const lines = ["'use strict';", 'const x = 1;'];
    assert.strictEqual(migrate.findInsertionIndex(lines), 1);
  });

  it('skips shebang + use strict + blank line', () => {
    const lines = ['#!/usr/bin/env node', '', "'use strict';", '', 'const x = 1;'];
    assert.strictEqual(migrate.findInsertionIndex(lines), 4);
  });

  it('inserts at line 0 when file starts with code', () => {
    const lines = ['const x = 1;', 'const y = 2;'];
    assert.strictEqual(migrate.findInsertionIndex(lines), 0);
  });
});

// ---------------------------------------------------------------------------
// planFileMigration (integration with real temp files)
// ---------------------------------------------------------------------------

describe('planFileMigration', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-migrate-'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('inserts a unified anchor in a file with fragmented tags', () => {
    const filePath = path.join(tmp, 'src', 'a.cjs');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, [
      "'use strict';",
      '',
      '// @cap-feature(feature:F-001, primary:true) A',
      '// @cap-todo(ac:F-001/AC-1) Parse X',
      'function a() {}',
      '',
    ].join('\n'));

    const tags = [
      { type: 'feature', file: 'src/a.cjs', line: 3, metadata: { feature: 'F-001', primary: true } },
      { type: 'todo', file: 'src/a.cjs', line: 4, metadata: { ac: 'F-001/AC-1' } },
    ];
    const r = migrate.planFileMigration(filePath, tmp, tags);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.reason, 'inserted');
    assert.ok(r.anchorBlock.includes('@cap feature:F-001 acs:[AC-1] role:primary'));
    assert.deepStrictEqual(r.consolidatedFeatures, ['F-001']);
    assert.deepStrictEqual(r.consolidatedAcs, ['F-001/AC-1']);
    assert.ok(r.newContent.includes('@cap feature:F-001'));
    // Legacy tags must still be present (additive migration)
    assert.ok(r.newContent.includes('@cap-feature(feature:F-001, primary:true)'));
    assert.ok(r.newContent.includes('@cap-todo(ac:F-001/AC-1)'));
  });

  it('skips file that already has a unified anchor', () => {
    const filePath = path.join(tmp, 'x.cjs');
    fs.writeFileSync(filePath, '/* @cap feature:F-001 */\nconst x = 1;\n');
    const r = migrate.planFileMigration(filePath, tmp, []);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.reason, 'already-has-anchor');
  });

  it('skips file with no feature-bound tags', () => {
    const filePath = path.join(tmp, 'x.cjs');
    fs.writeFileSync(filePath, '// plain code\n');
    const r = migrate.planFileMigration(filePath, tmp, []);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.reason, 'no-feature-tags');
  });

  it('emits one anchor per distinct feature when a file tags multiple features', () => {
    const filePath = path.join(tmp, 'multi.cjs');
    fs.writeFileSync(filePath, "'use strict';\n// a\n// b\n");
    const tags = [
      { type: 'feature', file: 'multi.cjs', line: 1, metadata: { feature: 'F-001' } },
      { type: 'todo', file: 'multi.cjs', line: 1, metadata: { ac: 'F-001/AC-1' } },
      { type: 'feature', file: 'multi.cjs', line: 2, metadata: { feature: 'F-002', primary: true } },
      { type: 'todo', file: 'multi.cjs', line: 2, metadata: { ac: 'F-002/AC-1' } },
    ];
    const r = migrate.planFileMigration(filePath, tmp, tags);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(r.consolidatedFeatures, ['F-001', 'F-002']);
    assert.strictEqual((r.anchorBlock.match(/@cap feature:/g) || []).length, 2);
  });

  it('picks python (line) comment style for .py files', () => {
    const filePath = path.join(tmp, 'x.py');
    fs.writeFileSync(filePath, 'x = 1\n');
    const tags = [
      { type: 'feature', file: 'x.py', line: 1, metadata: { feature: 'F-001' } },
      { type: 'todo', file: 'x.py', line: 1, metadata: { ac: 'F-001/AC-1' } },
    ];
    const r = migrate.planFileMigration(filePath, tmp, tags);
    assert.ok(r.anchorBlock.startsWith('# @cap'));
  });

  it('picks html comment style for .html files', () => {
    const filePath = path.join(tmp, 'x.html');
    fs.writeFileSync(filePath, '<html></html>\n');
    const tags = [
      { type: 'feature', file: 'x.html', line: 1, metadata: { feature: 'F-001' } },
      { type: 'todo', file: 'x.html', line: 1, metadata: { ac: 'F-001/AC-1' } },
    ];
    const r = migrate.planFileMigration(filePath, tmp, tags);
    assert.ok(r.anchorBlock.startsWith('<!-- @cap'));
  });

  it('handles read errors gracefully', () => {
    const r = migrate.planFileMigration(path.join(tmp, 'does-not-exist.cjs'), tmp, []);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.reason, 'read-error');
  });

  it('infers feature from ac:F-XXX/AC-N even without @cap-feature tag', () => {
    const filePath = path.join(tmp, 'helper.cjs');
    fs.writeFileSync(filePath, 'function h() {}\n');
    const tags = [
      { type: 'todo', file: 'helper.cjs', line: 1, metadata: { ac: 'F-050/AC-2' } },
    ];
    const r = migrate.planFileMigration(filePath, tmp, tags);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(r.consolidatedFeatures, ['F-050']);
    assert.deepStrictEqual(r.consolidatedAcs, ['F-050/AC-2']);
  });
});

// ---------------------------------------------------------------------------
// planProjectMigration + applyMigrations integration
// ---------------------------------------------------------------------------

describe('planProjectMigration + applyMigrations', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-migrate-project-'));
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'src', 'a.cjs'), [
      "// @cap-feature(feature:F-001) A",
      "// @cap-todo(ac:F-001/AC-1) X",
      'function a() {}',
    ].join('\n'));
    fs.writeFileSync(path.join(tmp, 'src', 'b.cjs'), [
      "// @cap-feature(feature:F-002, primary:true) B",
      "// @cap-todo(ac:F-002/AC-1) Y",
      'function b() {}',
    ].join('\n'));
    fs.writeFileSync(path.join(tmp, 'src', 'c.cjs'), 'function c() {}\n');
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('plans migrations for all tagged files (sorted by file path)', () => {
    const results = migrate.planProjectMigration(tmp);
    assert.ok(results.length >= 2);
    const changed = results.filter((r) => r.changed);
    assert.strictEqual(changed.length, 2, 'a.cjs + b.cjs should be changed, c.cjs has no tags');
    assert.strictEqual(changed[0].file, path.join('src', 'a.cjs'));
    assert.strictEqual(changed[1].file, path.join('src', 'b.cjs'));
  });

  it('applyMigrations writes only changed files', () => {
    const results = migrate.planProjectMigration(tmp);
    const out = migrate.applyMigrations(results, tmp);
    assert.strictEqual(out.written.length, 2);
    // a.cjs should now contain the unified anchor
    const a = fs.readFileSync(path.join(tmp, 'src', 'a.cjs'), 'utf8');
    assert.ok(a.includes('@cap feature:F-001'));
  });

  it('is idempotent: second run has no changes (already-has-anchor)', () => {
    const r1 = migrate.planProjectMigration(tmp);
    migrate.applyMigrations(r1, tmp);
    const r2 = migrate.planProjectMigration(tmp);
    const changed2 = r2.filter((r) => r.changed);
    assert.strictEqual(changed2.length, 0, 'second pass must detect existing anchors');
  });

  it('after migration, scanner + anchor expansion yield same AC references', () => {
    const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');

    const legacyTags = scanner.scanDirectory(tmp, { unifiedAnchors: false });
    const legacyAcs = new Set(
      legacyTags
        .filter((t) => t.type === 'todo' && t.metadata && t.metadata.ac)
        .map((t) => t.metadata.ac)
    );

    migrate.applyMigrations(migrate.planProjectMigration(tmp), tmp);

    const unifiedTags = scanner.scanDirectory(tmp, { unifiedAnchors: true });
    const unifiedAcs = new Set(
      unifiedTags
        .filter((t) => t.type === 'todo' && t.metadata && t.metadata.ac)
        .map((t) => t.metadata.ac)
    );

    // Unified scan must include everything the legacy scan had (plus possible duplicates
    // from the still-present legacy tags, which we deduplicate via Set).
    for (const ac of legacyAcs) {
      assert.ok(unifiedAcs.has(ac), `AC ${ac} missing after migration+re-scan`);
    }
  });
});

// ---------------------------------------------------------------------------
// formatMigrationReport
// ---------------------------------------------------------------------------

describe('formatMigrationReport', () => {
  it('renders changed/skipped summary', () => {
    const out = migrate.formatMigrationReport([
      {
        file: 'src/a.cjs',
        changed: true,
        anchorBlock: '/* @cap feature:F-001 acs:[AC-1] */',
        consolidatedFeatures: ['F-001'],
        consolidatedAcs: ['F-001/AC-1'],
        reason: 'inserted',
      },
      { file: 'src/b.cjs', changed: false, reason: 'already-has-anchor' },
      { file: 'src/c.cjs', changed: false, reason: 'no-feature-tags' },
    ]);
    assert.ok(out.includes('1 file(s) would be updated'));
    assert.ok(out.includes('src/a.cjs'));
    assert.ok(out.includes('@cap feature:F-001 acs:[AC-1]'));
    assert.ok(out.includes('1 file(s) already use unified anchors'));
    assert.ok(out.includes('1 file(s) had no feature-bound tags'));
  });
});

// ---------------------------------------------------------------------------
// Scanner integration: unified scan includes anchor tags
// ---------------------------------------------------------------------------

describe('scanner integration: unified scan includes anchor-expanded tags', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-migrate-scanner-'));
    fs.writeFileSync(path.join(tmp, 'a.cjs'), [
      '/* @cap feature:F-777 acs:[AC-1,AC-2] role:primary */',
      'function a() {}',
    ].join('\n'));
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('scanDirectory with unifiedAnchors=true picks up anchor tags', () => {
    const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
    const tags = scanner.scanDirectory(tmp, { unifiedAnchors: true });
    const features = tags.filter((t) => t.type === 'feature').map((t) => t.metadata.feature);
    assert.ok(features.includes('F-777'));
    const acs = tags.filter((t) => t.type === 'todo').map((t) => t.metadata.ac).sort();
    assert.deepStrictEqual(acs, ['F-777/AC-1', 'F-777/AC-2']);
  });

  it('scanDirectory with unifiedAnchors=false ignores anchor blocks entirely', () => {
    const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
    const tags = scanner.scanDirectory(tmp, { unifiedAnchors: false });
    // Legacy regex should NOT match `@cap ` with a space (it matches @cap-*).
    const hasAnchor = tags.some((t) => t.metadata && t.metadata.feature === 'F-777');
    assert.strictEqual(hasAnchor, false);
  });

  it('honours .cap/config.json opt-in when options.unifiedAnchors is omitted', () => {
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ unifiedAnchors: { enabled: true } })
    );
    const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
    const tags = scanner.scanDirectory(tmp);
    const hasAnchor = tags.some((t) => t.metadata && t.metadata.feature === 'F-777');
    assert.strictEqual(hasAnchor, true);
  });

  it('isUnifiedAnchorsEnabled returns true when config has enabled=true', () => {
    fs.mkdirSync(path.join(tmp, '.cap'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.cap', 'config.json'),
      JSON.stringify({ unifiedAnchors: { enabled: true } })
    );
    const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
    assert.strictEqual(scanner.isUnifiedAnchorsEnabled(tmp), true);
  });

  it('isUnifiedAnchorsEnabled returns false when flag missing', () => {
    const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
    assert.strictEqual(scanner.isUnifiedAnchorsEnabled(tmp), false);
  });
});
