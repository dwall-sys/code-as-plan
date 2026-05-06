// @cap-feature(feature:F-019) Tests for Module Integrity Verification

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  checkModuleIntegrity,
  checkPlatformPaths,
  CAP_MODULE_MANIFEST,
  runDoctor,
  formatReport,
} = require('../cap/bin/lib/cap-doctor.cjs');

const LIB_DIR = path.join(__dirname, '..', 'cap', 'bin', 'lib');

describe('CAP_MODULE_MANIFEST', () => {
  it('contains expected module entries', () => {
    // @cap-decision(F-064) Bumped 68 -> 69 when cap-design-families.cjs was extracted from cap-design.cjs (size split).
    // @cap-decision(F-065) Bumped 69 -> 70 when cap-ui.cjs was added (CAP-UI Core — local server + static export).
    // @cap-decision(F-068) Bumped 70 -> 73 when cap-ui was split into cap-ui.cjs + cap-ui-mind-map.cjs + cap-ui-thread-nav.cjs + cap-ui-design-editor.cjs (F-067 hand-off + F-068 editor).
    // @cap-decision(F-061) Bumped 73 -> 74 when cap-telemetry.cjs was added (Token Telemetry observability).
    // @cap-decision(F-075) Bumped 74 -> 75 when cap-trust-mode.cjs was added (Trust-Mode Configuration Slot).
    // @cap-decision(F-070) Bumped 75 -> 76 when cap-learning-signals.cjs was added (Collect Learning Signals).
    // @cap-decision(F-071) Bumped 76 -> 77 when cap-pattern-pipeline.cjs was added (Heuristic + LLM-briefing pattern pipeline).
    // @cap-decision(F-072) Bumped 77 -> 78 when cap-fitness-score.cjs was added (Two-Layer Fitness Score for Pattern Unlearn).
    // @cap-decision(F-074) Bumped 78 -> 79 when cap-pattern-apply.cjs was added (Enable Pattern Unlearn and Auto-Retract).
    // @cap-decision(F-073) Bumped 79 -> 80 when cap-learn-review.cjs was added (Review Patterns via Learn Command).
    // @cap-decision(F-076) Bumped 80 -> 81 when cap-memory-schema.cjs was added (V6 per-feature memory format foundation).
    // @cap-decision(F-077) Bumped 81 -> 82 when cap-memory-migrate.cjs was added (V6 migration tool with hybrid classifier).
    assert.equal(CAP_MODULE_MANIFEST.length, 82);
  });

  it('every entry ends with .cjs', () => {
    for (const name of CAP_MODULE_MANIFEST) {
      assert.ok(name.endsWith('.cjs'), `${name} should end with .cjs`);
    }
  });

  it('has no duplicates', () => {
    const unique = new Set(CAP_MODULE_MANIFEST);
    assert.equal(unique.size, CAP_MODULE_MANIFEST.length);
  });

  it('matches actual files on disk', () => {
    const onDisk = fs.readdirSync(LIB_DIR).filter(f => f.endsWith('.cjs')).sort();
    const manifest = [...CAP_MODULE_MANIFEST].sort();
    assert.deepEqual(manifest, onDisk, 'Manifest should match files in cap/bin/lib/');
  });
});

