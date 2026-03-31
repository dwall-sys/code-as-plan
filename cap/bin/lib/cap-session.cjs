// @gsd-context CAP v2.0 session manager -- manages .cap/SESSION.json for cross-conversation workflow state.
// @gsd-decision SESSION.json is ephemeral (gitignored) -- it tracks the current developer's workflow state, not project state. Project state lives in FEATURE-MAP.md.
// @gsd-decision JSON format (not markdown) -- session state is machine-consumed, not human-read. JSON is faster to parse and type-safe.
// @gsd-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path).
// @gsd-pattern All session reads/writes go through this module -- no direct fs.readFileSync of SESSION.json elsewhere.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// @gsd-decision Session schema is flat and extensible -- new workflow commands can add keys without schema migration.
// @gsd-todo(ref:AC-16) SESSION.json tracks ephemeral workflow state: active feature ID, current workflow step, session timestamps
/**
 * @typedef {Object} CapSession
 * @property {string} version - Session schema version (e.g., "2.0.0")
 * @property {string|null} lastCommand - Last /cap: command executed
 * @property {string|null} lastCommandTimestamp - ISO timestamp of last command
 * @property {string|null} activeApp - Currently focused app path (e.g., "apps/flow") or null for single-repo/root
 * @property {string|null} activeFeature - Currently focused feature ID
 * @property {string|null} step - Current workflow step
 * @property {string|null} startedAt - ISO timestamp of when session started
 * @property {string|null} activeDebugSession - Active debug session ID
 * @property {Object<string,string>} metadata - Extensible key-value metadata
 */

const CAP_DIR = '.cap';
const SESSION_FILE = 'SESSION.json';

// @gsd-todo(ref:AC-3) .cap/.gitignore ignores SESSION.json (ephemeral state shall not be committed)
const GITIGNORE_CONTENT = `# CAP ephemeral state -- do not commit
SESSION.json
debug/
`;

// @gsd-api getDefaultSession() -- Returns a fresh default session object.
// @gsd-todo(ref:AC-2) SESSION.json with valid JSON structure: { active_feature: null, step: null, started_at: null }
/**
 * @returns {CapSession}
 */
function getDefaultSession() {
  return {
    version: '2.0.0',
    lastCommand: null,
    lastCommandTimestamp: null,
    activeApp: null,
    activeFeature: null,
    step: null,
    startedAt: null,
    activeDebugSession: null,
    metadata: {},
  };
}

// @gsd-api loadSession(projectRoot) -- Loads .cap/SESSION.json. Returns default session if file missing or corrupt.
// @gsd-todo(ref:AC-19) SESSION.json is the only mutable session artifact
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {CapSession}
 */
function loadSession(projectRoot) {
  const sessionPath = path.join(projectRoot, CAP_DIR, SESSION_FILE);
  try {
    if (!fs.existsSync(sessionPath)) return getDefaultSession();
    const content = fs.readFileSync(sessionPath, 'utf8');
    const parsed = JSON.parse(content);
    // Merge with defaults to handle missing keys from older versions
    return { ...getDefaultSession(), ...parsed };
  } catch (_e) {
    // Corrupt JSON -- return default
    return getDefaultSession();
  }
}

// @gsd-api saveSession(projectRoot, session) -- Writes .cap/SESSION.json. Creates .cap/ directory if needed.
// @gsd-todo(ref:AC-18) SESSION.json shall not be committed to version control (enforced by .cap/.gitignore)
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {CapSession} session - Session data to persist
 */
function saveSession(projectRoot, session) {
  const capDir = path.join(projectRoot, CAP_DIR);
  if (!fs.existsSync(capDir)) {
    fs.mkdirSync(capDir, { recursive: true });
  }
  const sessionPath = path.join(capDir, SESSION_FILE);
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n', 'utf8');
}

// @gsd-api updateSession(projectRoot, updates) -- Partial update to session (merge, not overwrite).
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {Partial<CapSession>} updates - Fields to merge into current session
 * @returns {CapSession} - The updated session
 */
function updateSession(projectRoot, updates) {
  const session = loadSession(projectRoot);
  // Shallow merge -- metadata gets replaced if present in updates
  const updated = { ...session, ...updates };
  saveSession(projectRoot, updated);
  return updated;
}

