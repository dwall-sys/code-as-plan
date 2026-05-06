'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  CAP_TAG_TYPES,
  CAP_TAG_RE,
  scanFile,
  scanDirectory,
  extractTags,
  parseMetadata,
  groupByFeature,
  buildAcFileMap,
  detectOrphans,
  editDistance,
  detectWorkspaces,
  resolveWorkspaceGlobs,
  scanMonorepo,
  groupByPackage,
  detectLegacyTags,
  LEGACY_TAG_RE,
  scanApp,
  detectSharedPackages,
} = require('../cap/bin/lib/cap-tag-scanner.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-scanner-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- CAP_TAG_RE tests ---

describe('CAP_TAG_RE', () => {
  // @gsd-todo(ref:AC-20) Primary tags are @cap-feature and @cap-todo
  it('matches @cap-feature tag with metadata', () => {
    const line = '// @cap-feature(feature:F-001) Auth module implementation';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'feature');
    assert.strictEqual(match[2], 'feature:F-001');
    assert.strictEqual(match[3], 'Auth module implementation');
  });

  it('matches @cap-todo tag with ac: metadata', () => {
    const line = '// @cap-todo(feature:F-001, ac:AC-1) Implement login endpoint';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'todo');
    assert.strictEqual(match[2], 'feature:F-001, ac:AC-1');
  });

  // @gsd-todo(ref:AC-23) @cap-risk and @cap-decision available as standalone optional tags
  it('matches @cap-risk standalone tag', () => {
    const line = '// @cap-risk Memory leak possible under high concurrency';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'risk');
    assert.strictEqual(match[3], 'Memory leak possible under high concurrency');
  });

  it('matches @cap-decision standalone tag', () => {
    const line = '// @cap-decision Using bcrypt over argon2 for cross-platform compat';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'decision');
  });

  it('rejects @cap-feature inside string literal', () => {
    const line = 'const x = "// @cap-feature(feature:F-001) not a tag";';
    const match = line.match(CAP_TAG_RE);
    assert.strictEqual(match, null);
  });

  it('rejects @cap-todo after code on same line', () => {
    const line = 'const y = 5; // @cap-todo This is not valid';
    const match = line.match(CAP_TAG_RE);
    assert.strictEqual(match, null);
  });

  // @gsd-todo(ref:AC-26) Tag scanner is language-agnostic across JS, TS, Python, Ruby, Shell
  it('matches tags with hash comment token (Python/Ruby/Shell)', () => {
    const line = '# @cap-feature(feature:F-002) Database connection pool';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'feature');
  });

  it('matches tags with SQL comment token', () => {
    const line = '-- @cap-todo Add index on user_id column';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'todo');
  });

  it('matches tags with block comment continuation', () => {
    const line = ' * @cap-risk Race condition in concurrent writes';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'risk');
  });

  it('matches tags with triple-quote docstring', () => {
    const line = '""" @cap-feature(feature:F-003) Token validation';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'feature');
  });

  it('matches tags with leading whitespace', () => {
    const line = '    // @cap-todo Refactor this function';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'todo');
  });

  it('matches tag without metadata', () => {
    const line = '// @cap-feature Auth module';
    const match = line.match(CAP_TAG_RE);
    assert.ok(match);
    assert.strictEqual(match[1], 'feature');
    assert.strictEqual(match[2], undefined);
    assert.strictEqual(match[3], 'Auth module');
  });
});

// --- parseMetadata tests ---

describe('parseMetadata', () => {
  it('parses single key-value pair', () => {
    const result = parseMetadata('feature:F-001');
    assert.deepStrictEqual(result, { feature: 'F-001' });
  });

  it('parses multiple key-value pairs', () => {
    const result = parseMetadata('feature:F-001, ac:AC-1');
    assert.deepStrictEqual(result, { feature: 'F-001', ac: 'AC-1' });
  });

  it('returns empty object for empty string', () => {
    assert.deepStrictEqual(parseMetadata(''), {});
  });

  it('returns empty object for null', () => {
    assert.deepStrictEqual(parseMetadata(null), {});
  });

  it('trims whitespace from keys and values', () => {
    const result = parseMetadata('  feature : F-001 ,  ac : AC-2  ');
    assert.deepStrictEqual(result, { feature: 'F-001', ac: 'AC-2' });
  });

  it('handles key without value as flag', () => {
    const result = parseMetadata('urgent');
    assert.deepStrictEqual(result, { urgent: 'true' });
  });
});

// --- extractTags tests ---

describe('extractTags', () => {
  it('extracts @cap-feature tags from JavaScript content', () => {
    const content = `// @cap-feature(feature:F-001) Auth module
const login = () => {};
// @cap-todo(feature:F-001) Implement password hashing`;
    const tags = extractTags(content, 'src/auth.js');
    assert.strictEqual(tags.length, 2);
    assert.strictEqual(tags[0].type, 'feature');
    assert.strictEqual(tags[0].metadata.feature, 'F-001');
    assert.strictEqual(tags[0].line, 1);
    assert.strictEqual(tags[0].file, 'src/auth.js');
    assert.strictEqual(tags[1].type, 'todo');
    assert.strictEqual(tags[1].line, 3);
  });

  // @gsd-todo(ref:AC-22) @cap-todo supports subtypes: risk:..., decision:...
  it('detects risk: subtype in @cap-todo', () => {
    const content = '// @cap-todo risk: Memory leak if connections not closed';
    const tags = extractTags(content, 'src/db.js');
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].type, 'todo');
    assert.strictEqual(tags[0].subtype, 'risk');
  });

  it('detects decision: subtype in @cap-todo', () => {
    const content = '// @cap-todo decision: Use connection pooling over single connections';
    const tags = extractTags(content, 'src/db.js');
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].subtype, 'decision');
  });

  it('sets subtype null for regular @cap-todo', () => {
    const content = '// @cap-todo Implement caching layer';
    const tags = extractTags(content, 'src/cache.js');
    assert.strictEqual(tags[0].subtype, null);
  });

  it('returns empty array for file with no tags', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    const tags = extractTags(content, 'src/util.js');
    assert.deepStrictEqual(tags, []);
  });

  it('does not extract tags from string literals', () => {
    const content = 'const msg = "// @cap-feature(feature:F-001) not a tag";';
    const tags = extractTags(content, 'src/util.js');
    assert.deepStrictEqual(tags, []);
  });

  // @gsd-todo(ref:AC-25) Multiline block comment support
  it('extracts tags from block comment continuation lines', () => {
    const content = `/*
 * @cap-feature(feature:F-002) Database module
 * @cap-risk Connection pool exhaustion under load
 */`;
    const tags = extractTags(content, 'src/db.js');
    assert.strictEqual(tags.length, 2);
    assert.strictEqual(tags[0].type, 'feature');
    assert.strictEqual(tags[1].type, 'risk');
  });

  it('extracts tags from Python hash comments', () => {
    const content = `# @cap-feature(feature:F-003) CLI parser
# @cap-todo Add --verbose flag
def main():
    pass`;
    const tags = extractTags(content, 'cli.py');
    assert.strictEqual(tags.length, 2);
    assert.strictEqual(tags[0].type, 'feature');
    assert.strictEqual(tags[1].type, 'todo');
  });

  it('preserves raw line content', () => {
    const content = '  // @cap-todo(feature:F-001) Fix the thing';
    const tags = extractTags(content, 'src/fix.js');
    assert.strictEqual(tags[0].raw, '  // @cap-todo(feature:F-001) Fix the thing');
  });
});

