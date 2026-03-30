/**
 * Tests for workspace-detector.cjs
 *
 * Unit tests for monorepo workspace detection module.
 * Follows node:test pattern established by existing test files.
 */

'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  detectWorkspace,
  validateAppPath,
  expandWorkspaceGlobs,
  resolvePnpmWorkspaces,
  resolveNxWorkspaces,
} = require('../get-shit-done/bin/lib/workspace-detector.cjs');

// ── Helpers ────────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-ws-test-'));
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

// ── detectWorkspace ────────────────────────────────────────────────────────

describe('detectWorkspace', () => {
  it('returns null for a non-monorepo dir', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), { name: 'single-app' });
    const result = detectWorkspace(root);
    assert.strictEqual(result, null);
  });

  it('returns type: pnpm for a dir with pnpm-workspace.yaml', () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n', 'utf-8');
    fs.mkdirSync(path.join(root, 'packages', 'ui'), { recursive: true });
    writeJson(path.join(root, 'packages', 'ui', 'package.json'), { name: '@acme/ui' });
    const result = detectWorkspace(root);
    assert.strictEqual(result.type, 'pnpm');
    assert.strictEqual(result.packages.length, 1);
    assert.strictEqual(result.packages[0].name, '@acme/ui');
  });

  it('returns type: npm for a dir with package.json workspaces array', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), { name: 'mono', workspaces: ['apps/*'] });
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    writeJson(path.join(root, 'apps', 'web', 'package.json'), { name: 'web-app' });
    const result = detectWorkspace(root);
    assert.strictEqual(result.type, 'npm');
    assert.strictEqual(result.apps.length, 1);
    assert.strictEqual(result.apps[0].name, 'web-app');
  });

  it('classifies dirs under apps/ as apps and under packages/ as packages', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), { name: 'mono', workspaces: ['apps/*', 'packages/*'] });
    fs.mkdirSync(path.join(root, 'apps', 'dashboard'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages', 'shared'), { recursive: true });
    const result = detectWorkspace(root);
    assert.strictEqual(result.apps.length, 1);
    assert.strictEqual(result.apps[0].path, path.join('apps', 'dashboard'));
    assert.strictEqual(result.packages.length, 1);
    assert.strictEqual(result.packages[0].path, path.join('packages', 'shared'));
  });

  it('returns type: nx for a dir with nx.json and project.json-based subdirs', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'nx.json'), { targetDefaults: {} });
    writeJson(path.join(root, 'package.json'), { name: 'nx-mono' });
    // No workspaces field -- rely on project.json discovery
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    writeJson(path.join(root, 'apps', 'web', 'project.json'), { root: 'apps/web' });
    fs.mkdirSync(path.join(root, 'packages', 'utils'), { recursive: true });
    writeJson(path.join(root, 'packages', 'utils', 'project.json'), { root: 'packages/utils' });
    const result = detectWorkspace(root);
    assert.strictEqual(result.type, 'nx');
    assert.ok(result.apps.length >= 1 || result.packages.length >= 1, 'Should discover NX projects');
  });
});

// ── validateAppPath ────────────────────────────────────────────────────────

describe('validateAppPath', () => {
  it('returns valid: true for a known app path', () => {
    const workspace = {
      type: 'npm',
      rootPath: '/root',
      apps: [{ name: 'dashboard', path: 'apps/dashboard', absolutePath: '/root/apps/dashboard' }],
      packages: [],
      workspaceGlobs: ['apps/*'],
    };
    const result = validateAppPath(workspace, 'apps/dashboard');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.resolved.name, 'dashboard');
  });

  it('returns valid: false for an unknown path', () => {
    const workspace = {
      type: 'npm',
      rootPath: '/root',
      apps: [{ name: 'dashboard', path: 'apps/dashboard', absolutePath: '/root/apps/dashboard' }],
      packages: [],
      workspaceGlobs: ['apps/*'],
    };
    const result = validateAppPath(workspace, 'apps/nonexistent');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('not found'));
  });

  it('returns error when workspace is null', () => {
    const result = validateAppPath(null, 'apps/dashboard');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('No workspace'));
  });
});

// ── expandWorkspaceGlobs ───────────────────────────────────────────────────

describe('expandWorkspaceGlobs', () => {
  it('skips negation patterns without throwing', () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, 'packages', 'ui'), { recursive: true });
    const results = expandWorkspaceGlobs(root, ['packages/*', '!packages/internal']);
    // Should not throw and should still resolve packages/*
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 1);
    assert.ok(results[0].relativePath.includes('ui'));
  });
});

// ── resolvePnpmWorkspaces ──────────────────────────────────────────────────

describe('resolvePnpmWorkspaces', () => {
  it('parses a simple YAML list correctly', () => {
    const root = makeTmpDir();
    const wsFile = path.join(root, 'pnpm-workspace.yaml');
    fs.writeFileSync(wsFile, 'packages:\n  - "apps/*"\n  - "packages/*"\n', 'utf-8');
    const result = resolvePnpmWorkspaces(wsFile);
    assert.deepStrictEqual(result, ['apps/*', 'packages/*']);
  });
});
