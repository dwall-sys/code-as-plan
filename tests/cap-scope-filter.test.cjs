'use strict';

// @cap-feature(feature:F-085) Tests for the shared scope filter (gitignore-aware path filtering
//   used by cap-tag-scanner and cap-migrate-tags).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const filter = require('../cap/bin/lib/cap-scope-filter.cjs');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// ---------------------------------------------------------------------------
// Defaults & exports

test('exports DEFAULT_DIR_EXCLUDES with legacy basenames', () => {
  assert.ok(Array.isArray(filter.DEFAULT_DIR_EXCLUDES));
  for (const expected of ['.git', 'node_modules', 'dist', 'coverage', '.cap']) {
    assert.ok(filter.DEFAULT_DIR_EXCLUDES.includes(expected), `missing ${expected}`);
  }
});

test('exports DEFAULT_PATH_EXCLUDES covering F-085 problem-paths', () => {
  assert.ok(filter.DEFAULT_PATH_EXCLUDES.includes('.claude/worktrees'));
  assert.ok(filter.DEFAULT_PATH_EXCLUDES.includes('.claude/cap'));
  assert.ok(filter.DEFAULT_PATH_EXCLUDES.includes('tests/fixtures'));
});

test('LARGE_DIFF_THRESHOLD is positive integer', () => {
  assert.equal(typeof filter.LARGE_DIFF_THRESHOLD, 'number');
  assert.ok(filter.LARGE_DIFF_THRESHOLD > 0);
});

// ---------------------------------------------------------------------------
// buildScopeFilter — basic API

test('buildScopeFilter throws on invalid projectRoot', () => {
  assert.throws(() => filter.buildScopeFilter(''), TypeError);
  assert.throws(() => filter.buildScopeFilter(null), TypeError);
  assert.throws(() => filter.buildScopeFilter(undefined), TypeError);
});

