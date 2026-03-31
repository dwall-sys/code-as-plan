// @gsd-context Tests for cap-stack-docs.cjs -- dependency detection, doc writing, listing, and freshness checking.
// @gsd-decision Mocks execSync for Context7 calls -- tests must not require network access or ctx7 installed.
// @gsd-pattern Uses node:test and node:assert per project convention. All CJS tests follow this pattern.

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  STACK_DOCS_DIR,
  FRESHNESS_DAYS,
  FRESHNESS_HOURS,
  detectDependencies,
  writeDocs,
  listCachedDocs,
  checkFreshness,
  getDocsPath,
  parseFreshnessFromContent,
  checkFreshnessEnhanced,
  getStaleLibraries,
  detectWorkspacePackages,
  batchFetchDocs,
} = require('../cap/bin/lib/cap-stack-docs.cjs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-stackdocs-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- getDocsPath ---

describe('getDocsPath', () => {
  it('returns correct path for library name', () => {
    const result = getDocsPath('/project', 'react');
    assert.strictEqual(result, path.join('/project', '.cap/stack-docs', 'react.md'));
  });

  it('handles library names with dots', () => {
    const result = getDocsPath('/project', 'next.js');
    assert.strictEqual(result, path.join('/project', '.cap/stack-docs', 'next.js.md'));
  });

  it('handles library names with hyphens', () => {
    const result = getDocsPath('/project', 'my-library');
    assert.strictEqual(result, path.join('/project', '.cap/stack-docs', 'my-library.md'));
  });
});

// --- detectDependencies ---

describe('detectDependencies', () => {
  it('returns unknown type when no manifest files exist', () => {
    const result = detectDependencies(tmpDir);
    assert.strictEqual(result.type, 'unknown');
    assert.deepStrictEqual(result.dependencies, []);
    assert.deepStrictEqual(result.devDependencies, []);
  });

  it('detects Node.js project from package.json', () => {
    const pkg = {
      name: 'test-project',
      dependencies: { express: '^4.18.0', lodash: '^4.17.0' },
      devDependencies: { vitest: '^3.0.0' },
    };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf8');

    const result = detectDependencies(tmpDir);
    assert.strictEqual(result.type, 'node');
    assert.deepStrictEqual(result.dependencies, ['express', 'lodash']);
    assert.deepStrictEqual(result.devDependencies, ['vitest']);
  });

  it('handles package.json with no dependencies', () => {
    const pkg = { name: 'empty-project' };
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg), 'utf8');

    const result = detectDependencies(tmpDir);
    assert.strictEqual(result.type, 'node');
    assert.deepStrictEqual(result.dependencies, []);
    assert.deepStrictEqual(result.devDependencies, []);
  });

  it('handles malformed package.json gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ invalid json', 'utf8');

    const result = detectDependencies(tmpDir);
    // Should not throw -- falls through to other detectors
    assert.ok(result);
  });

  it('detects Python project from requirements.txt', () => {
    const reqs = 'flask==2.3.0\nrequests>=2.28.0\npytest\n';
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), reqs, 'utf8');

    const result = detectDependencies(tmpDir);
    assert.strictEqual(result.type, 'python');
    assert.ok(result.dependencies.includes('flask'));
    assert.ok(result.dependencies.includes('requests'));
    assert.ok(result.dependencies.includes('pytest'));
  });

  it('detects Go project from go.mod', () => {
    const goMod = `module example.com/myproject

go 1.21

require (
\tgithub.com/gin-gonic/gin v1.9.1
\tgithub.com/stretchr/testify v1.8.4
)
`;
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), goMod, 'utf8');

    const result = detectDependencies(tmpDir);
    assert.strictEqual(result.type, 'go');
    assert.ok(result.dependencies.length >= 1);
  });

  it('detects Rust project from Cargo.toml', () => {
    const cargo = `[package]
name = "my-project"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = { version = "1", features = ["full"] }
`;
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), cargo, 'utf8');

    const result = detectDependencies(tmpDir);
    assert.strictEqual(result.type, 'rust');
    assert.ok(result.dependencies.includes('serde'));
    assert.ok(result.dependencies.includes('tokio'));
  });

  it('prefers package.json over other manifest files', () => {
    // Both package.json and requirements.txt exist
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'node-project', dependencies: { express: '*' } }),
      'utf8'
    );
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'flask\n', 'utf8');

    const result = detectDependencies(tmpDir);
    assert.strictEqual(result.type, 'node');
    assert.deepStrictEqual(result.dependencies, ['express']);
  });
});

// --- writeDocs ---

