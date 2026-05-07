'use strict';

// @cap-feature(feature:F-086) Bundle-detection tests for cap-scope-filter.cjs (AC-2).
//   Verifies path-pattern probe (cheap, default) and line-count probe (deep, opt-in) both
//   identify bundler artefacts that the gitignore alone might miss when committed by mistake.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const filter = require('../cap/bin/lib/cap-scope-filter.cjs');

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bundle-')); }
function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// ---------------------------------------------------------------------------
// AC-2 path-probe (cheap, default)

test('AC-2: isBundle path probe — chunks/', () => {
  assert.equal(filter.isBundle('packages/foo/dist/chunks/abc.js'), true);
  assert.equal(filter.isBundle('apps/hub/.next/server/chunks/123.js'), true);
});

test('AC-2: isBundle path probe — Next.js [root-of-*] naming', () => {
  assert.equal(filter.isBundle('.next/dev/server/chunks/[root-of-the-server]__0p_l47z._.js'), true);
});

test('AC-2: isBundle path probe — Webpack-style hashed bundle', () => {
  assert.equal(filter.isBundle('any/dir/__abc123._.js'), true);
  assert.equal(filter.isBundle('any/dir/__deeply_nested._.js'), true);
});

test('AC-2: isBundle path probe — .bundle.js / .min.js / .chunk.js', () => {
  assert.equal(filter.isBundle('public/app.bundle.js'), true);
  assert.equal(filter.isBundle('public/app.min.js'), true);
  assert.equal(filter.isBundle('public/123.chunk.js'), true);
  assert.equal(filter.isBundle('public/app.bundle.mjs'), true);
});

test('AC-2: isBundle path probe — honest source files NOT flagged', () => {
  assert.equal(filter.isBundle('src/lib/auth.ts'), false);
  assert.equal(filter.isBundle('src/components/Header.tsx'), false);
  assert.equal(filter.isBundle('cap/bin/lib/cap-tag-scanner.cjs'), false);
  // chunks WITHOUT a slash boundary should NOT match
  assert.equal(filter.isBundle('src/munchkin/foo.js'), false);
});

// ---------------------------------------------------------------------------
// AC-2 deep probe (line-count, opt-in)

test('AC-2: isBundle deep probe — files >5000 lines flagged', () => {
  const tmp = mkTmp();
  try {
    const fp = writeFile(tmp, 'huge.js', 'a;\n'.repeat(6000));
    assert.equal(filter.isBundle(fp), false, 'path probe alone should NOT flag (no bundle path)');
    assert.equal(filter.isBundle(fp, { deep: true }), true, 'deep probe must flag huge file');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC-2: isBundle deep probe — small files NOT flagged', () => {
  const tmp = mkTmp();
  try {
    const fp = writeFile(tmp, 'normal.ts', 'const x = 1;\n'.repeat(100));
    assert.equal(filter.isBundle(fp, { deep: true }), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC-2: isBundle deep probe — early-exit at threshold', () => {
  // A 6000-line file should be flagged without reading the whole content into a slow loop.
  // We can't directly observe the early exit, but we can confirm the result is correct.
  const tmp = mkTmp();
  try {
    const fp = writeFile(tmp, 'big.js', 'x;\n'.repeat(20000));
    const start = Date.now();
    assert.equal(filter.isBundle(fp, { deep: true, lineThreshold: 100 }), true);
    const elapsed = Date.now() - start;
    // Sanity: 20k-line file with threshold 100 must complete fast (no full-file scan)
    assert.ok(elapsed < 1000, `deep probe must early-exit (took ${elapsed}ms)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC-2: isBundle deep probe — unreadable file returns false', () => {
  // Path doesn't exist → readFileSync throws → defaults to "not bundle"
  assert.equal(filter.isBundle('/nonexistent/does/not/exist.js', { deep: true }), false);
});

// ---------------------------------------------------------------------------
// Wired into buildScopeFilter

test('AC-2: scope-filter excludes bundle paths by default', () => {
  const tmp = mkTmp();
  try {
    const f = filter.buildScopeFilter(tmp, { respectGitignore: false });
    assert.equal(f.isExcluded(path.join(tmp, '.next', 'dev', 'server', 'chunks', '[root-of-the-server]__0p_l47z._.js'), false), true);
    assert.equal(f.isExcluded(path.join(tmp, 'public', 'app.bundle.js'), false), true);
    // Real source files must still pass
    assert.equal(f.isExcluded(path.join(tmp, 'src', 'lib', 'auth.ts'), false), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC-2: bundleDetection:false bypasses the bundle filter', () => {
  const tmp = mkTmp();
  try {
    const f = filter.buildScopeFilter(tmp, { respectGitignore: false, bundleDetection: false });
    assert.equal(f.isExcluded(path.join(tmp, 'public', 'app.bundle.js'), false), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC-2: deepBundleCheck enables line-count probe in scope-filter', () => {
  const tmp = mkTmp();
  try {
    const fp = writeFile(tmp, 'src/concatenated.js', 'a;\n'.repeat(10000));
    const fShallow = filter.buildScopeFilter(tmp, { respectGitignore: false });
    assert.equal(fShallow.isExcluded(fp, false), false, 'shallow filter should not flag (path is honest)');
    const fDeep = filter.buildScopeFilter(tmp, { respectGitignore: false, deepBundleCheck: true });
    assert.equal(fDeep.isExcluded(fp, false), true, 'deep filter should flag the 10k-line file');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Constants exposed

test('AC-2: BUNDLE_LINE_THRESHOLD and BUNDLE_PATH_PATTERNS are exported', () => {
  assert.equal(typeof filter.BUNDLE_LINE_THRESHOLD, 'number');
  assert.ok(filter.BUNDLE_LINE_THRESHOLD >= 1000);
  assert.ok(Array.isArray(filter.BUNDLE_PATH_PATTERNS));
  assert.ok(filter.BUNDLE_PATH_PATTERNS.length >= 4);
  for (const re of filter.BUNDLE_PATH_PATTERNS) {
    assert.ok(re instanceof RegExp);
  }
});
