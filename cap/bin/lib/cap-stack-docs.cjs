// @gsd-context CAP v2.0 stack docs manager -- wraps Context7 CLI for library documentation fetch and caching in .cap/stack-docs/.
// @gsd-decision Wraps npx ctx7@latest (not a direct API call) -- Context7 is already the user's standard tool per CLAUDE.md. This module provides programmatic access for agent workflows.
// @gsd-decision Docs cached as markdown files in .cap/stack-docs/{library-name}.md -- simple, readable, committable for offline use.
// @gsd-constraint Zero external dependencies at runtime -- Context7 is invoked via child_process.execSync (npx), not imported.
// @gsd-risk Context7 requires network access and may hit rate limits. Module must handle failures gracefully and report to caller.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const STACK_DOCS_DIR = '.cap/stack-docs';

// @gsd-todo(ref:AC-27) Tag scanner uses stack docs path for enrichment context
const FRESHNESS_DAYS = 7;
const FRESHNESS_HOURS = FRESHNESS_DAYS * 24; // 168 hours default freshness window

/**
 * @typedef {Object} LibraryInfo
 * @property {string} id - Context7 library ID (e.g., "/vercel/next.js")
 * @property {string} name - Display name
 * @property {string} description - Library description
 */

/**
 * @typedef {Object} FetchResult
 * @property {boolean} success - Whether the fetch succeeded
 * @property {string|null} filePath - Path to cached docs file (null on failure)
 * @property {string|null} error - Error message on failure
 */

/**
 * @typedef {Object} DependencyInfo
 * @property {string[]} dependencies - Production dependency names
 * @property {string[]} devDependencies - Dev dependency names
 * @property {string} type - Project type: 'node', 'python', 'go', 'rust', 'unknown'
 */

// @gsd-api detectDependencies(projectRoot) -- Reads package.json/requirements.txt/etc to discover project dependencies.
// Returns: DependencyInfo with categorized dependency lists and project type.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {DependencyInfo}
 */
function detectDependencies(projectRoot) {
  const result = { dependencies: [], devDependencies: [], type: 'unknown' };

  // Node.js: package.json
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      result.type = 'node';
      if (pkg.dependencies) result.dependencies = Object.keys(pkg.dependencies);
      if (pkg.devDependencies) result.devDependencies = Object.keys(pkg.devDependencies);
    } catch (_e) {
      // Malformed package.json -- continue to other detectors
    }
  }

  // Python: requirements.txt
  const reqPath = path.join(projectRoot, 'requirements.txt');
  if (fs.existsSync(reqPath) && result.type === 'unknown') {
    try {
      const content = fs.readFileSync(reqPath, 'utf8');
      const depRE = /^([a-zA-Z0-9_-]+)/gm;
      let match;
      result.type = 'python';
      while ((match = depRE.exec(content)) !== null) {
        result.dependencies.push(match[1]);
      }
    } catch (_e) {
      // Ignore
    }
  }

  // Python: pyproject.toml (basic extraction)
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath) && result.type === 'unknown') {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf8');
      result.type = 'python';
      // Extract dependency names from [project.dependencies] or [tool.poetry.dependencies]
      const depRE = /^\s*"?([a-zA-Z0-9_-]+)/gm;
      const depsSection = content.match(/\[(?:project\.)?dependencies\]([\s\S]*?)(?:\[|$)/);
      if (depsSection) {
        let m;
        while ((m = depRE.exec(depsSection[1])) !== null) {
          if (m[1] !== 'python') result.dependencies.push(m[1]);
        }
      }
    } catch (_e) {
      // Ignore
    }
  }

  // Go: go.mod
  const goModPath = path.join(projectRoot, 'go.mod');
  if (fs.existsSync(goModPath) && result.type === 'unknown') {
    try {
      const content = fs.readFileSync(goModPath, 'utf8');
      result.type = 'go';
      const requireRE = /^\s+([^\s]+)/gm;
      const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
      if (requireBlock) {
        let m;
        while ((m = requireRE.exec(requireBlock[1])) !== null) {
          result.dependencies.push(m[1]);
        }
      }
    } catch (_e) {
      // Ignore
    }
  }

  // Rust: Cargo.toml
  const cargoPath = path.join(projectRoot, 'Cargo.toml');
  if (fs.existsSync(cargoPath) && result.type === 'unknown') {
    try {
      const content = fs.readFileSync(cargoPath, 'utf8');
      result.type = 'rust';
      const depSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
      if (depSection) {
        const depRE = /^([a-zA-Z0-9_-]+)/gm;
        let m;
        while ((m = depRE.exec(depSection[1])) !== null) {
          result.dependencies.push(m[1]);
        }
      }
    } catch (_e) {
      // Ignore
    }
  }

  return result;
}

