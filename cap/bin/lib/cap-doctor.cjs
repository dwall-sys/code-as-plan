// @cap-context CAP v2.0 doctor utility -- checks all external dependencies CAP needs at runtime.
// @cap-decision Checks are split into required (Node.js, npm, git) and optional (ctx7, c8, vitest, fast-check).
// @cap-decision Project-specific checks only run when projectRoot is provided and package.json exists.
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (child_process, fs, path, os).

'use strict';

// @cap-feature(feature:F-005) Doctor Health Check — verify required and optional external dependencies
// @cap-feature(feature:F-019) Module Integrity Verification — verify CAP CJS modules exist and load correctly

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// @cap-todo(ac:F-019/AC-5) Module manifest — authoritative list of expected CAP modules
// @cap-decision Manifest is a flat array of filenames maintained manually. When a new module is added to
// cap/bin/lib/, it must be added here. This is intentional: an explicit manifest catches accidental deletions.
const CAP_MODULE_MANIFEST = [
  'arc-scanner.cjs',
  'cap-affinity-engine.cjs',
  'cap-anchor.cjs',
  'cap-annotation-writer.cjs',
  'cap-cluster-detect.cjs',
  'cap-cluster-display.cjs',
  'cap-cluster-format.cjs',
  'cap-cluster-helpers.cjs',
  'cap-cluster-io.cjs',
  'cap-completeness.cjs',
  'cap-deps.cjs',
  'cap-divergence-detector.cjs',
  'cap-doctor.cjs',
  'cap-feature-map.cjs',
  'cap-impact-analysis.cjs',
  'cap-loader.cjs',
  'cap-logger.cjs',
  'cap-memory-confidence.cjs',
  'cap-memory-dir.cjs',
  'cap-memory-engine.cjs',
  'cap-memory-graph.cjs',
  'cap-memory-pin.cjs',
  'cap-memory-prune.cjs',
  'cap-migrate-tags.cjs',
  'cap-migrate.cjs',
  'cap-realtime-affinity.cjs',
  'cap-reconcile.cjs',
  'cap-semantic-pipeline.cjs',
  'cap-session-extract.cjs',
  'cap-session.cjs',
  'cap-stack-docs.cjs',
  'cap-tag-scanner.cjs',
  'cap-test-audit.cjs',
  'cap-thread-migrator.cjs',
  'cap-thread-synthesis.cjs',
  'cap-thread-tracker.cjs',
  'cap-trace.cjs',
  'commands.cjs',
  'config.cjs',
  'convention-reader.cjs',
  'core.cjs',
  'feature-aggregator.cjs',
  'frontmatter.cjs',
  'init.cjs',
  'manifest-generator.cjs',
  'milestone.cjs',
  'model-profiles.cjs',
  'monorepo-context.cjs',
  'monorepo-migrator.cjs',
  'phase.cjs',
  'profile-output.cjs',
  'profile-pipeline.cjs',
  'roadmap.cjs',
  'security.cjs',
  'session-manager.cjs',
  'skeleton-generator.cjs',
  'state.cjs',
  'template.cjs',
  'test-detector.cjs',
  'uat.cjs',
  'verify.cjs',
  'workspace-detector.cjs',
  'workstream.cjs',
];

/**
 * @typedef {Object} ToolCheck
 * @property {string} name - Tool name
 * @property {string} version - Detected version (or 'not found')
 * @property {boolean} ok - Whether the tool is available
 * @property {boolean} required - Whether CAP requires it
 * @property {string} purpose - What CAP uses it for
 * @property {string} installHint - How to install if missing
 */

/**
 * @typedef {Object} DoctorReport
 * @property {ToolCheck[]} tools - All checked tools
 * @property {number} requiredOk - Count of required tools that are OK
 * @property {number} requiredTotal - Total required tools
 * @property {number} optionalOk - Count of optional tools that are OK
 * @property {number} optionalTotal - Total optional tools
 * @property {boolean} healthy - True if all required tools are OK
 * @property {string[]} installCommands - Commands to install missing tools
 * @property {ModuleCheck[]} [modules] - Module integrity check results
 * @property {PlatformPathCheck} [platformPaths] - Platform path resolution results
 * @property {number} [modulesOk] - Count of modules that passed integrity check
 * @property {number} [modulesTotal] - Total modules checked
 */

/**
 * @typedef {Object} ModuleCheck
 * @property {string} name - Module filename (e.g., 'cap-doctor.cjs')
 * @property {string} fullPath - Absolute path to the module
 * @property {boolean} exists - Whether the file exists on disk
 * @property {boolean} loads - Whether require() succeeds
 * @property {boolean} ok - True if both exists and loads
 * @property {string} [error] - Error message if exists or loads failed
 */

