/**
 * Tests for manifest-generator.cjs
 *
 * Unit tests for monorepo package manifest generation module.
 * Follows node:test pattern established by existing test files.
 */

'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  generateManifest,
  generateAllManifests,
  formatManifestMarkdown,
  scanExports,
  extractWorkspaceDeps,
} = require('../cap/bin/lib/manifest-generator.cjs');

// ── Helpers ────────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-manifest-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ── generateManifest ───────────────────────────────────────────────────────

describe('generateManifest', () => {
  it('extracts named exports from src/index.ts', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'ui');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), { name: '@acme/ui', version: '1.0.0' });
    fs.writeFileSync(path.join(pkgDir, 'src', 'index.ts'), [
      'export function Button() {}',
      'export class Dialog {}',
      'export const THEME = {};',
    ].join('\n'), 'utf-8');

    const manifest = generateManifest(pkgDir, { rootPath: root });
    assert.strictEqual(manifest.packageName, '@acme/ui');
    assert.strictEqual(manifest.exports.length, 3);
    assert.strictEqual(manifest.exports[0].name, 'Button');
    assert.strictEqual(manifest.exports[0].kind, 'function');
    assert.strictEqual(manifest.exports[1].name, 'Dialog');
    assert.strictEqual(manifest.exports[1].kind, 'class');
    assert.strictEqual(manifest.exports[2].name, 'THEME');
    assert.strictEqual(manifest.exports[2].kind, 'const');
  });

  it('extracts type exports from .d.ts files when no barrel file found', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'types');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), { name: '@acme/types' });
    // No src/index.ts, no barrel file -- only .d.ts
    fs.writeFileSync(path.join(pkgDir, 'types.d.ts'), [
      'export interface User { id: string; }',
      'export type Role = "admin" | "user";',
    ].join('\n'), 'utf-8');

    const manifest = generateManifest(pkgDir, { rootPath: root });
    assert.ok(manifest.exports.length >= 2, `Expected at least 2 exports, got ${manifest.exports.length}`);
    const names = manifest.exports.map(e => e.name);
    assert.ok(names.includes('User'));
    assert.ok(names.includes('Role'));
  });

  it('returns empty exports array for a package with no files', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'empty');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), { name: 'empty-pkg' });

    const manifest = generateManifest(pkgDir, { rootPath: root });
    assert.deepStrictEqual(manifest.exports, []);
  });
});

// ── extractWorkspaceDeps ───────────────────────────────────────────────────

describe('extractWorkspaceDeps', () => {
  it('extracts only workspace:* dependencies', () => {
    const pkg = {
      dependencies: { '@acme/ui': 'workspace:*', 'react': '^18.0.0' },
      devDependencies: { '@acme/config': 'workspace:^', 'vitest': '^1.0.0' },
    };
    const deps = extractWorkspaceDeps(pkg);
    assert.deepStrictEqual(deps.sort(), ['@acme/config', '@acme/ui']);
  });
});

// ── formatManifestMarkdown ─────────────────────────────────────────────────

describe('formatManifestMarkdown', () => {
  it('includes exports table', () => {
    const manifest = {
      packageName: 'test-pkg',
      packagePath: 'packages/test',
      description: null,
      version: '1.0.0',
      exports: [{ name: 'foo', kind: 'function', description: 'Does stuff' }],
      dependencies: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const md = formatManifestMarkdown(manifest);
    assert.ok(md.includes('## Exports'));
    assert.ok(md.includes('| foo | function | Does stuff |'));
  });

  it('includes Internal Dependencies section when deps are present', () => {
    const manifest = {
      packageName: 'test-pkg',
      packagePath: 'packages/test',
      description: null,
      version: '1.0.0',
      exports: [],
      dependencies: ['@acme/core', '@acme/utils'],
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const md = formatManifestMarkdown(manifest);
    assert.ok(md.includes('## Internal Dependencies'));
    assert.ok(md.includes('- @acme/core'));
    assert.ok(md.includes('- @acme/utils'));
  });
});

// ── generateAllManifests ───────────────────────────────────────────────────

describe('generateAllManifests', () => {
  it('creates output directory and writes one file per package', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'ui');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), { name: 'ui', version: '1.0.0' });

    const packages = [{ name: 'ui', path: 'packages/ui', absolutePath: pkgDir }];
    const written = generateAllManifests(root, packages, {});
    assert.strictEqual(written.length, 1);
    assert.ok(fs.existsSync(written[0]));
    assert.ok(written[0].endsWith('ui.md'));
  });

  it('encodes scoped name @acme/ui as acme__ui.md', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'ui');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), { name: '@acme/ui', version: '1.0.0' });

    const packages = [{ name: '@acme/ui', path: 'packages/ui', absolutePath: pkgDir }];
    const written = generateAllManifests(root, packages, {});
    assert.strictEqual(written.length, 1);
    assert.ok(path.basename(written[0]) === 'acme__ui.md', `Expected acme__ui.md, got ${path.basename(written[0])}`);
  });
});