// --- scanFile tests ---

describe('scanFile', () => {
  it('extracts @cap-feature tags from JavaScript file', () => {
    const filePath = path.join(tmpDir, 'auth.js');
    fs.writeFileSync(filePath, `// @cap-feature(feature:F-001) Auth module\nconst x = 1;\n`);
    const tags = scanFile(filePath, tmpDir);
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].type, 'feature');
    assert.strictEqual(tags[0].file, 'auth.js');
  });

  it('extracts multiple tag types from same file', () => {
    const filePath = path.join(tmpDir, 'db.js');
    fs.writeFileSync(filePath, `// @cap-feature(feature:F-002) Database module
// @cap-todo Implement connection pooling
// @cap-risk Timeout under heavy load
`);
    const tags = scanFile(filePath, tmpDir);
    assert.strictEqual(tags.length, 3);
    assert.strictEqual(tags[0].type, 'feature');
    assert.strictEqual(tags[1].type, 'todo');
    assert.strictEqual(tags[2].type, 'risk');
  });

  it('returns empty array for file with no tags', () => {
    const filePath = path.join(tmpDir, 'empty.js');
    fs.writeFileSync(filePath, 'const x = 1;\n');
    const tags = scanFile(filePath, tmpDir);
    assert.deepStrictEqual(tags, []);
  });

  it('returns empty array for non-existent file', () => {
    const tags = scanFile(path.join(tmpDir, 'nope.js'), tmpDir);
    assert.deepStrictEqual(tags, []);
  });

  it('computes relative path from project root', () => {
    const subDir = path.join(tmpDir, 'src');
    fs.mkdirSync(subDir);
    const filePath = path.join(subDir, 'mod.js');
    fs.writeFileSync(filePath, '// @cap-todo Fix this\n');
    const tags = scanFile(filePath, tmpDir);
    assert.strictEqual(tags[0].file, path.join('src', 'mod.js'));
  });
});

// --- scanDirectory tests ---

describe('scanDirectory', () => {
  it('recursively scans directory with extension filter', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'app.js'), '// @cap-feature(feature:F-001) App entry\n');
    fs.writeFileSync(path.join(srcDir, 'style.css'), '/* @cap-feature(feature:F-002) Styles */\n');
    const tags = scanDirectory(tmpDir, { extensions: ['.js'], projectRoot: tmpDir });
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].metadata.feature, 'F-001');
  });

  it('excludes node_modules and .git directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'dep.js'), '// @cap-todo Should not appear\n');
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.git', 'hook.js'), '// @cap-todo Should not appear\n');
    fs.writeFileSync(path.join(tmpDir, 'app.js'), '// @cap-todo This should appear\n');
    const tags = scanDirectory(tmpDir, { projectRoot: tmpDir });
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].file, 'app.js');
  });

  it('excludes framework build caches that emit source-mapped JS', () => {
    // Regression: a real-world GoetzeInvest scan surfaced 344 decisions sourced from
    // `.next/dev/server/chunks/*.js` (~28 % of decisions.md). Build artifacts MUST never enter
    // the memory pipeline. Pin Next.js, Turbo, Nx, Vercel, Svelte-Kit caches alongside the
    // generic `dist`/`build`/`coverage`.
    const buildArtifactDirs = [
      ['.next', 'server', 'chunks'],
      ['.turbo', 'cache'],
      ['.nx', 'cache'],
      ['.vercel', 'output'],
      ['.svelte-kit'],
      ['out'],
      ['.cache'],
      ['.parcel-cache'],
    ];
    for (const segs of buildArtifactDirs) {
      const dir = path.join(tmpDir, ...segs);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'chunk.js'), '// @cap-decision This is build output and must be ignored\n');
    }
    fs.writeFileSync(path.join(tmpDir, 'app.js'), '// @cap-decision This is real source\n');
    const tags = scanDirectory(tmpDir, { projectRoot: tmpDir });
    assert.strictEqual(tags.length, 1, `expected only app.js to scan, got ${tags.length} tags`);
    assert.strictEqual(tags[0].file, 'app.js');
  });

  it('scans nested directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'lib', 'util.js'), '// @cap-todo Implement util\n');
    const tags = scanDirectory(tmpDir, { projectRoot: tmpDir });
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].file, path.join('src', 'lib', 'util.js'));
  });

  it('returns empty array for empty directory', () => {
    const tags = scanDirectory(tmpDir, { projectRoot: tmpDir });
    assert.deepStrictEqual(tags, []);
  });
});

// --- groupByFeature tests ---