describe('checkModuleIntegrity', () => {
  // @cap-todo(ac:F-019/AC-1) Test: verify modules exist at expected path
  it('returns all modules as OK for the real lib directory', () => {
    const result = checkModuleIntegrity(LIB_DIR);
    assert.equal(result.modulesOk, result.modulesTotal);
    // @cap-decision(F-065) Bumped 69 -> 70 when cap-ui.cjs was added.
    // @cap-decision(F-068) Bumped 70 -> 73 when cap-ui was split into 3 siblings + the new design editor.
    // @cap-decision(F-061) Bumped 73 -> 74 when cap-telemetry.cjs was added.
    // @cap-decision(F-075) Bumped 74 -> 75 when cap-trust-mode.cjs was added.
    // @cap-decision(F-070) Bumped 75 -> 76 when cap-learning-signals.cjs was added.
    // @cap-decision(F-071) Bumped 76 -> 77 when cap-pattern-pipeline.cjs was added.
    // @cap-decision(F-072) Bumped 77 -> 78 when cap-fitness-score.cjs was added.
    // @cap-decision(F-074) Bumped 78 -> 79 when cap-pattern-apply.cjs was added.
    // @cap-decision(F-073) Bumped 79 -> 80 when cap-learn-review.cjs was added.
    assert.equal(result.modulesTotal, 82);
    for (const m of result.modules) {
      assert.ok(m.ok, `${m.name} should be OK`);
      assert.ok(m.exists, `${m.name} should exist`);
      assert.ok(m.loads, `${m.name} should load`);
      assert.equal(m.error, undefined, `${m.name} should have no error`);
    }
  });

  // @cap-todo(ac:F-019/AC-2) Test: report load failures for missing modules
  it('reports FAIL for a non-existent directory', () => {
    const result = checkModuleIntegrity('/tmp/cap-test-nonexistent-dir');
    assert.equal(result.modulesOk, 0);
    // @cap-decision(F-065) Bumped 69 -> 70 when cap-ui.cjs was added.
    // @cap-decision(F-068) Bumped 70 -> 73 after the cap-ui split + design-editor addition.
    // @cap-decision(F-061) Bumped 73 -> 74 when cap-telemetry.cjs was added.
    // @cap-decision(F-075) Bumped 74 -> 75 when cap-trust-mode.cjs was added.
    // @cap-decision(F-070) Bumped 75 -> 76 when cap-learning-signals.cjs was added.
    // @cap-decision(F-071) Bumped 76 -> 77 when cap-pattern-pipeline.cjs was added.
    // @cap-decision(F-072) Bumped 77 -> 78 when cap-fitness-score.cjs was added.
    // @cap-decision(F-074) Bumped 78 -> 79 when cap-pattern-apply.cjs was added.
    // @cap-decision(F-073) Bumped 79 -> 80 when cap-learn-review.cjs was added.
    assert.equal(result.modulesTotal, 82);
    for (const m of result.modules) {
      assert.ok(!m.ok, `${m.name} should fail`);
      assert.ok(!m.exists, `${m.name} should not exist`);
      assert.ok(m.error.includes('File not found'), `${m.name} error should mention file not found`);
    }
  });

  // @cap-todo(ac:F-019/AC-3) Test: per-module PASS/FAIL with error reason
  it('reports syntax error when module has bad JS', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-integrity-'));
    // Create all manifest files, but one with bad syntax
    for (const name of CAP_MODULE_MANIFEST) {
      if (name === 'verify.cjs') {
        fs.writeFileSync(path.join(tmpDir, name), 'this is not valid javascript {{{{');
      } else {
        fs.writeFileSync(path.join(tmpDir, name), "'use strict'; module.exports = {};");
      }
    }

    const result = checkModuleIntegrity(tmpDir);
    const verifyCheck = result.modules.find(m => m.name === 'verify.cjs');
    assert.ok(verifyCheck.exists, 'verify.cjs should exist');
    assert.ok(!verifyCheck.loads, 'verify.cjs should fail to load');
    assert.ok(!verifyCheck.ok, 'verify.cjs should not be OK');
    assert.ok(verifyCheck.error.includes('Load error'), 'should have a load error message');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // @cap-todo(ac:F-019/AC-5) Test: compare against manifest
  it('checks exactly the modules in the manifest', () => {
    const result = checkModuleIntegrity(LIB_DIR);
    const checkedNames = result.modules.map(m => m.name);
    assert.deepEqual(checkedNames, CAP_MODULE_MANIFEST);
  });

  it('each ModuleCheck has expected properties', () => {
    const result = checkModuleIntegrity(LIB_DIR);
    for (const m of result.modules) {
      assert.ok(typeof m.name === 'string');
      assert.ok(typeof m.fullPath === 'string');
      assert.ok(typeof m.exists === 'boolean');
      assert.ok(typeof m.loads === 'boolean');
      assert.ok(typeof m.ok === 'boolean');
      assert.ok(path.isAbsolute(m.fullPath), 'fullPath should be... a path');
    }
  });

  it('auto-detects install directory when none provided', () => {
    // Should not throw and should return a valid result
    const result = checkModuleIntegrity();
    assert.ok(result.modulesTotal > 0);
    assert.ok(Array.isArray(result.modules));
  });
});

describe('checkPlatformPaths', () => {
  // @cap-todo(ac:F-019/AC-6) Test: platform-specific path resolution
  it('returns correct structure', () => {
    const result = checkPlatformPaths(LIB_DIR);
    assert.ok(typeof result.envHome === 'string');
    assert.ok(typeof result.osHomedir === 'string');
    assert.ok(typeof result.homeMatch === 'boolean');
    assert.ok(typeof result.installDir === 'string');
    assert.ok(typeof result.isSymlink === 'boolean');
    assert.ok(typeof result.ok === 'boolean');
    assert.ok(Array.isArray(result.warnings));
  });

  it('reports homeMatch when HOME and os.homedir() agree', () => {
    const result = checkPlatformPaths(LIB_DIR);
    // On a normal dev machine these should match
    if (process.env.HOME === os.homedir()) {
      assert.ok(result.homeMatch, 'homeMatch should be true');
    }
  });

  it('detects non-symlink directory correctly', () => {
    const result = checkPlatformPaths(LIB_DIR);
    // The repo checkout should not be a symlink
    assert.equal(result.isSymlink, false);
    assert.equal(result.symlinkTarget, undefined);
  });

  it('detects symlink directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-symlink-'));
    const realDir = path.join(tmpDir, 'real');
    const linkDir = path.join(tmpDir, 'link');
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, linkDir);

    const result = checkPlatformPaths(linkDir);
    assert.ok(result.isSymlink, 'should detect symlink');
    assert.equal(result.symlinkTarget, fs.realpathSync(linkDir));
    assert.ok(result.warnings.length > 0, 'should have a warning about symlink');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-detects install directory when none provided', () => {
    const result = checkPlatformPaths();
    assert.ok(typeof result.installDir === 'string');
    assert.ok(result.installDir.length > 0);
  });
});

