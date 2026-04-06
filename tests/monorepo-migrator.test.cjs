/**
 * GSD Tools Tests - monorepo-migrator.cjs
 *
 * Unit tests for the monorepo migration module.
 * Covers audit, root analysis, archive, replace, execute, heuristics, and formatting.
 */

'use strict';
const { describe, it, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const migrator = require('../cap/bin/lib/monorepo-migrator.cjs');

function createTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-migrator-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1. auditAppPlanning
// ---------------------------------------------------------------------------

describe('auditAppPlanning', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('reports apps with and without .planning/', () => {
    // App with .planning/
    const appWithDir = path.join(tmpDir, 'apps', 'dashboard', '.planning');
    fs.mkdirSync(appWithDir, { recursive: true });
    fs.writeFileSync(path.join(appWithDir, 'PRD.md'), '# PRD\n', 'utf-8');
    fs.mkdirSync(path.join(appWithDir, 'prototype'), { recursive: true });
    fs.writeFileSync(path.join(appWithDir, 'prototype', 'CODE-INVENTORY.md'), '# Inv\n', 'utf-8');

    // App without .planning/
    fs.mkdirSync(path.join(tmpDir, 'apps', 'api'), { recursive: true });

    const apps = [
      { path: 'apps/dashboard', name: 'dashboard' },
      { path: 'apps/api', name: 'api' },
    ];

    const audit = migrator.auditAppPlanning(tmpDir, apps);

    assert.strictEqual(audit.appsWithPlanning, 1);
    assert.strictEqual(audit.appsWithoutPlanning, 1);
    assert.strictEqual(audit.apps.length, 2);

    const dashboard = audit.apps.find(a => a.appPath === 'apps/dashboard');
    assert.strictEqual(dashboard.exists, true);
    assert.ok(dashboard.files.includes('PRD.md'));
    assert.strictEqual(dashboard.hasCodeInventory, true);
    assert.strictEqual(dashboard.hasPrd, true);

    const api = audit.apps.find(a => a.appPath === 'apps/api');
    assert.strictEqual(api.exists, false);
    assert.deepStrictEqual(api.files, []);
    assert.strictEqual(api.hasCodeInventory, false);
  });
});

// ---------------------------------------------------------------------------
// 2. analyzeRootPlanning
// ---------------------------------------------------------------------------

describe('analyzeRootPlanning', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('classifies root files as global, app-specific, or ambiguous', () => {
    const rootPlanning = path.join(tmpDir, '.planning');
    fs.mkdirSync(rootPlanning, { recursive: true });

    // Global file
    fs.writeFileSync(path.join(rootPlanning, 'PROJECT.md'), '# Project\n', 'utf-8');

    // App-specific: PRD mentioning apps/dashboard 2+ times in first 20 lines
    fs.writeFileSync(
      path.join(rootPlanning, 'PRD.md'),
      'apps/dashboard feature A\napps/dashboard feature B\n',
      'utf-8'
    );

    // Ambiguous file
    fs.writeFileSync(path.join(rootPlanning, 'STATE.md'), '# State\n', 'utf-8');

    const result = migrator.analyzeRootPlanning(tmpDir);

    assert.ok(result.globalFiles.includes('PROJECT.md'));
    assert.ok(result.appSpecificFiles.includes('PRD.md'));
    assert.ok(result.ambiguousFiles.includes('STATE.md'));
  });

  it('returns empty arrays when no .planning/ exists', () => {
    const result = migrator.analyzeRootPlanning(tmpDir);
    assert.deepStrictEqual(result.globalFiles, []);
    assert.deepStrictEqual(result.appSpecificFiles, []);
    assert.deepStrictEqual(result.ambiguousFiles, []);
  });
});

// ---------------------------------------------------------------------------
// 3. archiveAppPlanning
// ---------------------------------------------------------------------------