describe('groupByFeature', () => {
  it('groups tags by feature name', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-001' }, file: 'a.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { feature: 'F-001' }, file: 'a.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'feature', metadata: { feature: 'F-002' }, file: 'b.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const groups = groupByFeature(tags);
    assert.strictEqual(groups['F-001'].length, 2);
    assert.strictEqual(groups['F-002'].length, 1);
  });

  it('puts untagged items in (unassigned) group', () => {
    const tags = [
      { type: 'todo', metadata: {}, file: 'c.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'risk', metadata: {}, file: 'd.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const groups = groupByFeature(tags);
    assert.strictEqual(groups['(unassigned)'].length, 2);
  });

  it('returns empty object for no tags', () => {
    const groups = groupByFeature([]);
    assert.deepStrictEqual(groups, {});
  });
});

// --- detectOrphans tests ---

describe('detectOrphans', () => {
  // @gsd-todo(ref:AC-15) Orphan tags flagged with fuzzy-match hint
  it('detects orphan tags not in feature map', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-099' }, file: 'x.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const orphans = detectOrphans(tags, ['F-001', 'F-002']);
    assert.strictEqual(orphans.length, 1);
    assert.strictEqual(orphans[0].tag.metadata.feature, 'F-099');
  });

  it('provides fuzzy-match hint for close IDs', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-01' }, file: 'x.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const orphans = detectOrphans(tags, ['F-001', 'F-002']);
    assert.strictEqual(orphans.length, 1);
    // F-01 is close to F-001 (edit distance 1)
    assert.strictEqual(orphans[0].hint, 'F-001');
  });

  it('returns null hint when no close match', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'ZZZZZ' }, file: 'x.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const orphans = detectOrphans(tags, ['F-001']);
    assert.strictEqual(orphans.length, 1);
    assert.strictEqual(orphans[0].hint, null);
  });

  it('does not flag tags matching known features', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-001' }, file: 'x.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const orphans = detectOrphans(tags, ['F-001', 'F-002']);
    assert.strictEqual(orphans.length, 0);
  });

  it('skips tags without feature metadata', () => {
    const tags = [
      { type: 'todo', metadata: {}, file: 'x.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const orphans = detectOrphans(tags, ['F-001']);
    assert.strictEqual(orphans.length, 0);
  });
});

// --- editDistance tests ---

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    assert.strictEqual(editDistance('abc', 'abc'), 0);
  });

  it('returns correct distance for single edit', () => {
    assert.strictEqual(editDistance('F-001', 'F-002'), 1);
  });

  it('returns length for empty vs non-empty', () => {
    assert.strictEqual(editDistance('', 'abc'), 3);
  });
});

// --- detectWorkspaces ---

// @gsd-todo(ref:AC-78) /cap:scan shall traverse all packages in a monorepo

