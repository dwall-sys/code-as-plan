'use strict';

// @cap-feature(feature:F-086) Tests for cap-memory-prune.cjs:pruneGitignored (AC-3).
//   Validates that V5 monolith files and V6 platform/feature files get cleaned of entries
//   pointing at scope-filter-excluded files (build outputs, gitignored dirs, bundles).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const prune = require('../cap/bin/lib/cap-memory-prune.cjs');
const filter = require('../cap/bin/lib/cap-scope-filter.cjs');

function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-prune-gi-'));
  fs.mkdirSync(path.join(root, '.cap', 'memory'), { recursive: true });
  return root;
}

function rm(root) { fs.rmSync(root, { recursive: true, force: true }); }

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// --------------------------------------------------------------------------
// V5 monolith pruning

test('AC-3 V5: dry-run reports gitignored entries without writing', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), '.next/\nbuild/\n');
    const decisionsPath = path.join(root, '.cap', 'memory', 'decisions.md');
    fs.writeFileSync(decisionsPath, [
      '# Project Memory: Decisions',
      '',
      '### <a id="aaaa1111"></a>Use refresh tokens',
      '',
      '- **Date:** 2026-04-01',
      '- **Files:** `src/lib/auth.ts`',
      '- **Confidence:** 0.80',
      '- **Evidence:** 1',
      '- **Last Seen:** 2026-04-01T10:00:00Z',
      '',
      '### <a id="bbbb2222"></a>Build artifact decision',
      '',
      '- **Date:** 2026-04-02',
      '- **Files:** `.next/dev/server/chunks/abc.js`',
      '- **Confidence:** 0.50',
      '- **Evidence:** 1',
      '- **Last Seen:** 2026-04-02T10:00:00Z',
      '',
      '### <a id="cccc3333"></a>Another bundle decision',
      '',
      '- **Date:** 2026-04-03',
      '- **Files:** `build/generated.js`',
      '- **Confidence:** 0.50',
      '- **Evidence:** 1',
      '- **Last Seen:** 2026-04-03T10:00:00Z',
      '',
    ].join('\n'));

    const result = prune.pruneGitignored(root);
    assert.equal(result.dryRun, true);
    assert.equal(result.v5RemovedTotal, 2, 'two .next/ + build/ entries should be flagged');
    // File on disk MUST be unchanged
    const after = fs.readFileSync(decisionsPath, 'utf8');
    assert.match(after, /Use refresh tokens/);
    assert.match(after, /Build artifact decision/, 'dry-run must NOT modify file');
  } finally {
    rm(root);
  }
});

test('AC-3 V5: --apply removes gitignored entries, preserves valid ones', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), '.next/\n');
    const decisionsPath = path.join(root, '.cap', 'memory', 'decisions.md');
    fs.writeFileSync(decisionsPath, [
      '# Project Memory: Decisions',
      '',
      '### <a id="aaaa1111"></a>Real source decision',
      '',
      '- **Date:** 2026-04-01',
      '- **Files:** `src/lib/auth.ts`',
      '- **Confidence:** 0.80',
      '- **Evidence:** 1',
      '- **Last Seen:** 2026-04-01T10:00:00Z',
      '',
      '### <a id="bbbb2222"></a>Bundle artefact decision',
      '',
      '- **Date:** 2026-04-02',
      '- **Files:** `.next/dev/server/chunks/abc.js`',
      '- **Confidence:** 0.50',
      '- **Evidence:** 1',
      '- **Last Seen:** 2026-04-02T10:00:00Z',
      '',
    ].join('\n'));

    const result = prune.pruneGitignored(root, { apply: true });
    assert.equal(result.dryRun, false);
    assert.equal(result.v5RemovedTotal, 1);
    const after = fs.readFileSync(decisionsPath, 'utf8');
    assert.match(after, /Real source decision/);
    assert.doesNotMatch(after, /Bundle artefact decision/);
  } finally {
    rm(root);
  }
});

test('AC-3 V5: entry with mixed in-scope + out-of-scope files is KEPT', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), '.next/\n');
    const decisionsPath = path.join(root, '.cap', 'memory', 'decisions.md');
    // An entry referencing both real source AND a bundle file should be preserved —
    // we only drop entries where ALL related files are out-of-scope.
    fs.writeFileSync(decisionsPath, [
      '# Project Memory: Decisions',
      '',
      '### <a id="aaaa1111"></a>Mixed-scope decision',
      '',
      '- **Date:** 2026-04-01',
      '- **Files:** `src/lib/auth.ts`, `.next/dev/server/chunks/x.js`',
      '- **Confidence:** 0.80',
      '- **Evidence:** 1',
      '- **Last Seen:** 2026-04-01T10:00:00Z',
      '',
    ].join('\n'));

    const result = prune.pruneGitignored(root, { apply: true });
    assert.equal(result.v5RemovedTotal, 0, 'mixed-scope entry must be kept (at least one in-scope file)');
  } finally {
    rm(root);
  }
});

