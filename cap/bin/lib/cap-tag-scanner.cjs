// @cap-context CAP v2.0 tag scanner -- extracts @cap-feature, @cap-todo, @cap-risk, and @cap-decision tags from source files.
// @cap-decision Separate module from arc-scanner.cjs -- CAP tags use @cap- prefix (not @gsd-) and have different metadata semantics (feature: key instead of phase: key).
// @cap-decision Regex-based extraction (not AST) -- language-agnostic, zero dependencies, proven sufficient in GSD arc-scanner.cjs.
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path).
// @cap-pattern Same comment anchor rule as ARC: tag is only valid when first non-whitespace content on a line is a comment token.

'use strict';

// @cap-feature(feature:F-001) Tag Scanner — regex-based extraction of @cap-* tags from source files
// @cap-todo decision: Migrating @gsd-* comment headers in this file to @cap-* format is blocked on F-006 migration completion

const fs = require('node:fs');
const path = require('node:path');

// @cap-todo(ref:AC-20) Primary tags are @cap-feature and @cap-todo; risk and decision are optional standalone tags
// @cap-decision CAP tag types: 2 primary (feature, todo) + 2 optional (risk, decision). Simplified from GSD's 8 types.
const CAP_TAG_TYPES = ['feature', 'todo', 'risk', 'decision'];

// @cap-todo(ref:AC-25) Tag scanner uses native RegExp with dotAll flag for multiline extraction
// @cap-pattern Tag regex anchors to comment tokens at line start -- identical approach to arc-scanner.cjs
const CAP_TAG_RE = /^[ \t]*(?:\/\/|\/\*|\*|#|--|"""|''')[ \t]*@cap-(feature|todo|risk|decision)(?:\(([^)]*)\))?[ \t]*(.*)/;

// @cap-todo(ref:AC-26) Tag scanner is language-agnostic, operating on comment syntax patterns across JS, TS, Python, Ruby, Shell
const SUPPORTED_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.sh', '.bash', '.sql', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp'];
const DEFAULT_EXCLUDE = ['node_modules', '.git', '.cap', 'dist', 'build', 'coverage', '.planning'];

// @cap-todo(ref:AC-22) @cap-todo supports structured subtypes: risk:..., decision:...
// @cap-decision Subtype detection uses prefix matching on the description text (e.g., "risk: memory leak" -> subtype: "risk")
const SUBTYPE_RE = /^(risk|decision):\s*(.*)/;

/**
 * @typedef {Object} CapTag
 * @property {string} type - Tag type without @cap- prefix ('feature', 'todo', 'risk', 'decision')
 * @property {string} file - Relative path from project root
 * @property {number} line - 1-based line number
 * @property {Object<string,string>} metadata - Parsed key-value pairs from parenthesized block
 * @property {string} description - Text after metadata block
 * @property {string} raw - Complete original line
 * @property {string|null} subtype - For @cap-todo: 'risk' or 'decision' if prefixed, else null
 */

// @cap-api parseMetadata(metadataStr) -- Parses parenthesized key:value pairs.
// Returns: Object<string,string> -- flat key-value object.
/**
 * @param {string} metadataStr - Raw metadata string without parens (e.g., "feature:auth, ac:AUTH/AC-1")
 * @returns {Object<string,string>}
 */
function parseMetadata(metadataStr) {
  if (!metadataStr || !metadataStr.trim()) return {};
  const result = {};
  const pairs = metadataStr.split(',');
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      // Key without value -- store as truthy flag
      result[trimmed] = 'true';
    } else {
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (key) result[key] = value;
    }
  }
  return result;
}

// @cap-api extractTags(content, filePath) -- Regex extraction engine supporting //, #, /* */, """ """ comment styles.
// Returns: CapTag[] -- array of extracted tags.
/**
 * @param {string} content - File content to scan
 * @param {string} filePath - Relative file path (for tag metadata)
 * @returns {CapTag[]}
 */