describe('runDoctor includes module integrity', () => {
  // @cap-todo(ac:F-019/AC-4) Test: module check runs automatically in runDoctor
  it('report includes modules array', () => {
    const report = runDoctor();
    assert.ok(Array.isArray(report.modules), 'report should have modules array');
    assert.ok(report.modules.length > 0, 'modules should not be empty');
  });

  it('report includes modulesOk and modulesTotal counts', () => {
    const report = runDoctor();
    assert.ok(typeof report.modulesOk === 'number');
    assert.ok(typeof report.modulesTotal === 'number');
    // @cap-decision(F-065) Bumped 69 -> 70 when cap-ui.cjs was added.
    // @cap-decision(F-068) Bumped 70 -> 73 after the cap-ui split + design-editor addition.
    // @cap-decision(F-061) Bumped 73 -> 74 when cap-telemetry.cjs was added.
    // @cap-decision(F-075) Bumped 74 -> 75 when cap-trust-mode.cjs was added.
    // @cap-decision(F-070) Bumped 75 -> 76 when cap-learning-signals.cjs was added.
    // @cap-decision(F-071) Bumped 76 -> 77 when cap-pattern-pipeline.cjs was added.
    // @cap-decision(F-072) Bumped 77 -> 78 when cap-fitness-score.cjs was added.
    // @cap-decision(F-074) Bumped 78 -> 79 when cap-pattern-apply.cjs was added.
    // @cap-decision(F-073) Bumped 79 -> 80 when cap-learn-review.cjs was added.
    assert.equal(report.modulesTotal, 82);
  });

  it('report includes platformPaths', () => {
    const report = runDoctor();
    assert.ok(report.platformPaths != null, 'report should have platformPaths');
    assert.ok(typeof report.platformPaths.homeMatch === 'boolean');
  });

  it('healthy accounts for module failures', () => {
    // When all modules pass and required tools are present, healthy should be true
    const report = runDoctor();
    if (report.requiredOk === report.requiredTotal && report.modulesOk === report.modulesTotal) {
      assert.ok(report.healthy, 'should be healthy when tools and modules are OK');
    }
  });
});