/**
 * @typedef {Object} PlatformPathCheck
 * @property {string} envHome - Value of process.env.HOME
 * @property {string} osHomedir - Value of os.homedir()
 * @property {boolean} homeMatch - Whether envHome and osHomedir agree
 * @property {string} installDir - Resolved install directory
 * @property {boolean} isSymlink - Whether the install directory is a symlink
 * @property {string} [symlinkTarget] - Real path if installDir is a symlink
 * @property {boolean} ok - True if no discrepancies
 * @property {string[]} warnings - Any platform path warnings
 */

/**
 * Check if a CLI tool is available and get its version.
 * @param {string} command - Version check command (e.g., 'node --version')
 * @param {number} [timeout=10000] - Timeout in ms
 * @returns {{ ok: boolean, version: string }}
 */
function checkTool(command, timeout = 10000) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // Extract version number (strip 'v' prefix if present)
    const version = output.replace(/^v/, '').split('\n')[0].trim();
    return { ok: true, version };
  } catch (_e) {
    return { ok: false, version: 'not found' };
  }
}

/**
 * Detect the CAP install directory.
 * @cap-decision Auto-detection tries the global install path first ($HOME/.claude/cap/cap/bin/lib),
 * then falls back to the directory containing this file. This handles both global npx installs
 * and local development (running from the repo checkout).
 * @returns {string} Absolute path to the cap/bin/lib directory
 */
function detectInstallDir() {
  // Global install path: $HOME/.claude/cap/cap/bin/lib/
  const homeDir = process.env.HOME || os.homedir();
  const globalDir = path.join(homeDir, '.claude', 'cap', 'cap', 'bin', 'lib');
  if (fs.existsSync(globalDir)) {
    return globalDir;
  }
  // Fallback: this file's own directory (local dev / repo checkout)
  return __dirname;
}

// @cap-todo(ac:F-019/AC-1) Verify every required CJS module exists at the expected install path
// @cap-todo(ac:F-019/AC-2) Attempt require() on each module and report load failures
// @cap-todo(ac:F-019/AC-3) Report clear PASS/FAIL summary per module with error reason
/**
 * Check integrity of all CAP CJS modules.
 * Verifies each module in the manifest exists on disk and can be loaded via require().
 * @param {string} [installDir] - Directory containing the CJS modules (auto-detected if omitted)
 * @returns {{ modules: ModuleCheck[], modulesOk: number, modulesTotal: number }}
 */
function checkModuleIntegrity(installDir) {
  const dir = installDir || detectInstallDir();
  const modules = [];

  for (const name of CAP_MODULE_MANIFEST) {
    const fullPath = path.join(dir, name);
    const check = { name, fullPath, exists: false, loads: false, ok: false };

    // Step 1: Check file existence
    if (!fs.existsSync(fullPath)) {
      check.error = `File not found: ${fullPath}`;
      modules.push(check);
      continue;
    }
    check.exists = true;

    // Step 2: Attempt require() to verify the module parses and loads
    try {
      require(path.resolve(fullPath));
      check.loads = true;
      check.ok = true;
    } catch (err) {
      check.error = `Load error: ${err.message.split('\n')[0]}`;
    }

    modules.push(check);
  }

  return {
    modules,
    modulesOk: modules.filter(m => m.ok).length,
    modulesTotal: modules.length,
  };
}

// @cap-todo(ac:F-019/AC-6) Test platform-specific path resolution (Linux vs macOS, symlinks)
/**
 * Check platform-specific path resolution for the CAP install directory.
 * Compares process.env.HOME with os.homedir() and checks for symlinks.
 * @param {string} [installDir] - Directory to check (auto-detected if omitted)
 * @returns {PlatformPathCheck}
 */
function checkPlatformPaths(installDir) {
  const dir = installDir || detectInstallDir();
  const envHome = process.env.HOME || '';
  const osHome = os.homedir();
  const warnings = [];

  // Check HOME consistency
  const homeMatch = envHome === osHome;
  if (!homeMatch) {
    warnings.push(
      `$HOME (${envHome}) differs from os.homedir() (${osHome}). ` +
      'This can happen under sudo, in Docker containers, or with nvm. ' +
      'CAP uses $HOME for install paths — ensure it points to the correct user directory.'
    );
  }

  // Check if install dir is a symlink
  let isSymlink = false;
  let symlinkTarget;
  try {
    const stat = fs.lstatSync(dir);
    isSymlink = stat.isSymbolicLink();
    if (isSymlink) {
      symlinkTarget = fs.realpathSync(dir);
      warnings.push(
        `Install directory is a symlink: ${dir} -> ${symlinkTarget}`
      );
    }
  } catch (_e) {
    // Directory doesn't exist — the module integrity check will catch this
  }

  return {
    envHome,
    osHomedir: osHome,
    homeMatch,
    installDir: dir,
    isSymlink,
    symlinkTarget,
    ok: warnings.length === 0,
    warnings,
  };
}