test('isExcluded accepts paths inside projectRoot, ignores outside', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root, { respectGitignore: false });
    assert.equal(f.isExcluded(path.join(root, 'src', 'foo.js'), false), false);
    // Outside projectRoot → never excluded by design (callers should not pass these)
    assert.equal(f.isExcluded('/etc/passwd', false), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-3 default path-pattern excludes

test('AC-3: default excludes match .claude/worktrees deeply', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root, { respectGitignore: false });
    assert.equal(f.isExcluded(path.join(root, '.claude', 'worktrees'), true), true);
    assert.equal(f.isExcluded(path.join(root, '.claude', 'worktrees', 'agent-abc', 'cap', 'bin', 'lib', 'cap-foo.cjs'), false), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-3: default excludes match tests/fixtures', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root, { respectGitignore: false });
    assert.equal(f.isExcluded(path.join(root, 'tests', 'fixtures', 'polyglot', 'example.py'), false), true);
    // tests/cap-foo.test.cjs (real test file) MUST NOT be excluded
    assert.equal(f.isExcluded(path.join(root, 'tests', 'cap-foo.test.cjs'), false), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-3: **/fixtures/polyglot pattern matches anywhere in tree', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root, { respectGitignore: false });
    // Direct match
    assert.equal(f.isExcluded(path.join(root, 'tests', 'fixtures', 'polyglot', 'x.go'), false), true);
    // Nested match: packages/foo/fixtures/polyglot/y.rs
    assert.equal(f.isExcluded(path.join(root, 'packages', 'foo', 'fixtures', 'polyglot', 'y.rs'), false), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-2 gitignore awareness

test('AC-2: respects .gitignore for top-level dirs', () => {
  const root = mkTmp('cap-scope-');
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nbuild/\n.claude/\n');
    fs.mkdirSync(path.join(root, 'node_modules', 'foo'), { recursive: true });
    const f = filter.buildScopeFilter(root);
    assert.equal(f.isExcluded(path.join(root, 'node_modules', 'foo'), true), true);
    assert.equal(f.isExcluded(path.join(root, '.claude', 'worktrees', 'a'), true), true);
    assert.equal(f.isExcluded(path.join(root, 'src', 'foo.js'), false), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-2: gitignore pattern with trailing slash is directory-only', () => {
  const root = mkTmp('cap-scope-');
  try {
    // pattern `dist/` should match a directory named dist, NOT a file named dist
    fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
    const f = filter.buildScopeFilter(root);
    assert.equal(f.isExcluded(path.join(root, 'dist'), true), true);
    assert.equal(f.isExcluded(path.join(root, 'dist'), false), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-2: gitignore comments and blank lines are ignored', () => {
  const root = mkTmp('cap-scope-');
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), '# header\n\nnode_modules\n# comment\n');
    const f = filter.buildScopeFilter(root);
    assert.equal(f.isExcluded(path.join(root, 'node_modules'), true), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-2: gitignore negation patterns are silently dropped (MVP)', () => {
  const root = mkTmp('cap-scope-');
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n!node_modules/important\n');
    const f = filter.buildScopeFilter(root);
    // Negation IGNORED in MVP → node_modules is excluded, but the negation does not apply
    assert.equal(f.isExcluded(path.join(root, 'node_modules', 'important'), true), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-2: missing .gitignore is graceful (no throw, no excludes from gitignore)', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root);
    // Without .gitignore the only excludes are DEFAULT_DIR_EXCLUDES + DEFAULT_PATH_EXCLUDES
    assert.equal(f.isExcluded(path.join(root, 'random-folder'), true), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-2: respectGitignore:false bypasses gitignore', () => {
  const root = mkTmp('cap-scope-');
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'src/secrets/\n');
    const f = filter.buildScopeFilter(root, { respectGitignore: false });
    assert.equal(f.isExcluded(path.join(root, 'src', 'secrets'), true), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-4 plugin-mirror detection

test('AC-4: detectPluginMirror finds .claude/cap with bin+commands', () => {
  const root = mkTmp('cap-scope-');
  try {
    fs.mkdirSync(path.join(root, '.claude', 'cap', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(root, '.claude', 'cap', 'commands'), { recursive: true });
    const mirror = filter.detectPluginMirror(root);
    assert.equal(mirror, '.claude/cap');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-4: detectPluginMirror returns null when only one of bin/commands exists', () => {
  const root = mkTmp('cap-scope-');
  try {
    fs.mkdirSync(path.join(root, '.claude', 'cap', 'bin'), { recursive: true });
    // No 'commands' dir → not the plugin mirror
    const mirror = filter.detectPluginMirror(root);
    assert.equal(mirror, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-4: detectPluginMirror returns null when .claude/cap absent', () => {
  const root = mkTmp('cap-scope-');
  try {
    const mirror = filter.detectPluginMirror(root);
    assert.equal(mirror, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-4: scope filter excludes detected plugin mirror', () => {
  const root = mkTmp('cap-scope-');
  try {
    fs.mkdirSync(path.join(root, '.claude', 'cap', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(root, '.claude', 'cap', 'commands'), { recursive: true });
    const f = filter.buildScopeFilter(root, { respectGitignore: false });
    assert.equal(f.pluginMirror, '.claude/cap');
    assert.equal(f.isExcluded(path.join(root, '.claude', 'cap', 'bin', 'lib', 'cap-foo.cjs'), false), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-5 bucketize

test('AC-5: bucketize counts items per top-2 directory', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root, { respectGitignore: false });
    const items = [
      'cap/bin/lib/a.cjs',
      'cap/bin/lib/b.cjs',
      'tests/foo.test.cjs',
      '.claude/worktrees/agent-1/x.cjs',
      '.claude/worktrees/agent-2/y.cjs',
    ];
    const buckets = f.bucketize(items);
    const map = new Map(buckets);
    assert.equal(map.get('cap/bin'), 2);
    assert.equal(map.get('.claude/worktrees'), 2);
    assert.equal(map.get('tests/foo.test.cjs'), 1);
    // Sorted descending
    assert.ok(buckets[0][1] >= buckets[buckets.length - 1][1]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-5: bucketize accepts {file} objects too', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root, { respectGitignore: false });
    const buckets = f.bucketize([
      { file: 'src/lib/foo.js' },
      { file: 'src/lib/bar.js' },
      { file: 'src/components/baz.js' },
    ]);
    const map = new Map(buckets);
    assert.equal(map.get('src/lib'), 2);
    assert.equal(map.get('src/components'), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-6 user includes/excludes

test('AC-6: user excludes are additive on top of defaults', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root, {
      respectGitignore: false,
      excludes: ['scripts/legacy'],
    });
    assert.equal(f.isExcluded(path.join(root, 'scripts', 'legacy', 'old.js'), false), true);
    // Defaults still apply
    assert.equal(f.isExcluded(path.join(root, '.claude', 'worktrees', 'agent-1'), true), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-6: user includes are a positive filter (only matches pass)', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root, {
      respectGitignore: false,
      includes: ['cap/bin'],
    });
    assert.equal(f.isExcluded(path.join(root, 'cap', 'bin', 'lib', 'foo.cjs'), false), false);
    // Outside the include set → excluded even though no other rule fires
    assert.equal(f.isExcluded(path.join(root, 'tests', 'cap-foo.test.cjs'), false), true);
    assert.equal(f.isExcluded(path.join(root, 'scripts', 'build.js'), false), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC-6: empty includes array means no positive filter (default behaviour)', () => {
  const root = mkTmp('cap-scope-');
  try {
    const f = filter.buildScopeFilter(root, { respectGitignore: false, includes: [] });
    assert.equal(f.isExcluded(path.join(root, 'random', 'foo.js'), false), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Internal helper sanity

test('_matchPathPattern: prefix match', () => {
  assert.equal(filter._matchPathPattern('tests/fixtures', 'tests/fixtures'), true);
  assert.equal(filter._matchPathPattern('tests/fixtures/polyglot/x.py', 'tests/fixtures'), true);
  assert.equal(filter._matchPathPattern('tests/cap.test.cjs', 'tests/fixtures'), false);
});

test('_matchPathPattern: **/foo suffix-anywhere', () => {
  assert.equal(filter._matchPathPattern('tests/fixtures/polyglot/x.py', '**/fixtures/polyglot'), true);
  assert.equal(filter._matchPathPattern('packages/a/fixtures/polyglot/x.py', '**/fixtures/polyglot'), true);
  assert.equal(filter._matchPathPattern('src/polyglot/x.py', '**/fixtures/polyglot'), false);
});

test('_compileGitignorePattern: basic dir match', () => {
  const m = filter._compileGitignorePattern('node_modules');
  assert.equal(m('node_modules', true), true);
  assert.equal(m('node_modules/foo', false), true);
  assert.equal(m('src/node_modules', true), true); // matches anywhere in tree
});

test('_compileGitignorePattern: anchored pattern with leading slash', () => {
  const m = filter._compileGitignorePattern('/build');
  assert.equal(m('build', true), true);
  assert.equal(m('build/x', false), true);
  // Anchored: src/build/x should NOT match
  assert.equal(m('src/build/x', false), false);
});

test('_compileGitignorePattern: glob *.ext', () => {
  const m = filter._compileGitignorePattern('*.log');
  assert.equal(m('error.log', false), true);
  assert.equal(m('src/error.log', false), true);
  assert.equal(m('error.txt', false), false);
});
