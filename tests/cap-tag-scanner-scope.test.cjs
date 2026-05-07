'use strict';

// @cap-feature(feature:F-085) Tests for cap-tag-scanner scope-filter integration. Asserts that
//   the scanner respects gitignore, default path-excludes, plugin-mirror detection, and the new
//   `options.scope` / `options.includes` parameters. Mirrors the behavioural contract of
//   tests/cap-migrate-tags-scope.test.cjs because both consumers share the same filter.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const scanner = require('../cap/bin/lib/cap-tag-scanner.cjs');
const filter = require('../cap/bin/lib/cap-scope-filter.cjs');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-scanner-scope-'));
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

test('AC-3: scanDirectory skips .claude/worktrees', () => {
  const root = mkTmp();
  try {
    writeFile(root, 'src/foo.js', '// @cap-feature(feature:F-001)\n');
    writeFile(root, '.claude/worktrees/agent-x/src/noise.js', '// @cap-feature(feature:F-099)\n');
    const tags = scanner.scanDirectory(root, { projectRoot: root });
    const features = new Set(tags.map((t) => t.metadata && t.metadata.feature));
    assert.ok(features.has('F-001'));
    assert.ok(!features.has('F-099'), 'worktree noise must be filtered');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-3: scanDirectory skips tests/fixtures/polyglot', () => {
  const root = mkTmp();
  try {
    writeFile(root, 'src/foo.js', '// @cap-feature(feature:F-001)\n');
    writeFile(root, 'tests/fixtures/polyglot/example.py', '# @cap-feature(feature:F-099)\n');
    const tags = scanner.scanDirectory(root, { projectRoot: root });
    const features = new Set(tags.map((t) => t.metadata && t.metadata.feature));
    assert.ok(features.has('F-001'));
    assert.ok(!features.has('F-099'), 'fixture noise must be filtered');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-2: scanDirectory honours .gitignore', () => {
  const root = mkTmp();
  try {
    writeFile(root, '.gitignore', 'build/\n');
    writeFile(root, 'src/foo.js', '// @cap-feature(feature:F-001)\n');
    writeFile(root, 'build/generated.js', '// @cap-feature(feature:F-099)\n');
    const tags = scanner.scanDirectory(root, { projectRoot: root });
    const features = new Set(tags.map((t) => t.metadata && t.metadata.feature));
    assert.ok(features.has('F-001'));
    assert.ok(!features.has('F-099'), 'gitignored build artefacts must be filtered');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-4: scanDirectory skips detected plugin-self-mirror', () => {
  const root = mkTmp();
  try {
    fs.mkdirSync(path.join(root, '.claude', 'cap', 'commands'), { recursive: true });
    writeFile(root, 'src/foo.js', '// @cap-feature(feature:F-001)\n');
    writeFile(root, '.claude/cap/bin/lib/cap-foo.cjs', '// @cap-feature(feature:F-099)\n');
    const tags = scanner.scanDirectory(root, { projectRoot: root });
    const features = new Set(tags.map((t) => t.metadata && t.metadata.feature));
    assert.ok(features.has('F-001'));
    assert.ok(!features.has('F-099'), 'plugin-mirror must be filtered');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-1: explicit options.scope wins over default-built filter', () => {
  const root = mkTmp();
  try {
    writeFile(root, 'src/foo.js', '// @cap-feature(feature:F-001)\n');
    writeFile(root, 'tools/bar.js', '// @cap-feature(feature:F-002)\n');
    const customScope = filter.buildScopeFilter(root, {
      respectGitignore: false,
      includes: ['tools'],
    });
    const tags = scanner.scanDirectory(root, { projectRoot: root, scope: customScope });
    const features = new Set(tags.map((t) => t.metadata && t.metadata.feature));
    assert.ok(features.has('F-002'));
    assert.ok(!features.has('F-001'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-1: scanner reduces real-repo tag count by ~92% (regression guard)', () => {
  // Sanity check on the actual repo: ensure the scope filter is engaged. The pre-F-085 baseline
  // was ~33000 tags (90 % from .claude/worktrees); the post-F-085 figure must be drastically
  // lower. We pin a generous upper bound rather than an exact number so legitimate growth
  // doesn't break the test.
  const repoRoot = path.join(__dirname, '..');
  const tags = scanner.scanDirectory(repoRoot, { projectRoot: repoRoot });
  assert.ok(tags.length > 100, `expected real project tags, got ${tags.length}`);
  assert.ok(tags.length < 10000, `expected scoped scan well under 10000, got ${tags.length}`);
  // Hard guarantee: no scanned file path may live under .claude/worktrees or .claude/cap.
  for (const t of tags) {
    assert.ok(
      !t.file.startsWith('.claude/worktrees/'),
      `worktree path slipped through scope filter: ${t.file}`
    );
    assert.ok(
      !t.file.startsWith('.claude/cap/'),
      `plugin-mirror path slipped through scope filter: ${t.file}`
    );
  }
});