function extractTags(content, filePath) {
  const lines = content.split('\n');
  const tags = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(CAP_TAG_RE);
    if (!match) continue;

    const type = match[1];
    const metadataStr = match[2] || '';
    const description = (match[3] || '').trim();
    const metadata = parseMetadata(metadataStr);

    // @cap-todo(ref:AC-22) Detect subtypes in @cap-todo description (risk:..., decision:...)
    let subtype = null;
    if (type === 'todo') {
      const subtypeMatch = description.match(SUBTYPE_RE);
      if (subtypeMatch) {
        subtype = subtypeMatch[1];
      }
    }

    tags.push({
      type,
      file: filePath,
      line: i + 1,
      metadata,
      description,
      raw: line,
      subtype,
    });
  }
  return tags;
}

// @cap-api scanFile(filePath, projectRoot) -- Scans a single file for @cap-* tags.
// Returns: CapTag[] -- array of extracted tags with file, line, metadata, description.
/**
 * @param {string} filePath - Absolute path to file
 * @param {string} projectRoot - Absolute path to project root (for relative path computation)
 * @returns {CapTag[]}
 */
function scanFile(filePath, projectRoot) {
  // @cap-todo(ref:AC-25) Use native RegExp for tag extraction -- no AST parsing
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return [];
  }
  const relativePath = path.relative(projectRoot, filePath);
  return extractTags(content, relativePath);
}

// @cap-api scanDirectory(dirPath, options) -- Recursively scans a directory for @cap-* tags.
// Returns: CapTag[] -- aggregated tags from all matching files.
// Options: { extensions?: string[], exclude?: string[] }
/**
 * @param {string} dirPath - Absolute path to directory to scan
 * @param {Object} [options]
 * @param {string[]} [options.extensions] - File extensions to include (e.g., ['.js', '.ts', '.py'])
 * @param {string[]} [options.exclude] - Directory names to exclude (e.g., ['node_modules', '.git'])
 * @param {string} [options.projectRoot] - Project root for relative paths (defaults to dirPath)
 * @returns {CapTag[]}
 */
function scanDirectory(dirPath, options = {}) {
  const extensions = options.extensions || SUPPORTED_EXTENSIONS;
  const exclude = options.exclude || DEFAULT_EXCLUDE;
  const projectRoot = options.projectRoot || dirPath;
  const tags = [];

  // @cap-constraint Uses readdirSync (not glob) per project zero-dep constraint
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (exclude.includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!extensions.includes(ext)) continue;
        const fileTags = scanFile(fullPath, projectRoot);
        tags.push(...fileTags);
      }
    }
  }

  walk(dirPath);
  return tags;
}

// @cap-api groupByFeature(tags) -- Groups tags by their feature: metadata value.
// Returns: Object<string, CapTag[]> -- map from feature name to tags.
/**
 * @param {CapTag[]} tags - Array of extracted tags
 * @returns {Object<string, CapTag[]>}
 */
function groupByFeature(tags) {
  const groups = {};
  for (const tag of tags) {
    const featureId = tag.metadata.feature || '(unassigned)';
    if (!groups[featureId]) groups[featureId] = [];
    groups[featureId].push(tag);
  }
  return groups;
}

// @cap-feature(feature:F-045) Multi-file AC traceability — aggregates per-AC file references and detects primary file per AC.
// @cap-decision Place buildAcFileMap alongside groupByFeature in the scanner module (not in cap-trace.cjs) — it is pure tag aggregation, no IO/graph traversal, mirrors the shape of the existing groupByFeature helper. cap-trace.cjs depends on it.
// @cap-decision The "ac" key in @cap-todo metadata accepts two formats: "F-045/AC-1" (fully qualified) and "AC-1" (relies on the surrounding @cap-feature for the feature ID). buildAcFileMap normalizes both.

/**
 * @typedef {Object} AcFileMapEntry
 * @property {string[]} files - All files that contributed at least one tag to this AC (deduped, stable order)
 * @property {string|null} primary - Primary implementation file (designated, inferred, or null when no files)
 * @property {('designated'|'inferred'|null)} primarySource - How `primary` was determined
 * @property {Object<string,number>} tagDensity - Map from file path -> tag count contributing to this AC
 * @property {string[]} warnings - Human-readable warnings (e.g., heuristic primary picked)
 */