// @gsd-api startSession(projectRoot, featureId, step) -- Set active feature and step with timestamp.
// @gsd-todo(ref:AC-17) SESSION.json connects to FEATURE-MAP.md only via feature IDs (loose coupling)
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} featureId - Feature ID to focus on (e.g., "F-001")
 * @param {string} step - Current workflow step name
 * @returns {CapSession}
 */
function startSession(projectRoot, featureId, step) {
  return updateSession(projectRoot, {
    activeFeature: featureId,
    step,
    startedAt: new Date().toISOString(),
  });
}

// @gsd-api updateStep(projectRoot, step) -- Update current workflow step.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} step - New workflow step name
 * @returns {CapSession}
 */
function updateStep(projectRoot, step) {
  return updateSession(projectRoot, { step });
}

// @gsd-api endSession(projectRoot) -- Clear active feature and step.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {CapSession}
 */
function endSession(projectRoot) {
  return updateSession(projectRoot, {
    activeFeature: null,
    step: null,
    startedAt: null,
  });
}

// @gsd-api isInitialized(projectRoot) -- Check if .cap/ exists.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {boolean}
 */
function isInitialized(projectRoot) {
  return fs.existsSync(path.join(projectRoot, CAP_DIR));
}

// @gsd-api initCapDirectory(projectRoot) -- Creates .cap/ directory structure and .gitignore. Idempotent.
// @gsd-todo(ref:AC-4) No prompts, questions, wizards, or configuration forms
// @gsd-todo(ref:AC-5) Completes in a single invocation with no follow-up steps
// @gsd-todo(ref:AC-6) Idempotent -- running on already-initialized project shall not overwrite existing content
/**
 * @param {string} projectRoot - Absolute path to project root
 */
function initCapDirectory(projectRoot) {
  const capDir = path.join(projectRoot, CAP_DIR);
  const stackDocsDir = path.join(capDir, 'stack-docs');
  const debugDir = path.join(capDir, 'debug');
  const gitignorePath = path.join(capDir, '.gitignore');
  const sessionPath = path.join(capDir, SESSION_FILE);

  // Create directories (idempotent via recursive:true)
  fs.mkdirSync(capDir, { recursive: true });
  fs.mkdirSync(stackDocsDir, { recursive: true });
  fs.mkdirSync(debugDir, { recursive: true });

  // Write .gitignore (always overwrite -- it's infrastructure, not user content)
  fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf8');

  // Write SESSION.json only if it doesn't exist (preserve existing session)
  if (!fs.existsSync(sessionPath)) {
    saveSession(projectRoot, getDefaultSession());
  }
}

// @gsd-api setActiveApp(projectRoot, appPath) -- Set the active app in SESSION.json for monorepo scoping.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string|null} appPath - Relative app path (e.g., "apps/flow") or null to clear
 * @returns {CapSession}
 */
function setActiveApp(projectRoot, appPath) {
  return updateSession(projectRoot, { activeApp: appPath || null });
}

// @gsd-api getActiveApp(projectRoot) -- Get current active app path from SESSION.json.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string|null} - Active app path or null
 */
function getActiveApp(projectRoot) {
  const session = loadSession(projectRoot);
  return session.activeApp || null;
}

// @gsd-api getAppRoot(projectRoot) -- Returns the effective root for app-scoped operations.
// If activeApp is set, returns projectRoot + activeApp. Otherwise returns projectRoot.
// This is the KEY function for all scoping decisions.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string} - Absolute path to the active app root (or project root if no app)
 */
function getAppRoot(projectRoot) {
  const activeApp = getActiveApp(projectRoot);
  if (activeApp) {
    return path.join(projectRoot, activeApp);
  }
  return projectRoot;
}

// @gsd-api listApps(projectRoot) -- List available apps/packages in a monorepo using detectWorkspaces.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {{ isMonorepo: boolean, apps: string[] }}
 */
function listApps(projectRoot) {
  // Lazy require to avoid circular dependency
  const { detectWorkspaces } = require('./cap-tag-scanner.cjs');
  const workspaces = detectWorkspaces(projectRoot);
  return {
    isMonorepo: workspaces.isMonorepo,
    apps: workspaces.packages,
  };
}

module.exports = {
  CAP_DIR,
  SESSION_FILE,
  GITIGNORE_CONTENT,
  loadSession,
  saveSession,
  updateSession,
  getDefaultSession,
  startSession,
  updateStep,
  endSession,
  isInitialized,
  initCapDirectory,
  setActiveApp,
  getActiveApp,
  getAppRoot,
  listApps,
};