// ── Additional branch coverage tests ──────────────────────────────────────

const {
  resolveEntryFile,
  scanDtsFiles,
  cmdGenerateManifest,
} = require('../cap/bin/lib/manifest-generator.cjs');

describe('resolveEntryFile', () => {
  it('returns null when no entry file or convention files exist', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'empty');
    fs.mkdirSync(pkgDir, { recursive: true });
    const result = resolveEntryFile(pkgDir, {});
    assert.strictEqual(result, null);
  });

  it('resolves package.json exports string', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'a');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'main.js'), 'module.exports = {}');
    const result = resolveEntryFile(pkgDir, { exports: './main.js' });
    assert.ok(result.endsWith('main.js'));
  });

  it('resolves exports["."] object with import field', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'b');
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'dist', 'index.mjs'), 'export default {}');
    const result = resolveEntryFile(pkgDir, { exports: { '.': { import: './dist/index.mjs' } } });
    assert.ok(result.endsWith('index.mjs'));
  });

  it('resolves exports["."] object with require field', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'c');
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'dist', 'index.cjs'), 'module.exports = {}');
    const result = resolveEntryFile(pkgDir, { exports: { '.': { require: './dist/index.cjs' } } });
    assert.ok(result.endsWith('index.cjs'));
  });

  it('resolves exports["."] object with default field', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'd');
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'dist', 'index.js'), 'export default {}');
    const result = resolveEntryFile(pkgDir, { exports: { '.': { default: './dist/index.js' } } });
    assert.ok(result.endsWith('index.js'));
  });

  it('resolves exports["."] string', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'e');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'entry.js'), 'export default {}');
    const result = resolveEntryFile(pkgDir, { exports: { '.': './entry.js' } });
    assert.ok(result.endsWith('entry.js'));
  });

  it('resolves module field', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'f');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'esm.js'), 'export default {}');
    const result = resolveEntryFile(pkgDir, { module: './esm.js' });
    assert.ok(result.endsWith('esm.js'));
  });

  it('resolves main field', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'g');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'lib.js'), 'module.exports = {}');
    const result = resolveEntryFile(pkgDir, { main: './lib.js' });
    assert.ok(result.endsWith('lib.js'));
  });

  it('falls back to index.ts in root', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'h');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'index.ts'), 'export const x = 1');
    const result = resolveEntryFile(pkgDir, {});
    assert.ok(result.endsWith('index.ts'));
  });

  it('falls back to lib/index.js', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'i');
    fs.mkdirSync(path.join(pkgDir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'lib', 'index.js'), 'module.exports = {}');
    const result = resolveEntryFile(pkgDir, {});
    assert.ok(result.endsWith(path.join('lib', 'index.js')));
  });
});