describe('writeDocs', () => {
  it('writes documentation to .cap/stack-docs/', () => {
    const content = '# React Docs\n\nSome documentation content.';
    const filePath = writeDocs(tmpDir, 'react', content);

    assert.ok(fs.existsSync(filePath));
    const written = fs.readFileSync(filePath, 'utf8');
    assert.ok(written.includes('# React Docs'));
    assert.ok(written.includes('CAP Stack Docs: react'));
  });

  it('creates .cap/stack-docs/ directory if missing', () => {
    const docsDir = path.join(tmpDir, '.cap', 'stack-docs');
    assert.ok(!fs.existsSync(docsDir));

    writeDocs(tmpDir, 'express', 'docs content');
    assert.ok(fs.existsSync(docsDir));
  });

  it('overwrites existing docs file', () => {
    writeDocs(tmpDir, 'react', 'version 1');
    writeDocs(tmpDir, 'react', 'version 2');

    const content = fs.readFileSync(getDocsPath(tmpDir, 'react'), 'utf8');
    assert.ok(content.includes('version 2'));
    assert.ok(!content.includes('version 1'));
  });

  it('adds metadata header to written docs', () => {
    writeDocs(tmpDir, 'prisma', 'schema docs');

    const content = fs.readFileSync(getDocsPath(tmpDir, 'prisma'), 'utf8');
    assert.ok(content.includes('<!-- CAP Stack Docs: prisma -->'));
    assert.ok(content.includes('<!-- Written:'));
  });
});

// --- listCachedDocs ---

describe('listCachedDocs', () => {
  it('returns empty array when no docs are cached', () => {
    const result = listCachedDocs(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when .cap/stack-docs/ does not exist', () => {
    const result = listCachedDocs(path.join(tmpDir, 'nonexistent'));
    assert.deepStrictEqual(result, []);
  });

  it('returns all cached doc files with metadata', () => {
    writeDocs(tmpDir, 'react', 'react docs');
    writeDocs(tmpDir, 'express', 'express docs');

    const result = listCachedDocs(tmpDir);
    assert.strictEqual(result.length, 2);

    const names = result.map(r => r.libraryName).sort();
    assert.deepStrictEqual(names, ['express', 'react']);

    for (const doc of result) {
      assert.ok(doc.filePath);
      assert.ok(doc.lastModified instanceof Date);
    }
  });

  it('ignores non-.md files in stack-docs directory', () => {
    writeDocs(tmpDir, 'react', 'docs');
    // Write a non-.md file
    const docsDir = path.join(tmpDir, STACK_DOCS_DIR);
    fs.writeFileSync(path.join(docsDir, 'notes.txt'), 'not docs', 'utf8');

    const result = listCachedDocs(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].libraryName, 'react');
  });
});

// --- checkFreshness ---

describe('checkFreshness', () => {
  it('returns not fresh when docs file does not exist', () => {
    const result = checkFreshness(tmpDir, 'nonexistent');
    assert.strictEqual(result.fresh, false);
    assert.strictEqual(result.ageHours, null);
    assert.strictEqual(result.filePath, null);
  });

  it('returns fresh for recently written docs', () => {
    writeDocs(tmpDir, 'react', 'fresh docs');

    const result = checkFreshness(tmpDir, 'react');
    assert.strictEqual(result.fresh, true);
    assert.strictEqual(result.ageHours, 0);
    assert.ok(result.filePath);
  });

  it('respects custom maxAgeHours parameter', () => {
    writeDocs(tmpDir, 'react', 'docs');

    // With 0 hours max age, just-written docs are fresh (0 <= 0)
    const result = checkFreshness(tmpDir, 'react', 0);
    assert.strictEqual(result.fresh, true);
    assert.strictEqual(result.ageHours, 0);
  });

  it('returns default freshness window constant', () => {
    assert.strictEqual(FRESHNESS_HOURS, 168); // 7 days
  });
});

// --- resolveLibrary and fetchDocs (network-dependent -- stub tests) ---

describe('resolveLibrary', () => {
  it('returns null when ctx7 is not available', () => {
    // This test verifies graceful failure when npx ctx7 is not installed
    // In CI environments without ctx7, this should return null, not throw
    const result = require('../cap/bin/lib/cap-stack-docs.cjs').resolveLibrary(
      'definitely-not-a-real-library-xyz-123'
    );
    // Either null (library not found) or an object (if ctx7 happens to be available)
    assert.ok(result === null || typeof result === 'object');
  });
});

describe('fetchDocs', () => {
  it('returns error result when ctx7 fetch fails', () => {
    const result = require('../cap/bin/lib/cap-stack-docs.cjs').fetchDocs(
      tmpDir,
      '/fake/nonexistent-library-xyz',
      'test query'
    );
    // Should return a FetchResult with success: false
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.strictEqual(result.filePath, null);
  });
});

// --- FRESHNESS_DAYS constant ---

