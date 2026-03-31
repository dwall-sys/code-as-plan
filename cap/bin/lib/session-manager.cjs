// @gsd-context Session manager for monorepo mode -- persists and resolves the current app selection so all GSD commands auto-scope without --app flag
// @gsd-decision Session stored in .planning/SESSION.json -- co-located with planning artifacts, not in a hidden dotfile or temp directory
// @gsd-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path)
// @gsd-pattern All GSD commands call resolveCurrentApp() to get the effective app -- explicit --app flag overrides session, session overrides nothing

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SessionData
 * @property {string|null} current_app - Relative path to the active app (e.g., 'apps/dashboard'), or null for root/global
 * @property {string|null} default_app - Default app to auto-select at session start (set via /gsd:switch-app --default)
 * @property {'monorepo'|'single'|null} workspace_type - Detected workspace type
 * @property {string[]} available_apps - List of all app paths from workspace detection
 * @property {number} updated_at - Epoch ms of last update
 */

// ---------------------------------------------------------------------------
// File path resolution
// ---------------------------------------------------------------------------

// @gsd-decision SESSION.json lives at root .planning/SESSION.json -- one session file for the whole monorepo, not per-app
/**
 * Get the path to SESSION.json.
 *
 * @param {string} rootPath - Project/monorepo root
 * @returns {string}
 */