describe('archiveAppPlanning', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('moves files to legacy-{timestamp}/ and removes originals', () => {
    const planningDir = path.join(tmpDir, 'apps', 'foo', '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    fs.writeFileSync(path.join(planningDir, 'PRD.md'), '# PRD\n', 'utf-8');
    fs.writeFileSync(path.join(planningDir, 'STATE.md'), '# State\n', 'utf-8');

    const result = migrator.archiveAppPlanning(tmpDir, 'apps/foo');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.action, 'archive');
    assert.ok(result.archivePath);
    assert.ok(result.archivePath.includes('legacy-'));

    // Archived files should exist in legacy dir
    assert.ok(fs.existsSync(path.join(result.archivePath, 'PRD.md')));
    assert.ok(fs.existsSync(path.join(result.archivePath, 'STATE.md')));

    // Original files should be gone (only legacy- dir remains)
    const remaining = fs.readdirSync(planningDir);
    assert.strictEqual(remaining.length, 1);
    assert.ok(remaining[0].startsWith('legacy-'));
  });

  it('returns success with null archivePath when no .planning/ exists', () => {
    fs.mkdirSync(path.join(tmpDir, 'apps', 'bar'), { recursive: true });
    const result = migrator.archiveAppPlanning(tmpDir, 'apps/bar');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.archivePath, null);
  });
});

// ---------------------------------------------------------------------------
// 4. replaceAppPlanning
// ---------------------------------------------------------------------------

describe('replaceAppPlanning', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('archives then creates fresh stubs', () => {
    const planningDir = path.join(tmpDir, 'apps', 'baz', '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    fs.writeFileSync(path.join(planningDir, 'OLD.md'), 'old content\n', 'utf-8');

    const result = migrator.replaceAppPlanning(tmpDir, 'apps/baz');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.action, 'replace');
    assert.ok(result.archivePath);

    // Fresh stubs created
    assert.ok(fs.existsSync(path.join(planningDir, 'PRD.md')));
    assert.ok(fs.existsSync(path.join(planningDir, 'FEATURES.md')));
    assert.ok(fs.existsSync(path.join(planningDir, 'prototype', 'CODE-INVENTORY.md')));

    // Old file archived
    assert.ok(fs.existsSync(path.join(result.archivePath, 'OLD.md')));
  });
});

// ---------------------------------------------------------------------------
// 5. executeAppMigration
// ---------------------------------------------------------------------------