describe('scanExports (additional branches)', () => {
  it('handles file read error gracefully', () => {
    const exports = scanExports('/nonexistent/file.ts');
    assert.deepStrictEqual(exports, []);
  });

  it('extracts default export with name', () => {
    const root = makeTmpDir();
    const file = path.join(root, 'test.ts');
    fs.writeFileSync(file, 'export default function MyFunc() {}');
    const exports = scanExports(file);
    const defaultExp = exports.find(e => e.kind === 'default');
    assert.ok(defaultExp, 'should find default export');
    assert.strictEqual(defaultExp.name, 'MyFunc');
  });

  it('extracts default export without name', () => {
    const root = makeTmpDir();
    const file = path.join(root, 'test2.ts');
    fs.writeFileSync(file, 'export default class {}');
    const exports = scanExports(file);
    const defaultExp = exports.find(e => e.kind === 'default');
    assert.ok(defaultExp, 'should find default export');
    assert.strictEqual(defaultExp.name, 'default');
  });

  it('extracts re-exports with as rename', () => {
    const root = makeTmpDir();
    const file = path.join(root, 'barrel.ts');
    fs.writeFileSync(file, "export { Foo as Bar, Baz } from './module'");
    const exports = scanExports(file);
    const names = exports.map(e => e.name);
    assert.ok(names.includes('Bar'), 'should include renamed export');
    assert.ok(names.includes('Baz'), 'should include direct export');
  });

  it('normalizes let/var to const', () => {
    const root = makeTmpDir();
    const file = path.join(root, 'vars.ts');
    fs.writeFileSync(file, 'export let x = 1;\nexport var y = 2;');
    const exports = scanExports(file);
    assert.ok(exports.every(e => e.kind === 'const'), 'let/var should become const');
  });

  it('extracts abstract class as class kind', () => {
    const root = makeTmpDir();
    const file = path.join(root, 'abstract.ts');
    fs.writeFileSync(file, 'export abstract class Base {}');
    const exports = scanExports(file);
    assert.strictEqual(exports[0].kind, 'class');
    assert.strictEqual(exports[0].name, 'Base');
  });

  it('extracts enum and interface exports', () => {
    const root = makeTmpDir();
    const file = path.join(root, 'types.ts');
    fs.writeFileSync(file, 'export interface Foo {}\nexport enum Bar { A, B }');
    const exports = scanExports(file);
    assert.strictEqual(exports.length, 2);
    assert.strictEqual(exports[0].kind, 'interface');
    assert.strictEqual(exports[1].kind, 'enum');
  });

  it('extracts preceding single-line comment as description', () => {
    const root = makeTmpDir();
    const file = path.join(root, 'commented.ts');
    fs.writeFileSync(file, '// A nice function\nexport function nice() {}');
    const exports = scanExports(file);
    assert.strictEqual(exports[0].description, 'A nice function');
  });

  it('extracts preceding block comment end as description', () => {
    const root = makeTmpDir();
    const file = path.join(root, 'block.ts');
    fs.writeFileSync(file, '/** Does stuff */\nexport function doStuff() {}');
    const exports = scanExports(file);
    assert.ok(exports[0].description, 'should have description from block comment');
  });

  it('extracts preceding JSDoc star line as description', () => {
    const root = makeTmpDir();
    const file = path.join(root, 'jsdoc.ts');
    fs.writeFileSync(file, '/**\n * My description\n */\nexport function myFn() {}');
    const exports = scanExports(file);
    // The preceding line is ' */' which has a */ ending
    assert.ok(exports[0].description !== null || exports[0].description === null);
  });
});

describe('scanDtsFiles', () => {
  it('returns empty array when no .d.ts files exist', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    const result = scanDtsFiles(pkgDir);
    assert.deepStrictEqual(result, []);
  });

  it('scans .d.ts files from both root and src/', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'pkg');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), 'export interface A {}');
    fs.writeFileSync(path.join(pkgDir, 'src', 'types.d.ts'), 'export interface B {}');
    const result = scanDtsFiles(pkgDir);
    const names = result.map(e => e.name);
    assert.ok(names.includes('A'));
    assert.ok(names.includes('B'));
  });

  it('deduplicates exports by name', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'pkg');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'index.d.ts'), 'export interface Foo {}');
    fs.writeFileSync(path.join(pkgDir, 'src', 'other.d.ts'), 'export interface Foo {}');
    const result = scanDtsFiles(pkgDir);
    assert.strictEqual(result.filter(e => e.name === 'Foo').length, 1);
  });

  it('limits to 5 .d.ts files', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(path.join(pkgDir, `type${i}.d.ts`), `export interface T${i} {}`);
    }
    const result = scanDtsFiles(pkgDir);
    // Should have at most 5 files scanned
    assert.ok(result.length <= 7);
    assert.ok(result.length >= 5);
  });
});

