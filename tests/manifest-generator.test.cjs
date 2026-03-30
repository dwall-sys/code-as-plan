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
} = require('../get-shit-done/bin/lib/manifest-generator.cjs');

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