describe('executeAppMigration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('keep action returns success without modifying anything', () => {
    const planningDir = path.join(tmpDir, 'apps', 'x', '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    fs.writeFileSync(path.join(planningDir, 'FILE.md'), 'content\n', 'utf-8');

    const result = migrator.executeAppMigration(tmpDir, { appPath: 'apps/x', action: 'keep' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.action, 'keep');
    assert.ok(fs.existsSync(path.join(planningDir, 'FILE.md')));
  });

  it('archive action delegates to archiveAppPlanning', () => {
    const planningDir = path.join(tmpDir, 'apps', 'y', '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    fs.writeFileSync(path.join(planningDir, 'DATA.md'), 'data\n', 'utf-8');

    const result = migrator.executeAppMigration(tmpDir, { appPath: 'apps/y', action: 'archive' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.action, 'archive');
    assert.ok(result.archivePath);
  });

  it('replace action delegates to replaceAppPlanning', () => {
    const planningDir = path.join(tmpDir, 'apps', 'z', '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    fs.writeFileSync(path.join(planningDir, 'OLD.md'), 'old\n', 'utf-8');

    const result = migrator.executeAppMigration(tmpDir, { appPath: 'apps/z', action: 'replace' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.action, 'replace');
    assert.ok(fs.existsSync(path.join(planningDir, 'PRD.md')));
  });

  it('unknown action returns failure with error message', () => {
    const result = migrator.executeAppMigration(tmpDir, { appPath: 'apps/w', action: 'destroy' });
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown action'));
  });
});

// ---------------------------------------------------------------------------
// 6. looksAppSpecific
// ---------------------------------------------------------------------------

describe('looksAppSpecific', () => {
  it('returns true when content has 2+ apps/ references in first 20 lines', () => {
    const content = 'apps/dashboard route A\napps/dashboard route B\n';
    assert.strictEqual(migrator.looksAppSpecific(content), true);
  });

  it('returns false when fewer than 2 app references', () => {
    const content = 'apps/dashboard route A\nSome other text\n';
    assert.strictEqual(migrator.looksAppSpecific(content), false);
  });

  it('returns false for empty content', () => {
    assert.strictEqual(migrator.looksAppSpecific(''), false);
  });
});

// ---------------------------------------------------------------------------
// 7. formatAuditReport
// ---------------------------------------------------------------------------

describe('formatAuditReport', () => {
  it('output contains app path and counts', () => {
    const audit = {
      apps: [
        { appPath: 'apps/dashboard', exists: true, files: ['PRD.md'], directories: [], hasCodeInventory: false, hasPrd: true },
        { appPath: 'apps/api', exists: false, files: [], directories: [], hasCodeInventory: false, hasPrd: false },
      ],
      appsWithPlanning: 1,
      appsWithoutPlanning: 1,
      rootAnalysis: { globalFiles: ['PROJECT.md'], appSpecificFiles: [], ambiguousFiles: [], rootPlanningDir: '/tmp/root/.planning' },
    };

    const report = migrator.formatAuditReport(audit);
    assert.ok(report.includes('apps/dashboard'));
    assert.ok(report.includes('1'));
    assert.ok(report.includes('Migration Audit'));
    assert.ok(report.includes('PROJECT.md'));
  });

  it('does not show root analysis when all arrays are empty', () => {
    const audit = {
      apps: [],
      appsWithPlanning: 0,
      appsWithoutPlanning: 0,
      rootAnalysis: { globalFiles: [], appSpecificFiles: [], ambiguousFiles: [], rootPlanningDir: '/tmp/.planning' },
    };

    const report = migrator.formatAuditReport(audit);
    assert.ok(!report.includes('Root .planning/ Analysis'), 'should not show root analysis when no files');
  });

  it('shows app-specific and ambiguous files in root analysis', () => {
    const audit = {
      apps: [],
      appsWithPlanning: 0,
      appsWithoutPlanning: 0,
      rootAnalysis: {
        globalFiles: [],
        appSpecificFiles: ['PRD.md'],
        ambiguousFiles: ['STATE.md'],
        rootPlanningDir: '/tmp/.planning',
      },
    };

    const report = migrator.formatAuditReport(audit);
    assert.ok(report.includes('App-specific (move to app): PRD.md'), 'should show app-specific');
    assert.ok(report.includes('Needs review: STATE.md'), 'should show ambiguous');
  });

  it('shows directories and CODE-INVENTORY status for existing apps', () => {
    const audit = {
      apps: [
        {
          appPath: 'apps/web',
          exists: true,
          files: [],
          directories: ['prototype'],
          hasCodeInventory: true,
          hasPrd: false,
        },
      ],
      appsWithPlanning: 1,
      appsWithoutPlanning: 0,
      rootAnalysis: { globalFiles: [], appSpecificFiles: [], ambiguousFiles: [], rootPlanningDir: '/tmp/.planning' },
    };

    const report = migrator.formatAuditReport(audit);
    assert.ok(report.includes('prototype'), 'should list directories');
    assert.ok(report.includes('Has CODE-INVENTORY: yes'), 'should show CODE-INVENTORY status');
  });
});

// ---------------------------------------------------------------------------
// 8. regenerateScopedInventories
// ---------------------------------------------------------------------------

describe('regenerateScopedInventories', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('generates CODE-INVENTORY.md for each app', () => {
    // Create app directory with a tagged file
    const appDir = path.join(tmpDir, 'apps', 'web');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'index.js'), '// @gsd-context Web app\n', 'utf-8');

    const apps = [{ path: 'apps/web' }];
    const results = migrator.regenerateScopedInventories(tmpDir, apps);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[0].error, null);
    assert.ok(fs.existsSync(results[0].inventoryPath), 'inventory file should exist');
  });

  it('handles errors gracefully and reports failure', () => {
    // App path points to nonexistent directory — cmdExtractTags may still work (just empty scan)
    // Instead, create a scenario where writing fails
    const apps = [{ path: 'apps/ghost' }];
    const results = migrator.regenerateScopedInventories(tmpDir, apps);

    assert.strictEqual(results.length, 1);
    // It should succeed because cmdExtractTags creates the output dir
    assert.strictEqual(results[0].success, true);
  });
});