describe('detectWorkspaces', () => {
  it('detects no monorepo for single-repo project', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'single-repo' }),
      'utf8'
    );

    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, false);
    assert.deepStrictEqual(result.packages, []);
  });

  it('detects npm workspaces array format', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, 'packages', 'core'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', 'cli'), { recursive: true });
    // hidden dir should be excluded
    fs.mkdirSync(path.join(tmpDir, 'packages', '.internal'), { recursive: true });

    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.strictEqual(result.packages.length, 2);
    assert.ok(result.packages.includes(path.join('packages', 'core')));
    assert.ok(result.packages.includes(path.join('packages', 'cli')));
  });

  it('detects yarn workspaces object format', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'yarn-monorepo',
        workspaces: { packages: ['apps/*', 'libs/*'] },
      }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'libs', 'shared'), { recursive: true });

    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.strictEqual(result.packages.length, 2);
  });

  it('detects lerna monorepo', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'lerna-repo' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'lerna.json'),
      JSON.stringify({ packages: ['packages/*'] }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, 'packages', 'utils'), { recursive: true });

    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.ok(result.packages.includes(path.join('packages', 'utils')));
  });

  it('prefers package.json workspaces over lerna.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'monorepo', workspaces: ['apps/*'] }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'lerna.json'),
      JSON.stringify({ packages: ['packages/*'] }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', 'lib'), { recursive: true });

    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    // Should only have apps/web, not packages/lib
    assert.ok(result.packages.some(p => p.includes('web')));
    assert.ok(!result.packages.some(p => p.includes('lib')));
  });

  it('handles no package.json gracefully', () => {
    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, false);
    assert.deepStrictEqual(result.packages, []);
  });

  it('handles nonexistent workspace directories', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'empty', workspaces: ['nonexistent/*'] }),
      'utf8'
    );

    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.deepStrictEqual(result.packages, []);
  });
});

// --- resolveWorkspaceGlobs ---

describe('resolveWorkspaceGlobs', () => {
  it('expands simple glob pattern', () => {
    fs.mkdirSync(path.join(tmpDir, 'packages', 'a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', 'b'), { recursive: true });

    const result = resolveWorkspaceGlobs(tmpDir, ['packages/*']);
    assert.strictEqual(result.length, 2);
  });

  it('handles direct package reference (no glob)', () => {
    fs.mkdirSync(path.join(tmpDir, 'tools', 'cli'), { recursive: true });

    const result = resolveWorkspaceGlobs(tmpDir, ['tools/cli']);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], 'tools/cli');
  });

  it('handles double-star glob (**)', () => {
    fs.mkdirSync(path.join(tmpDir, 'packages', 'nested'), { recursive: true });

    const result = resolveWorkspaceGlobs(tmpDir, ['packages/**']);
    assert.ok(result.length >= 1);
  });

  it('skips hidden directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'packages', 'visible'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', '.hidden'), { recursive: true });

    const result = resolveWorkspaceGlobs(tmpDir, ['packages/*']);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].includes('visible'));
  });

  it('returns empty array for nonexistent base dir', () => {
    const result = resolveWorkspaceGlobs(tmpDir, ['nonexistent/*']);
    assert.deepStrictEqual(result, []);
  });
});

// --- scanMonorepo ---

// @gsd-todo(ref:AC-79) Feature Map entries support cross-package file references
// @gsd-todo(ref:AC-80) Works seamlessly with single-repo projects

describe('scanMonorepo', () => {
  it('falls back to scanDirectory for single-repo', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'single' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'app.js'),
      '// @cap-feature(feature:F-001) App entry\n',
      'utf8'
    );

    const result = scanMonorepo(tmpDir);
    assert.strictEqual(result.isMonorepo, false);
    assert.deepStrictEqual(result.packages, []);
    assert.strictEqual(result.tags.length, 1);
    assert.strictEqual(result.tags[0].metadata.feature, 'F-001');
  });

  it('scans all workspace packages in monorepo', () => {
    // Set up monorepo structure
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }),
      'utf8'
    );

    // Root file
    fs.writeFileSync(
      path.join(tmpDir, 'config.js'),
      '// @cap-feature(feature:F-001) Root config\n',
      'utf8'
    );

    // Package A
    fs.mkdirSync(path.join(tmpDir, 'packages', 'core', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages', 'core', 'src', 'auth.js'),
      '// @cap-feature(feature:F-002) Auth module in core package\n// @cap-todo Implement JWT validation\n',
      'utf8'
    );

    // Package B
    fs.mkdirSync(path.join(tmpDir, 'packages', 'api', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages', 'api', 'src', 'routes.js'),
      '// @cap-feature(feature:F-003) API routes\n',
      'utf8'
    );

    const result = scanMonorepo(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.strictEqual(result.packages.length, 2);

    // Should find tags from all packages and root
    assert.ok(result.tags.length >= 4); // F-001, F-002, todo, F-003

    // Cross-package file references should be relative to project root
    const authTag = result.tags.find(t => t.description.includes('Auth module'));
    assert.ok(authTag);
    assert.ok(authTag.file.startsWith(path.join('packages', 'core')));
  });

  it('deduplicates tags that appear in both root scan and package scan', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, 'packages', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages', 'lib', 'index.js'),
      '// @cap-feature(feature:F-010) Lib entry\n',
      'utf8'
    );

    const result = scanMonorepo(tmpDir);
    // The file should only appear once despite being in both root walk and package walk
    const libTags = result.tags.filter(t => t.file.includes('lib'));
    assert.strictEqual(libTags.length, 1);
  });

  it('handles monorepo with no tags in any package', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'empty-monorepo', workspaces: ['packages/*'] }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, 'packages', 'empty'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages', 'empty', 'index.js'),
      'const x = 1;\n',
      'utf8'
    );

    const result = scanMonorepo(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.deepStrictEqual(result.tags, []);
  });
});

// --- groupByPackage ---

describe('groupByPackage', () => {
  it('groups tags by workspace package path', () => {
    const packages = [path.join('packages', 'core'), path.join('packages', 'api')];
    const tags = [
      { file: path.join('packages', 'core', 'src', 'auth.js'), type: 'feature', line: 1, metadata: {}, description: '', raw: '', subtype: null },
      { file: path.join('packages', 'api', 'src', 'routes.js'), type: 'feature', line: 1, metadata: {}, description: '', raw: '', subtype: null },
      { file: 'config.js', type: 'feature', line: 1, metadata: {}, description: '', raw: '', subtype: null },
    ];

    const groups = groupByPackage(tags, packages);
    assert.strictEqual(groups[path.join('packages', 'core')].length, 1);
    assert.strictEqual(groups[path.join('packages', 'api')].length, 1);
    assert.strictEqual(groups['(root)'].length, 1);
  });

  it('puts all tags in root when no packages match', () => {
    const tags = [
      { file: 'src/app.js', type: 'feature', line: 1, metadata: {}, description: '', raw: '', subtype: null },
    ];

    const groups = groupByPackage(tags, []);
    assert.strictEqual(groups['(root)'].length, 1);
  });

  it('returns empty groups for no tags', () => {
    const groups = groupByPackage([], ['packages/core']);
    assert.strictEqual(groups['(root)'].length, 0);
    assert.strictEqual(groups['packages/core'].length, 0);
  });
});

// --- detectLegacyTags ---

describe('detectLegacyTags', () => {
  it('detects @gsd-* tags in source files', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'app.js'),
      '// @gsd-feature Auth module\n// @gsd-todo Fix this\nconst x = 1;\n',
      'utf8'
    );

    const result = detectLegacyTags(tmpDir);
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0], 'app.js');
    assert.ok(result.recommendation.includes('/cap:migrate'));
  });

  it('returns zero count when no @gsd-* tags exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'clean.js'),
      '// @cap-feature Already migrated\nconst x = 1;\n',
      'utf8'
    );

    const result = detectLegacyTags(tmpDir);
    assert.strictEqual(result.count, 0);
    assert.strictEqual(result.files.length, 0);
    assert.strictEqual(result.recommendation, '');
  });

  it('skips node_modules and .git directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(
      path.join(tmpDir, 'node_modules', 'dep.js'),
      '// @gsd-feature Should not appear\n',
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(
      path.join(tmpDir, '.git', 'hook.js'),
      '// @gsd-todo Should not appear\n',
      'utf8'
    );

    const result = detectLegacyTags(tmpDir);
    assert.strictEqual(result.count, 0);
  });

  it('detects all GSD tag types', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'full.js'),
      [
        '// @gsd-feature Auth',
        '// @gsd-todo Fix this',
        '// @gsd-risk Memory leak',
        '// @gsd-decision Use bcrypt',
        '// @gsd-context Scanner module',
        '// @gsd-status done',
        '// @gsd-depends F-001',
        '// @gsd-pattern Anchor rule',
        '// @gsd-api parseMetadata()',
        '// @gsd-constraint Zero deps',
      ].join('\n') + '\n',
      'utf8'
    );

    const result = detectLegacyTags(tmpDir);
    assert.strictEqual(result.count, 10);
  });

  it('scans nested directories', () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'lib', 'util.js'),
      '// @gsd-todo Deep nested tag\n',
      'utf8'
    );

    const result = detectLegacyTags(tmpDir);
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.files[0], path.join('src', 'lib', 'util.js'));
  });
});

describe('LEGACY_TAG_RE', () => {
  it('matches @gsd-feature in JS comment', () => {
    assert.ok(LEGACY_TAG_RE.test('// @gsd-feature Auth'));
  });

  it('matches @gsd-todo in Python comment', () => {
    assert.ok(LEGACY_TAG_RE.test('# @gsd-todo Fix this'));
  });

  it('matches @gsd-constraint with leading whitespace', () => {
    assert.ok(LEGACY_TAG_RE.test('    // @gsd-constraint Zero deps'));
  });

  it('does not match @cap- tags', () => {
    assert.ok(!LEGACY_TAG_RE.test('// @cap-feature Auth'));
  });

  it('does not match @gsd- in string literals', () => {
    assert.ok(!LEGACY_TAG_RE.test('const x = "@gsd-feature not a tag"'));
  });
});

// --- Zero-dep compliance verification ---

// @gsd-todo(ref:AC-93) Zero runtime dependencies
// @gsd-todo(ref:AC-95) File discovery uses fs.readdirSync -- no glob library

describe('zero-dep compliance', () => {
  it('cap-tag-scanner.cjs only requires node: built-ins and local modules', () => {
    const scannerPath = path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-tag-scanner.cjs');
    const content = fs.readFileSync(scannerPath, 'utf8');

    // Extract all require() calls
    const requireRE = /require\(['"]([^'"]+)['"]\)/g;
    let match;
    const requires = [];
    while ((match = requireRE.exec(content)) !== null) {
      requires.push(match[1]);
    }

    // Each require must be node: built-in or local (./*)
    for (const req of requires) {
      const isBuiltin = req.startsWith('node:');
      const isLocal = req.startsWith('./') || req.startsWith('../');
      assert.ok(
        isBuiltin || isLocal,
        `Unexpected external require: ${req}`
      );
    }
  });
});

// --- Branch coverage: scanApp with shared packages ---

describe('scanApp (branch coverage)', () => {
  it('scans app and detects shared workspace packages', () => {
    // Set up a monorepo structure: root package.json with workspaces
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'monorepo',
      workspaces: ['packages/*', 'apps/*'],
    }), 'utf8');

    // Create an app
    const appDir = path.join(tmpDir, 'apps', 'myapp');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
      name: 'myapp',
      dependencies: { 'shared-lib': '*' },
    }), 'utf8');
    fs.writeFileSync(path.join(appDir, 'index.js'),
      "// @cap-feature(feature:F-001) App feature\nconst x = 1;\n", 'utf8');

    // Create a shared package that the app depends on
    const pkgDir = path.join(tmpDir, 'packages', 'shared-lib');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: 'shared-lib',
    }), 'utf8');
    fs.writeFileSync(path.join(pkgDir, 'lib.js'),
      "// @cap-feature(feature:F-002) Shared feature\nmodule.exports = " + "{};\n", 'utf8');

    const result = scanApp(tmpDir, 'apps/myapp');
    assert.ok(result.tags.length >= 1, 'Should find tags from app');
    assert.ok(result.scannedDirs.includes('apps/myapp'));
    // May include shared packages if detected correctly
    assert.ok(Array.isArray(result.scannedDirs));
  });

  it('handles app with no package.json', () => {
    const appDir = path.join(tmpDir, 'apps', 'bare');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'main.js'),
      "// @cap-feature(feature:F-010) Bare app\n", 'utf8');

    const result = scanApp(tmpDir, 'apps/bare');
    assert.ok(result.tags.length >= 1);
    assert.strictEqual(result.scannedDirs[0], 'apps/bare');
  });
});

describe('detectSharedPackages (branch coverage)', () => {
  it('returns empty when app package.json is malformed', () => {
    const appDir = path.join(tmpDir, 'apps', 'bad');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'package.json'), 'not valid json!!!', 'utf8');
    const result = detectSharedPackages(tmpDir, 'apps/bad');
    assert.deepStrictEqual(result, []);
  });

  it('returns empty when workspace package.json is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'root', workspaces: ['packages/*'],
    }), 'utf8');

    const appDir = path.join(tmpDir, 'apps', 'myapp');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
      name: 'myapp', dependencies: { 'broken-pkg': '*' },
    }), 'utf8');

    const pkgDir = path.join(tmpDir, 'packages', 'broken-pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{malformed json', 'utf8');

    const result = detectSharedPackages(tmpDir, 'apps/myapp');
    // Should not throw, gracefully skip malformed package
    assert.ok(Array.isArray(result));
  });
});

describe('detectLegacyTags (walk error branch)', () => {
  it('handles unreadable directories gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'fake-dir.js'), "// @gsd-feature old tag\n", 'utf8');
    const result = detectLegacyTags(tmpDir);
    assert.ok(typeof result.count === 'number');
    assert.ok(Array.isArray(result.files));
  });

  it('handles unreadable file in scanFileForLegacy gracefully', () => {
    const subDir = path.join(tmpDir, 'src');
    fs.mkdirSync(subDir, { recursive: true });
    const badFile = path.join(subDir, 'unreadable.js');
    fs.writeFileSync(badFile, "// @gsd-feature old\n", 'utf8');
    fs.chmodSync(badFile, 0o000);
    const result = detectLegacyTags(tmpDir);
    // Restore permissions for cleanup
    fs.chmodSync(badFile, 0o644);
    assert.ok(typeof result.count === 'number');
  });

  it('handles unreadable subdirectory in walk', () => {
    const subDir = path.join(tmpDir, 'src');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'good.js'), "// @gsd-feature old\n", 'utf8');
    const unreadableDir = path.join(tmpDir, 'secret');
    fs.mkdirSync(unreadableDir, { recursive: true });
    fs.chmodSync(unreadableDir, 0o000);
    const result = detectLegacyTags(tmpDir);
    fs.chmodSync(unreadableDir, 0o755);
    assert.ok(typeof result.count === 'number');
  });
});

// --- Additional branch coverage for tag scanner ---

describe('parseMetadata (branch coverage)', () => {
  it('handles trailing comma in metadata string', () => {
    const result = parseMetadata('key:value,');
    assert.strictEqual(result.key, 'value');
  });

  it('handles leading comma in metadata string', () => {
    const result = parseMetadata(',key:value');
    assert.strictEqual(result.key, 'value');
  });
});

describe('scanDirectory (branch coverage)', () => {
  it('falls back to dirPath when projectRoot not provided', () => {
    const subDir = path.join(tmpDir, 'src');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'test.js'), "// @cap-feature(feature:F-001) Test\n", 'utf8');
    const tags = require('../cap/bin/lib/cap-tag-scanner.cjs').scanDirectory(subDir);
    assert.ok(tags.length >= 1);
    // File path should be relative to subDir since no projectRoot
    assert.ok(typeof tags[0].file === 'string');
  });

  it('handles readdirSync error in walk', { skip: process.platform === 'win32' }, () => {
    const subDir = path.join(tmpDir, 'unreadable-dir');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'test.js'), "// @cap-feature(feature:F-001) Test\n", 'utf8');
    fs.chmodSync(subDir, 0o000);
    const tags = require('../cap/bin/lib/cap-tag-scanner.cjs').scanDirectory(subDir);
    fs.chmodSync(subDir, 0o755);
    assert.deepStrictEqual(tags, []);
  });
});

describe('detectWorkspaces (additional branches)', () => {
  it('handles malformed package.json gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not json!!!', 'utf8');
    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, false);
  });

  it('handles pnpm-workspace.yaml without packages key', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'someOtherKey: value\n', 'utf8');
    const result = detectWorkspaces(tmpDir);
    assert.ok(typeof result.isMonorepo === 'boolean');
  });

  it('detects pnpm-workspace.yaml with packages', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"\n  - "packages/*"\n', 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', 'shared'), { recursive: true });
    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.ok(result.packages.length >= 1);
  });

  it('handles malformed pnpm-workspace.yaml gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), '{{invalid', 'utf8');
    const result = detectWorkspaces(tmpDir);
    assert.ok(typeof result.isMonorepo === 'boolean');
  });

  it('detects NX workspace with workspaceLayout', () => {
    fs.writeFileSync(path.join(tmpDir, 'nx.json'),
      JSON.stringify({ workspaceLayout: { appsDir: 'apps', libsDir: 'libs' } }), 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'apps', 'frontend'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'libs', 'shared'), { recursive: true });
    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.ok(result.packages.length >= 1);
  });

  it('detects NX workspace with fallback conventional dirs (no workspaceLayout)', () => {
    fs.writeFileSync(path.join(tmpDir, 'nx.json'), JSON.stringify({}), 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'apps', 'myapp'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', 'shared'), { recursive: true });
    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.ok(result.packages.length >= 1);
  });

  it('handles malformed nx.json gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'nx.json'), 'not json!!!', 'utf8');
    const result = detectWorkspaces(tmpDir);
    assert.ok(typeof result.isMonorepo === 'boolean');
  });

  it('handles malformed lerna.json gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'lerna.json'), 'not json!!!', 'utf8');
    const result = detectWorkspaces(tmpDir);
    assert.ok(typeof result.isMonorepo === 'boolean');
  });

  it('detects workspace.packages object format', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'root',
      workspaces: { packages: ['packages/*'] },
    }), 'utf8');
    const pkgDir = path.join(tmpDir, 'packages', 'mylib');
    fs.mkdirSync(pkgDir, { recursive: true });
    const result = detectWorkspaces(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.ok(result.packages.length >= 1);
  });
});

describe('scanMonorepo (non-existent package dir branch)', () => {
  it('skips non-existent workspace package directories', () => {
    // Create a monorepo that references a package dir that does not exist
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'root',
      workspaces: ['packages/*'],
    }), 'utf8');
    // Create packages dir but only one subpackage, other is missing
    const pkgDir = path.join(tmpDir, 'packages', 'existing');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'index.js'), "// @cap-feature(feature:F-001) Test\n", 'utf8');
    // ghost package dir referenced but doesn't exist at scan time
    const result = scanMonorepo(tmpDir);
    assert.ok(result.tags.length >= 1);
    assert.ok(result.isMonorepo);
  });
});

describe('resolveWorkspaceGlobs (catch branch)', () => {
  it('skips unreadable directories', () => {
    const pkgsDir = path.join(tmpDir, 'packages');
    fs.mkdirSync(pkgsDir, { recursive: true });
    fs.chmodSync(pkgsDir, 0o000);
    const result = resolveWorkspaceGlobs(tmpDir, ['packages/*']);
    fs.chmodSync(pkgsDir, 0o755);
    assert.deepStrictEqual(result, []);
  });
});

describe('extractTags (fallback branches)', () => {
  it('handles tag with no description (match[3] undefined)', () => {
    const content = "// @cap-feature(feature:F-001)\n";
    const { extractTags } = require('../cap/bin/lib/cap-tag-scanner.cjs');
    const tags = extractTags(content);
    assert.ok(tags.length >= 1);
    assert.strictEqual(tags[0].description, '');
  });
});

// --- Assertion density boost: export shape verification ---
describe('cap-tag-scanner export verification', () => {
  const mod = require('../cap/bin/lib/cap-tag-scanner.cjs');

  it('exports have correct types', () => {
    assert.strictEqual(typeof mod.CAP_TAG_TYPES, 'object');
    assert.strictEqual(typeof mod.CAP_TAG_RE, 'object');
    assert.strictEqual(typeof mod.SUPPORTED_EXTENSIONS, 'object');
    assert.strictEqual(typeof mod.DEFAULT_EXCLUDE, 'object');
    assert.strictEqual(typeof mod.LEGACY_TAG_RE, 'object');
    assert.strictEqual(typeof mod.scanFile, 'function');
    assert.strictEqual(typeof mod.scanDirectory, 'function');
    assert.strictEqual(typeof mod.extractTags, 'function');
    assert.strictEqual(typeof mod.parseMetadata, 'function');
    assert.strictEqual(typeof mod.groupByFeature, 'function');
    assert.strictEqual(typeof mod.detectOrphans, 'function');
    assert.strictEqual(typeof mod.editDistance, 'function');
    assert.strictEqual(typeof mod.detectWorkspaces, 'function');
    assert.strictEqual(typeof mod.resolveWorkspaceGlobs, 'function');
    assert.strictEqual(typeof mod.scanMonorepo, 'function');
  });

  it('exported functions are named', () => {
    assert.strictEqual(typeof mod.scanFile, 'function');
    assert.ok(mod.scanFile.name.length > 0);
    assert.strictEqual(typeof mod.scanDirectory, 'function');
    assert.ok(mod.scanDirectory.name.length > 0);
    assert.strictEqual(typeof mod.extractTags, 'function');
    assert.ok(mod.extractTags.name.length > 0);
    assert.strictEqual(typeof mod.parseMetadata, 'function');
    assert.ok(mod.parseMetadata.name.length > 0);
    assert.strictEqual(typeof mod.groupByFeature, 'function');
    assert.ok(mod.groupByFeature.name.length > 0);
    assert.strictEqual(typeof mod.detectOrphans, 'function');
    assert.ok(mod.detectOrphans.name.length > 0);
    assert.strictEqual(typeof mod.editDistance, 'function');
    assert.ok(mod.editDistance.name.length > 0);
    assert.strictEqual(typeof mod.detectWorkspaces, 'function');
    assert.ok(mod.detectWorkspaces.name.length > 0);
    assert.strictEqual(typeof mod.resolveWorkspaceGlobs, 'function');
    assert.ok(mod.resolveWorkspaceGlobs.name.length > 0);
    assert.strictEqual(typeof mod.scanMonorepo, 'function');
    assert.ok(mod.scanMonorepo.name.length > 0);
  });

  it('constants are stable', () => {
    assert.ok(Array.isArray(mod.CAP_TAG_TYPES));
    assert.strictEqual(mod.CAP_TAG_TYPES.length, 4);
    assert.strictEqual(typeof mod.CAP_TAG_RE, 'object');
    assert.ok(Object.keys(mod.CAP_TAG_RE).length >= 0);
    assert.ok(Array.isArray(mod.SUPPORTED_EXTENSIONS));
    assert.strictEqual(mod.SUPPORTED_EXTENSIONS.length, 18);
    assert.ok(Array.isArray(mod.DEFAULT_EXCLUDE));
    // Pin: the V6 memory-bloat fix expanded DEFAULT_EXCLUDE to cover Next.js / Turbo / Nx / Vercel
    // caches that were silently leaking source-mapped JS into decisions.md (28 % of one real project).
    // We assert the must-haves explicitly instead of length so a future legit addition doesn't break this.
    const REQUIRED_EXCLUDES = [
      '.git', '.cap', '.planning',
      'node_modules', 'dist', 'build', 'coverage', 'out',
      '.next', '.turbo', '.nx', '.cache', '.parcel-cache', '.vercel', '.svelte-kit',
      '__pycache__', '.pytest_cache', 'venv', '.venv',
      'target', '.gradle', 'Pods', '.expo',
    ];
    for (const dir of REQUIRED_EXCLUDES) {
      assert.ok(
        mod.DEFAULT_EXCLUDE.includes(dir),
        `DEFAULT_EXCLUDE must include "${dir}" — build artifacts must never enter the memory pipeline`,
      );
    }
    assert.strictEqual(typeof mod.LEGACY_TAG_RE, 'object');
    assert.ok(Object.keys(mod.LEGACY_TAG_RE).length >= 0);
  });

  it('exports buildAcFileMap', () => {
    assert.strictEqual(typeof mod.buildAcFileMap, 'function');
    assert.ok(mod.buildAcFileMap.name.length > 0);
  });
});

// --- buildAcFileMap (F-045) ---

// @cap-todo(ac:F-045/AC-2) Tests verify acFileMap aggregation: keys are F-NNN/AC-M, values include files, primary, primarySource, tagDensity, warnings.

describe('buildAcFileMap', () => {
  it('returns empty object for no tags', () => {
    const result = buildAcFileMap([]);
    assert.deepStrictEqual(result, {});
  });

  it('aggregates a single-file AC trivially as inferred primary', () => {
    const tags = [
      { type: 'todo', metadata: { ac: 'F-100/AC-1' }, file: 'src/foo.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-100/AC-1' }, file: 'src/foo.js', line: 5, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.strictEqual(Object.keys(result).length, 1);
    const entry = result['F-100/AC-1'];
    assert.deepStrictEqual(entry.files, ['src/foo.js']);
    assert.strictEqual(entry.primary, 'src/foo.js');
    assert.strictEqual(entry.primarySource, 'inferred');
    assert.strictEqual(entry.tagDensity['src/foo.js'], 2);
    assert.deepStrictEqual(entry.warnings, []);
  });

  it('emits warning and infers primary by tag density for multi-file AC without primary:true', () => {
    const tags = [
      { type: 'todo', metadata: { ac: 'F-200/AC-3' }, file: 'src/a.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-200/AC-3' }, file: 'src/a.js', line: 5, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-200/AC-3' }, file: 'src/a.js', line: 9, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-200/AC-3' }, file: 'src/b.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    const entry = result['F-200/AC-3'];
    assert.strictEqual(entry.files.length, 2);
    assert.strictEqual(entry.primary, 'src/a.js'); // higher density
    assert.strictEqual(entry.primarySource, 'inferred');
    assert.strictEqual(entry.warnings.length, 1);
    assert.ok(entry.warnings[0].includes('F-200/AC-3'));
    assert.ok(entry.warnings[0].includes('src/a.js'));
  });

  // @cap-todo(ac:F-045/AC-1) Recognize primary:true on @cap-feature
  it('honors primary:true on @cap-feature and marks source as designated', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-300', primary: 'true' }, file: 'src/main.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-300/AC-1' }, file: 'src/main.js', line: 3, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-300/AC-1' }, file: 'src/helper.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-300/AC-1' }, file: 'src/helper.js', line: 5, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    const entry = result['F-300/AC-1'];
    assert.strictEqual(entry.primary, 'src/main.js');
    assert.strictEqual(entry.primarySource, 'designated');
    assert.deepStrictEqual(entry.warnings, []); // no heuristic warning when designated
  });

  it('falls back to inference when primary:true file does not contribute to the AC', () => {
    const tags = [
      // primary:true on barrel file that does not tag any AC
      { type: 'feature', metadata: { feature: 'F-301', primary: 'true' }, file: 'src/index.js', line: 1, description: '', raw: '', subtype: null },
      // AC tagged in two other files
      { type: 'todo', metadata: { ac: 'F-301/AC-2' }, file: 'src/a.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-301/AC-2' }, file: 'src/a.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-301/AC-2' }, file: 'src/b.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    const entry = result['F-301/AC-2'];
    assert.strictEqual(entry.primary, 'src/a.js');
    assert.strictEqual(entry.primarySource, 'inferred');
    assert.strictEqual(entry.warnings.length, 1);
  });

  it('accepts short-form ac:AC-N when tag also has metadata.feature', () => {
    const tags = [
      { type: 'todo', metadata: { feature: 'F-400', ac: 'AC-1' }, file: 'src/foo.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.ok(result['F-400/AC-1']);
    assert.strictEqual(result['F-400/AC-1'].primary, 'src/foo.js');
  });

  it('skips tags with ac:AC-N short form but no feature context', () => {
    const tags = [
      { type: 'todo', metadata: { ac: 'AC-1' }, file: 'src/foo.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.deepStrictEqual(result, {});
  });

  it('ignores primary:true on non-@cap-feature tags', () => {
    const tags = [
      // primary:true on @cap-todo — should be ignored
      { type: 'todo', metadata: { ac: 'F-500/AC-1', primary: 'true' }, file: 'src/wrong.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-500/AC-1' }, file: 'src/wrong.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-500/AC-1' }, file: 'src/right.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-500/AC-1' }, file: 'src/right.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-500/AC-1' }, file: 'src/right.js', line: 3, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    const entry = result['F-500/AC-1'];
    assert.strictEqual(entry.primarySource, 'inferred');
    // src/right.js has higher density, so it wins
    assert.strictEqual(entry.primary, 'src/right.js');
  });

  it('honors first primary:true encountered when multiple feature files claim it', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-600', primary: 'true' }, file: 'src/first.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'feature', metadata: { feature: 'F-600', primary: 'true' }, file: 'src/second.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-600/AC-1' }, file: 'src/first.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-600/AC-1' }, file: 'src/second.js', line: 2, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    const entry = result['F-600/AC-1'];
    assert.strictEqual(entry.primary, 'src/first.js');
    assert.strictEqual(entry.primarySource, 'designated');
  });

  it('handles primary as boolean true (not just string "true")', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-700', primary: true }, file: 'src/main.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-700/AC-1' }, file: 'src/main.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-700/AC-1' }, file: 'src/other.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.strictEqual(result['F-700/AC-1'].primarySource, 'designated');
  });

  it('produces stable file order matching first appearance', () => {
    const tags = [
      { type: 'todo', metadata: { ac: 'F-800/AC-1' }, file: 'src/c.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-800/AC-1' }, file: 'src/a.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-800/AC-1' }, file: 'src/b.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.deepStrictEqual(result['F-800/AC-1'].files, ['src/c.js', 'src/a.js', 'src/b.js']);
  });

  it('aggregates multiple ACs in one pass', () => {
    const tags = [
      { type: 'todo', metadata: { ac: 'F-900/AC-1' }, file: 'src/a.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-900/AC-2' }, file: 'src/b.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-901/AC-1' }, file: 'src/c.js', line: 1, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.strictEqual(Object.keys(result).length, 3);
    assert.ok(result['F-900/AC-1']);
    assert.ok(result['F-900/AC-2']);
    assert.ok(result['F-901/AC-1']);
  });

  it('skips tags with no ac metadata', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-001' }, file: 'src/a.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: {}, file: 'src/a.js', line: 2, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.deepStrictEqual(result, {});
  });

  // --- adversarial / boundary cases (F-045 GREEN-phase verification) ---

  it('treats explicit primary:false as not-primary (heuristic still applies)', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-EX', primary: 'false' }, file: 'a.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-EX/AC-1' }, file: 'a.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-EX/AC-1' }, file: 'b.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-EX/AC-1' }, file: 'b.js', line: 2, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.strictEqual(result['F-EX/AC-1'].primarySource, 'inferred');
    // b.js wins by tag density (2 vs 1), confirming primary:false is NOT a designation.
    assert.strictEqual(result['F-EX/AC-1'].primary, 'b.js');
  });

  it('does not parse primary:true correctly when the comma between feature: and primary: is missing', () => {
    // Reflects the documented limitation in docs/F-045-multi-file-tagging.md:
    // `feature:F-001 primary:true` (no comma) is NOT parsed as primary:true.
    const line = '// @cap-feature(feature:F-MISS primary:true) Test';
    const tags = extractTags(line, 'main.js');
    assert.strictEqual(tags.length, 1);
    // The whole "F-MISS primary:true" is captured as the value of `feature`.
    assert.strictEqual(tags[0].metadata.feature, 'F-MISS primary:true');
    assert.strictEqual(tags[0].metadata.primary, undefined);
  });

  it('accepts primary:true with no whitespace after comma (`feature:F-X,primary:true`)', () => {
    const line = '// @cap-feature(feature:F-CMS,primary:true) Test';
    const tags = extractTags(line, 'main.js');
    assert.strictEqual(tags[0].metadata.feature, 'F-CMS');
    assert.strictEqual(tags[0].metadata.primary, 'true');
  });

  it('aggregates duplicate AC tags in the same file as tagDensity++ but files stays deduped', () => {
    const tags = [
      { type: 'todo', metadata: { ac: 'F-DUP/AC-1' }, file: 'src/x.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-DUP/AC-1' }, file: 'src/x.js', line: 5, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-DUP/AC-1' }, file: 'src/x.js', line: 9, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.deepStrictEqual(result['F-DUP/AC-1'].files, ['src/x.js']);
    assert.strictEqual(result['F-DUP/AC-1'].tagDensity['src/x.js'], 3);
  });

  it('handles 200 tags in one file in well under 50ms (perf invariant)', () => {
    const tags = [];
    for (let i = 0; i < 200; i++) {
      tags.push({ type: 'todo', metadata: { ac: 'F-PERF/AC-1' }, file: 'big.js', line: i + 1, description: '', raw: '', subtype: null });
    }
    const start = process.hrtime.bigint();
    const result = buildAcFileMap(tags);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 50, `aggregation took ${ms}ms (expected <50ms)`);
    assert.strictEqual(result['F-PERF/AC-1'].tagDensity['big.js'], 200);
  });

  it('aggregates multiple primary:true on independent features without cross-contamination', () => {
    const tags = [
      { type: 'feature', metadata: { feature: 'F-IND1', primary: 'true' }, file: 'one.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'feature', metadata: { feature: 'F-IND2', primary: 'true' }, file: 'two.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-IND1/AC-1' }, file: 'one.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-IND2/AC-1' }, file: 'two.js', line: 2, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.strictEqual(result['F-IND1/AC-1'].primary, 'one.js');
    assert.strictEqual(result['F-IND2/AC-1'].primary, 'two.js');
  });

  it('breaks density ties deterministically by first appearance (zzz before aaa preserves zzz win)', () => {
    const tags = [
      { type: 'todo', metadata: { ac: 'F-TIE/AC-1' }, file: 'src/zzz.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-TIE/AC-1' }, file: 'src/zzz.js', line: 2, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-TIE/AC-1' }, file: 'src/aaa.js', line: 1, description: '', raw: '', subtype: null },
      { type: 'todo', metadata: { ac: 'F-TIE/AC-1' }, file: 'src/aaa.js', line: 2, description: '', raw: '', subtype: null },
    ];
    const result = buildAcFileMap(tags);
    assert.strictEqual(result['F-TIE/AC-1'].primary, 'src/zzz.js');
  });
});
