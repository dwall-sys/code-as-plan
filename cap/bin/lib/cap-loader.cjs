// @cap-feature(feature:F-020) Resilient Module Loading with Error Recovery
// @cap-decision Loader wraps require() with error detection, self-repair, and retry.
// Bootstrap problem: if cap-loader.cjs itself is missing, callers need an inline try/catch
// to show the basic "run npx code-as-plan@latest --force" message. This module handles
// all other module failures once it is loaded.
// @cap-constraint Zero external dependencies — uses only Node.js built-ins.

'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPAIR_COMMAND = 'npx code-as-plan@latest --force';

// @cap-todo(ac:F-020/AC-1) Display specific error naming the missing module and its expected path
/**
 * Format a clear error message for a failed module load.
 * @param {string} moduleName - Module filename (e.g., 'cap-feature-map.cjs')
 * @param {string} fullPath - Absolute path where the module was expected
 * @param {Error} originalError - The original require() error
 * @returns {string} Formatted error message
 */
function formatLoadError(moduleName, fullPath, originalError) {
  const reason = originalError.code === 'MODULE_NOT_FOUND'
    ? 'File not found'
    : `Load error: ${originalError.message.split('\n')[0]}`;

  return [
    `[CAP] Failed to load module: ${moduleName}`,
    `  Expected path: ${fullPath}`,
    `  Reason: ${reason}`,
    `  Repair: ${REPAIR_COMMAND}`,
  ].join('\n');
}

/**
 * Detect the CAP install directory.
 * Checks the global install path first, then falls back to this file's directory.
 * @cap-decision Intentionally duplicates cap-doctor.cjs:detectInstallDir(). cap-loader must be
 * self-contained — it cannot require() cap-doctor because cap-loader is the module that handles
 * require() failures. Extracting to a shared utility would create a bootstrap dependency.
 * @returns {string} Absolute path to cap/bin/lib/
 */
function detectInstallDir() {
  const homeDir = process.env.HOME || os.homedir();
  const globalDir = path.join(homeDir, '.claude', 'cap', 'cap', 'bin', 'lib');
  if (fs.existsSync(globalDir)) {
    return globalDir;
  }
  return __dirname;
}

// @cap-todo(ac:F-020/AC-4) Offer automatic self-repair by re-running the installer
/**
 * Attempt to repair the CAP installation by re-running the installer.
 * Runs `npx code-as-plan@latest --force` via execSync (blocking, up to 120s).
 * If _repair() throws, the error propagates intentionally — callers should not
 * catch unexpected failures from the repair mechanism itself.
 * @returns {{ ok: boolean, error?: string }} Repair result
 */