function getSessionPath(rootPath) {
  return path.join(rootPath, '.planning', 'SESSION.json');
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

// @gsd-todo(ref:AC-13) Implement session detection at startup: when monorepo detected, present app selector if no session exists
// @gsd-api getSession(rootPath) -- returns SessionData or null if no session file exists
/**
 * Read the current session data.
 *
 * @param {string} rootPath - Project root
 * @returns {SessionData|null}
 */
function getSession(rootPath) {
  const sessionPath = getSessionPath(rootPath);
  try {
    const raw = fs.readFileSync(sessionPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// @gsd-todo(ref:AC-14) Implement auto-scoping: all GSD commands call resolveCurrentApp() so --app flag is not required after selection
// @gsd-api getCurrentApp(rootPath) -- returns the current app path string or null (global/root scope)
/**
 * Get the currently selected app path.
 * Returns null if no session or if working at root/global scope.
 *
 * @param {string} rootPath - Project root
 * @returns {string|null}
 */
function getCurrentApp(rootPath) {
  const session = getSession(rootPath);
  if (!session) return null;
  // If no app explicitly selected but a default is configured, use the default
  if (!session.current_app && session.default_app) return session.default_app;
  return session.current_app || null;
}

// @gsd-api resolveCurrentApp(rootPath, explicitApp) -- returns effective app path: explicit --app flag wins, then session, then null
/**
 * Resolve the effective current app for a command.
 * Priority: explicit --app flag > session > null (root scope).
 *
 * @param {string} rootPath - Project root
 * @param {string|null|undefined} explicitApp - Value from --app flag, if provided
 * @returns {string|null}
 */
function resolveCurrentApp(rootPath, explicitApp) {
  // @gsd-decision Explicit --app always wins over session -- escape hatch for one-off commands on a different app
  if (explicitApp) return explicitApp;
  return getCurrentApp(rootPath);
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

// @gsd-todo(ref:AC-15) Wire setCurrentApp to /gsd:switch-app command for mid-session app switching
// @gsd-api setCurrentApp(rootPath, appPath, availableApps) -- writes SESSION.json with new current_app
/**
 * Set the current app in the session.
 * Pass null for appPath to set global/root scope.
 *
 * @param {string} rootPath - Project root
 * @param {string|null} appPath - Relative app path or null for global
 * @param {string[]} [availableApps] - List of available app paths (updates the cached list)
 * @returns {SessionData}
 */
function setCurrentApp(rootPath, appPath, availableApps) {
  const existing = getSession(rootPath) || {};

  const session = {
    current_app: appPath,
    workspace_type: existing.workspace_type || 'monorepo',
    available_apps: availableApps || existing.available_apps || [],
    updated_at: Date.now(),
  };

  const sessionPath = getSessionPath(rootPath);
  // Ensure .planning/ exists
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n', 'utf-8');

  return session;
}

// @gsd-todo(ref:AC-16) Implement "Global" option: setCurrentApp(rootPath, null) puts session in root-level scope for cross-app work
// @gsd-api clearSession(rootPath) -- removes SESSION.json entirely, resetting to no-session state
/**
 * Clear the session entirely. Removes SESSION.json.
 *
 * @param {string} rootPath - Project root
 */
function clearSession(rootPath) {
  const sessionPath = getSessionPath(rootPath);
  try {
    fs.unlinkSync(sessionPath);
  } catch {
    // File doesn't exist -- already cleared
  }
}

// ---------------------------------------------------------------------------
// Session initialization (for monorepo startup)
// ---------------------------------------------------------------------------

// @gsd-api initSession(rootPath, workspaceInfo) -- creates initial SESSION.json from workspace detection results
/**
 * Initialize a session from workspace detection results.
 * Called by monorepo-init or at session start when a monorepo is detected.
 *
 * @param {string} rootPath - Project root
 * @param {Object} workspaceInfo - WorkspaceInfo from workspace-detector.cjs
 * @returns {SessionData}
 */
function initSession(rootPath, workspaceInfo) {
  // @gsd-constraint Session init does NOT auto-select an app -- user must explicitly choose via selector or /gsd:switch-app
  const availableApps = (workspaceInfo.apps || []).map(a => a.path);

  // Check if a default app was previously configured — auto-select it
  const existing = getSession(rootPath);
  const defaultApp = (existing && existing.default_app) || null;

  const session = {
    current_app: defaultApp,
    default_app: defaultApp,
    workspace_type: workspaceInfo.type || 'monorepo',
    available_apps: availableApps,
    updated_at: Date.now(),
  };

  const sessionPath = getSessionPath(rootPath);
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n', 'utf-8');

  return session;
}

// ---------------------------------------------------------------------------
// Default app configuration
// ---------------------------------------------------------------------------

/**
 * Set a default app that auto-selects at session start.
 * Pass null to clear the default.
 *
 * @param {string} rootPath - Project root
 * @param {string|null} appPath - Relative app path or null to clear
 * @returns {SessionData}
 */
function setDefaultApp(rootPath, appPath) {
  const existing = getSession(rootPath) || {};

  const session = {
    current_app: existing.current_app || appPath,
    default_app: appPath,
    workspace_type: existing.workspace_type || 'monorepo',
    available_apps: existing.available_apps || [],
    updated_at: Date.now(),
  };

  const sessionPath = getSessionPath(rootPath);
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n', 'utf-8');

  return session;
}

/**
 * Get the default app, if configured.
 *
 * @param {string} rootPath - Project root
 * @returns {string|null}
 */
function getDefaultApp(rootPath) {
  const session = getSession(rootPath);
  return (session && session.default_app) || null;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

// @gsd-api isMonorepoSession(rootPath) -- returns true if a monorepo session is active
/**
 * Check if the current session is a monorepo session.
 *
 * @param {string} rootPath - Project root
 * @returns {boolean}
 */
function isMonorepoSession(rootPath) {
  const session = getSession(rootPath);
  return !!(session && session.workspace_type && session.workspace_type !== 'single');
}

// @gsd-api getAvailableApps(rootPath) -- returns cached list of app paths from session, or empty array
/**
 * Get the list of available apps from the session.
 *
 * @param {string} rootPath - Project root
 * @returns {string[]}
 */
function getAvailableApps(rootPath) {
  const session = getSession(rootPath);
  return (session && session.available_apps) || [];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format the app selector prompt for display.
 *
 * @param {string[]} apps - Available app paths
 * @param {string|null} currentApp - Currently selected app
 * @returns {string}
 */
function formatAppSelector(apps, currentApp) {
  const lines = ['Which app do you want to work on?\n'];

  for (let i = 0; i < apps.length; i++) {
    const marker = apps[i] === currentApp ? ' (current)' : '';
    lines.push(`  ${i + 1}. ${apps[i]}${marker}`);
  }

  const globalMarker = currentApp === null ? ' (current)' : '';
  lines.push(`  ${apps.length + 1}. [Global] -- root-level cross-app work${globalMarker}`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getSessionPath,
  getSession,
  getCurrentApp,
  resolveCurrentApp,
  setCurrentApp,
  setDefaultApp,
  getDefaultApp,
  clearSession,
  initSession,
  isMonorepoSession,
  getAvailableApps,
  formatAppSelector,
};