/**
 * Run full doctor check.
 * @param {string} [projectRoot] - Optional project root for project-specific checks
 * @returns {DoctorReport}
 */
function runDoctor(projectRoot) {
  const tools = [];

  // Required tools
  const node = checkTool('node --version');
  tools.push({
    name: 'Node.js',
    ...node,
    required: true,
    purpose: 'CAP runtime (>= 20.0.0 required)',
    installHint: 'https://nodejs.org/ or: curl -fsSL https://fnm.vercel.app/install | bash && fnm install --lts',
  });

  const npm = checkTool('npm --version');
  tools.push({
    name: 'npm',
    ...npm,
    required: true,
    purpose: 'Package management and npx tool execution',
    installHint: 'Comes with Node.js',
  });

  const git = checkTool('git --version');
  // git --version returns "git version 2.45.0"
  if (git.ok) git.version = git.version.replace('git version ', '');
  tools.push({
    name: 'git',
    ...git,
    required: true,
    purpose: 'Version control, commit history for /cap:report and /cap:review',
    installHint: 'https://git-scm.com/downloads or: brew install git',
  });

  // Optional tools -- CAP works without them but with reduced functionality
  const ctx7 = checkTool('npx ctx7@latest --version', 15000);
  tools.push({
    name: 'Context7 (ctx7)',
    ...ctx7,
    required: false,
    purpose: 'Library documentation fetching for /cap:init and /cap:refresh-docs',
    installHint: 'npm install -g ctx7   (or CAP uses npx ctx7@latest on demand)',
  });

  // @cap-todo(ac:F-053/AC-5) Skip c8 check on Node >= 20 — native --experimental-test-coverage covers /cap:test-audit's needs.
  const nodeMajor = parseInt((process.versions.node || '0').split('.')[0], 10) || 0;
  if (nodeMajor < 20) {
    const c8 = checkTool('npx c8 --version');
    tools.push({
      name: 'c8',
      ...c8,
      required: false,
      purpose: 'Code coverage for /cap:test-audit (Node < 20; Node 20+ uses native coverage)',
      installHint: 'npm install -D c8',
    });
  }

  // Project-specific checks (only if projectRoot provided)
  if (projectRoot) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Check vitest if project uses it
        if (allDeps.vitest || fs.existsSync(path.join(projectRoot, 'vitest.config.ts')) || fs.existsSync(path.join(projectRoot, 'vitest.config.js'))) {
          const vitest = checkTool('npx vitest --version');
          tools.push({
            name: 'vitest',
            ...vitest,
            required: false,
            purpose: 'TypeScript/SDK test runner (detected in this project)',
            installHint: 'npm install -D vitest',
          });
        }

        // Check fast-check if property tests are desired
        if (allDeps['fast-check']) {
          tools.push({
            name: 'fast-check',
            ok: true,
            version: allDeps['fast-check'].replace('^', '').replace('~', ''),
            required: false,
            purpose: 'Property-based testing for business logic invariants',
            installHint: 'npm install -D fast-check',
          });
        } else {
          tools.push({
            name: 'fast-check',
            ok: false,
            version: 'not installed',
            required: false,
            purpose: 'Property-based testing for business logic invariants (recommended)',
            installHint: 'npm install -D fast-check',
          });
        }
      } catch (_e) { /* malformed package.json -- skip project-specific checks */ }
    }
  }

  // @cap-todo(ac:F-019/AC-4) Module integrity check runs automatically as part of /cap:doctor
  const moduleResult = checkModuleIntegrity();
  const platformResult = checkPlatformPaths();

  // Compute summary
  const requiredTools = tools.filter(t => t.required);
  const optionalTools = tools.filter(t => !t.required);

  const report = {
    tools,
    requiredOk: requiredTools.filter(t => t.ok).length,
    requiredTotal: requiredTools.length,
    optionalOk: optionalTools.filter(t => t.ok).length,
    optionalTotal: optionalTools.length,
    healthy: requiredTools.every(t => t.ok) && moduleResult.modulesOk === moduleResult.modulesTotal,
    installCommands: [],
    modules: moduleResult.modules,
    modulesOk: moduleResult.modulesOk,
    modulesTotal: moduleResult.modulesTotal,
    platformPaths: platformResult,
  };

  // Build install commands for missing tools
  const missingOptional = optionalTools.filter(t => !t.ok);
  const npmInstallDev = missingOptional
    .filter(t => t.installHint.startsWith('npm install -D'))
    .map(t => t.name.toLowerCase().replace('context7 (ctx7)', 'ctx7'));

  if (npmInstallDev.length > 0) {
    report.installCommands.push(`npm install -D ${npmInstallDev.join(' ')}`);
  }

  const globalInstall = missingOptional
    .filter(t => t.installHint.startsWith('npm install -g'));
  for (const t of globalInstall) {
    report.installCommands.push(t.installHint);
  }

  return report;
}

