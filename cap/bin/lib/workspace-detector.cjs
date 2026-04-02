// @cap-context Workspace detector for monorepo mode -- discovers NX, Turbo, and pnpm workspaces and enumerates apps/packages
// @cap-decision Regex-parses pnpm-workspace.yaml instead of adding a YAML parser -- keeps zero-dep constraint
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path)
// @cap-ref(ref:AC-1) GSD auto-detects NX/Turbo/pnpm workspaces and lists available apps and packages on project initialization
// @cap-pattern Workspace detection returns a structured WorkspaceInfo object that downstream modules consume uniformly

'use strict';

// @cap-feature(feature:F-012) Monorepo Support — workspace detection for NX, Turbo, and pnpm workspaces

const fs = require('node:fs');
const path = require('node:path');

// @cap-api detectWorkspace(projectRoot) -- returns WorkspaceInfo | null describing the monorepo type, apps, and packages

/**
 * @typedef {Object} WorkspaceApp
 * @property {string} name - Package name from package.json or directory name
 * @property {string} path - Relative path from project root (e.g., 'apps/dashboard')
 * @property {string} absolutePath - Absolute path on disk
 */

/**
 * @typedef {Object} WorkspacePackage
 * @property {string} name - Package name from package.json or directory name
 * @property {string} path - Relative path from project root (e.g., 'packages/ui')
 * @property {string} absolutePath - Absolute path on disk
 * @property {string[]} exports - Exported entry points (from package.json exports field)
 */

/**
 * @typedef {Object} WorkspaceInfo
 * @property {'nx'|'turbo'|'pnpm'|'npm'|null} type - Detected workspace manager
 * @property {string} rootPath - Absolute path to monorepo root
 * @property {WorkspaceApp[]} apps - Detected applications
 * @property {WorkspacePackage[]} packages - Detected shared packages
 * @property {string[]} workspaceGlobs - Raw glob patterns from workspace config
 */

/**
 * Detect the workspace type by checking for config files.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @returns {WorkspaceInfo|null} Workspace info or null if not a monorepo
 */
function detectWorkspace(projectRoot) {
  // @cap-decision Check nx.json first, then turbo.json, then pnpm-workspace.yaml, then package.json workspaces -- priority matches market share
  const nxPath = path.join(projectRoot, 'nx.json');
  const turboPath = path.join(projectRoot, 'turbo.json');
  const pnpmWsPath = path.join(projectRoot, 'pnpm-workspace.yaml');
  const pkgPath = path.join(projectRoot, 'package.json');

  let type = null;
  let workspaceGlobs = [];

  if (fs.existsSync(nxPath)) {
    type = 'nx';
    workspaceGlobs = resolveNxWorkspaces(nxPath, pkgPath);
  } else if (fs.existsSync(turboPath)) {
    type = 'turbo';
    workspaceGlobs = resolveTurboWorkspaces(pkgPath);
  } else if (fs.existsSync(pnpmWsPath)) {
    type = 'pnpm';
    workspaceGlobs = resolvePnpmWorkspaces(pnpmWsPath);
  } else if (fs.existsSync(pkgPath)) {
    const pkg = safeReadJson(pkgPath);
    if (pkg && Array.isArray(pkg.workspaces)) {
      type = 'npm';
      workspaceGlobs = pkg.workspaces;
    } else if (pkg && pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
      type = 'npm';
      workspaceGlobs = pkg.workspaces.packages;
    }
  }

  if (!type) return null;

  // @cap-risk Glob expansion uses simple fs.readdirSync matching, not full glob semantics -- patterns like apps/** work but complex negations do not
  const resolved = expandWorkspaceGlobs(projectRoot, workspaceGlobs);

  // @cap-decision Classify directories under apps/ or packages/ by convention -- NX/Turbo monorepos use this standard structure
  const apps = [];
  const packages = [];

  for (const entry of resolved) {
    const relPath = entry.relativePath;
    const pkgJson = safeReadJson(path.join(entry.absolutePath, 'package.json'));
    const name = (pkgJson && pkgJson.name) || path.basename(relPath);
    const exports = (pkgJson && pkgJson.exports) ? Object.keys(pkgJson.exports) : [];

    const item = {
      name,
      path: relPath,
      absolutePath: entry.absolutePath,
    };

    if (relPath.startsWith('apps/') || relPath.startsWith('apps\\')) {
      apps.push(item);
    } else if (relPath.startsWith('packages/') || relPath.startsWith('libs/') || relPath.startsWith('packages\\') || relPath.startsWith('libs\\')) {
      packages.push({ ...item, exports });
    } else {
      // @cap-risk Directories not under apps/ or packages/ are classified as packages by default -- may misclassify standalone tools
      packages.push({ ...item, exports });
    }
  }

  return {
    type,
    rootPath: projectRoot,
    apps,
    packages,
    workspaceGlobs,
  };
}