// @gsd-api resolveLibrary(libraryName, query) -- Resolves a library name to a Context7 library ID.
// Returns: LibraryInfo or null if not found.
/**
 * @param {string} libraryName - Library name (e.g., "react", "express")
 * @param {string} [query] - Optional query for better matching
 * @returns {LibraryInfo|null}
 */
function resolveLibrary(libraryName, query) {
  const queryStr = query ? `"${query}"` : `"${libraryName}"`;
  try {
    const output = execSync(
      `npx ctx7@latest library ${libraryName} ${queryStr}`,
      { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Parse the first result from ctx7 library output
    // Expected format: lines with ID, name, description
    const lines = output.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    // ctx7 outputs a table or JSON-like structure -- extract the first match
    // Look for a line containing a library ID in /org/project format
    for (const line of lines) {
      const idMatch = line.match(/\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+/);
      if (idMatch) {
        return {
          id: idMatch[0],
          name: libraryName,
          description: line.replace(idMatch[0], '').trim(),
        };
      }
    }

    return null;
  } catch (e) {
    // ctx7 not available, network error, or timeout
    return null;
  }
}

// @gsd-api fetchDocs(projectRoot, libraryId, query) -- Fetches library docs via Context7 and caches them.
// Returns: FetchResult with success status and cached file path.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} libraryId - Context7 library ID (e.g., "/vercel/next.js")
 * @param {string} [query] - Optional query to focus documentation
 * @returns {FetchResult}
 */
function fetchDocs(projectRoot, libraryId, query) {
  const docsDir = path.join(projectRoot, STACK_DOCS_DIR);
  // Ensure .cap/stack-docs/ exists
  fs.mkdirSync(docsDir, { recursive: true });

  // Derive filename from library ID: /vercel/next.js -> next.js.md
  const libName = libraryId.split('/').pop() || libraryId.replace(/\//g, '-');
  const filePath = path.join(docsDir, `${libName}.md`);

  const queryStr = query ? `"${query}"` : '""';
  try {
    const output = execSync(
      `npx ctx7@latest docs ${libraryId} ${queryStr}`,
      { encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    if (!output || output.trim().length === 0) {
      return { success: false, filePath: null, error: 'Empty response from Context7' };
    }

    // Write docs with metadata header
    const header = [
      `<!-- CAP Stack Docs: ${libraryId} -->`,
      `<!-- Fetched: ${new Date().toISOString()} -->`,
      `<!-- Query: ${query || 'general'} -->`,
      '',
    ].join('\n');

    fs.writeFileSync(filePath, header + output, 'utf8');
    return { success: true, filePath, error: null };
  } catch (e) {
    const errorMsg = e.message || 'Unknown error fetching docs';
    return { success: false, filePath: null, error: errorMsg };
  }
}

// @gsd-api writeDocs(projectRoot, libraryName, content) -- Writes documentation content directly to .cap/stack-docs/.
// Returns: string -- path to written file.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} libraryName - Library name for filename
 * @param {string} content - Documentation content to write
 * @returns {string}
 */
function writeDocs(projectRoot, libraryName, content) {
  const docsDir = path.join(projectRoot, STACK_DOCS_DIR);
  fs.mkdirSync(docsDir, { recursive: true });

  const filePath = path.join(docsDir, `${libraryName}.md`);
  const header = [
    `<!-- CAP Stack Docs: ${libraryName} -->`,
    `<!-- Written: ${new Date().toISOString()} -->`,
    '',
  ].join('\n');

  fs.writeFileSync(filePath, header + content, 'utf8');
  return filePath;
}

// @gsd-api listCachedDocs(projectRoot) -- Lists all cached library docs.
// Returns: Array of { libraryName, filePath, lastModified }.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {Array<{libraryName: string, filePath: string, lastModified: Date}>}
 */
function listCachedDocs(projectRoot) {
  const docsDir = path.join(projectRoot, STACK_DOCS_DIR);
  if (!fs.existsSync(docsDir)) return [];

  try {
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
    return files.map(f => {
      const filePath = path.join(docsDir, f);
      const stat = fs.statSync(filePath);
      return {
        libraryName: f.replace(/\.md$/, ''),
        filePath,
        lastModified: stat.mtime,
      };
    });
  } catch (_e) {
    return [];
  }
}

// @gsd-api checkFreshness(projectRoot, libraryName, maxAgeHours) -- Checks if cached docs are still fresh.
// Returns: { fresh: boolean, ageHours: number | null, filePath: string | null }
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} libraryName - Library name
 * @param {number} [maxAgeHours] - Maximum age in hours (default: 168 = 7 days)
 * @returns {{ fresh: boolean, ageHours: number|null, filePath: string|null }}
 */
function checkFreshness(projectRoot, libraryName, maxAgeHours) {
  const maxAge = maxAgeHours != null ? maxAgeHours : FRESHNESS_HOURS;
  const filePath = getDocsPath(projectRoot, libraryName);

  if (!fs.existsSync(filePath)) {
    return { fresh: false, ageHours: null, filePath: null };
  }

  try {
    const stat = fs.statSync(filePath);
    const ageMs = Math.max(0, Date.now() - stat.mtime.getTime());
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    return {
      fresh: ageHours <= maxAge,
      ageHours,
      filePath,
    };
  } catch (_e) {
    return { fresh: false, ageHours: null, filePath: null };
  }
}

// @gsd-api getDocsPath(projectRoot, libraryName) -- Returns the expected path for a library's cached docs.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} libraryName - Library name
 * @returns {string}
 */
function getDocsPath(projectRoot, libraryName) {
  return path.join(projectRoot, STACK_DOCS_DIR, `${libraryName}.md`);
}

// @gsd-api parseFreshnessFromContent(content) -- Extracts freshness date from doc file header comment.
// @gsd-todo(ref:AC-84) Stack-docs carry freshness marker (fetch date). Docs older than 7 days auto-refreshed.
/**
 * Parse the fetch date from a stack doc file's header.
 * Looks for: <!-- Fetched: ISO_DATE --> or <!-- Written: ISO_DATE -->
 *
 * @param {string} content - File content
 * @returns {string|null} - ISO date string or null if not found
 */
function parseFreshnessFromContent(content) {
  const match = content.match(/<!--\s*(?:Fetched|Written):\s*(\d{4}-\d{2}-\d{2}T[^\s>]+)\s*-->/);
  return match ? match[1] : null;
}

// @gsd-api checkFreshnessEnhanced(projectRoot, libraryName, maxAgeDays) -- Checks freshness using embedded date marker.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} libraryName - Library name
 * @param {number} [maxAgeDays] - Maximum age in days (default: 7)
 * @returns {{ fresh: boolean, ageHours: number|null, fetchDate: string|null, filePath: string|null }}
 */
function checkFreshnessEnhanced(projectRoot, libraryName, maxAgeDays) {
  const maxDays = maxAgeDays != null ? maxAgeDays : FRESHNESS_DAYS;
  const filePath = path.join(projectRoot, STACK_DOCS_DIR, `${libraryName}.md`);

  if (!fs.existsSync(filePath)) {
    return { fresh: false, ageHours: null, fetchDate: null, filePath: null };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fetchDate = parseFreshnessFromContent(content);

    if (!fetchDate) {
      // No freshness marker -- treat as stale, use file mtime as fallback
      const stat = fs.statSync(filePath);
      const ageMs = Math.max(0, Date.now() - stat.mtime.getTime());
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      return {
        fresh: ageHours <= maxDays * 24,
        ageHours,
        fetchDate: null,
        filePath,
      };
    }

    const fetchTime = new Date(fetchDate).getTime();
    const ageMs = Math.max(0, Date.now() - fetchTime);
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

    return {
      fresh: ageHours <= maxDays * 24,
      ageHours,
      fetchDate,
      filePath,
    };
  } catch (_e) {
    return { fresh: false, ageHours: null, fetchDate: null, filePath: null };
  }
}

// @gsd-api fetchDocsWithFreshness(projectRoot, libraryId, query) -- Fetches docs with embedded freshness marker.
// @gsd-todo(ref:AC-82) Store fetched stack docs in .cap/stack-docs/{library-name}.md
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} libraryId - Context7 library ID (e.g., "/vercel/next.js")
 * @param {string} [query] - Optional query to focus documentation
 * @returns {{ success: boolean, filePath: string|null, error: string|null }}
 */
function fetchDocsWithFreshness(projectRoot, libraryId, query) {
  const docsDir = path.join(projectRoot, STACK_DOCS_DIR);
  fs.mkdirSync(docsDir, { recursive: true });

  const libName = libraryId.split('/').pop() || libraryId.replace(/\//g, '-');
  const filePath = path.join(docsDir, `${libName}.md`);

  const queryStr = query ? `"${query}"` : '""';
  try {
    const output = execSync(
      `npx ctx7@latest docs ${libraryId} ${queryStr}`,
      { encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    if (!output || output.trim().length === 0) {
      return { success: false, filePath: null, error: 'Empty response from Context7' };
    }

    // Write docs with freshness metadata header
    const now = new Date().toISOString();
    const header = [
      `<!-- CAP Stack Docs: ${libraryId} -->`,
      `<!-- Fetched: ${now} -->`,
      `<!-- Query: ${query || 'general'} -->`,
      `<!-- Freshness: valid until ${new Date(Date.now() + FRESHNESS_DAYS * 24 * 60 * 60 * 1000).toISOString()} -->`,
      '',
    ].join('\n');

    fs.writeFileSync(filePath, header + output, 'utf8');
    return { success: true, filePath, error: null };
  } catch (e) {
    return { success: false, filePath: null, error: e.message || 'Unknown error' };
  }
}

// @gsd-api batchFetchDocs(projectRoot, dependencies, options) -- Orchestrates batch fetch for /cap:init.
// @gsd-todo(ref:AC-85) Context7 fetching is MANDATORY at init. If unreachable, warning emitted and init continues.
/**
 * Fetch stack docs for multiple dependencies. Skips already-fresh docs.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {string[]} dependencies - Array of dependency names to fetch
 * @param {Object} [options]
 * @param {number} [options.maxDeps] - Maximum number of deps to fetch (default: 15)
 * @param {boolean} [options.force] - Force refresh even if fresh (default: false)
 * @returns {{ total: number, fetched: number, failed: number, skipped: number, context7Available: boolean, errors: string[] }}
 */
function batchFetchDocs(projectRoot, dependencies, options = {}) {
  const maxDeps = options.maxDeps || 15;
  const force = options.force || false;

  // Filter out internal/scoped packages that Context7 likely does not have
  const fetchable = dependencies
    .filter(dep => !dep.startsWith('@') || dep.startsWith('@angular/') || dep.startsWith('@nestjs/'))
    .slice(0, maxDeps);

  const result = {
    total: fetchable.length,
    fetched: 0,
    failed: 0,
    skipped: 0,
    context7Available: false,
    errors: [],
  };

  for (const dep of fetchable) {
    // Check freshness first (skip if already fresh and not forced)
    if (!force) {
      const freshness = checkFreshnessEnhanced(projectRoot, dep);
      if (freshness.fresh) {
        result.skipped++;
        continue;
      }
    }

    // Resolve library in Context7
    // @gsd-risk Context7 resolution may fail for less popular libraries. Graceful skip per dep.
    try {
      const lib = resolveLibrary(dep, 'API surface and configuration');
      if (!lib) {
        result.failed++;
        result.errors.push(`${dep}: not found in Context7`);
        continue;
      }

      const fetchResult = fetchDocsWithFreshness(
        projectRoot,
        lib.id,
        'API surface, configuration, breaking changes'
      );

      if (fetchResult.success) {
        result.fetched++;
        result.context7Available = true;
      } else {
        result.failed++;
        result.errors.push(`${dep}: ${fetchResult.error}`);
      }
    } catch (e) {
      result.failed++;
      result.errors.push(`${dep}: ${e.message}`);
    }
  }

  return result;
}

// @gsd-api getStaleLibraries(projectRoot) -- Returns list of libraries with stale (>7 day) docs.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {Array<{libraryName: string, ageHours: number, fetchDate: string|null}>}
 */
function getStaleLibraries(projectRoot) {
  const docsDir = path.join(projectRoot, STACK_DOCS_DIR);
  if (!fs.existsSync(docsDir)) return [];

  const stale = [];
  try {
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const libName = f.replace(/\.md$/, '');
      const freshness = checkFreshnessEnhanced(projectRoot, libName);
      if (!freshness.fresh) {
        stale.push({
          libraryName: libName,
          ageHours: freshness.ageHours,
          fetchDate: freshness.fetchDate,
        });
      }
    }
  } catch (_e) {
    // Ignore
  }

  return stale;
}

// @gsd-api detectWorkspacePackages(projectRoot) -- Detects monorepo workspace packages for cross-package scanning.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {{ isMonorepo: boolean, packages: string[] }}
 */
function detectWorkspacePackages(projectRoot) {
  const result = { isMonorepo: false, packages: [] };

  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.workspaces) {
        result.isMonorepo = true;
        const wsPatterns = Array.isArray(pkg.workspaces)
          ? pkg.workspaces
          : (pkg.workspaces.packages || []);

        for (const pattern of wsPatterns) {
          const baseDir = pattern.replace(/\/\*.*$/, '');
          const fullDir = path.join(projectRoot, baseDir);
          if (fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
            const entries = fs.readdirSync(fullDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) {
                result.packages.push(path.join(baseDir, entry.name));
              }
            }
          }
        }
      }
    } catch (_e) {
      // Ignore
    }
  }

  // Check lerna.json
  const lernaPath = path.join(projectRoot, 'lerna.json');
  if (!result.isMonorepo && fs.existsSync(lernaPath)) {
    try {
      const lerna = JSON.parse(fs.readFileSync(lernaPath, 'utf8'));
      result.isMonorepo = true;
      const patterns = lerna.packages || ['packages/*'];
      for (const pattern of patterns) {
        const baseDir = pattern.replace(/\/\*.*$/, '');
        const fullDir = path.join(projectRoot, baseDir);
        if (fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
          const entries = fs.readdirSync(fullDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              result.packages.push(path.join(baseDir, entry.name));
            }
          }
        }
      }
    } catch (_e) {
      // Ignore
    }
  }

  return result;
}

module.exports = {
  STACK_DOCS_DIR,
  FRESHNESS_DAYS,
  FRESHNESS_HOURS,
  detectDependencies,
  resolveLibrary,
  fetchDocs,
  writeDocs,
  listCachedDocs,
  checkFreshness,
  getDocsPath,
  parseFreshnessFromContent,
  checkFreshnessEnhanced,
  fetchDocsWithFreshness,
  batchFetchDocs,
  getStaleLibraries,
  detectWorkspacePackages,
};