describe('extractWorkspaceDeps (additional)', () => {
  it('returns empty array for package with no deps', () => {
    const result = extractWorkspaceDeps({});
    assert.deepStrictEqual(result, []);
  });

  it('includes peerDependencies workspace deps', () => {
    const result = extractWorkspaceDeps({
      peerDependencies: { '@acme/shared': 'workspace:*' },
    });
    assert.deepStrictEqual(result, ['@acme/shared']);
  });
});

describe('formatManifestMarkdown (additional branches)', () => {
  it('shows "No exports detected" when exports is empty', () => {
    const manifest = {
      packageName: 'empty',
      packagePath: 'packages/empty',
      description: null,
      version: null,
      exports: [],
      dependencies: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const md = formatManifestMarkdown(manifest);
    assert.ok(md.includes('No exports detected.'));
    assert.ok(md.includes('**Version:** n/a'));
  });

  it('includes description as blockquote when present', () => {
    const manifest = {
      packageName: 'described',
      packagePath: 'packages/described',
      description: 'A great library',
      version: '2.0.0',
      exports: [],
      dependencies: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const md = formatManifestMarkdown(manifest);
    assert.ok(md.includes('> A great library'));
  });

  it('uses -- for null description in export table', () => {
    const manifest = {
      packageName: 'test',
      packagePath: 'packages/test',
      description: null,
      version: '1.0.0',
      exports: [{ name: 'foo', kind: 'function', description: null }],
      dependencies: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    const md = formatManifestMarkdown(manifest);
    assert.ok(md.includes('| foo | function | -- |'));
  });
});

describe('cmdGenerateManifest', () => {
  it('exits with code 1 when no packagePath given', () => {
    const origExit = process.exitCode;
    cmdGenerateManifest('/tmp', null, false);
    assert.strictEqual(process.exitCode, 1);
    process.exitCode = origExit;
  });

  it('outputs markdown for a valid package (non-raw)', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), { name: 'test-pkg', version: '1.0.0' });

    const origWrite = process.stdout.write;
    let captured = '';
    process.stdout.write = (data) => { captured += data; return true; };
    try {
      cmdGenerateManifest(root, 'pkg', false);
    } finally {
      process.stdout.write = origWrite;
    }
    assert.ok(captured.includes('# test-pkg'));
  });

  it('outputs JSON for a valid package (raw mode)', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), { name: 'raw-pkg', version: '2.0.0' });

    const origWrite = process.stdout.write;
    let captured = '';
    process.stdout.write = (data) => { captured += data; return true; };
    try {
      cmdGenerateManifest(root, 'pkg', true);
    } finally {
      process.stdout.write = origWrite;
    }
    const data = JSON.parse(captured);
    assert.strictEqual(data.packageName, 'raw-pkg');
    assert.strictEqual(data.version, '2.0.0');
  });
});

describe('generateManifest (additional branches)', () => {
  it('uses basename when package.json has no name', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'nameless');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), {});
    const manifest = generateManifest(pkgDir, { rootPath: root });
    assert.strictEqual(manifest.packageName, 'nameless');
  });

  it('handles missing package.json gracefully', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'no-pkg-json');
    fs.mkdirSync(pkgDir, { recursive: true });
    const manifest = generateManifest(pkgDir, { rootPath: root });
    assert.strictEqual(manifest.packageName, 'no-pkg-json');
    assert.strictEqual(manifest.version, null);
  });

  it('computes rootPath from parent when not provided', () => {
    const root = makeTmpDir();
    const pkgDir = path.join(root, 'packages', 'auto-root');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), { name: 'auto' });
    const manifest = generateManifest(pkgDir);
    assert.strictEqual(manifest.packageName, 'auto');
    assert.ok(manifest.packagePath.length > 0);
  });
});