// @cap-api buildAcFileMap(tags) -- Aggregate tags into per-AC entries with primary file detection.
// @cap-todo(ac:F-045/AC-1) Recognize `primary:true` flag on @cap-feature tags as the canonical-file marker.
// @cap-todo(ac:F-045/AC-2) Emit a structured acFileMap keyed by `<feature-id>/<ac-id>` with all contributing files.
// @cap-todo(ac:F-045/AC-3) When no `primary:true` is found and the AC spans multiple files, infer primary from highest tag density and emit a warning.
/**
 * Build a map of AC -> { files, primary, primarySource, tagDensity, warnings }.
 *
 * Key shape: "<feature-id>/<ac-id>" e.g. "F-045/AC-1".
 * Files contribute to an AC when:
 *   - the tag is @cap-todo with metadata.ac matching "F-XXX/AC-N" or just "AC-N" (resolved via metadata.feature)
 *   - or the tag is @cap-feature/risk/decision with metadata.feature AND metadata.ac present (rare but supported)
 *
 * Primary file detection:
 *   - If any @cap-feature tag for the matching feature has `primary:true` AND that file also has a tag for this AC -> designated
 *   - Else if any @cap-feature tag for the matching feature has `primary:true` -> designated (file may not directly tag the AC)
 *   - Else if multiple files contribute -> inferred via highest tag density (warning emitted)
 *   - Else if exactly one file contributes -> that file (inferred, trivially)
 *   - Else -> null
 *
 * @param {CapTag[]} tags
 * @returns {Object<string, AcFileMapEntry>}
 */
function buildAcFileMap(tags) {
  const map = {};

  // First pass: collect designated-primary files per feature (from @cap-feature primary:true tags).
  // @cap-decision primary:true is a flag on @cap-feature only — putting it on @cap-todo or @cap-risk is meaningless because those tags are AC-level not feature-level.
  const designatedPrimaryByFeature = {}; // featureId -> file
  for (const tag of tags) {
    if (tag.type !== 'feature') continue;
    if (!tag.metadata || !tag.metadata.feature) continue;
    // Normalize "true" string flag (parser stores all values as strings) to boolean check.
    const isPrimary = tag.metadata.primary === 'true' || tag.metadata.primary === true;
    if (!isPrimary) continue;
    // First wins — if multiple files claim primary for the same feature, the first encountered wins.
    // @cap-risk Multiple primary:true claims on the same feature are silently ignored after the first; consider warning in a follow-up if this becomes a problem in practice.
    if (!designatedPrimaryByFeature[tag.metadata.feature]) {
      designatedPrimaryByFeature[tag.metadata.feature] = tag.file;
    }
  }

  // Second pass: build per-AC contribution lists.
  // We support two ways a tag references an AC:
  //   1) metadata.ac with full form "F-NNN/AC-M"
  //   2) metadata.ac with short form "AC-M" PLUS metadata.feature giving the feature
  for (const tag of tags) {
    if (!tag.metadata || !tag.metadata.ac) continue;
    const acRaw = tag.metadata.ac;

    let key;
    if (acRaw.includes('/')) {
      key = acRaw;
    } else if (tag.metadata.feature) {
      key = `${tag.metadata.feature}/${acRaw}`;
    } else {
      // Tag references an AC without enough context to qualify it. Skip silently — orphan detection lives elsewhere.
      continue;
    }

    if (!map[key]) {
      map[key] = {
        files: [],
        primary: null,
        primarySource: null,
        tagDensity: {},
        warnings: [],
      };
    }
    const entry = map[key];
    if (!entry.files.includes(tag.file)) entry.files.push(tag.file);
    entry.tagDensity[tag.file] = (entry.tagDensity[tag.file] || 0) + 1;
  }

  // Third pass: resolve primary for each AC entry.
  for (const acKey of Object.keys(map)) {
    const entry = map[acKey];
    const featureId = acKey.split('/')[0];

    // Designated primary takes precedence — only if that file actually contributes to this AC.
    // If a feature designates a primary file but the AC isn't tagged in that file, fall back to inference.
    // @cap-decision Designated primary requires the file to actually contain at least one tag for this AC. Otherwise primary:true on an unrelated file (e.g. a barrel index) would mislead the trace.
    const designatedFile = designatedPrimaryByFeature[featureId];
    if (designatedFile && entry.files.includes(designatedFile)) {
      entry.primary = designatedFile;
      entry.primarySource = 'designated';
      continue;
    }

    if (entry.files.length === 0) {
      entry.primary = null;
      entry.primarySource = null;
      continue;
    }

    if (entry.files.length === 1) {
      entry.primary = entry.files[0];
      entry.primarySource = 'inferred';
      continue;
    }

    // Multiple files contribute and no designated primary — pick by tag density.
    // @cap-decision Tag density (count of contributing tags per file) is the simplest defensible heuristic. Future signals could include @cap-feature presence, file size, or import graph centrality, but those add complexity for marginal gain in a heuristic-anyway choice.
    let bestFile = null;
    let bestCount = -1;
    // Iterate files in stable order so ties are broken by first-appearance.
    for (const f of entry.files) {
      const count = entry.tagDensity[f] || 0;
      if (count > bestCount) {
        bestCount = count;
        bestFile = f;
      }
    }
    entry.primary = bestFile;
    entry.primarySource = 'inferred';
    entry.warnings.push(
      `AC ${acKey} spans ${entry.files.length} files with no @cap-feature(...primary:true) tag — inferred primary: ${bestFile}`
    );
  }

  return map;
}