/**
 * Format the doctor report as readable terminal output.
 * @param {DoctorReport} report
 * @returns {string}
 */
function formatReport(report) {
  const lines = [];
  lines.push('cap:doctor\n');

  // Required tools
  lines.push('  Required:');
  for (const t of report.tools.filter(t => t.required)) {
    const icon = t.ok ? '  ✓' : '  ✗';
    const pad = ' '.repeat(Math.max(0, 18 - t.name.length));
    lines.push(`  ${icon} ${t.name}${pad}${t.version}${t.ok ? '' : '    ← ' + t.purpose}`);
  }

  lines.push('');
  lines.push('  Optional:');
  for (const t of report.tools.filter(t => !t.required)) {
    const icon = t.ok ? '  ✓' : '  -';
    const pad = ' '.repeat(Math.max(0, 18 - t.name.length));
    const hint = t.ok ? '' : `    ← ${t.purpose}`;
    lines.push(`  ${icon} ${t.name}${pad}${t.version}${hint}`);
  }

  // Module integrity section
  if (report.modules && report.modules.length > 0) {
    lines.push('');
    lines.push('  Module Integrity:');
    const failedModules = report.modules.filter(m => !m.ok);
    const passedCount = report.modulesOk || 0;
    const totalCount = report.modulesTotal || 0;

    if (failedModules.length === 0) {
      lines.push(`    ✓ All ${totalCount} CAP modules verified (exist + loadable)`);
    } else {
      lines.push(`    ${passedCount}/${totalCount} modules OK — ${failedModules.length} failed:`);
      for (const m of failedModules) {
        lines.push(`    ✗ ${m.name}  ← ${m.error}`);
      }
    }
  }

  // Platform path section
  if (report.platformPaths) {
    const pp = report.platformPaths;
    if (!pp.ok) {
      lines.push('');
      lines.push('  Platform Paths:');
      for (const w of pp.warnings) {
        lines.push(`    ⚠ ${w}`);
      }
    }
  }

  lines.push('');
  lines.push(`  Required:  ${report.requiredOk}/${report.requiredTotal} OK`);
  lines.push(`  Optional:  ${report.optionalOk}/${report.optionalTotal} OK`);
  if (report.modulesTotal != null) {
    lines.push(`  Modules:   ${report.modulesOk}/${report.modulesTotal} OK`);
  }

  if (!report.healthy) {
    lines.push('');
    const toolsMissing = report.requiredOk < report.requiredTotal;
    const modulesMissing = report.modulesOk != null && report.modulesOk < report.modulesTotal;
    if (toolsMissing && modulesMissing) {
      lines.push('  ✗ UNHEALTHY — required tools missing and module integrity failures detected.');
    } else if (modulesMissing) {
      lines.push('  ✗ UNHEALTHY — module integrity failures detected. Try: npx code-as-plan@latest --force');
    } else {
      lines.push('  ✗ UNHEALTHY — required tools missing. CAP cannot function correctly.');
    }
  }

  if (report.installCommands.length > 0) {
    lines.push('');
    lines.push('  To install missing tools:');
    for (const cmd of report.installCommands) {
      lines.push(`    ${cmd}`);
    }
  }

  const allModulesOk = report.modulesOk == null || report.modulesOk === report.modulesTotal;
  if (report.healthy && report.optionalOk === report.optionalTotal && allModulesOk) {
    lines.push('');
    lines.push('  All tools and modules verified. CAP is fully operational.');
  }

  return lines.join('\n');
}

module.exports = {
  checkTool,
  runDoctor,
  formatReport,
  checkModuleIntegrity,
  checkPlatformPaths,
  CAP_MODULE_MANIFEST,
};
