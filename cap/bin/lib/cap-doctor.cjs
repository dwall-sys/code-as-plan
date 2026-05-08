// @cap-context CAP v2.0 doctor utility -- checks all external dependencies CAP needs at runtime.
// @cap-decision Checks are split into required (Node.js, npm, git) and optional (ctx7, c8, vitest, fast-check).
// @cap-decision Project-specific checks only run when projectRoot is provided and package.json exists.
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (child_process, fs, path, os).

'use strict';

// @cap-feature(feature:F-005) Doctor Health Check — verify required and optional external dependencies
// @cap-feature(feature:F-019) Module Integrity Verification — verify CAP CJS modules exist and load correctly
// @cap-feature(feature:F-058) Claude-Code Plugin Manifest — detect npx vs plugin install modes and surface coexistence

// @cap-history(sessions:8, edits:22, since:2026-04-20, learned:2026-05-08) Frequently modified — 8 sessions, 22 edits
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Tolerant require: the install-hardening test fixture copies cap-doctor.cjs
// alone to verify missing-module detection. If we require cap-plugin-manifest
// eagerly, the load of doctor itself throws and the integrity checker reports
// a single "cannot load manifest" failure instead of the 30+ expected misses.
// A tolerant null fallback keeps CAP_MODULE_MANIFEST loadable in isolation;
// detectInstallMode guards its plugin-name use against the null case below.
let pluginManifest;
try { pluginManifest = require('./cap-plugin-manifest.cjs'); } catch (_e) { pluginManifest = null; }