// @cap-api detectOrphans(tags, featureIds) -- Compare tags against Feature Map entries, fuzzy-match hints for orphans.
// Returns: Array of { tag, hint } where hint is the closest matching feature ID.
// @cap-todo(ref:AC-15) Orphan tags flagged with fuzzy-match hint suggesting closest existing feature ID
/**
 * @param {CapTag[]} tags - Array of extracted tags
 * @param {string[]} featureIds - Known feature IDs from Feature Map (e.g., ['F-001', 'F-002'])
 * @returns {{ tag: CapTag, hint: string|null }[]}
 */
function detectOrphans(tags, featureIds) {
  const orphans = [];
  const featureSet = new Set(featureIds);

  for (const tag of tags) {
    const tagFeatureId = tag.metadata.feature;
    if (!tagFeatureId) continue;
    if (featureSet.has(tagFeatureId)) continue;

    // Fuzzy match: find closest feature ID by Levenshtein-like similarity
    const hint = findClosestMatch(tagFeatureId, featureIds);
    orphans.push({ tag, hint });
  }

  return orphans;
}

// @cap-decision Simple character-level distance for fuzzy matching -- no external library needed
/**
 * Compute edit distance between two strings (Levenshtein).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function editDistance(a, b) {
  const la = a.length;
  const lb = b.length;
  const dp = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[la][lb];
}

/**
 * Find the closest matching string from candidates using edit distance.
 * @param {string} target
 * @param {string[]} candidates
 * @returns {string|null}
 */
function findClosestMatch(target, candidates) {
  if (candidates.length === 0) return null;
  let bestDist = Infinity;
  let bestMatch = null;
  const lowerTarget = target.toLowerCase();
  for (const candidate of candidates) {
    const dist = editDistance(lowerTarget, candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = candidate;
    }
  }
  // Only suggest if distance is reasonable (less than half the target length)
  if (bestDist <= Math.ceil(target.length / 2)) return bestMatch;
  return null;
}

// @cap-todo(ref:AC-78) /cap:scan shall traverse all packages in a monorepo
// @cap-todo(ref:AC-93) Zero runtime dependencies -- uses only Node.js built-ins
// @cap-todo(ref:AC-94) Tag scanner uses native RegExp -- no comment-parser or AST parser
// @cap-todo(ref:AC-95) File discovery uses fs.readdirSync with recursive walk -- no glob library
// @cap-todo(ref:AC-96) CLI argument parsing uses existing parseNamedArgs() pattern

// @cap-api detectWorkspaces(projectRoot) -- Detects monorepo workspaces from package.json and lerna.json.
// Returns: { isMonorepo: boolean, packages: string[] }
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {{ isMonorepo: boolean, packages: string[] }}
 */