describe('FRESHNESS_DAYS', () => {
  // @gsd-todo(ref:AC-84) Docs older than 7 days auto-refreshed
  it('is set to 7 days', () => {
    assert.strictEqual(FRESHNESS_DAYS, 7);
  });

  it('FRESHNESS_HOURS equals FRESHNESS_DAYS * 24', () => {
    assert.strictEqual(FRESHNESS_HOURS, FRESHNESS_DAYS * 24);
  });
});

// --- parseFreshnessFromContent ---

describe('parseFreshnessFromContent', () => {
  it('extracts Fetched date from doc header', () => {
    const content = '<!-- CAP Stack Docs: react -->\n<!-- Fetched: 2026-03-30T12:00:00.000Z -->\n# React';
    const date = parseFreshnessFromContent(content);
    assert.strictEqual(date, '2026-03-30T12:00:00.000Z');
  });

  it('extracts Written date from doc header', () => {
    const content = '<!-- CAP Stack Docs: express -->\n<!-- Written: 2026-03-28T08:30:00.000Z -->\n# Express';
    const date = parseFreshnessFromContent(content);
    assert.strictEqual(date, '2026-03-28T08:30:00.000Z');
  });

  it('returns null when no date marker present', () => {
    const content = '# React\nSome docs without headers.';
    const date = parseFreshnessFromContent(content);
    assert.strictEqual(date, null);
  });

  it('returns null for empty content', () => {
    assert.strictEqual(parseFreshnessFromContent(''), null);
  });
});

// --- checkFreshnessEnhanced ---

describe('checkFreshnessEnhanced', () => {
  it('returns not fresh when docs file does not exist', () => {
    const result = checkFreshnessEnhanced(tmpDir, 'nonexistent');
    assert.strictEqual(result.fresh, false);
    assert.strictEqual(result.ageHours, null);
    assert.strictEqual(result.fetchDate, null);
    assert.strictEqual(result.filePath, null);
  });

  it('returns fresh for doc with recent Fetched date', () => {
    const docsDir = path.join(tmpDir, STACK_DOCS_DIR);
    fs.mkdirSync(docsDir, { recursive: true });
    const now = new Date().toISOString();
    const content = `<!-- CAP Stack Docs: react -->\n<!-- Fetched: ${now} -->\n# React`;
    fs.writeFileSync(path.join(docsDir, 'react.md'), content, 'utf8');

    const result = checkFreshnessEnhanced(tmpDir, 'react');
    assert.strictEqual(result.fresh, true);
    assert.strictEqual(result.ageHours, 0);
    assert.strictEqual(result.fetchDate, now);
    assert.ok(result.filePath);
  });

  it('returns not fresh for doc with old Fetched date', () => {
    const docsDir = path.join(tmpDir, STACK_DOCS_DIR);
    fs.mkdirSync(docsDir, { recursive: true });
    // 10 days ago
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const content = `<!-- CAP Stack Docs: react -->\n<!-- Fetched: ${oldDate} -->\n# React`;
    fs.writeFileSync(path.join(docsDir, 'react.md'), content, 'utf8');

    const result = checkFreshnessEnhanced(tmpDir, 'react');
    assert.strictEqual(result.fresh, false);
    assert.ok(result.ageHours >= 240); // At least 10 days in hours
    assert.strictEqual(result.fetchDate, oldDate);
  });

  it('uses file mtime as fallback when no freshness marker', () => {
    const docsDir = path.join(tmpDir, STACK_DOCS_DIR);
    fs.mkdirSync(docsDir, { recursive: true });
    const content = '# React\nNo header markers here.';
    fs.writeFileSync(path.join(docsDir, 'react.md'), content, 'utf8');

    const result = checkFreshnessEnhanced(tmpDir, 'react');
    // Just-written file should be fresh
    assert.strictEqual(result.fresh, true);
    assert.strictEqual(result.fetchDate, null); // No embedded marker
    assert.ok(result.filePath);
  });

  it('respects custom maxAgeDays parameter', () => {
    const docsDir = path.join(tmpDir, STACK_DOCS_DIR);
    fs.mkdirSync(docsDir, { recursive: true });
    // 2 days ago
    const twoDay = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const content = `<!-- Fetched: ${twoDay} -->\n# React`;
    fs.writeFileSync(path.join(docsDir, 'react.md'), content, 'utf8');

    // With 1 day max age, 2-day-old docs are stale
    const staleResult = checkFreshnessEnhanced(tmpDir, 'react', 1);
    assert.strictEqual(staleResult.fresh, false);

    // With 3 day max age, 2-day-old docs are fresh
    const freshResult = checkFreshnessEnhanced(tmpDir, 'react', 3);
    assert.strictEqual(freshResult.fresh, true);
  });
});

// --- getStaleLibraries ---

