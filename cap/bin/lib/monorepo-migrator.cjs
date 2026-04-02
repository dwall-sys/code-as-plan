// @cap-context Monorepo migration module -- audits existing .planning/ directories in apps, supports archive/replace/keep per app, analyzes root .planning/ for global vs app-specific split, regenerates scoped CODE-INVENTORY.md
// @cap-decision Separate module from monorepo-context.cjs -- migration is a one-time destructive operation; context assembly is read-only and ongoing
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path)
// @cap-pattern Migration functions return audit/result objects -- callers (commands) handle user interaction and confirmation

'use strict';

// @cap-feature(feature:F-012) Monorepo Support — flat-to-monorepo planning migration

const fs = require('node:fs');
const path = require('node:path');
const arcScanner = require('./arc-scanner.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// @cap-decision Standard .planning/ files recognized during audit -- matches the set that monorepo-context.cjs and extract-plan produce
const KNOWN_PLANNING_FILES = [
  'PROJECT.md',
  'ROADMAP.md',
  'REQUIREMENTS.md',
  'PRD.md',
  'FEATURES.md',
  'STATE.md',
  'MILESTONES.md',
  'RETROSPECTIVE.md',
  'BRAINSTORM-LEDGER.md',
  'config.json',
];

const KNOWN_PLANNING_DIRS = [
  'prototype',
  'phases',
  'milestones',
  'manifests',
  'research',
];

// ---------------------------------------------------------------------------
// Audit types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PlanningAuditEntry
 * @property {string} appPath - Relative path to the app (e.g., 'apps/dashboard')
 * @property {string} planningDir - Absolute path to app's .planning/
 * @property {boolean} exists - Whether .planning/ exists in this app
 * @property {string[]} files - Filenames found in .planning/
 * @property {string[]} directories - Subdirectory names found in .planning/
 * @property {boolean} hasCodeInventory - Whether prototype/CODE-INVENTORY.md exists
 * @property {boolean} hasPrd - Whether PRD.md exists
 */

/**
 * @typedef {Object} MigrationAudit
 * @property {PlanningAuditEntry[]} apps - Audit entry per app
 * @property {number} appsWithPlanning - Count of apps that have .planning/
 * @property {number} appsWithoutPlanning - Count of apps that lack .planning/
 * @property {RootAnalysis} rootAnalysis - Analysis of root .planning/ contents
 */

/**
 * @typedef {Object} RootAnalysis
 * @property {string[]} globalFiles - Files that belong at root (PROJECT.md, ROADMAP.md, etc.)
 * @property {string[]} appSpecificFiles - Files that likely belong to a specific app (PRD.md with app refs, etc.)
 * @property {string[]} ambiguousFiles - Files that need user decision
 * @property {string} rootPlanningDir - Absolute path to root .planning/
 */

/**
 * @typedef {Object} MigrationAction
 * @property {string} appPath - Relative path to app
 * @property {'keep'|'archive'|'replace'} action - What to do with existing .planning/
 */

/**
 * @typedef {Object} MigrationResult
 * @property {string} appPath - Relative path to app
 * @property {string} action - Action taken
 * @property {boolean} success - Whether it succeeded
 * @property {string|null} archivePath - Path to archive if action was 'archive'
 * @property {string|null} error - Error message if failed
 */

// ---------------------------------------------------------------------------
// Audit functions
// ---------------------------------------------------------------------------

// @cap-todo(ref:AC-9) Implement full audit: scan all app directories for existing .planning/ folders and report what exists where
// @cap-api auditAppPlanning(rootPath, apps) -- returns MigrationAudit describing existing .planning/ state across all apps
/**
 * Scan all app directories for existing .planning/ folders.
 * Produces a structured audit of what exists where.
 *
 * @param {string} rootPath - Monorepo root
 * @param {Array<{path: string, name: string}>} apps - Apps from workspace detection
 * @returns {MigrationAudit}
 */
function auditAppPlanning(rootPath, apps) {
  const entries = [];
  let withPlanning = 0;
  let withoutPlanning = 0;

  for (const app of apps) {
    const planningDir = path.join(rootPath, app.path, '.planning');
    const exists = fs.existsSync(planningDir);

    if (exists) {
      withPlanning++;
      const contents = safeReaddir(planningDir);
      const files = contents.filter(name => {
        const fullPath = path.join(planningDir, name);
        return safeStat(fullPath, 'isFile');
      });
      const directories = contents.filter(name => {
        const fullPath = path.join(planningDir, name);
        return safeStat(fullPath, 'isDirectory');
      });

      entries.push({
        appPath: app.path,
        planningDir,
        exists: true,
        files,
        directories,
        hasCodeInventory: fs.existsSync(path.join(planningDir, 'prototype', 'CODE-INVENTORY.md')),
        hasPrd: files.includes('PRD.md'),
      });
    } else {
      withoutPlanning++;
      entries.push({
        appPath: app.path,
        planningDir,
        exists: false,
        files: [],
        directories: [],
        hasCodeInventory: false,
        hasPrd: false,
      });
    }
  }

  const rootAnalysis = analyzeRootPlanning(rootPath);

  return {
    apps: entries,
    appsWithPlanning: withPlanning,
    appsWithoutPlanning: withoutPlanning,
    rootAnalysis,
  };
}

// ---------------------------------------------------------------------------
// Root analysis
// ---------------------------------------------------------------------------

// @cap-todo(ref:AC-11) Implement root .planning/ analysis: classify files as global vs app-specific and guide user to split
// @cap-api analyzeRootPlanning(rootPath) -- returns RootAnalysis classifying root .planning/ contents
/**
 * Analyze root .planning/ contents and classify them as global or app-specific.
 * Global: PROJECT.md, ROADMAP.md, REQUIREMENTS.md, manifests/
 * App-specific: PRD.md that references a single app, app-named subdirectories
 * Ambiguous: everything else -- user decides
 *
 * @param {string} rootPath - Monorepo root
 * @returns {RootAnalysis}
 */
function analyzeRootPlanning(rootPath) {
  const rootPlanningDir = path.join(rootPath, '.planning');
  const globalFiles = [];
  const appSpecificFiles = [];
  const ambiguousFiles = [];

  if (!fs.existsSync(rootPlanningDir)) {
    return { globalFiles, appSpecificFiles, ambiguousFiles, rootPlanningDir };
  }

  // @cap-decision Classify root files by name convention -- PROJECT.md, ROADMAP.md, REQUIREMENTS.md are always global; PRD.md and FEATURES.md at root are ambiguous in a monorepo
  const GLOBAL_FILES = new Set(['PROJECT.md', 'ROADMAP.md', 'REQUIREMENTS.md', 'MILESTONES.md', 'config.json']);
  const AMBIGUOUS_FILES = new Set(['PRD.md', 'FEATURES.md', 'STATE.md', 'BRAINSTORM-LEDGER.md', 'RETROSPECTIVE.md']);

  const contents = safeReaddir(rootPlanningDir);

  for (const name of contents) {
    const fullPath = path.join(rootPlanningDir, name);

    if (safeStat(fullPath, 'isDirectory')) {
      // manifests/ is global; prototype/ with monolithic inventory is ambiguous
      if (name === 'manifests') {
        globalFiles.push(name + '/');
      } else if (name === 'prototype') {
        // @cap-risk Root prototype/ may contain monolithic CODE-INVENTORY.md that should be split per app
        ambiguousFiles.push(name + '/');
      } else {
        ambiguousFiles.push(name + '/');
      }
      continue;
    }

    if (GLOBAL_FILES.has(name)) {
      globalFiles.push(name);
    } else if (AMBIGUOUS_FILES.has(name)) {
      // Further check: does the file reference a specific app?
      const content = safeReadFile(fullPath);
      if (content && looksAppSpecific(content)) {
        appSpecificFiles.push(name);
      } else {
        ambiguousFiles.push(name);
      }
    } else {
      ambiguousFiles.push(name);
    }
  }

  return { globalFiles, appSpecificFiles, ambiguousFiles, rootPlanningDir };
}

/**
 * Heuristic: does a planning file's content reference a single app?
 * Checks for app-like path references (apps/something) in the first 20 lines.
 *
 * @param {string} content - File content
 * @returns {boolean}
 */
function looksAppSpecific(content) {
  // @cap-risk Heuristic detection of app-specific content may produce false positives -- user confirmation is always required
  const lines = content.split('\n').slice(0, 20);
  const appRefs = lines.filter(line => /\bapps\/\w+/.test(line));
  return appRefs.length >= 2;
}

// ---------------------------------------------------------------------------
// Migration actions
// ---------------------------------------------------------------------------

// @cap-todo(ref:AC-10) Implement per-app keep/archive/replace: user chooses action for each app's existing .planning/
// @cap-api executeAppMigration(rootPath, action) -- performs keep, archive, or replace on one app's .planning/
/**
 * Execute a migration action on a single app's .planning/ directory.
 *
 * @param {string} rootPath - Monorepo root
 * @param {MigrationAction} action - Action to perform
 * @returns {MigrationResult}
 */
function executeAppMigration(rootPath, action) {
  const planningDir = path.join(rootPath, action.appPath, '.planning');

  try {
    switch (action.action) {
      case 'keep':
        return { appPath: action.appPath, action: 'keep', success: true, archivePath: null, error: null };

      case 'archive':
        return archiveAppPlanning(rootPath, action.appPath);

      case 'replace':
        return replaceAppPlanning(rootPath, action.appPath);

      default:
        return { appPath: action.appPath, action: action.action, success: false, archivePath: null, error: `Unknown action: ${action.action}` };
    }
  } catch (err) {
    return { appPath: action.appPath, action: action.action, success: false, archivePath: null, error: err.message };
  }
}

// @cap-pattern Archive uses timestamp-based directory naming (legacy-{timestamp}) -- ensures idempotent re-runs never collide
/**
 * Archive an app's existing .planning/ to .planning/legacy-{timestamp}/.
 *
 * @param {string} rootPath - Monorepo root
 * @param {string} appPath - Relative path to app
 * @returns {MigrationResult}
 */
function archiveAppPlanning(rootPath, appPath) {
  const planningDir = path.join(rootPath, appPath, '.planning');

  if (!fs.existsSync(planningDir)) {
    return { appPath, action: 'archive', success: true, archivePath: null, error: null };
  }

  // @cap-decision Archive to legacy-{timestamp} inside the app's .planning/ -- keeps history co-located with the app
  const timestamp = Date.now();
  const archiveDir = path.join(planningDir, `legacy-${timestamp}`);
  fs.mkdirSync(archiveDir, { recursive: true });

  const contents = safeReaddir(planningDir);
  for (const name of contents) {
    if (name.startsWith('legacy-')) continue; // Don't archive previous archives
    const src = path.join(planningDir, name);
    const dest = path.join(archiveDir, name);
    // @cap-decision Use cpSync+rmSync instead of renameSync -- cross-device safe for monorepos spanning mounts
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }

  return { appPath, action: 'archive', success: true, archivePath: archiveDir, error: null };
}

/**
 * Replace an app's existing .planning/ with a fresh structure.
 * Archives first, then creates fresh stubs.
 *
 * @param {string} rootPath - Monorepo root
 * @param {string} appPath - Relative path to app
 * @returns {MigrationResult}
 */
function replaceAppPlanning(rootPath, appPath) {
  // Archive first so nothing is lost
  const archiveResult = archiveAppPlanning(rootPath, appPath);
  if (!archiveResult.success) return archiveResult;

  // Create fresh structure using monorepo-context.cjs pattern
  const planningDir = path.join(rootPath, appPath, '.planning');
  const appName = path.basename(appPath);
  fs.mkdirSync(planningDir, { recursive: true });
  fs.mkdirSync(path.join(planningDir, 'prototype'), { recursive: true });

  fs.writeFileSync(
    path.join(planningDir, 'PRD.md'),
    `# ${appName} -- PRD\n\nApp-scoped PRD. Generated by monorepo-init --migrate.\n`,
    'utf-8'
  );
  fs.writeFileSync(
    path.join(planningDir, 'FEATURES.md'),
    `# ${appName} -- Feature Map\n\nRun extract-plan --app ${appPath} to populate.\n`,
    'utf-8'
  );
  fs.writeFileSync(
    path.join(planningDir, 'prototype', 'CODE-INVENTORY.md'),
    `# CODE-INVENTORY.md\n\nRun /gsd:extract-plan --app ${appPath} to populate.\n`,
    'utf-8'
  );

  return { appPath, action: 'replace', success: true, archivePath: archiveResult.archivePath, error: null };
}

// ---------------------------------------------------------------------------
// Scoped CODE-INVENTORY regeneration
// ---------------------------------------------------------------------------

// @cap-todo(ref:AC-12) Implement scoped CODE-INVENTORY.md regeneration per app after migration (replacing monolithic version)
// @cap-api regenerateScopedInventories(rootPath, apps) -- triggers extract-tags per app to produce scoped CODE-INVENTORY.md files
/**
 * Regenerate CODE-INVENTORY.md for each app by invoking the tag scanner
 * scoped to each app directory.
 *
 * Note: This is a scaffold -- actual implementation calls extract-tags
 * via the CLI or imports tag-scanner.cjs directly.
 *
 * @param {string} rootPath - Monorepo root
 * @param {Array<{path: string}>} apps - Apps to regenerate inventories for
 * @returns {Array<{appPath: string, inventoryPath: string, success: boolean, error: string|null}>}
 */
function regenerateScopedInventories(rootPath, apps) {
  // @cap-constraint Must use existing tag-scanner.cjs for extraction -- no reimplementation of scanning logic
  const results = [];

  for (const app of apps) {
    const appAbsPath = path.join(rootPath, app.path);
    const planningDir = path.join(appAbsPath, '.planning');
    const inventoryPath = path.join(planningDir, 'prototype', 'CODE-INVENTORY.md');

    try {
      // Ensure directory exists
      fs.mkdirSync(path.join(planningDir, 'prototype'), { recursive: true });

      // Delegate to arc-scanner for actual tag extraction scoped to this app
      arcScanner.cmdExtractTags(appAbsPath, appAbsPath, {
        format: 'md',
        outputFile: inventoryPath,
      });

      results.push({
        appPath: app.path,
        inventoryPath,
        success: true,
        error: null,
      });
    } catch (err) {
      results.push({
        appPath: app.path,
        inventoryPath,
        success: false,
        error: err.message,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Batch migration
// ---------------------------------------------------------------------------

// @cap-api executeMigration(rootPath, apps, actions) -- runs all migration actions and returns aggregate results
/**
 * Execute a full migration given user-selected actions per app.
 *
 * @param {string} rootPath - Monorepo root
 * @param {Array<{path: string, name: string}>} apps - All apps from workspace detection
 * @param {MigrationAction[]} actions - User-selected action per app
 * @returns {{results: MigrationResult[], regeneration: Array}}
 */
function executeMigration(rootPath, apps, actions) {
  const results = [];

  for (const action of actions) {
    results.push(executeAppMigration(rootPath, action));
  }

  // After migration, regenerate scoped inventories for all apps
  const regeneration = regenerateScopedInventories(rootPath, apps);

  return { results, regeneration };
}

// ---------------------------------------------------------------------------
// Formatting helpers (for command output)
// ---------------------------------------------------------------------------

// @cap-api formatAuditReport(audit) -- returns human-readable string summarizing the migration audit
/**
 * Format the audit into a human-readable report for display.
 *
 * @param {MigrationAudit} audit
 * @returns {string}
 */
function formatAuditReport(audit) {
  const lines = [];
  lines.push('## Migration Audit\n');
  lines.push(`Apps with existing .planning/: ${audit.appsWithPlanning}`);
  lines.push(`Apps without .planning/: ${audit.appsWithoutPlanning}\n`);

  for (const entry of audit.apps) {
    if (entry.exists) {
      lines.push(`### ${entry.appPath}`);
      lines.push(`  Files: ${entry.files.join(', ') || '(none)'}`);
      lines.push(`  Directories: ${entry.directories.join(', ') || '(none)'}`);
      lines.push(`  Has CODE-INVENTORY: ${entry.hasCodeInventory ? 'yes' : 'no'}`);
      lines.push(`  Has PRD: ${entry.hasPrd ? 'yes' : 'no'}`);
      lines.push('');
    }
  }

  if (audit.rootAnalysis.globalFiles.length > 0 || audit.rootAnalysis.appSpecificFiles.length > 0 || audit.rootAnalysis.ambiguousFiles.length > 0) {
    lines.push('### Root .planning/ Analysis\n');
    if (audit.rootAnalysis.globalFiles.length > 0) {
      lines.push(`Global (keep at root): ${audit.rootAnalysis.globalFiles.join(', ')}`);
    }
    if (audit.rootAnalysis.appSpecificFiles.length > 0) {
      lines.push(`App-specific (move to app): ${audit.rootAnalysis.appSpecificFiles.join(', ')}`);
    }
    if (audit.rootAnalysis.ambiguousFiles.length > 0) {
      lines.push(`Needs review: ${audit.rootAnalysis.ambiguousFiles.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function safeReaddir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function safeStat(filePath, check) {
  try {
    const stat = fs.statSync(filePath);
    return stat[check]();
  } catch {
    return false;
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  auditAppPlanning,
  analyzeRootPlanning,
  executeAppMigration,
  archiveAppPlanning,
  replaceAppPlanning,
  regenerateScopedInventories,
  executeMigration,
  formatAuditReport,
  looksAppSpecific,
  KNOWN_PLANNING_FILES,
  KNOWN_PLANNING_DIRS,
};