function detectWorkspaces(projectRoot) {
  const result = { isMonorepo: false, packages: [] };

  // Check package.json workspaces (npm/yarn/pnpm)
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.workspaces) {
        result.isMonorepo = true;
        const patterns = Array.isArray(pkg.workspaces)
          ? pkg.workspaces
          : (pkg.workspaces.packages || []);
        result.packages = resolveWorkspaceGlobs(projectRoot, patterns);
      }
    } catch (_e) {
      // Malformed package.json
    }
  }

  // Check pnpm-workspace.yaml
  if (!result.isMonorepo) {
    const pnpmPath = path.join(projectRoot, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmPath)) {
      try {
        const content = fs.readFileSync(pnpmPath, 'utf8');
        // Simple YAML parsing for packages array — handles:
        //   packages:
        //     - "apps/*"
        //     - "packages/*"
        const packagesMatch = content.match(/packages:\s*\n((?:\s+-\s*.+\n?)*)/);
        if (packagesMatch) {
          result.isMonorepo = true;
          const patterns = packagesMatch[1]
            .split('\n')
            .map(line => line.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''))
            .filter(Boolean);
          result.packages = resolveWorkspaceGlobs(projectRoot, patterns);
        }
      } catch (_e) {
        // Malformed pnpm-workspace.yaml
      }
    }
  }

  // Check nx.json (NX workspace — look for project patterns or apps/packages dirs)
  if (!result.isMonorepo) {
    const nxPath = path.join(projectRoot, 'nx.json');
    if (fs.existsSync(nxPath)) {
      try {
        const nx = JSON.parse(fs.readFileSync(nxPath, 'utf8'));
        result.isMonorepo = true;
        // NX may define workspaceLayout or rely on convention (apps/, packages/, libs/)
        const layout = nx.workspaceLayout || {};
        const patterns = [];
        if (layout.appsDir) patterns.push(layout.appsDir + '/*');
        if (layout.libsDir) patterns.push(layout.libsDir + '/*');
        // Fallback: check common NX directories
        if (patterns.length === 0) {
          for (const dir of ['apps', 'packages', 'libs']) {
            if (fs.existsSync(path.join(projectRoot, dir))) {
              patterns.push(dir + '/*');
            }
          }
        }
        if (patterns.length > 0) {
          result.packages = resolveWorkspaceGlobs(projectRoot, patterns);
        }
      } catch (_e) {
        // Malformed nx.json
      }
    }
  }

  // Check lerna.json
  if (!result.isMonorepo) {
    const lernaPath = path.join(projectRoot, 'lerna.json');
    if (fs.existsSync(lernaPath)) {
      try {
        const lerna = JSON.parse(fs.readFileSync(lernaPath, 'utf8'));
        result.isMonorepo = true;
        const patterns = lerna.packages || ['packages/*'];
        result.packages = resolveWorkspaceGlobs(projectRoot, patterns);
      } catch (_e) {
        // Malformed lerna.json
      }
    }
  }

  return result;
}

// @cap-api resolveWorkspaceGlobs(projectRoot, patterns) -- Expands workspace glob patterns to actual directories.
// @cap-decision Uses fs.readdirSync instead of glob library for workspace pattern expansion. Handles only simple patterns (dir/* and dir/**).
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string[]} patterns - Workspace glob patterns (e.g., ["packages/*", "apps/*"])
 * @returns {string[]} - Array of relative package directory paths
 */
function resolveWorkspaceGlobs(projectRoot, patterns) {
  const packages = [];

  for (const pattern of patterns) {
    // Strip trailing glob: "packages/*" -> "packages", "apps/**" -> "apps"
    const baseDir = pattern.replace(/\/\*+$/, '');
    const fullPath = path.join(projectRoot, baseDir);

    if (!fs.existsSync(fullPath)) continue;

    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) continue;

    // If pattern has no glob, it is a direct package reference
    if (!pattern.includes('*')) {
      packages.push(baseDir);
      continue;
    }

    // Enumerate subdirectories
    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          packages.push(path.join(baseDir, entry.name));
        }
      }
    } catch (_e) {
      // Skip unreadable directories
    }
  }

  return packages;
}