describe('formatReport with module integrity', () => {
  it('includes Module Integrity section', () => {
    const report = runDoctor();
    const output = formatReport(report);
    assert.ok(output.includes('Module Integrity:'), 'should have Module Integrity section');
  });

  it('includes Modules count in summary', () => {
    const report = runDoctor();
    const output = formatReport(report);
    assert.ok(output.includes('Modules:'), 'should show Modules count');
    assert.ok(output.includes(`${report.modulesOk}/${report.modulesTotal} OK`));
  });

  it('shows failed modules when present', () => {
    // Create a report with a failed module
    const report = {
      tools: [],
      requiredOk: 0,
      requiredTotal: 0,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: false,
      installCommands: [],
      modules: [
        { name: 'test.cjs', fullPath: '/fake/test.cjs', exists: false, loads: false, ok: false, error: 'File not found: /fake/test.cjs' },
      ],
      modulesOk: 0,
      modulesTotal: 1,
      platformPaths: { envHome: '/home', osHomedir: '/home', homeMatch: true, installDir: '/fake', isSymlink: false, ok: true, warnings: [] },
    };
    const output = formatReport(report);
    assert.ok(output.includes('0/1 modules OK'), 'should show failed count');
    assert.ok(output.includes('test.cjs'), 'should name the failed module');
    assert.ok(output.includes('module integrity failures'), 'should show unhealthy message about modules');
  });

  it('shows platform path warnings when present', () => {
    const report = {
      tools: [],
      requiredOk: 0,
      requiredTotal: 0,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: true,
      installCommands: [],
      modules: [],
      modulesOk: 0,
      modulesTotal: 0,
      platformPaths: { envHome: '/a', osHomedir: '/b', homeMatch: false, installDir: '/a', isSymlink: false, ok: false, warnings: ['$HOME (/a) differs from os.homedir() (/b).'] },
    };
    const output = formatReport(report);
    assert.ok(output.includes('Platform Paths:'), 'should have Platform Paths section');
    assert.ok(output.includes('differs from os.homedir()'), 'should show the warning');
  });
});

// ============================================================================
// ADVERSARIAL EDGE-CASE TESTS (added by cap-tester)
// ============================================================================