// @cap-todo(ac:F-019/AC-5) Module manifest — authoritative list of expected CAP modules
// @cap-decision Manifest is a flat array of filenames maintained manually. When a new module is added to
// cap/bin/lib/, it must be added here. This is intentional: an explicit manifest catches accidental deletions.
const CAP_MODULE_MANIFEST = [
  'arc-scanner.cjs',
  'cap-affinity-engine.cjs',
  'cap-anchor.cjs',
  'cap-annotation-writer.cjs',
  'cap-checkpoint.cjs',
  'cap-cluster-detect.cjs',
  'cap-cluster-display.cjs',
  'cap-cluster-format.cjs',
  'cap-cluster-helpers.cjs',
  'cap-cluster-io.cjs',
  'cap-completeness.cjs',
  'cap-deps.cjs',
  'cap-design.cjs',
  'cap-design-families.cjs',
  'cap-divergence-detector.cjs',
  'cap-doctor.cjs',
  'cap-feature-map.cjs',
  // @cap-feature(feature:F-083) Shared internals module — hosts constants/primitives both
  //   cap-feature-map.cjs and cap-feature-map-monorepo.cjs need without forcing a lazy-require
  //   just to read a string literal.
  // @cap-decision(F-083/followup) F-083-FIX-A: Bumped 85 -> 86 when cap-feature-map-internals.cjs
  //   was added (de-duplicates `FEATURE_MAP_FILE` between core and monorepo modules).
  'cap-feature-map-internals.cjs',
  // @cap-feature(feature:F-089) Sharded Feature Map migration — monolithic → sharded layout.
  // @cap-decision(F-089) Bumped manifest count when cap-feature-map-migrate.cjs was added.
  'cap-feature-map-migrate.cjs',
  // @cap-feature(feature:F-083) Monorepo aggregation module extracted from cap-feature-map.cjs.
  // @cap-decision(F-083) Bumped 84 -> 85 when cap-feature-map-monorepo.cjs was added.
  'cap-feature-map-monorepo.cjs',
  // @cap-feature(feature:F-089) Sharded Feature Map — pure shard helpers (ID validator, index parse/serialize).
  // @cap-decision(F-089) Bumped manifest count when cap-feature-map-shard.cjs was added.
  'cap-feature-map-shard.cjs',
  // @cap-feature(feature:F-072) Compute Two-Layer Fitness Score — pure-compute scorer driving F-074 unlearn.
  // @cap-decision(F-072) Bumped 77 -> 78 when cap-fitness-score.cjs was added (Two-Layer Fitness Score for Pattern Unlearn).
  'cap-fitness-score.cjs',
  'cap-impact-analysis.cjs',
  // @cap-feature(feature:F-073) Review Patterns via Learn Command — board renderer + Stop-hook gate.
  // @cap-decision(F-073) Bumped 79 -> 80 when cap-learn-review.cjs was added (closes the V5 self-learning loop).
  'cap-learn-review.cjs',
  // @cap-feature(feature:F-070) Collect Learning Signals — override/memory-ref/regret JSONL collectors + getSignals API.
  'cap-learning-signals.cjs',
  'cap-loader.cjs',
  'cap-logger.cjs',
  // @cap-feature(feature:F-080) Bridge to Claude-native Memory — read-only consumer of ~/.claude/projects/<slug>/memory/.
  // @cap-decision(F-083/followup) Manifest sync: cap-memory-bridge.cjs (F-080) was on disk but missing from the manifest;
  //   added during the F-083-FIX-A internals extraction work to keep the on-disk-vs-manifest contract green.
  'cap-memory-bridge.cjs',
  'cap-memory-confidence.cjs',
  'cap-memory-dir.cjs',
  'cap-memory-engine.cjs',
  // @cap-feature(feature:F-078) Extends-Chain Resolver — resolves `extends: platform/<topic>` chains in a single pass.
  // @cap-decision(F-078) Bumped 82 -> 83 when cap-memory-extends.cjs was added (Platform-Bucket reader path).
  'cap-memory-extends.cjs',
  'cap-memory-graph.cjs',
  // @cap-feature(feature:F-077) V6 Memory Migration Tool — one-shot migration from V5 monolith to V6 per-feature layout.
  // @cap-decision(F-077) Bumped 81 -> 82 when cap-memory-migrate.cjs was added (V6 migration tool with hybrid classifier).
  'cap-memory-migrate.cjs',
  'cap-memory-pin.cjs',
  // @cap-feature(feature:F-078) Platform-Bucket for Cross-Cutting Decisions — explicit-only platform-topic file IO + classifier.
  // @cap-decision(F-078) Bumped 83 -> 84 when cap-memory-platform.cjs was added (Platform-Bucket file IO + writer).
  'cap-memory-platform.cjs',
  'cap-memory-prune.cjs',
  // @cap-feature(feature:F-076) V6 Per-Feature Memory Format — schema + validator + round-trip-safe parser/serializer.
  // @cap-decision(F-076) Bumped 80 -> 81 when cap-memory-schema.cjs was added (V6 memory-format pivot foundation).
  'cap-memory-schema.cjs',
  'cap-migrate-tags.cjs',
  'cap-migrate.cjs',
  // @cap-feature(feature:F-074) Enable Pattern Unlearn and Auto-Retract — apply audit + reverse patch + retract list.
  // @cap-decision(F-074) Bumped 78 -> 79 when cap-pattern-apply.cjs was added (F-074 closes the V5 self-learning loop).
  'cap-pattern-apply.cjs',
  // @cap-feature(feature:F-071) Pattern Pipeline — heuristic Stage 1 + LLM-briefing Stage 2.
  // @cap-decision(F-071) Bumped 76 -> 77 when cap-pattern-pipeline.cjs was added.
  'cap-pattern-pipeline.cjs',
  'cap-plugin-manifest.cjs',
  'cap-realtime-affinity.cjs',
  'cap-reconcile.cjs',
  'cap-research-gate.cjs',
  // @cap-feature(feature:F-085) Scope filter shared by cap-tag-scanner and cap-migrate-tags.
  'cap-scope-filter.cjs',
  'cap-semantic-pipeline.cjs',
  'cap-session-extract.cjs',
  'cap-session.cjs',
  // @cap-feature(feature:F-079) Wire Snapshot Linkage to Features and Platform — resolveLinkageOptions + processSnapshots.
  // @cap-decision(F-083/followup) Manifest sync: cap-snapshot-linkage.cjs (F-079) was on disk but missing from the manifest;
  //   added during the F-083-FIX-A internals extraction work to keep the on-disk-vs-manifest contract green.
  'cap-snapshot-linkage.cjs',
  'cap-stack-docs.cjs',
  'cap-tag-observer.cjs',
  'cap-tag-scanner.cjs',
  // @cap-feature(feature:F-061) Token Telemetry — LLM-call metrics + per-session aggregates.
  'cap-telemetry.cjs',
  'cap-test-audit.cjs',
  'cap-thread-migrator.cjs',
  'cap-thread-synthesis.cjs',
  'cap-thread-tracker.cjs',
  'cap-trace.cjs',
  // @cap-feature(feature:F-075) Trust-Mode Configuration Slot — open-closed extension point for B/C activation.
  'cap-trust-mode.cjs',
  // @cap-feature(feature:F-065) CAP-UI Core module entry.
  'cap-ui.cjs',
  // @cap-feature(feature:F-068) CAP-UI Design Editor (DESIGN.md-only edit surface).
  'cap-ui-design-editor.cjs',
  // @cap-feature(feature:F-066) CAP-UI Tag Mind-Map module (extracted from cap-ui.cjs during F-068 hand-off).
  'cap-ui-mind-map.cjs',
  // @cap-feature(feature:F-067) CAP-UI Thread + Cluster Navigator module (extracted from cap-ui.cjs during F-068 hand-off).
  'cap-ui-thread-nav.cjs',
  // @cap-feature(feature:F-084) Project Onboarding & Migration Orchestrator —
  //   planner + state-manager for /cap:upgrade. Companion markdown command at
  //   commands/cap/upgrade.md and SessionStart-hook at hooks/cap-version-check.js.
  // @cap-decision(F-084) Bumped 88 -> 89 when cap-upgrade.cjs was added.
  'cap-upgrade.cjs',
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

// @cap-todo(ac:F-058/AC-5) cap-doctor shall detect both install modes (npx vs plugin) and show the active mode.
// @cap-todo(ac:F-058/AC-6) Coexistence check — surface warning when both npx and plugin install modes are active.
/**
 * @typedef {Object} InstallModeReport
 * @property {boolean} npx - True when npx install footprint ($HOME/.claude/cap/) is present.
 * @property {boolean} plugin - True when plugin install footprint is detected.
 * @property {boolean} coexist - True when both npx and plugin are active simultaneously.
 * @property {string} active - Primary active mode: 'npx', 'plugin', 'both', or 'none'.
 * @property {string[]} pluginPaths - Absolute paths where plugin footprint was detected.
 * @property {string} [npxPath] - Absolute path to the npx install dir when present.
 * @property {string[]} warnings - Human-readable warnings (coexistence, missing, etc).
 */

/**
 * @cap-decision Plugin footprint detection uses two filesystem-only heuristics:
 *   (1) presence of a Claude plugin cache entry under $HOME/.claude/plugins/cache/cap@*
 *       (any plugin installed via /plugin install or marketplace), and
 *   (2) presence of .claude-plugin/plugin.json in cwd with name === PLUGIN_NAME
 *       (local-dev checkout). The cwd manifest's name gate prevents foreign plugins
 *       living in the same repo from false-positive-registering as a CAP install.
 * We do NOT read the CLAUDE_PLUGIN_ROOT env var. That variable is only set when
 * Claude Code spawns a hook inside a plugin, never during a plain `npx cap:doctor`
 * run from a shell, so relying on it would systematically false-negative on the
 * CLI path where this function gets exercised most.
 * @cap-decision npx footprint is the existing detection used by detectInstallDir() — $HOME/.claude/cap/
 * written by the installer. No change to that detection.
 *
 * Detect which install mode(s) of CAP are active on this machine.
 * @param {Object} [opts]
 * @param {string} [opts.homeDir] - Override HOME for testing.
 * @param {string} [opts.cwd] - Override cwd for testing.
 * @returns {InstallModeReport}
 */
function detectInstallMode(opts) {
  const options = opts || {};
  const homeDir = options.homeDir || process.env.HOME || os.homedir();
  const cwd = options.cwd || process.cwd();
  const warnings = [];

  // npx footprint: installer writes to $HOME/.claude/cap/
  const npxPath = path.join(homeDir, '.claude', 'cap');
  const npxPresent = fs.existsSync(npxPath);

  // Plugin footprint: Claude Code caches installed plugins at $HOME/.claude/plugins/cache/<name>@<source>/
  const pluginPaths = [];
  // Fallback to the hard-coded plugin name when cap-plugin-manifest.cjs is not
  // loadable (install-hardening fixture path). The name hasn't changed since
  // F-058 and is covered by a dedicated contract test there.
  const pluginName = (pluginManifest && pluginManifest.PLUGIN_NAME) || 'cap';
  const isCapManifest = (pluginManifest && pluginManifest.isCapPluginManifest)
    || ((m) => !!(m && typeof m === 'object' && m.name === pluginName));
  const pluginCacheDir = path.join(homeDir, '.claude', 'plugins', 'cache');
  if (fs.existsSync(pluginCacheDir)) {
    try {
      const entries = fs.readdirSync(pluginCacheDir);
      const capPrefix = `${pluginName}@`;
      for (const entry of entries) {
        if (entry === pluginName || entry.startsWith(capPrefix)) {
          pluginPaths.push(path.join(pluginCacheDir, entry));
        }
      }
    } catch (err) {
      // Surface unreadable cache directories so the user learns why detection came up empty
      // instead of silently reporting "no plugin installed".
      const code = err && err.code ? err.code : 'unknown';
      warnings.push(`Plugin cache directory is unreadable (${code}): ${pluginCacheDir}`);
    }
  }

  // Local-dev plugin footprint: .claude-plugin/plugin.json in cwd with name === PLUGIN_NAME.
  // Foreign manifests (a different plugin living in the same repo) must not register as a CAP install.
  const localManifest = path.join(cwd, '.claude-plugin', 'plugin.json');
  if (fs.existsSync(localManifest)) {
    try {
      const raw = fs.readFileSync(localManifest, 'utf8');
      const parsed = JSON.parse(raw);
      if (isCapManifest(parsed)) {
        pluginPaths.push(localManifest);
      }
    } catch (_err) {
      // Malformed manifest JSON: do not count as a CAP footprint. The other doctor checks will
      // separately flag the broken file via module/config validation when in scope.
    }
  }

  const pluginPresent = pluginPaths.length > 0;
  const coexist = npxPresent && pluginPresent;

  let active;
  if (coexist) {
    active = 'both';
  } else if (npxPresent) {
    active = 'npx';
  } else if (pluginPresent) {
    active = 'plugin';
  } else {
    active = 'none';
  }

  // @cap-todo(ac:F-058/AC-6) Emit warning (not hard failure) when both modes coexist.
  if (coexist) {
    warnings.push(
      'Both npx and plugin install modes are active. ' +
      'Commands and hooks may be registered twice. ' +
      'Recommended: pick one install path (npx is primary) and remove the other to avoid duplicate registration.'
    );
  }

  const report = {
    npx: npxPresent,
    plugin: pluginPresent,
    coexist,
    active,
    pluginPaths,
    warnings,
  };
  if (npxPresent) {
    report.npxPath = npxPath;
  }
  return report;
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
  // @cap-todo(ac:F-058/AC-5) Install-mode detection runs automatically and is surfaced in the doctor report.
  const installMode = detectInstallMode();

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
    installMode,
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

  // @cap-todo(ac:F-058/AC-5) Render active install mode in the doctor output.
  // @cap-todo(ac:F-058/AC-6) Render coexistence warning when both modes are active.
  if (report.installMode) {
    const im = report.installMode;
    lines.push('');
    lines.push('  Install mode:');
    let modeLine;
    if (im.active === 'both') {
      modeLine = '  ⚠ npx (primary) + plugin (secondary) — coexistence detected';
    } else if (im.active === 'npx') {
      modeLine = '  ✓ npx (primary)';
    } else if (im.active === 'plugin') {
      modeLine = '  ✓ plugin';
    } else {
      modeLine = '  - none detected';
    }
    lines.push(`  ${modeLine}`);
    for (const w of im.warnings) {
      lines.push(`    ⚠ ${w}`);
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
  detectInstallMode,
  CAP_MODULE_MANIFEST,
};