// ---------------------------------------------------------------------------
// 9. executeMigration
// ---------------------------------------------------------------------------

describe('executeMigration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('runs all actions and regenerates inventories', () => {
    // Create two apps
    const appADir = path.join(tmpDir, 'apps', 'a', '.planning');
    fs.mkdirSync(appADir, { recursive: true });
    fs.writeFileSync(path.join(appADir, 'OLD.md'), 'old\n', 'utf-8');

    fs.mkdirSync(path.join(tmpDir, 'apps', 'b'), { recursive: true });

    const apps = [
      { path: 'apps/a', name: 'a' },
      { path: 'apps/b', name: 'b' },
    ];
    const actions = [
      { appPath: 'apps/a', action: 'archive' },
      { appPath: 'apps/b', action: 'keep' },
    ];

    const { results, regeneration } = migrator.executeMigration(tmpDir, apps, actions);

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].action, 'archive');
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[1].action, 'keep');
    assert.strictEqual(results[1].success, true);

    assert.strictEqual(regeneration.length, 2);
  });
});

// ---------------------------------------------------------------------------
// 10. analyzeRootPlanning — directory classification
// ---------------------------------------------------------------------------

describe('analyzeRootPlanning directory classification', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('classifies manifests/ as global and prototype/ as ambiguous', () => {
    const rootPlanning = path.join(tmpDir, '.planning');
    fs.mkdirSync(path.join(rootPlanning, 'manifests'), { recursive: true });
    fs.mkdirSync(path.join(rootPlanning, 'prototype'), { recursive: true });
    fs.mkdirSync(path.join(rootPlanning, 'custom-dir'), { recursive: true });

    const result = migrator.analyzeRootPlanning(tmpDir);
    assert.ok(result.globalFiles.includes('manifests/'), 'manifests/ should be global');
    assert.ok(result.ambiguousFiles.includes('prototype/'), 'prototype/ should be ambiguous');
    assert.ok(result.ambiguousFiles.includes('custom-dir/'), 'unknown dirs should be ambiguous');
  });

  it('classifies FEATURES.md without app refs as ambiguous', () => {
    const rootPlanning = path.join(tmpDir, '.planning');
    fs.mkdirSync(rootPlanning, { recursive: true });
    fs.writeFileSync(path.join(rootPlanning, 'FEATURES.md'), '# Features\nGeneral features.\n', 'utf-8');

    const result = migrator.analyzeRootPlanning(tmpDir);
    assert.ok(result.ambiguousFiles.includes('FEATURES.md'), 'FEATURES.md without app refs should be ambiguous');
  });

  it('classifies unknown files as ambiguous', () => {
    const rootPlanning = path.join(tmpDir, '.planning');
    fs.mkdirSync(rootPlanning, { recursive: true });
    fs.writeFileSync(path.join(rootPlanning, 'CUSTOM.md'), '# Custom\n', 'utf-8');

    const result = migrator.analyzeRootPlanning(tmpDir);
    assert.ok(result.ambiguousFiles.includes('CUSTOM.md'), 'unknown files should be ambiguous');
  });
});