test('AC-3 V5: missing memory file is graceful (no throw, no errors)', () => {
  const root = mkProject();
  try {
    const result = prune.pruneGitignored(root);
    assert.equal(result.v5RemovedTotal, 0);
    assert.equal(result.errors.length, 0);
  } finally {
    rm(root);
  }
});

// --------------------------------------------------------------------------
// V6 platform pruning

test('AC-3 V6: removes bullet lines pointing to gitignored paths', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), '.next/\n');
    const platformDir = path.join(root, '.cap', 'memory', 'platform');
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(path.join(platformDir, 'unassigned.md'), [
      '---',
      'topic: unassigned',
      '---',
      '',
      '# Platform: Unassigned',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions (from tags)',
      '- Real decision — `src/lib/auth.ts:120`',
      '- Bundle noise — `.next/dev/server/chunks/[root]_._.js:326`',
      '- Another bundle — `.next/server/chunks/abc.js:1500`',
      '- Real decision 2 — `src/components/Header.tsx:45`',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const result = prune.pruneGitignored(root, { apply: true });
    assert.equal(result.v6RemovedTotal, 2, 'two .next/ bullets should be removed');
    const after = fs.readFileSync(path.join(platformDir, 'unassigned.md'), 'utf8');
    assert.match(after, /Real decision —/);
    assert.match(after, /Real decision 2 —/);
    assert.doesNotMatch(after, /Bundle noise/);
    assert.doesNotMatch(after, /Another bundle/);
    // Auto-block markers must be preserved
    assert.match(after, /<!-- cap:auto:start -->/);
    assert.match(after, /<!-- cap:auto:end -->/);
  } finally {
    rm(root);
  }
});

test('AC-3 V6: bundle-detection (path probe) removes commit ed Webpack chunks even without gitignore', () => {
  const root = mkProject();
  try {
    // No .gitignore for .next/, so gitignore alone wouldn't catch this
    const platformDir = path.join(root, '.cap', 'memory', 'platform');
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(path.join(platformDir, 'unassigned.md'), [
      '# Platform',
      '<!-- cap:auto:start -->',
      '- Real source — `src/foo.ts:10`',
      '- Webpack chunk — `dist/chunks/__abc._.js:200`',
      '<!-- cap:auto:end -->',
    ].join('\n'));

    const result = prune.pruneGitignored(root, { apply: true });
    assert.equal(result.v6RemovedTotal, 1, 'bundle path should still be caught via path-pattern probe');
  } finally {
    rm(root);
  }
});

test('AC-3 V6: dry-run does not modify file', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), '.next/\n');
    const platformDir = path.join(root, '.cap', 'memory', 'platform');
    fs.mkdirSync(platformDir, { recursive: true });
    const fp = path.join(platformDir, 'unassigned.md');
    const original = '# Platform\n<!-- cap:auto:start -->\n- noise — `.next/x.js:1`\n<!-- cap:auto:end -->\n';
    fs.writeFileSync(fp, original);

    const result = prune.pruneGitignored(root); // no apply
    assert.equal(result.v6RemovedTotal, 1);
    assert.equal(fs.readFileSync(fp, 'utf8'), original, 'dry-run must NOT change V6 files');
  } finally {
    rm(root);
  }
});

// --------------------------------------------------------------------------
// formatGitignoredReport

test('AC-3 formatGitignoredReport: includes counts', () => {
  const root = mkProject();
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), '.next/\n');
    const platformDir = path.join(root, '.cap', 'memory', 'platform');
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(path.join(platformDir, 'unassigned.md'),
      '# Platform\n<!-- cap:auto:start -->\n- noise — `.next/x.js:1`\n<!-- cap:auto:end -->\n');

    const result = prune.pruneGitignored(root);
    const report = prune.formatGitignoredReport(result);
    assert.match(report, /V5 entries removed: 0/);
    assert.match(report, /V6 lines removed:\s+1/);
    assert.match(report, /\(dry-run\)/);
  } finally {
    rm(root);
  }
});

test('AC-3: caller can pass own scope filter (e.g. via --include flag downstream)', () => {
  const root = mkProject();
  try {
    const platformDir = path.join(root, '.cap', 'memory', 'platform');
    fs.mkdirSync(platformDir, { recursive: true });
    fs.writeFileSync(path.join(platformDir, 'unassigned.md'),
      '# Platform\n<!-- cap:auto:start -->\n- one — `cap/bin/lib/foo.cjs:10`\n- two — `tests/foo.test.cjs:20`\n<!-- cap:auto:end -->\n');

    // Custom scope: only `tests/` is in-scope
    const customScope = filter.buildScopeFilter(root, {
      respectGitignore: false,
      includes: ['tests'],
    });
    const result = prune.pruneGitignored(root, { scope: customScope });
    assert.equal(result.v6RemovedTotal, 1, 'cap/bin/lib path should be flagged out-of-scope');
  } finally {
    rm(root);
  }
});
