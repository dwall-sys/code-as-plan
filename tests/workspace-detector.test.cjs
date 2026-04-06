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
  resolveTurboWorkspaces,
  cmdDetectWorkspace,
} = require('../cap/bin/lib/workspace-detector.cjs');

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

  it('stops parsing at non-list line after packages section', () => {
    const root = makeTmpDir();
    const wsFile = path.join(root, 'pnpm-workspace.yaml');
    fs.writeFileSync(wsFile, 'packages:\n  - "apps/*"\nsomething_else:\n  - "ignored/*"\n', 'utf-8');
    const result = resolvePnpmWorkspaces(wsFile);
    assert.deepStrictEqual(result, ['apps/*']);
  });

  it('returns fallback when packages section is empty', () => {
    const root = makeTmpDir();
    const wsFile = path.join(root, 'pnpm-workspace.yaml');
    fs.writeFileSync(wsFile, 'other:\n  - stuff\n', 'utf-8');
    const result = resolvePnpmWorkspaces(wsFile);
    assert.deepStrictEqual(result, ['packages/*', 'apps/*']);
  });

  it('returns fallback when file cannot be read', () => {
    const result = resolvePnpmWorkspaces('/nonexistent/pnpm-workspace.yaml');
    assert.deepStrictEqual(result, ['packages/*', 'apps/*']);
  });

  it('strips quotes from glob entries', () => {
    const root = makeTmpDir();
    const wsFile = path.join(root, 'pnpm-workspace.yaml');
    fs.writeFileSync(wsFile, "packages:\n  - 'libs/*'\n", 'utf-8');
    const result = resolvePnpmWorkspaces(wsFile);
    assert.deepStrictEqual(result, ['libs/*']);
  });
});

// ── resolveTurboWorkspaces ─────────────────────────────────────────────────

describe('resolveTurboWorkspaces', () => {
  it('reads workspaces array from package.json', () => {
    const root = makeTmpDir();
    const pkgPath = path.join(root, 'package.json');
    writeJson(pkgPath, { name: 'turbo-mono', workspaces: ['apps/*', 'packages/*'] });
    const result = resolveTurboWorkspaces(pkgPath);
    assert.deepStrictEqual(result, ['apps/*', 'packages/*']);
  });

  it('reads workspaces.packages from package.json', () => {
    const root = makeTmpDir();
    const pkgPath = path.join(root, 'package.json');
    writeJson(pkgPath, { name: 'turbo-mono', workspaces: { packages: ['libs/*'] } });
    const result = resolveTurboWorkspaces(pkgPath);
    assert.deepStrictEqual(result, ['libs/*']);
  });

  it('returns defaults when package.json has no workspaces', () => {
    const root = makeTmpDir();
    const pkgPath = path.join(root, 'package.json');
    writeJson(pkgPath, { name: 'turbo-mono' });
    const result = resolveTurboWorkspaces(pkgPath);
    assert.deepStrictEqual(result, ['apps/*', 'packages/*']);
  });
});

// ── expandWorkspaceGlobs two-level ─────────────────────────────────────────

describe('expandWorkspaceGlobs two-level', () => {
  it('expands two-level glob patterns like scope/*/sub/*', () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, 'scope', 'groupA', 'sub', 'pkg1'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scope', 'groupA', 'sub', 'pkg2'), { recursive: true });
    const results = expandWorkspaceGlobs(root, ['scope/*/sub/*']);
    assert.strictEqual(results.length, 2);
    const relPaths = results.map(r => r.relativePath).sort();
    assert.ok(relPaths[0].includes('pkg1'));
    assert.ok(relPaths[1].includes('pkg2'));
  });

  it('skips non-existent parent dir for two-level globs', () => {
    const root = makeTmpDir();
    const results = expandWorkspaceGlobs(root, ['nonexist/*/sub/*']);
    assert.deepStrictEqual(results, []);
  });

  it('deduplicates entries across overlapping globs', () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    const results = expandWorkspaceGlobs(root, ['apps/*', 'apps/*']);
    assert.strictEqual(results.length, 1);
  });
});

// ── cmdDetectWorkspace ─────────────────────────────────────────────────────