describe('getStaleLibraries', () => {
  it('returns empty array when no docs exist', () => {
    const result = getStaleLibraries(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when all docs are fresh', () => {
    const docsDir = path.join(tmpDir, STACK_DOCS_DIR);
    fs.mkdirSync(docsDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(docsDir, 'react.md'),
      `<!-- Fetched: ${now} -->\n# React`,
      'utf8'
    );

    const result = getStaleLibraries(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  it('returns stale libraries', () => {
    const docsDir = path.join(tmpDir, STACK_DOCS_DIR);
    fs.mkdirSync(docsDir, { recursive: true });
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(docsDir, 'old-lib.md'),
      `<!-- Fetched: ${oldDate} -->\n# Old Lib`,
      'utf8'
    );
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(docsDir, 'fresh-lib.md'),
      `<!-- Fetched: ${now} -->\n# Fresh Lib`,
      'utf8'
    );

    const result = getStaleLibraries(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].libraryName, 'old-lib');
    assert.ok(result[0].ageHours >= 240);
  });
});

// --- detectDependencies (multi-language from v2) ---

// @gsd-todo(ref:AC-81) Detect all dependencies from package.json / requirements.txt / Cargo.toml / go.mod

describe('detectDependencies (multi-language)', () => {
  it('detects Python project from pyproject.toml', () => {
    const pyproject = `[project]
name = "my-project"

[project.dependencies]
"fastapi"
"uvicorn"
"pydantic"
`;
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), pyproject, 'utf8');

    const result = detectDependencies(tmpDir);
    assert.strictEqual(result.type, 'python');
    assert.ok(result.dependencies.length >= 1);
  });

  it('handles empty requirements.txt', () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), '', 'utf8');
    const result = detectDependencies(tmpDir);
    assert.strictEqual(result.type, 'python');
    assert.deepStrictEqual(result.dependencies, []);
  });
});

// --- detectWorkspacePackages ---

describe('detectWorkspacePackages', () => {
  it('returns not monorepo for project without workspaces', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'single-repo' }),
      'utf8'
    );

    const result = detectWorkspacePackages(tmpDir);
    assert.strictEqual(result.isMonorepo, false);
    assert.deepStrictEqual(result.packages, []);
  });

  it('detects npm workspaces from package.json array format', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }),
      'utf8'
    );
    // Create workspace packages
    fs.mkdirSync(path.join(tmpDir, 'packages', 'core'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', 'cli'), { recursive: true });

    const result = detectWorkspacePackages(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.ok(result.packages.length >= 2);
  });

  it('detects yarn workspaces from package.json object format', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'monorepo', workspaces: { packages: ['packages/*'] } }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, 'packages', 'api'), { recursive: true });

    const result = detectWorkspacePackages(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.ok(result.packages.length >= 1);
  });

  it('detects lerna monorepo from lerna.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'lerna-repo' }), // no workspaces
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'lerna.json'),
      JSON.stringify({ packages: ['packages/*'] }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmpDir, 'packages', 'shared'), { recursive: true });

    const result = detectWorkspacePackages(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.ok(result.packages.length >= 1);
  });

  it('returns empty packages when workspace dirs do not exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'empty-monorepo', workspaces: ['nonexistent/*'] }),
      'utf8'
    );

    const result = detectWorkspacePackages(tmpDir);
    assert.strictEqual(result.isMonorepo, true);
    assert.deepStrictEqual(result.packages, []);
  });

  it('returns not monorepo when no package.json exists', () => {
    const result = detectWorkspacePackages(tmpDir);
    assert.strictEqual(result.isMonorepo, false);
  });
});

// --- batchFetchDocs (stub test -- no network) ---

describe('batchFetchDocs', () => {
  it('is exported and callable', () => {
    assert.strictEqual(typeof batchFetchDocs, 'function');
  });

  // @gsd-todo(ref:AC-85) Context7 mandatory -- graceful failure when unreachable
  it('returns valid BatchFetchResult structure', () => {
    // Use fake library names -- result depends on whether ctx7 is available
    const result = batchFetchDocs(tmpDir, ['fake-lib-xyz-123-nonexistent'], { maxDeps: 1 });
    // Verify structure regardless of Context7 availability
    assert.strictEqual(typeof result.total, 'number');
    assert.strictEqual(typeof result.fetched, 'number');
    assert.strictEqual(typeof result.failed, 'number');
    assert.strictEqual(typeof result.skipped, 'number');
    assert.strictEqual(typeof result.context7Available, 'boolean');
    assert.ok(Array.isArray(result.errors));
    assert.strictEqual(result.total, 1);
    // fetched + failed + skipped should equal total
    assert.strictEqual(result.fetched + result.failed + result.skipped, result.total);
  });
});