/**
 * Resolve NX workspace globs. NX uses package.json workspaces or project.json files.
 *
 * @param {string} nxPath - Path to nx.json
 * @param {string} pkgPath - Path to root package.json
 * @returns {string[]}
 */
function resolveNxWorkspaces(nxPath, pkgPath) {
  const pkg = safeReadJson(pkgPath);
  if (pkg && Array.isArray(pkg.workspaces)) return pkg.workspaces;
  if (pkg && pkg.workspaces && Array.isArray(pkg.workspaces.packages)) return pkg.workspaces.packages;

  // NX project.json-based discovery: scan first-level subdirectories for project.json files
  const projectRoot = path.dirname(nxPath);
  const discoveredGlobs = new Set();

  try {
    const topEntries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const topEntry of topEntries) {
      if (!topEntry.isDirectory()) continue;
      if (topEntry.name === 'node_modules' || topEntry.name === '.git') continue;

      const topDir = path.join(projectRoot, topEntry.name);
      try {
        const subEntries = fs.readdirSync(topDir, { withFileTypes: true });
        for (const subEntry of subEntries) {
          if (!subEntry.isDirectory()) continue;
          const projectJsonPath = path.join(topDir, subEntry.name, 'project.json');
          if (fs.existsSync(projectJsonPath)) {
            // Add the parent-level glob pattern (e.g., 'apps/*')
            discoveredGlobs.add(`${topEntry.name}/*`);
          }
        }
      } catch {
        // Permission errors on subdirectory
      }
    }
  } catch {
    // Permission errors on project root
  }

  if (discoveredGlobs.size > 0) {
    return Array.from(discoveredGlobs);
  }

  // Fallback: NX convention
  return ['apps/*', 'packages/*', 'libs/*'];
}

/**
 * Resolve Turbo workspace globs. Turbo reads from package.json workspaces.
 *
 * @param {string} pkgPath - Path to root package.json
 * @returns {string[]}
 */
function resolveTurboWorkspaces(pkgPath) {
  const pkg = safeReadJson(pkgPath);
  if (pkg && Array.isArray(pkg.workspaces)) return pkg.workspaces;
  if (pkg && pkg.workspaces && Array.isArray(pkg.workspaces.packages)) return pkg.workspaces.packages;
  return ['apps/*', 'packages/*'];
}

/**
 * Parse pnpm-workspace.yaml to extract workspace globs.
 * Uses simple regex instead of a YAML parser to maintain zero-dep constraint.
 *
 * @param {string} pnpmWsPath - Path to pnpm-workspace.yaml
 * @returns {string[]}
 */
function resolvePnpmWorkspaces(pnpmWsPath) {
  // @cap-decision Parse pnpm-workspace.yaml with regex -- avoids adding js-yaml dependency; works for the simple list format pnpm uses
  // @cap-risk Regex YAML parsing will break on complex YAML features (anchors, flow sequences) -- sufficient for pnpm-workspace.yaml which is always a simple list
  try {
    const content = fs.readFileSync(pnpmWsPath, 'utf-8');
    const globs = [];
    const lines = content.split('\n');
    let inPackages = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'packages:') {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (trimmed.startsWith('- ')) {
          const glob = trimmed.slice(2).replace(/['"]/g, '').trim();
          if (glob) globs.push(glob);
        } else if (trimmed && !trimmed.startsWith('#')) {
          // Non-list line ends the packages section
          break;
        }
      }
    }
    return globs.length > 0 ? globs : ['packages/*', 'apps/*'];
  } catch {
    return ['packages/*', 'apps/*'];
  }
}

/**
 * Expand workspace globs to actual directories on disk.
 *
 * @param {string} rootPath - Absolute path to monorepo root
 * @param {string[]} globs - Workspace glob patterns (e.g., ['apps/*', 'packages/*'])
 * @returns {Array<{relativePath: string, absolutePath: string}>}
 */