describe('checkModuleIntegrity — adversarial edge cases', () => {
  // @cap-todo(ac:F-019/AC-1) Edge case: empty (0-byte) module file
  it('reports load failure for a 0-byte module file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-empty-'));
    for (const name of CAP_MODULE_MANIFEST) {
      if (name === 'config.cjs') {
        // 0-byte file — exists but has no content
        fs.writeFileSync(path.join(tmpDir, name), '');
      } else {
        fs.writeFileSync(path.join(tmpDir, name), "'use strict'; module.exports = {};");
      }
    }

    const result = checkModuleIntegrity(tmpDir);
    const configCheck = result.modules.find(m => m.name === 'config.cjs');
    assert.ok(configCheck.exists, 'empty file should still exist');
    // An empty file is valid JS (exports {}), so it should load fine
    // This verifies we don't false-positive on empty files
    assert.ok(configCheck.loads, '0-byte JS file is valid — should load');
    assert.ok(configCheck.ok, '0-byte JS file should be OK');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // @cap-todo(ac:F-019/AC-1) Edge case: directory path with spaces
  it('handles install directory path containing spaces', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap path with spaces '));
    for (const name of CAP_MODULE_MANIFEST) {
      fs.writeFileSync(path.join(tmpDir, name), "'use strict'; module.exports = {};");
    }

    const result = checkModuleIntegrity(tmpDir);
    assert.equal(result.modulesOk, result.modulesTotal, 'all modules should pass with spaces in path');
    assert.equal(result.modulesTotal, CAP_MODULE_MANIFEST.length);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // @cap-todo(ac:F-019/AC-2) Edge case: module that throws at require-time
  it('reports load failure for a module that throws on require()', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-throw-'));
    for (const name of CAP_MODULE_MANIFEST) {
      if (name === 'state.cjs') {
        fs.writeFileSync(
          path.join(tmpDir, name),
          "'use strict'; throw new Error('Intentional runtime explosion');"
        );
      } else {
        fs.writeFileSync(path.join(tmpDir, name), "'use strict'; module.exports = {};");
      }
    }

    const result = checkModuleIntegrity(tmpDir);
    const stateCheck = result.modules.find(m => m.name === 'state.cjs');
    assert.ok(stateCheck.exists, 'throwing module should exist');
    assert.ok(!stateCheck.loads, 'throwing module should fail to load');
    assert.ok(!stateCheck.ok, 'throwing module should not be OK');
    assert.ok(stateCheck.error.includes('Load error'), 'error should start with Load error');
    assert.ok(stateCheck.error.includes('Intentional runtime explosion'), 'error should include throw message');

    // Other modules should still be OK
    const otherOkCount = result.modules.filter(m => m.name !== 'state.cjs' && m.ok).length;
    assert.equal(otherOkCount, CAP_MODULE_MANIFEST.length - 1, 'all other modules should pass');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // @cap-todo(ac:F-019/AC-2) Edge case: module that exports null
  it('treats a module exporting null as loaded successfully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-null-'));
    for (const name of CAP_MODULE_MANIFEST) {
      if (name === 'template.cjs') {
        fs.writeFileSync(path.join(tmpDir, name), "'use strict'; module.exports = null;");
      } else {
        fs.writeFileSync(path.join(tmpDir, name), "'use strict'; module.exports = {};");
      }
    }

    const result = checkModuleIntegrity(tmpDir);
    const templateCheck = result.modules.find(m => m.name === 'template.cjs');
    // require() succeeds even if exports are null — no error thrown
    assert.ok(templateCheck.exists, 'file should exist');
    assert.ok(templateCheck.loads, 'require() should succeed for null export');
    assert.ok(templateCheck.ok, 'should be OK — null export is valid');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // @cap-todo(ac:F-019/AC-3) Edge case: every failing module has a non-empty error string
  it('every failed module has a non-empty, descriptive error string', () => {
    const result = checkModuleIntegrity('/tmp/cap-nonexistent-path-12345');
    for (const m of result.modules) {
      assert.ok(!m.ok, `${m.name} should fail`);
      assert.ok(typeof m.error === 'string', `${m.name} error should be a string`);
      assert.ok(m.error.length > 10, `${m.name} error should be descriptive (got: "${m.error}")`);
    }
  });

  // @cap-todo(ac:F-019/AC-3) Edge case: error messages use consistent prefixes
  it('error messages use consistent "File not found:" or "Load error:" prefixes', () => {
    // Test file-not-found prefix
    const missingResult = checkModuleIntegrity('/tmp/cap-nonexistent-path-99999');
    for (const m of missingResult.modules) {
      assert.ok(m.error.startsWith('File not found:'), `Missing module error should start with "File not found:" but got: "${m.error}"`);
    }

    // Test load-error prefix
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-badjs-'));
    for (const name of CAP_MODULE_MANIFEST) {
      fs.writeFileSync(path.join(tmpDir, name), '{{{{INVALID SYNTAX}}}}');
    }
    const badResult = checkModuleIntegrity(tmpDir);
    for (const m of badResult.modules) {
      assert.ok(m.error.startsWith('Load error:'), `Load failure error should start with "Load error:" but got: "${m.error}"`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // @cap-todo(ac:F-019/AC-5) Edge case: extra files on disk not in manifest are ignored
  it('ignores extra .cjs files on disk that are not in the manifest', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-extra-'));
    for (const name of CAP_MODULE_MANIFEST) {
      fs.writeFileSync(path.join(tmpDir, name), "'use strict'; module.exports = {};");
    }
    // Add an extra file NOT in the manifest
    fs.writeFileSync(path.join(tmpDir, 'rogue-module.cjs'), "'use strict'; module.exports = {};");

    const result = checkModuleIntegrity(tmpDir);
    assert.equal(result.modulesTotal, CAP_MODULE_MANIFEST.length, 'total should only count manifest entries');
    assert.equal(result.modulesOk, CAP_MODULE_MANIFEST.length, 'all manifest modules should pass');
    const rogueCheck = result.modules.find(m => m.name === 'rogue-module.cjs');
    assert.equal(rogueCheck, undefined, 'rogue file should NOT appear in results');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // @cap-todo(ac:F-019/AC-5) Edge case: partial manifest — some files missing, some broken, some OK
  it('correctly categorizes a mix of missing, broken, and valid modules', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mix-'));
    let missingCount = 0;
    let brokenCount = 0;
    let okCount = 0;

    for (let i = 0; i < CAP_MODULE_MANIFEST.length; i++) {
      const name = CAP_MODULE_MANIFEST[i];
      if (i % 3 === 0) {
        // skip — file missing
        missingCount++;
      } else if (i % 3 === 1) {
        // broken syntax
        fs.writeFileSync(path.join(tmpDir, name), '{{{{BROKEN');
        brokenCount++;
      } else {
        // valid
        fs.writeFileSync(path.join(tmpDir, name), "'use strict'; module.exports = {};");
        okCount++;
      }
    }

    const result = checkModuleIntegrity(tmpDir);
    assert.equal(result.modulesTotal, CAP_MODULE_MANIFEST.length);
    assert.equal(result.modulesOk, okCount, `expected ${okCount} OK modules`);

    const missing = result.modules.filter(m => !m.exists);
    const broken = result.modules.filter(m => m.exists && !m.loads);
    const ok = result.modules.filter(m => m.ok);
    assert.equal(missing.length, missingCount);
    assert.equal(broken.length, brokenCount);
    assert.equal(ok.length, okCount);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('checkPlatformPaths — adversarial edge cases', () => {
  // @cap-todo(ac:F-019/AC-6) Edge case: HOME env var unset entirely
  it('handles HOME being unset by falling back gracefully', () => {
    const originalHome = process.env.HOME;
    try {
      delete process.env.HOME;
      const result = checkPlatformPaths('/tmp');
      assert.ok(typeof result.envHome === 'string', 'envHome should still be a string');
      // When HOME is unset, envHome should be empty string (per the || '' fallback)
      assert.equal(result.envHome, '', 'envHome should be empty string when HOME is unset');
      // homeMatch should be false since '' !== os.homedir()
      assert.equal(result.homeMatch, false, 'homeMatch should be false when HOME is unset');
      assert.ok(result.warnings.length > 0, 'should warn about HOME mismatch');
    } finally {
      process.env.HOME = originalHome;
    }
  });

  // @cap-todo(ac:F-019/AC-6) Edge case: non-existent directory passed to checkPlatformPaths
  it('handles non-existent directory without throwing', () => {
    const result = checkPlatformPaths('/tmp/cap-totally-nonexistent-dir-xyz');
    assert.strictEqual(typeof result, 'object', 'should return a result object');
    assert.notStrictEqual(result, null, 'result should not be null');
    assert.equal(result.isSymlink, false, 'non-existent dir is not a symlink');
    assert.equal(result.installDir, '/tmp/cap-totally-nonexistent-dir-xyz');
  });

  // @cap-todo(ac:F-019/AC-6) Edge case: HOME set to empty string
  // When HOME='', os.homedir() also returns '' on macOS/Linux, so they "match"
  // but both are invalid paths. This test verifies the function does not throw.
  it('handles HOME set to empty string without throwing', () => {
    const originalHome = process.env.HOME;
    try {
      process.env.HOME = '';
      const result = checkPlatformPaths('/tmp');
      assert.equal(result.envHome, '', 'envHome should be empty string');
      // On Unix, both HOME and os.homedir() will be '' so they match.
      // On Windows, os.homedir() falls back to USERPROFILE, so they won't match.
      if (process.platform === 'win32') {
        assert.equal(result.homeMatch, false, 'on Windows, empty HOME != USERPROFILE');
      } else {
        assert.equal(result.homeMatch, true, 'both are empty so they match');
      }
      assert.strictEqual(typeof result.ok, 'boolean', 'ok should be a boolean');
    } finally {
      process.env.HOME = originalHome;
    }
  });

  // @cap-todo(ac:F-019/AC-6) Edge case: installDir is a regular file, not a directory
  it('handles a file path (not directory) as installDir', () => {
    const tmpFile = path.join(os.tmpdir(), 'cap-not-a-dir-' + Date.now());
    fs.writeFileSync(tmpFile, 'not a directory');
    try {
      const result = checkPlatformPaths(tmpFile);
      // lstatSync should succeed on a file — it's not a symlink
      assert.equal(result.isSymlink, false, 'regular file is not a symlink');
      assert.strictEqual(typeof result.ok, 'boolean', 'ok should be a boolean');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe('formatReport — adversarial edge cases', () => {
  // @cap-todo(ac:F-019/AC-3) Edge case: report with zero modules (empty modules array)
  it('handles report with empty modules array', () => {
    const report = {
      tools: [],
      requiredOk: 0,
      requiredTotal: 0,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: true,
      installCommands: [],
      modules: [],
      modulesOk: 0,
      modulesTotal: 0,
      platformPaths: { envHome: '/home', osHomedir: '/home', homeMatch: true, installDir: '/test', isSymlink: false, ok: true, warnings: [] },
    };
    const output = formatReport(report);
    assert.strictEqual(typeof output, 'string', 'should return a string');
    assert.ok(output.length > 0, 'output should not be empty');
    assert.ok(output.includes('Modules:'), 'should still show Modules line');
    assert.ok(output.includes('0/0 OK'), 'should show 0/0');
  });

  // @cap-todo(ac:F-019/AC-3) Edge case: report with null/undefined modules
  it('handles report with undefined modules gracefully', () => {
    const report = {
      tools: [],
      requiredOk: 0,
      requiredTotal: 0,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: true,
      installCommands: [],
      // modules intentionally omitted
    };
    // Should not throw
    const output = formatReport(report);
    assert.strictEqual(typeof output, 'string', 'should return a string');
    assert.ok(output.length > 0, 'output should not be empty');
  });

  // @cap-todo(ac:F-019/AC-3) Edge case: multiple failed modules with long error messages
  it('formats multiple failures without truncation', () => {
    const longError = 'A'.repeat(200);
    const report = {
      tools: [],
      requiredOk: 0,
      requiredTotal: 0,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: false,
      installCommands: [],
      modules: [
        { name: 'a.cjs', fullPath: '/fake/a.cjs', exists: false, loads: false, ok: false, error: `File not found: ${longError}` },
        { name: 'b.cjs', fullPath: '/fake/b.cjs', exists: true, loads: false, ok: false, error: `Load error: ${longError}` },
        { name: 'c.cjs', fullPath: '/fake/c.cjs', exists: true, loads: true, ok: true },
      ],
      modulesOk: 1,
      modulesTotal: 3,
      platformPaths: { envHome: '/home', osHomedir: '/home', homeMatch: true, installDir: '/fake', isSymlink: false, ok: true, warnings: [] },
    };
    const output = formatReport(report);
    assert.ok(output.includes('a.cjs'), 'should list first failed module');
    assert.ok(output.includes('b.cjs'), 'should list second failed module');
    assert.ok(!output.includes('c.cjs'), 'should NOT list passing module in failures');
    assert.ok(output.includes('1/3 modules OK'), 'should show correct count');
  });

  // @cap-todo(ac:F-019/AC-4) Edge case: unhealthy report with both tool and module failures
  it('shows combined unhealthy message when both tools and modules fail', () => {
    const report = {
      tools: [
        { name: 'Node.js', ok: false, version: 'not found', required: true, purpose: 'runtime', installHint: '' },
      ],
      requiredOk: 0,
      requiredTotal: 1,
      optionalOk: 0,
      optionalTotal: 0,
      healthy: false,
      installCommands: [],
      modules: [
        { name: 'x.cjs', fullPath: '/fake/x.cjs', exists: false, loads: false, ok: false, error: 'File not found' },
      ],
      modulesOk: 0,
      modulesTotal: 1,
      platformPaths: { envHome: '/home', osHomedir: '/home', homeMatch: true, installDir: '/fake', isSymlink: false, ok: true, warnings: [] },
    };
    const output = formatReport(report);
    assert.ok(output.includes('UNHEALTHY'), 'should say UNHEALTHY');
    assert.ok(
      output.includes('required tools missing and module integrity failures'),
      'should mention both tools and modules in unhealthy message'
    );
  });
});

describe('runDoctor — adversarial edge cases', () => {
  // @cap-todo(ac:F-019/AC-4) Edge case: runDoctor with non-existent projectRoot
  it('handles non-existent projectRoot gracefully', () => {
    const report = runDoctor('/tmp/cap-nonexistent-project-root-xyz');
    assert.strictEqual(typeof report, 'object', 'should still return a report');
    assert.notStrictEqual(report, null, 'report should not be null');
    assert.strictEqual(Array.isArray(report.tools), true, 'should still have tools');
    assert.strictEqual(typeof report.healthy, 'boolean', 'should still have healthy flag');
  });

  // @cap-todo(ac:F-019/AC-4) Edge case: runDoctor with projectRoot pointing to file
  it('handles projectRoot pointing to a file (not directory)', () => {
    const tmpFile = path.join(os.tmpdir(), 'cap-fake-root-' + Date.now());
    fs.writeFileSync(tmpFile, '{}');
    try {
      const report = runDoctor(tmpFile);
      assert.strictEqual(typeof report, 'object', 'should return an object');
      assert.notStrictEqual(report, null, 'report should not be null');
      assert.strictEqual(Array.isArray(report.tools), true, 'should have tools array');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  // @cap-todo(ac:F-019/AC-4) Edge case: runDoctor with malformed package.json
  it('handles projectRoot with malformed package.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-badpkg-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'NOT VALID JSON {{{');
    try {
      const report = runDoctor(tmpDir);
      assert.strictEqual(typeof report, 'object', 'should not throw on bad package.json');
      assert.notStrictEqual(report, null, 'report should not be null');
      assert.strictEqual(Array.isArray(report.tools), true, 'should have tools array');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