// @cap-api scanMonorepo(projectRoot, options) -- Scans all workspace packages in a monorepo for @cap-* tags.
// @cap-todo(ref:AC-79) Feature Map entries support cross-package file references (e.g., packages/core/src/auth.ts)
// @cap-todo(ref:AC-80) Works seamlessly with single-repo projects -- returns regular scanDirectory results if not a monorepo
/**
 * Scans a monorepo or single repo for @cap-* tags.
 * In monorepo mode: scans root + each workspace package.
 * In single-repo mode: delegates to scanDirectory.
 * All file paths are relative to project root for cross-package references.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {Object} [options]
 * @param {string[]} [options.extensions] - File extensions to include
 * @param {string[]} [options.exclude] - Directory names to exclude
 * @returns {{ tags: CapTag[], isMonorepo: boolean, packages: string[] }}
 */
function scanMonorepo(projectRoot, options = {}) {
  const workspaces = detectWorkspaces(projectRoot);

  if (!workspaces.isMonorepo) {
    // Single repo -- delegate to base scanner
    const tags = scanDirectory(projectRoot, {
      ...options,
      projectRoot,
    });
    return { tags, isMonorepo: false, packages: [] };
  }

  // Monorepo -- scan root and each package
  const allTags = [];
  const seen = new Set();

  // Scan root (excludes workspace dirs by default since they are scanned separately)
  const rootTags = scanDirectory(projectRoot, {
    ...options,
    projectRoot,
  });
  for (const tag of rootTags) {
    const key = `${tag.file}:${tag.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      allTags.push(tag);
    }
  }

  // Scan each workspace package
  for (const pkg of workspaces.packages) {
    const pkgDir = path.join(projectRoot, pkg);
    if (!fs.existsSync(pkgDir)) continue;

    const pkgTags = scanDirectory(pkgDir, {
      ...options,
      projectRoot, // Paths relative to monorepo root, not package root
    });

    for (const tag of pkgTags) {
      const key = `${tag.file}:${tag.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        allTags.push(tag);
      }
    }
  }

  return { tags: allTags, isMonorepo: true, packages: workspaces.packages };
}

// @cap-api groupByPackage(tags) -- Groups tags by their workspace package based on file path prefix.
/**
 * @param {CapTag[]} tags - Array of extracted tags
 * @param {string[]} packages - Known workspace package paths
 * @returns {Object<string, CapTag[]>}
 */