function attemptSelfRepair() {
  // @cap-todo(ac:F-020/AC-3) Never silently fall back — always produce visible output
  process.stderr.write('[CAP] Attempting self-repair: ' + REPAIR_COMMAND + '\n');

  try {
    execSync(REPAIR_COMMAND, {
      encoding: 'utf8',
      timeout: 120000, // 2 minute timeout for npm install
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    process.stderr.write('[CAP] Self-repair completed successfully.\n');
    return { ok: true };
  } catch (err) {
    const msg = err.stderr
      ? err.stderr.split('\n')[0]
      : err.message.split('\n')[0];
    return { ok: false, error: msg };
  }
}

/**
 * Clear a module from Node's require cache so a fresh require() picks up repaired files.
 * @param {string} fullPath - Absolute path to clear from cache
 */
function clearRequireCache(fullPath) {
  const resolved = path.resolve(fullPath);
  delete require.cache[resolved];
}

// @cap-todo(ac:F-020/AC-2) Error message shall suggest running repair command
// @cap-todo(ac:F-020/AC-5) If self-repair succeeds, retry the original operation
// @cap-todo(ac:F-020/AC-6) If self-repair fails, exit with non-zero code
/**
 * Load a CAP module with resilient error handling and optional self-repair.
 *
 * @param {string} moduleName - Module name without path (e.g., 'cap-feature-map' or 'cap-feature-map.cjs')
 * @param {Object} [options]
 * @param {string} [options.installDir] - Override install directory (for testing)
 * @param {boolean} [options.autoRepair=false] - Attempt self-repair on failure
 * @param {boolean} [options.exitOnFailure=true] - Call process.exit(1) if load fails after repair
 * @param {function} [options._require] - Override require function (for testing)
 * @param {function} [options._repair] - Override repair function (for testing)
 * @param {function} [options._exit] - Override exit function (for testing)
 * @param {function} [options._stderr] - Override stderr write function (for testing)
 * @returns {*} The loaded module exports
 * @throws {Error} If module cannot be loaded and exitOnFailure is false
 */
function load(moduleName, options = {}) {
  const {
    installDir,
    autoRepair = false,
    exitOnFailure = true,
    _require = require,
    _repair = attemptSelfRepair,
    _exit = (code) => process.exit(code),
    _stderr = (msg) => process.stderr.write(msg),
  } = options;

  // Normalize module name: ensure .cjs extension
  const fileName = moduleName.endsWith('.cjs') ? moduleName : `${moduleName}.cjs`;
  const dir = installDir || detectInstallDir();
  const fullPath = path.join(dir, fileName);

  // @cap-todo(ac:F-020/AC-3) Never silently fall back — always produce a visible error
  // First attempt
  try {
    return _require(path.resolve(fullPath));
  } catch (firstError) {
    const errorMsg = formatLoadError(fileName, fullPath, firstError);
    _stderr(errorMsg + '\n');

    // @cap-todo(ac:F-020/AC-4) Automatic self-repair option
    if (!autoRepair) {
      if (exitOnFailure) {
        _stderr(`[CAP] Run "${REPAIR_COMMAND}" to repair your installation.\n`);
        _exit(1);
        return; // process.exit halts; return guards against overridden _exit in tests
      }
      const err = new Error(`CAP module load failed: ${fileName} at ${fullPath}`);
      err.code = 'CAP_MODULE_LOAD_FAILED';
      err.moduleName = fileName;
      err.modulePath = fullPath;
      err.originalError = firstError;
      throw err;
    }

    // @cap-todo(ac:F-020/AC-4) Attempt self-repair
    const repairResult = _repair();

    if (repairResult.ok) {
      // @cap-todo(ac:F-020/AC-5) Retry after successful repair
      clearRequireCache(fullPath);
      try {
        const mod = _require(path.resolve(fullPath));
        _stderr(`[CAP] Module ${fileName} loaded successfully after repair.\n`);
        return mod;
      } catch (retryError) {
        // Repair ran but module still won't load
        const retryMsg = formatLoadError(fileName, fullPath, retryError);
        _stderr(retryMsg + '\n');
        _stderr('[CAP] Self-repair completed but module still fails to load.\n');
        _stderr(`[CAP] Reinstall manually: ${REPAIR_COMMAND}\n`);
        if (exitOnFailure) {
          _exit(1);
          return;
        }
        const err = new Error(`CAP module load failed after repair: ${fileName}`);
        err.code = 'CAP_MODULE_LOAD_FAILED_AFTER_REPAIR';
        err.moduleName = fileName;
        err.modulePath = fullPath;
        err.originalError = retryError;
        throw err;
      }
    }

    // @cap-todo(ac:F-020/AC-6) Repair failed — exit with non-zero code
    _stderr(`[CAP] Self-repair failed: ${repairResult.error || 'unknown error'}\n`);
    _stderr(`[CAP] Reinstall manually: ${REPAIR_COMMAND}\n`);
    if (exitOnFailure) {
      _exit(1);
      return;
    }
    const err = new Error(`CAP self-repair failed for module: ${fileName}`);
    err.code = 'CAP_REPAIR_FAILED';
    err.moduleName = fileName;
    err.modulePath = fullPath;
    err.repairError = repairResult.error;
    throw err;
  }
}

/**
 * Load multiple CAP modules at once. Fails fast on the first missing module.
 *
 * @param {string[]} moduleNames - Array of module names
 * @param {Object} [options] - Same options as load()
 * @returns {Object} Map of moduleName -> exports
 */
function loadAll(moduleNames, options = {}) {
  const result = {};
  for (const name of moduleNames) {
    const key = name.replace(/\.cjs$/, '');
    const mod = load(name, options);
    // load() returns undefined only when _exit() was called (real process.exit halts,
    // but overridden _exit in tests returns control). Stop iterating in either case.
    if (mod === undefined) break;
    result[key] = mod;
  }
  return result;
}

module.exports = {
  load,
  loadAll,
  detectInstallDir,
  formatLoadError,
  attemptSelfRepair,
  clearRequireCache,
  REPAIR_COMMAND,
};