function expandWorkspaceGlobs(rootPath, globs) {
  // @cap-constraint Uses readdirSync (not glob library) per project zero-dep constraint
  const results = [];
  const seen = new Set();

  for (const glob of globs) {
    // Skip negation patterns (e.g., '!packages/internal')
    if (glob.startsWith('!')) continue;

    // Detect two-level glob patterns like 'packages/*/sub/*'
    const segments = glob.split('/');
    const starPositions = segments.reduce((acc, seg, i) => {
      if (seg === '*' || seg === '**') acc.push(i);
      return acc;
    }, []);

    if (starPositions.length >= 2) {
      // Two-level pattern: walk two directory levels
      const firstParent = path.join(rootPath, segments.slice(0, starPositions[0]).join('/'));
      if (!fs.existsSync(firstParent)) continue;

      try {
        const level1Entries = fs.readdirSync(firstParent, { withFileTypes: true });
        for (const l1 of level1Entries) {
          if (!l1.isDirectory() || l1.name === 'node_modules' || l1.name === '.git') continue;
          // Build the path to the second-level parent (may have fixed segments between stars)
          const midSegments = segments.slice(starPositions[0] + 1, starPositions[1]);
          const level2Parent = path.join(firstParent, l1.name, ...midSegments);
          if (!fs.existsSync(level2Parent)) continue;

          try {
            const level2Entries = fs.readdirSync(level2Parent, { withFileTypes: true });
            for (const l2 of level2Entries) {
              if (!l2.isDirectory() || l2.name === 'node_modules' || l2.name === '.git') continue;
              const absPath = path.join(level2Parent, l2.name);
              const relPath = path.relative(rootPath, absPath);
              if (!seen.has(relPath)) {
                seen.add(relPath);
                results.push({ relativePath: relPath, absolutePath: absPath });
              }
            }
          } catch {
            // Permission errors
          }
        }
      } catch {
        // Permission errors
      }
    } else {
      // Single-level pattern: 'apps/*', 'packages/*', 'libs/*'
      const cleanGlob = glob.replace(/\/\*\*?$/, '').replace(/\\\*\*?$/, '');
      const parentDir = path.join(rootPath, cleanGlob);

      if (!fs.existsSync(parentDir)) continue;

      try {
        const entries = fs.readdirSync(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name === 'node_modules' || entry.name === '.git') continue;

          const absPath = path.join(parentDir, entry.name);
          const relPath = path.relative(rootPath, absPath);

          if (!seen.has(relPath)) {
            seen.add(relPath);
            results.push({ relativePath: relPath, absolutePath: absPath });
          }
        }
      } catch {
        // Permission errors, etc.
      }
    }
  }

  return results;
}

/**
 * Safely read and parse a JSON file.
 *
 * @param {string} filePath
 * @returns {Object|null}
 */
function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Validate that an --app path exists within the workspace.
 *
 * @param {WorkspaceInfo} workspace - Detected workspace info
 * @param {string} appPath - User-provided app path (e.g., 'apps/dashboard')
 * @returns {{valid: boolean, resolved: WorkspaceApp|null, error: string|null}}
 */
// @cap-api validateAppPath(workspace, appPath) -- returns {valid, resolved, error} for --app flag validation
function validateAppPath(workspace, appPath) {
  if (!workspace) {
    return { valid: false, resolved: null, error: 'No workspace detected. Run monorepo-init first.' };
  }

  const normalized = appPath.replace(/\\/g, '/').replace(/\/$/, '');
  const allEntries = [...workspace.apps, ...workspace.packages];
  const match = allEntries.find(e => e.path.replace(/\\/g, '/') === normalized);

  if (match) {
    return { valid: true, resolved: match, error: null };
  }

  return {
    valid: false,
    resolved: null,
    error: `App '${appPath}' not found in workspace. Available: ${allEntries.map(e => e.path).join(', ')}`,
  };
}

/**
 * CLI entry point for detect-workspace subcommand.
 *
 * @param {string} cwd - Current working directory
 * @param {boolean} raw - Whether to output raw JSON
 */
function cmdDetectWorkspace(cwd, raw) {
  const workspace = detectWorkspace(cwd);
  if (!workspace) {
    if (raw) {
      process.stdout.write('null\n');
    } else {
      process.stderr.write('No workspace detected. Not a monorepo or missing workspace config.\n');
    }
    return;
  }

  const output = JSON.stringify(workspace, null, 2);
  process.stdout.write(output + '\n');
}

module.exports = {
  detectWorkspace,
  validateAppPath,
  expandWorkspaceGlobs,
  resolvePnpmWorkspaces,
  resolveNxWorkspaces,
  resolveTurboWorkspaces,
  cmdDetectWorkspace,
};