function groupByPackage(tags, packages) {
  const groups = { '(root)': [] };
  for (const pkg of packages) {
    groups[pkg] = [];
  }

  for (const tag of tags) {
    let matched = false;
    for (const pkg of packages) {
      if (tag.file.startsWith(pkg + '/') || tag.file.startsWith(pkg + path.sep)) {
        groups[pkg].push(tag);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups['(root)'].push(tag);
    }
  }

  return groups;
}

// @cap-api scanApp(projectRoot, appPath, options) -- Scans a single app directory plus referenced shared packages.
// When activeApp is set, scans only the active app and shared packages it imports.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} appPath - Relative app path (e.g., "apps/flow")
 * @param {Object} [options]
 * @param {string[]} [options.extensions] - File extensions to include
 * @param {string[]} [options.exclude] - Directory names to exclude
 * @returns {{ tags: CapTag[], scannedDirs: string[] }}
 */
function scanApp(projectRoot, appPath, options = {}) {
  const appDir = path.join(projectRoot, appPath);
  const scannedDirs = [appPath];

  // Scan the app directory itself
  const appTags = scanDirectory(appDir, {
    ...options,
    projectRoot,
  });

  const allTags = [...appTags];
  const seen = new Set(appTags.map(t => `${t.file}:${t.line}`));

  // Detect shared packages referenced by this app via package.json dependencies
  const sharedPkgs = detectSharedPackages(projectRoot, appPath);
  for (const pkg of sharedPkgs) {
    const pkgDir = path.join(projectRoot, pkg);
    if (!fs.existsSync(pkgDir)) continue;
    scannedDirs.push(pkg);
    const pkgTags = scanDirectory(pkgDir, {
      ...options,
      projectRoot,
    });
    for (const tag of pkgTags) {
      const key = `${tag.file}:${tag.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        allTags.push(tag);
      }
    }
  }

  return { tags: allTags, scannedDirs };
}

// @cap-api detectSharedPackages(projectRoot, appPath) -- Detects workspace packages referenced by an app's package.json.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} appPath - Relative app path
 * @returns {string[]} - Array of relative paths to shared packages
 */
function detectSharedPackages(projectRoot, appPath) {
  const packages = [];
  const appPkgPath = path.join(projectRoot, appPath, 'package.json');
  if (!fs.existsSync(appPkgPath)) return packages;

  let appPkg;
  try {
    appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf8'));
  } catch (_e) {
    return packages;
  }

  // Collect all dependency names
  const allDeps = Object.keys(appPkg.dependencies || {}).concat(Object.keys(appPkg.devDependencies || {}));

  // Resolve workspace packages -- check if any dep matches a workspace package name
  const workspaces = detectWorkspaces(projectRoot);
  if (!workspaces.isMonorepo) return packages;

  for (const wsPkg of workspaces.packages) {
    const wsPkgJsonPath = path.join(projectRoot, wsPkg, 'package.json');
    if (!fs.existsSync(wsPkgJsonPath)) continue;
    try {
      const wsPkgJson = JSON.parse(fs.readFileSync(wsPkgJsonPath, 'utf8'));
      if (wsPkgJson.name && allDeps.includes(wsPkgJson.name)) {
        packages.push(wsPkg);
      }
    } catch (_e) {
      // Skip malformed
    }
  }

  return packages;
}

// @cap-todo Detect legacy @gsd-* tags and recommend /cap:migrate
const LEGACY_TAG_RE = /^[ \t]*(?:\/\/|\/\*|\*|#|--|"""|''')[ \t]*@gsd-(feature|todo|risk|decision|context|status|depends|ref|pattern|api|constraint)/;

/**
 * Detect legacy @gsd-* tags in scanned files.
 * Re-scans source files for @gsd-* patterns that the primary scanner ignores.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {Object} [options]
 * @param {string[]} [options.extensions] - File extensions to include
 * @param {string[]} [options.exclude] - Directory names to exclude
 * @returns {{ count: number, files: string[], recommendation: string }}
 */
function detectLegacyTags(projectRoot, options = {}) {
  const extensions = options.extensions || SUPPORTED_EXTENSIONS;
  const exclude = options.exclude || DEFAULT_EXCLUDE;
  const result = { count: 0, files: [], recommendation: '' };
  const fileSet = new Set();

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (exclude.includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!extensions.includes(ext)) continue;
        scanFileForLegacy(fullPath);
      }
    }
  }

  function scanFileForLegacy(filePath) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_e) {
      return;
    }
    const lines = content.split('\n');
    let found = false;
    for (const line of lines) {
      if (LEGACY_TAG_RE.test(line)) {
        result.count++;
        found = true;
      }
    }
    if (found) {
      const relativePath = path.relative(projectRoot, filePath);
      fileSet.add(relativePath);
    }
  }

  walk(projectRoot);
  result.files = Array.from(fileSet).sort();

  if (result.count > 0) {
    result.recommendation = `Found ${result.count} legacy @gsd-* tag(s) in ${result.files.length} file(s). Run /cap:migrate to convert them to @cap-* format.`;
  }

  return result;
}

module.exports = {
  CAP_TAG_TYPES,
  CAP_TAG_RE,
  SUPPORTED_EXTENSIONS,
  DEFAULT_EXCLUDE,
  LEGACY_TAG_RE,
  scanFile,
  scanDirectory,
  extractTags,
  parseMetadata,
  groupByFeature,
  buildAcFileMap,
  detectOrphans,
  editDistance,
  detectWorkspaces,
  resolveWorkspaceGlobs,
  scanMonorepo,
  groupByPackage,
  detectLegacyTags,
  scanApp,
  detectSharedPackages,
};
