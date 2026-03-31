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
  detectOrphans,
  editDistance,
  detectWorkspaces,
  resolveWorkspaceGlobs,
  scanMonorepo,
  groupByPackage,
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