describe('cmdDetectWorkspace', () => {
  it('outputs null when not a monorepo in raw mode', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), { name: 'single' });

    let captured = '';
    const origWrite = process.stdout.write;
    process.stdout.write = (data) => { captured += data; return true; };

    cmdDetectWorkspace(root, true);

    process.stdout.write = origWrite;
    assert.strictEqual(captured.trim(), 'null');
  });

  it('writes to stderr when not a monorepo in non-raw mode', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), { name: 'single' });

    let captured = '';
    const origWrite = process.stderr.write;
    process.stderr.write = (data) => { captured += data; return true; };

    cmdDetectWorkspace(root, false);

    process.stderr.write = origWrite;
    assert.ok(captured.includes('No workspace detected'));
  });

  it('outputs JSON when workspace is detected', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), { name: 'mono', workspaces: ['apps/*'] });
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });

    let captured = '';
    const origWrite = process.stdout.write;
    process.stdout.write = (data) => { captured += data; return true; };

    cmdDetectWorkspace(root, false);

    process.stdout.write = origWrite;
    const parsed = JSON.parse(captured);
    assert.strictEqual(parsed.type, 'npm');
  });
});

// ── detectWorkspace turbo ──────────────────────────────────────────────────

describe('detectWorkspace turbo', () => {
  it('returns type: turbo when turbo.json exists', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'turbo.json'), { pipeline: {} });
    writeJson(path.join(root, 'package.json'), { name: 'turbo-mono', workspaces: ['apps/*'] });
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    const result = detectWorkspace(root);
    assert.strictEqual(result.type, 'turbo');
    assert.strictEqual(result.apps.length, 1);
  });
});

// ── detectWorkspace npm workspaces.packages ────────────────────────────────

describe('detectWorkspace npm workspaces.packages', () => {
  it('reads workspaces.packages object form', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), {
      name: 'mono',
      workspaces: { packages: ['libs/*'] },
    });
    fs.mkdirSync(path.join(root, 'libs', 'shared'), { recursive: true });
    const result = detectWorkspace(root);
    assert.strictEqual(result.type, 'npm');
    assert.strictEqual(result.packages.length, 1);
  });
});

// ── detectWorkspace nx with workspaces.packages ────────────────────────────

describe('detectWorkspace nx with workspaces.packages', () => {
  it('reads nx with package.json workspaces.packages', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'nx.json'), {});
    writeJson(path.join(root, 'package.json'), {
      name: 'nx-mono',
      workspaces: { packages: ['apps/*'] },
    });
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    const result = detectWorkspace(root);
    assert.strictEqual(result.type, 'nx');
  });
});

// ── detectWorkspace classifies non-standard dirs as packages ───────────────

describe('detectWorkspace classification', () => {
  it('classifies dirs under libs/ as packages', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), {
      name: 'mono',
      workspaces: ['libs/*'],
    });
    fs.mkdirSync(path.join(root, 'libs', 'shared'), { recursive: true });
    const result = detectWorkspace(root);
    assert.strictEqual(result.packages.length, 1);
    assert.strictEqual(result.packages[0].path, path.join('libs', 'shared'));
  });

  it('classifies unknown top-level dirs as packages', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), {
      name: 'mono',
      workspaces: ['tools/*'],
    });
    fs.mkdirSync(path.join(root, 'tools', 'cli'), { recursive: true });
    const result = detectWorkspace(root);
    assert.strictEqual(result.packages.length, 1);
    assert.strictEqual(result.apps.length, 0);
  });

  it('NX fallback when no project.json and no workspaces in package.json', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'nx.json'), {});
    writeJson(path.join(root, 'package.json'), { name: 'nx-mono' });
    // No project.json files, no workspaces field in package.json
    // Should fall back to ['apps/*', 'packages/*', 'libs/*']
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(root, 'libs', 'shared'), { recursive: true });
    const result = detectWorkspace(root);
    assert.strictEqual(result.type, 'nx');
    assert.ok(result.apps.length >= 1 || result.packages.length >= 1);
  });

  it('reads exports field from package.json', () => {
    const root = makeTmpDir();
    writeJson(path.join(root, 'package.json'), {
      name: 'mono',
      workspaces: ['packages/*'],
    });
    const pkgDir = path.join(root, 'packages', 'ui');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), {
      name: '@acme/ui',
      exports: { '.': './dist/index.js', './button': './dist/button.js' },
    });
    const result = detectWorkspace(root);
    assert.ok(result.packages[0].exports.length === 2);
  });
});
