// @cap-feature(feature:F-020) Tests for Resilient Module Loading with Error Recovery

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  load,
  loadAll,
  detectInstallDir,
  formatLoadError,
  clearRequireCache,
  REPAIR_COMMAND,
} = require('../cap/bin/lib/cap-loader.cjs');

const LIB_DIR = path.join(__dirname, '..', 'cap', 'bin', 'lib');

describe('cap-loader', () => {

  // @cap-todo(ac:F-020/AC-1) Test: display specific error naming missing module and path
  describe('AC-1: specific error for missing modules', () => {
    it('formatLoadError includes module name and path', () => {
      const err = new Error("Cannot find module '/fake/path/missing.cjs'");
      err.code = 'MODULE_NOT_FOUND';
      const msg = formatLoadError('missing.cjs', '/fake/path/missing.cjs', err);
      assert.ok(msg.includes('missing.cjs'), 'should name the module');
      assert.ok(msg.includes('/fake/path/missing.cjs'), 'should include the full path');
      assert.ok(msg.includes('File not found'), 'should say file not found for MODULE_NOT_FOUND');
    });

    it('formatLoadError handles syntax/load errors differently from missing', () => {
      const err = new Error('Unexpected token }');
      err.code = 'ERR_SYNTAX';
      const msg = formatLoadError('broken.cjs', '/fake/broken.cjs', err);
      assert.ok(msg.includes('Load error: Unexpected token }'), 'should include original error');
    });

    it('load() writes specific error to stderr on failure', () => {
      const stderrOutput = [];
      const fakeStderr = (msg) => stderrOutput.push(msg);
      const fakeRequire = () => { const e = new Error('not found'); e.code = 'MODULE_NOT_FOUND'; throw e; };
      let exitCode = null;
      const fakeExit = (code) => { exitCode = code; };

      load('nonexistent-module', {
        installDir: '/tmp/cap-loader-test-fake',
        exitOnFailure: true,
        _require: fakeRequire,
        _exit: fakeExit,
        _stderr: fakeStderr,
      });

      const combined = stderrOutput.join('');
      assert.ok(combined.includes('nonexistent-module.cjs'), 'error should name the module');
      assert.ok(combined.includes('/tmp/cap-loader-test-fake'), 'error should include expected path');
    });
  });

  // @cap-todo(ac:F-020/AC-2) Test: suggest repair command
  describe('AC-2: suggest repair command', () => {
    it('REPAIR_COMMAND is npx code-as-plan@latest --force', () => {
      assert.equal(REPAIR_COMMAND, 'npx code-as-plan@latest --force');
    });

    it('formatLoadError includes repair command', () => {
      const err = new Error('not found');
      err.code = 'MODULE_NOT_FOUND';
      const msg = formatLoadError('x.cjs', '/x.cjs', err);
      assert.ok(msg.includes(REPAIR_COMMAND), 'should suggest repair command');
    });

    it('load() suggests repair command in stderr on failure', () => {
      const stderrOutput = [];
      const fakeRequire = () => { const e = new Error('nf'); e.code = 'MODULE_NOT_FOUND'; throw e; };
      let exited = false;

      load('missing', {
        installDir: '/tmp/fake',
        _require: fakeRequire,
        _exit: () => { exited = true; },
        _stderr: (msg) => stderrOutput.push(msg),
      });

      const combined = stderrOutput.join('');
      assert.ok(combined.includes(REPAIR_COMMAND), 'should suggest repair command');
      assert.ok(exited, 'should have called exit');
    });
  });

  // @cap-todo(ac:F-020/AC-3) Test: never silently fall back
  describe('AC-3: never silently fall back', () => {
    it('load() always produces stderr output on failure', () => {
      const stderrOutput = [];
      const fakeRequire = () => { throw new Error('boom'); };

      load('failing-module', {
        installDir: '/tmp/fake',
        exitOnFailure: true,
        _require: fakeRequire,
        _exit: () => {},
        _stderr: (msg) => stderrOutput.push(msg),
      });

      assert.ok(stderrOutput.length > 0, 'must write to stderr on failure');
      const combined = stderrOutput.join('');
      assert.ok(combined.includes('[CAP]'), 'must include [CAP] prefix');
      assert.ok(combined.includes('failing-module'), 'must name the failing module');
    });

    it('load() with exitOnFailure=false throws instead of silent fallback', () => {
      const fakeRequire = () => { throw new Error('boom'); };

      assert.throws(
        () => load('broken', {
          installDir: '/tmp/fake',
          exitOnFailure: false,
          autoRepair: false,
          _require: fakeRequire,
          _stderr: () => {},
        }),
        (err) => {
          assert.equal(err.code, 'CAP_MODULE_LOAD_FAILED');
          assert.equal(err.moduleName, 'broken.cjs');
          return true;
        }
      );
    });
  });

  // @cap-todo(ac:F-020/AC-4) Test: automatic self-repair
  describe('AC-4: automatic self-repair', () => {
    it('attempts repair when autoRepair=true and load fails', () => {
      let repairCalled = false;
      let loadAttempts = 0;
      const fakeRequire = () => {
        loadAttempts++;
        if (loadAttempts === 1) { throw new Error('not found'); }
        return { repaired: true };
      };
      const fakeRepair = () => { repairCalled = true; return { ok: true }; };

      const result = load('repairable', {
        installDir: '/tmp/fake',
        autoRepair: true,
        _require: fakeRequire,
        _repair: fakeRepair,
        _stderr: () => {},
      });

      assert.ok(repairCalled, 'should have called repair');
      assert.deepEqual(result, { repaired: true });
    });

    it('does not attempt repair when autoRepair=false', () => {
      let repairCalled = false;
      const fakeRequire = () => { throw new Error('not found'); };
      const fakeRepair = () => { repairCalled = true; return { ok: true }; };

      load('missing', {
        installDir: '/tmp/fake',
        autoRepair: false,
        _require: fakeRequire,
        _repair: fakeRepair,
        _exit: () => {},
        _stderr: () => {},
      });

      assert.ok(!repairCalled, 'should not call repair when autoRepair=false');
    });
  });

  // @cap-todo(ac:F-020/AC-5) Test: retry after successful repair
  describe('AC-5: retry after successful repair', () => {
    it('retries require() after successful repair and returns module', () => {
      let loadAttempts = 0;
      const fakeRequire = () => {
        loadAttempts++;
        if (loadAttempts === 1) {
          const e = new Error('missing');
          e.code = 'MODULE_NOT_FOUND';
          throw e;
        }
        return { loaded: true, attempt: loadAttempts };
      };

      const result = load('recoverable', {
        installDir: '/tmp/fake',
        autoRepair: true,
        _require: fakeRequire,
        _repair: () => ({ ok: true }),
        _stderr: () => {},
      });

      assert.equal(loadAttempts, 2, 'should have tried twice');
      assert.equal(result.loaded, true);
      assert.equal(result.attempt, 2);
    });

    it('reports success message after repair+retry', () => {
      const stderrOutput = [];
      let loadAttempts = 0;
      const fakeRequire = () => {
        loadAttempts++;
        if (loadAttempts === 1) throw new Error('missing');
        return {};
      };

      load('fixed', {
        installDir: '/tmp/fake',
        autoRepair: true,
        _require: fakeRequire,
        _repair: () => ({ ok: true }),
        _stderr: (msg) => stderrOutput.push(msg),
      });

      const combined = stderrOutput.join('');
      assert.ok(combined.includes('loaded successfully after repair'), 'should confirm successful retry');
    });
  });

  // @cap-todo(ac:F-020/AC-6) Test: non-zero exit on repair failure
  describe('AC-6: non-zero exit on repair failure', () => {
    it('exits with code 1 when repair fails', () => {
      let exitCode = null;
      const fakeRequire = () => { throw new Error('missing'); };
      const fakeRepair = () => ({ ok: false, error: 'npm network error' });

      load('hopeless', {
        installDir: '/tmp/fake',
        autoRepair: true,
        exitOnFailure: true,
        _require: fakeRequire,
        _repair: fakeRepair,
        _exit: (code) => { exitCode = code; },
        _stderr: () => {},
      });

      assert.equal(exitCode, 1, 'should exit with code 1');
    });

    it('includes repair error in stderr output', () => {
      const stderrOutput = [];
      const fakeRequire = () => { throw new Error('missing'); };
      const fakeRepair = () => ({ ok: false, error: 'ENOENT: npm not found' });

      load('hopeless', {
        installDir: '/tmp/fake',
        autoRepair: true,
        exitOnFailure: true,
        _require: fakeRequire,
        _repair: fakeRepair,
        _exit: () => {},
        _stderr: (msg) => stderrOutput.push(msg),
      });

      const combined = stderrOutput.join('');
      assert.ok(combined.includes('ENOENT: npm not found'), 'should include repair error');
      assert.ok(combined.includes('Reinstall manually'), 'should suggest manual reinstall');
    });

    it('throws with CAP_REPAIR_FAILED code when exitOnFailure=false', () => {
      const fakeRequire = () => { throw new Error('missing'); };
      const fakeRepair = () => ({ ok: false, error: 'timeout' });

      assert.throws(
        () => load('hopeless', {
          installDir: '/tmp/fake',
          autoRepair: true,
          exitOnFailure: false,
          _require: fakeRequire,
          _repair: fakeRepair,
          _stderr: () => {},
        }),
        (err) => {
          assert.equal(err.code, 'CAP_REPAIR_FAILED');
          assert.equal(err.repairError, 'timeout');
          return true;
        }
      );
    });

    it('exits with code 1 when repair succeeds but retry still fails', () => {
      let exitCode = null;
      const fakeRequire = () => { throw new Error('always broken'); };
      const fakeRepair = () => ({ ok: true });

      load('still-broken', {
        installDir: '/tmp/fake',
        autoRepair: true,
        exitOnFailure: true,
        _require: fakeRequire,
        _repair: fakeRepair,
        _exit: (code) => { exitCode = code; },
        _stderr: () => {},
      });

      assert.equal(exitCode, 1, 'should exit with code 1');
    });
  });

  describe('load() with real modules', () => {
    it('loads a real CAP module by name (without .cjs)', () => {
      const mod = load('cap-session', { installDir: LIB_DIR });
      assert.ok(typeof mod.loadSession === 'function');
    });

    it('loads a real CAP module by name (with .cjs)', () => {
      const mod = load('cap-session.cjs', { installDir: LIB_DIR });
      assert.ok(typeof mod.loadSession === 'function');
    });
  });

  describe('loadAll()', () => {
    it('loads multiple modules and returns a map', () => {
      const mods = loadAll(['cap-session', 'cap-feature-map'], { installDir: LIB_DIR });
      assert.ok(typeof mods['cap-session'].loadSession === 'function');
      assert.ok(typeof mods['cap-feature-map'].readFeatureMap === 'function');
    });

    it('fails fast on first missing module', () => {
      let exitCode = null;
      const stderrOutput = [];

      loadAll(['cap-session', 'nonexistent-xyz', 'cap-feature-map'], {
        installDir: LIB_DIR,
        exitOnFailure: true,
        _exit: (code) => { exitCode = code; },
        _stderr: (msg) => stderrOutput.push(msg),
      });

      assert.equal(exitCode, 1);
      const combined = stderrOutput.join('');
      assert.ok(combined.includes('nonexistent-xyz'));
    });
  });

  describe('detectInstallDir()', () => {
    it('returns a string path', () => {
      const dir = detectInstallDir();
      assert.equal(typeof dir, 'string');
      assert.ok(dir.length > 0);
    });

    it('returned directory exists', () => {
      const dir = detectInstallDir();
      assert.ok(fs.existsSync(dir), `${dir} should exist`);
    });
  });

  describe('clearRequireCache()', () => {
    it('removes a module from require.cache', () => {
      const testPath = path.resolve(LIB_DIR, 'cap-session.cjs');
      // Ensure it's in cache
      require(testPath);
      assert.ok(require.cache[testPath], 'should be in cache');

      clearRequireCache(testPath);
      assert.equal(require.cache[testPath], undefined, 'should be cleared from cache');
    });
  });

  // === ADVERSARIAL EDGE CASES ===

  describe('adversarial — formatLoadError edge cases', () => {
    it('truncates multiline error messages to first line', () => {
      const err = new Error('Line 1\nLine 2\nLine 3');
      const msg = formatLoadError('mod.cjs', '/p/mod.cjs', err);
      assert.ok(msg.includes('Load error: Line 1'), 'should only show first line');
      assert.ok(!msg.includes('Line 2'), 'should not include second line');
    });

    it('handles error with no code property', () => {
      const err = new Error('generic failure');
      // Deliberately no err.code
      const msg = formatLoadError('mod.cjs', '/p/mod.cjs', err);
      assert.ok(msg.includes('Load error: generic failure'), 'should fall through to Load error');
    });

    it('handles error with empty message', () => {
      const err = new Error('');
      err.code = 'MODULE_NOT_FOUND';
      const msg = formatLoadError('mod.cjs', '/p/mod.cjs', err);
      assert.ok(msg.includes('File not found'), 'MODULE_NOT_FOUND code takes precedence over empty message');
    });

    it('preserves special characters in module name and path', () => {
      const err = new Error('not found');
      err.code = 'MODULE_NOT_FOUND';
      const msg = formatLoadError('my-module (v2).cjs', '/path/with spaces/my-module (v2).cjs', err);
      assert.ok(msg.includes('my-module (v2).cjs'));
      assert.ok(msg.includes('/path/with spaces/'));
    });
  });

  describe('adversarial — load() edge cases', () => {
    it('normalizes module name without .cjs extension', () => {
      const stderrOutput = [];
      const fakeRequire = () => { throw new Error('nf'); };

      load('my-module', {
        installDir: '/tmp/fake',
        _require: fakeRequire,
        _exit: () => {},
        _stderr: (msg) => stderrOutput.push(msg),
      });

      const combined = stderrOutput.join('');
      assert.ok(combined.includes('my-module.cjs'), 'should append .cjs to bare name');
    });

    it('does not double-append .cjs when already present', () => {
      const stderrOutput = [];
      const fakeRequire = () => { throw new Error('nf'); };

      load('my-module.cjs', {
        installDir: '/tmp/fake',
        _require: fakeRequire,
        _exit: () => {},
        _stderr: (msg) => stderrOutput.push(msg),
      });

      const combined = stderrOutput.join('');
      assert.ok(combined.includes('my-module.cjs'), 'should include module name');
      assert.ok(!combined.includes('my-module.cjs.cjs'), 'should NOT double-append .cjs');
    });

    it('returns module exports on successful first load (no error path)', () => {
      const fakeModule = { foo: 'bar', fn: () => 42 };
      const result = load('good-module', {
        installDir: '/tmp/fake',
        _require: () => fakeModule,
        _stderr: () => {},
      });
      assert.deepEqual(result, fakeModule);
    });

    it('handles module that exports falsy values (null, 0, empty string)', () => {
      // Modules can export falsy values — load should still return them
      const result = load('null-module', {
        installDir: '/tmp/fake',
        _require: () => null,
        _stderr: () => {},
      });
      assert.equal(result, null, 'should return null without triggering error path');
    });

    it('handles repair function that throws instead of returning {ok: false}', () => {
      const stderrOutput = [];
      const fakeRequire = () => { throw new Error('missing'); };
      const fakeRepair = () => { throw new Error('repair crashed'); };

      // When repair itself throws, load should propagate that — not silently catch it
      assert.throws(
        () => load('mod', {
          installDir: '/tmp/fake',
          autoRepair: true,
          exitOnFailure: false,
          _require: fakeRequire,
          _repair: fakeRepair,
          _stderr: (msg) => stderrOutput.push(msg),
        }),
        (err) => {
          assert.equal(err.message, 'repair crashed');
          return true;
        }
      );
    });

    it('error object includes originalError, moduleName, and modulePath', () => {
      const originalErr = new Error('the original');
      originalErr.code = 'MODULE_NOT_FOUND';
      const fakeRequire = () => { throw originalErr; };

      try {
        load('detailed', {
          installDir: '/some/dir',
          exitOnFailure: false,
          autoRepair: false,
          _require: fakeRequire,
          _stderr: () => {},
        });
        assert.fail('should have thrown');
      } catch (err) {
        assert.equal(err.code, 'CAP_MODULE_LOAD_FAILED');
        assert.equal(err.moduleName, 'detailed.cjs');
        assert.equal(err.modulePath, path.join('/some/dir', 'detailed.cjs'));
        assert.equal(err.originalError, originalErr, 'should preserve original error reference');
      }
    });

    it('CAP_MODULE_LOAD_FAILED_AFTER_REPAIR includes correct properties', () => {
      const fakeRequire = () => { throw new Error('still broken'); };
      const fakeRepair = () => ({ ok: true });

      try {
        load('post-repair-fail', {
          installDir: '/tmp/d',
          autoRepair: true,
          exitOnFailure: false,
          _require: fakeRequire,
          _repair: fakeRepair,
          _stderr: () => {},
        });
        assert.fail('should have thrown');
      } catch (err) {
        assert.equal(err.code, 'CAP_MODULE_LOAD_FAILED_AFTER_REPAIR');
        assert.equal(err.moduleName, 'post-repair-fail.cjs');
        assert.ok(err.originalError instanceof Error);
      }
    });
  });

  describe('adversarial — loadAll() edge cases', () => {
    it('returns empty object for empty module list', () => {
      const result = loadAll([], { installDir: LIB_DIR });
      assert.deepEqual(result, {});
    });

    it('handles same module loaded twice without error', () => {
      const result = loadAll(['cap-session', 'cap-session'], { installDir: LIB_DIR });
      // Second load overwrites first — key is the same
      assert.ok(typeof result['cap-session'].loadSession === 'function');
    });

    it('strips .cjs from keys in returned map', () => {
      const result = loadAll(['cap-session.cjs'], { installDir: LIB_DIR });
      assert.ok(result['cap-session'] !== undefined, 'key should have .cjs stripped');
      assert.equal(result['cap-session.cjs'], undefined, 'should not have .cjs key');
    });

    it('loadAll stops at first failure and does not load subsequent modules', () => {
      let loadedModules = [];
      let callCount = 0;
      const fakeRequire = (p) => {
        callCount++;
        const name = path.basename(p);
        if (name === 'bad.cjs') throw new Error('fail');
        loadedModules.push(name);
        return { name };
      };

      loadAll(['good', 'bad', 'never-reached'], {
        installDir: '/tmp/fake',
        _require: fakeRequire,
        _exit: () => {},
        _stderr: () => {},
      });

      assert.equal(callCount, 2, 'should stop after "bad" fails');
      assert.deepEqual(loadedModules, ['good.cjs'], 'should only have loaded "good"');
    });
  });

  describe('adversarial — no silent fallback guarantee', () => {
    // AC-3 is critical: test EVERY failure path produces stderr output

    it('autoRepair=false + exitOnFailure=true produces stderr', () => {
      const stderrOutput = [];
      load('m', {
        installDir: '/tmp/fake',
        autoRepair: false,
        exitOnFailure: true,
        _require: () => { throw new Error('x'); },
        _exit: () => {},
        _stderr: (msg) => stderrOutput.push(msg),
      });
      assert.ok(stderrOutput.length > 0, 'path 1: must produce stderr');
    });

    it('autoRepair=false + exitOnFailure=false produces stderr before throw', () => {
      const stderrOutput = [];
      try {
        load('m', {
          installDir: '/tmp/fake',
          autoRepair: false,
          exitOnFailure: false,
          _require: () => { throw new Error('x'); },
          _stderr: (msg) => stderrOutput.push(msg),
        });
      } catch (_) { /* expected */ }
      assert.ok(stderrOutput.length > 0, 'path 2: must produce stderr');
    });

    it('autoRepair=true + repair succeeds + retry succeeds produces stderr about initial failure', () => {
      const stderrOutput = [];
      let attempt = 0;
      load('m', {
        installDir: '/tmp/fake',
        autoRepair: true,
        _require: () => { attempt++; if (attempt === 1) throw new Error('x'); return {}; },
        _repair: () => ({ ok: true }),
        _stderr: (msg) => stderrOutput.push(msg),
      });
      assert.ok(stderrOutput.length > 0, 'path 3: must produce stderr even on eventual success');
    });

    it('autoRepair=true + repair succeeds + retry fails produces stderr', () => {
      const stderrOutput = [];
      load('m', {
        installDir: '/tmp/fake',
        autoRepair: true,
        exitOnFailure: true,
        _require: () => { throw new Error('x'); },
        _repair: () => ({ ok: true }),
        _exit: () => {},
        _stderr: (msg) => stderrOutput.push(msg),
      });
      assert.ok(stderrOutput.length > 0, 'path 4: must produce stderr');
      const combined = stderrOutput.join('');
      assert.ok(combined.includes('still fails'), 'should mention retry failure');
    });

    it('autoRepair=true + repair fails produces stderr', () => {
      const stderrOutput = [];
      load('m', {
        installDir: '/tmp/fake',
        autoRepair: true,
        exitOnFailure: true,
        _require: () => { throw new Error('x'); },
        _repair: () => ({ ok: false, error: 'timeout' }),
        _exit: () => {},
        _stderr: (msg) => stderrOutput.push(msg),
      });
      assert.ok(stderrOutput.length > 0, 'path 5: must produce stderr');
      const combined = stderrOutput.join('');
      assert.ok(combined.includes('Self-repair failed'), 'should mention repair failure');
    });
  });

  describe('adversarial — repair result edge cases', () => {
    it('handles repair returning {ok: false} with no error field', () => {
      const stderrOutput = [];
      load('m', {
        installDir: '/tmp/fake',
        autoRepair: true,
        exitOnFailure: true,
        _require: () => { throw new Error('x'); },
        _repair: () => ({ ok: false }),
        _exit: () => {},
        _stderr: (msg) => stderrOutput.push(msg),
      });
      const combined = stderrOutput.join('');
      assert.ok(combined.includes('unknown error'), 'should show "unknown error" when repair.error is undefined');
    });

    it('handles repair returning {ok: false, error: ""} (empty string)', () => {
      const stderrOutput = [];
      load('m', {
        installDir: '/tmp/fake',
        autoRepair: true,
        exitOnFailure: true,
        _require: () => { throw new Error('x'); },
        _repair: () => ({ ok: false, error: '' }),
        _exit: () => {},
        _stderr: (msg) => stderrOutput.push(msg),
      });
      const combined = stderrOutput.join('');
      // Empty string is falsy, so falls back to 'unknown error'
      assert.ok(combined.includes('unknown error'), 'empty string error should fallback to unknown');
    });
  });

  describe('adversarial — real file system edge cases', () => {
    let tmpDir;

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-loader-test-'));
    });

    after(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('detects a real missing module (not mocked) and reports correct path', () => {
      const stderrOutput = [];
      let exitCode = null;

      load('does-not-exist-at-all', {
        installDir: tmpDir,
        exitOnFailure: true,
        _exit: (code) => { exitCode = code; },
        _stderr: (msg) => stderrOutput.push(msg),
      });

      assert.equal(exitCode, 1);
      const combined = stderrOutput.join('');
      assert.ok(combined.includes(tmpDir), 'should include the actual directory path');
      assert.ok(combined.includes('does-not-exist-at-all.cjs'));
    });

    it('detects a module with syntax errors (real file, bad JS)', () => {
      const badPath = path.join(tmpDir, 'bad-syntax.cjs');
      fs.writeFileSync(badPath, 'module.exports = {{{; // broken', 'utf8');

      const stderrOutput = [];
      let exitCode = null;

      load('bad-syntax', {
        installDir: tmpDir,
        exitOnFailure: true,
        _exit: (code) => { exitCode = code; },
        _stderr: (msg) => stderrOutput.push(msg),
      });

      assert.equal(exitCode, 1);
      const combined = stderrOutput.join('');
      assert.ok(combined.includes('bad-syntax.cjs'));
      assert.ok(combined.includes('Load error:'), 'should identify as load error, not file-not-found');
    });

    it('successfully loads a real valid module from temp directory', () => {
      const goodPath = path.join(tmpDir, 'good-module.cjs');
      fs.writeFileSync(goodPath, "module.exports = { answer: 42 };", 'utf8');

      const result = load('good-module', { installDir: tmpDir });
      assert.deepEqual(result, { answer: 42 });

      // Cleanup require cache
      clearRequireCache(goodPath);
    });

    it('detects an empty file (0 bytes) as loadable (empty module)', () => {
      const emptyPath = path.join(tmpDir, 'empty-module.cjs');
      fs.writeFileSync(emptyPath, '', 'utf8');

      // Empty CJS module exports an empty object {}
      const result = load('empty-module', { installDir: tmpDir });
      assert.deepEqual(result, {});

      clearRequireCache(emptyPath);
    });
  });
});
