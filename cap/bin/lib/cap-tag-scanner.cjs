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

// @cap-feature(feature:F-047) Opt-in config check for unified anchor block parsing.
// Returns true when .cap/config.json has { unifiedAnchors: { enabled: true } }.
// Returns false on any error or when the section is absent. Called once per scanDirectory.
function isUnifiedAnchorsEnabled(projectRoot) {
  try {
    const cfgPath = path.join(projectRoot, '.cap', 'config.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    return !!(parsed && parsed.unifiedAnchors && parsed.unifiedAnchors.enabled === true);
  } catch (_e) {
    return false;
  }
}

// @cap-todo(ref:AC-25) Tag scanner uses native RegExp with dotAll flag for multiline extraction
// @cap-pattern Tag regex anchors to comment tokens at line start -- identical approach to arc-scanner.cjs
// @cap-decision F-046 leaves CAP_TAG_RE untouched (AC-5 backward compat). New polylingual extension uses extractTagsWithContext + getCommentStyle for richer per-language detection.
const CAP_TAG_RE = /^[ \t]*(?:\/\/|\/\*|\*|#|--|"""|''')[ \t]*@cap-(feature|todo|risk|decision)(?:\(([^)]*)\))?[ \t]*(.*)/;

// @cap-feature(feature:F-063) Design-Tag recognition in the tag scanner.
// @cap-todo(ac:F-063/AC-2) Recognise @cap-design-token(id:DT-NNN) and @cap-design-component(id:DC-NNN) in source comments.
// @cap-decision Keep the core CAP_TAG_RE / CAP_TAG_TYPES untouched — adding design types there would break F-001's
//   regression tests (CAP_TAG_TYPES.length === 4 is pinned). Design tags get a sibling regex and are merged into
//   extractTags output with type values 'design-token' | 'design-component'. Consumers that filter by tag.type
//   against {'feature','todo','risk','decision'} are unaffected.
const CAP_DESIGN_TAG_RE = /^[ \t]*(?:\/\/|\/\*|\*|#|--|"""|''')[ \t]*@cap-(design-token|design-component)(?:\(([^)]*)\))?[ \t]*(.*)/;

// @cap-api CAP_DESIGN_TAG_TYPES -- exported for /cap:deps --design and /cap:trace design-usage.
const CAP_DESIGN_TAG_TYPES = ['design-token', 'design-component'];

// @cap-todo(ref:AC-26) Tag scanner is language-agnostic, operating on comment syntax patterns across JS, TS, Python, Ruby, Shell
// @cap-decision F-046 leaves SUPPORTED_EXTENSIONS untouched to preserve AC-5 backward compatibility (existing test asserts list length === 18). The new polylingual scanner uses Object.keys(COMMENT_STYLES) as its default extension list, which DOES include HTML/CSS/SCSS/Markdown/YAML/TOML/Shell-zsh.
const SUPPORTED_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.sh', '.bash', '.sql', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp'];
// @cap-decision DEFAULT_EXCLUDE covers (a) VCS + tooling metadata, (b) JS/TS build outputs, (c) framework
//                 caches that emit source-mapped JS the scanner would otherwise mistake for real code.
//                 The Next.js / Turbo / Nx caches were the worst offenders — a single GoetzeInvest scan
//                 surfaced 344 decisions sourced from `.next/dev/server/chunks/*.js` (~28 % of the
//                 decisions.md file). Build artifacts MUST never enter the memory pipeline; pre-existing
//                 entries should be pruned via `cap:memory prune` after this constant lands.
const DEFAULT_EXCLUDE = [
  // VCS + CAP own metadata
  '.git', '.cap', '.planning',
  // Generic JS/TS build outputs
  'node_modules', 'dist', 'build', 'coverage', 'out',
  // Framework / monorepo caches that emit source-mapped JS
  '.next', '.turbo', '.nx', '.cache', '.parcel-cache', '.vercel', '.svelte-kit',
  // Other ecosystems (Python / Java / Rust / iOS / Android)
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', 'venv', '.venv',
  'target', '.gradle', 'Pods', '.expo',
];

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
    if (match) {
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
      continue;
    }

    // @cap-todo(ac:F-063/AC-2) Fall through to design-tag recognition. Two separate regexes keep the
    // core tag-type set (feature/todo/risk/decision) stable and pinned by F-001's regression tests.
    const designMatch = line.match(CAP_DESIGN_TAG_RE);
    if (designMatch) {
      const type = designMatch[1]; // 'design-token' | 'design-component'
      const metadataStr = designMatch[2] || '';
      const description = (designMatch[3] || '').trim();
      const metadata = parseMetadata(metadataStr);
      tags.push({
        type,
        file: filePath,
        line: i + 1,
        metadata,
        description,
        raw: line,
        subtype: null,
      });
    }
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
// @cap-todo(ac:F-047/AC-1) scanFile shall also expand unified @cap anchor blocks when
// the caller passes { unifiedAnchors: true }. Backward-compatible default (off).
function scanFile(filePath, projectRoot, options) {
  // @cap-todo(ref:AC-25) Use native RegExp for tag extraction -- no AST parsing
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return [];
  }
  const relativePath = path.relative(projectRoot, filePath);
  const tags = extractTags(content, relativePath);
  if (options && options.unifiedAnchors) {
    // Lazy require keeps the module decoupled when the feature is disabled.
    const anchor = require('./cap-anchor.cjs');
    tags.push(...anchor.scanAnchorsInContent(content, relativePath));
  }
  return tags;
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
  // F-047: honour explicit opt-in via options OR .cap/config.json flag. Config is
  // read once per scan so the overhead stays constant regardless of file count.
  const unifiedAnchors =
    options.unifiedAnchors != null
      ? !!options.unifiedAnchors
      : isUnifiedAnchorsEnabled(projectRoot);
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
        const fileTags = scanFile(fullPath, projectRoot, { unifiedAnchors });
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

// =====================================================================
// F-046: Polylingual comment-context detection
// =====================================================================
//
// @cap-feature(feature:F-046, primary:true) Strengthen Polylingual Comment-Token Detection in Tag Scanner
// @cap-decision Comment-style table is extension-driven (per-language) rather than heuristic — extensions are deterministic, low-risk, and match how editors highlight code. A heuristic (e.g., shebang-sniffing) would over-trigger on polyglot files like .md with embedded code blocks.
// @cap-decision Backward-compat strategy: keep `extractTags(content, file) -> CapTag[]` legacy shape (Option A from spec) and add a new `extractTagsWithContext(content, file) -> { tags, warnings }`. F-046/AC-5 requires JS/TS callsites to be untouched, and this avoids churning ~30 callers.
// @cap-decision Comment-context detection is implemented as an in-place line-by-line state machine rather than a tokenizer or AST. The scanner has been regex-based since F-001; adopting a tokenizer for one feature would balloon scope and add maintenance burden. The state machine handles 95%+ of real-world cases (line + block comments, multi-line block tracking) with ~80 lines of logic.
// @cap-risk Edge cases not covered: nested string-quote inside block comment (e.g., `# "@cap-feature" still in code`), here-docs in shell, raw strings in Python (r"@cap..."), C++ raw string literals R"(@cap)". These are extremely rare for tag-bearing files and would require a real lexer to handle correctly. The warning system in AC-3 catches most false positives; AC-4's --strict mode is the safety net for CI.
// @cap-risk Unrecognized extensions fall back to "treat as JS-style line + block comments" so behavior is at least no worse than today. Documented below at COMMENT_STYLES_DEFAULT.
// @cap-feature(feature:F-046, ac:F-046/AC-3) String-literal awareness — classifyTagContext now tracks string state alongside comment state. A line like `const x = "// @cap-feature(F-999) fake"` is correctly classified as a string-literal context, the @cap-* token is NOT extracted as a tag, and a structured warning is emitted instead. Implementation: STRING_STYLES per-extension table, _matchStringOpen / _findStringClose helpers, and string-state extension to blockState carried across lines (Python triple-quotes, TOML triple-quotes, Rust raw strings, JS template literals all multi-line capable). See tests/cap-tag-scanner-polylingual-adversarial.test.cjs `'F-046/AC-3 string literal containing comment token is correctly rejected'` for the inverted witness tests that pin the fix.

/**
 * @typedef {Object} CommentStyle
 * @property {string[]} line - Line-comment tokens (e.g., ["//"])
 * @property {Array<[string,string]>} block - Block-comment open/close pairs (e.g., [["/*", "*\/"]])
 */

// @cap-todo(ac:F-046/AC-1) Per-extension comment style table covering Python, Ruby, Shell, Go, Rust, HTML, CSS in addition to JS/TS.
// Order within `line` matters: longer tokens must come first so that `///` matches before `//`.
/** @type {Object<string, CommentStyle>} */
const COMMENT_STYLES = {
  // JS / TS family — preserved from existing behavior (AC-5).
  '.js':   { line: ['//'], block: [['/*', '*/']] },
  '.cjs':  { line: ['//'], block: [['/*', '*/']] },
  '.mjs':  { line: ['//'], block: [['/*', '*/']] },
  '.ts':   { line: ['//'], block: [['/*', '*/']] },
  '.tsx':  { line: ['//'], block: [['/*', '*/']] },
  '.jsx':  { line: ['//'], block: [['/*', '*/']] },
  // Python — line `#`; block via triple-quoted strings (used as docstring comments).
  '.py':   { line: ['#'],  block: [['"""', '"""'], ["'''", "'''"]] },
  // Ruby — line `#`; block via =begin/=end.
  '.rb':   { line: ['#'],  block: [['=begin', '=end']] },
  // Shell family — line `#` only.
  '.sh':   { line: ['#'],  block: [] },
  '.bash': { line: ['#'],  block: [] },
  '.zsh':  { line: ['#'],  block: [] },
  // Go — same as JS family.
  '.go':   { line: ['//'], block: [['/*', '*/']] },
  // Rust — `///` doc-comment must be matched before `//`.
  '.rs':   { line: ['///', '//'], block: [['/*', '*/']] },
  // HTML / Markdown HTML comments — block only.
  '.html': { line: [], block: [['<!--', '-->']] },
  '.htm':  { line: [], block: [['<!--', '-->']] },
  '.md':   { line: [], block: [['<!--', '-->']] },
  // CSS / SCSS — block always; SCSS adds line comments.
  '.css':  { line: [], block: [['/*', '*/']] },
  '.scss': { line: ['//'], block: [['/*', '*/']] },
  // YAML / TOML — line `#` only.
  '.yaml': { line: ['#'], block: [] },
  '.yml':  { line: ['#'], block: [] },
  '.toml': { line: ['#'], block: [] },
  // SQL / Lua — line `--`.
  '.sql':  { line: ['--'], block: [['/*', '*/']] },
  // C / C++ / Java — same as JS family.
  '.java': { line: ['//'], block: [['/*', '*/']] },
  '.c':    { line: ['//'], block: [['/*', '*/']] },
  '.cpp':  { line: ['//'], block: [['/*', '*/']] },
  '.h':    { line: ['//'], block: [['/*', '*/']] },
  '.hpp':  { line: ['//'], block: [['/*', '*/']] },
};

// @cap-decision Default fallback for unrecognized extensions: assume JS-style. This is the safest non-breaking default — files we don't know about will behave exactly as they did before F-046 (regex-only).
/** @type {CommentStyle} */
const COMMENT_STYLES_DEFAULT = { line: ['//', '#', '--'], block: [['/*', '*/'], ['"""', '"""'], ["'''", "'''"], ['<!--', '-->'], ['=begin', '=end']] };

/**
 * Pick the comment style for a file path based on its extension.
 * @param {string} filePath
 * @returns {CommentStyle}
 */
function getCommentStyle(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  return COMMENT_STYLES[ext] || COMMENT_STYLES_DEFAULT;
}

// =====================================================================
// F-046/AC-3 — String-literal awareness
// =====================================================================
//
// @cap-feature(feature:F-046) String-state tracker — prevents @cap-* tokens INSIDE string literals from being misclassified as comments. Resolves the AC-3 bug pinned by adversarial tests.
// @cap-decision String-state lives in the same blockState object as comment-state, walked synchronously by classifyTagContext. A separate pass would double the asymptotic work and require keeping two parallel cursors in sync; one walker that checks string-open BEFORE comment-open at each position is simpler and provably correct.
// @cap-decision Per-language STRING_STYLES table — same shape philosophy as COMMENT_STYLES. Order within the array matters: longer / more-specific tokens (triple-quotes, raw-string prefixes like r" or r#") must be listed before their substring counterparts.
// @cap-risk(out-of-scope) Ruby `<<~END` heredocs and Shell `<< EOF` heredocs are NOT tracked. The body of a heredoc is plain text but the scanner sees it as code. Documented limitation; pinned by adversarial tests `'heredocs and multi-line strings (current behaviour)'`. A real fix requires tokenizing the heredoc-introducer syntax, which is non-trivial (delimiter is identifier-defined, can be quoted or unquoted, can be `<<~` for indent-stripping). Out of scope for this iteration.
// @cap-risk(out-of-scope) Rust nested `/* /* */ */` block comments still close on the first `*/`. Same documented limitation as before F-046/AC-3 fix — nesting requires a depth counter, separate from string-state.
// @cap-risk(out-of-scope) Markdown ```code fences``` are NOT understood as comments-or-strings. A tag inside a fenced code block is treated as a plain prose mention and emits a warning. Documented in adversarial test `'Markdown code fences are NOT understood'`.

/**
 * @typedef {Object} StringSyntax
 * @property {string} open - Opening token (e.g., '"', "'", '"""', 'r#"').
 * @property {string} close - Closing token. For raw strings with hash counts (r#"..."#), the runtime computes the actual close from the open.
 * @property {boolean} escapes - When true, backslash escapes the next character; when false (raw strings, shell single-quotes, Python r"..."), the backslash is literal.
 * @property {boolean} multiline - When true, the string can span multiple lines (Python """, TOML ''', etc).
 * @property {boolean} [rustRaw] - Special-case marker for Rust r#"..."# raw strings whose close depends on hash count of open.
 */

// @cap-feature(feature:F-046) Per-extension string syntax table — used by classifyTagContext to detect when the cursor enters a string literal so comment-token matches inside the string are ignored.
// @cap-decision Order matters: longer / prefixed tokens come first so `"""` matches before `"`, `r"..."` matches before `"..."`. Otherwise the shorter token would consume the prefix and misclassify.
/** @type {Object<string, StringSyntax[]>} */
const STRING_STYLES = {
  // JS / TS family — double, single, and template literals (backtick treated as plain string; interpolation NOT tracked).
  '.js':  [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }, { open: '`', close: '`', escapes: true, multiline: true }],
  '.cjs': [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }, { open: '`', close: '`', escapes: true, multiline: true }],
  '.mjs': [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }, { open: '`', close: '`', escapes: true, multiline: true }],
  '.ts':  [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }, { open: '`', close: '`', escapes: true, multiline: true }],
  '.tsx': [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }, { open: '`', close: '`', escapes: true, multiline: true }],
  '.jsx': [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }, { open: '`', close: '`', escapes: true, multiline: true }],
  // Python — single-line strings only here. Triple-quoted strings are treated as BLOCK COMMENTS via COMMENT_STYLES['.py'] for docstring compatibility (this matches Python convention where """...""" at module/function/class level is the docstring).
  // @cap-decision Triple-quoted strings are NOT in Python STRING_STYLES — they remain in COMMENT_STYLES.block to preserve the F-046/AC-1 contract that Python docstrings carry tags. Edge case: a triple-quoted string used as a literal value (e.g., `s = """hello"""`) is misclassified as a comment, but this is the existing behavior the original tests pin (see `'Python inline triple-quote'` test).
  '.py':  [
    // Prefixed strings come BEFORE plain strings so `r"..."` matches before `"..."`.
    { open: 'rb"', close: '"', escapes: false, multiline: false, isRaw: true },
    { open: "rb'", close: "'", escapes: false, multiline: false, isRaw: true },
    { open: 'br"', close: '"', escapes: false, multiline: false, isRaw: true },
    { open: "br'", close: "'", escapes: false, multiline: false, isRaw: true },
    { open: 'r"', close: '"', escapes: false, multiline: false, isRaw: true },
    { open: "r'", close: "'", escapes: false, multiline: false, isRaw: true },
    { open: 'b"', close: '"', escapes: true, multiline: false },
    { open: "b'", close: "'", escapes: true, multiline: false },
    { open: 'f"', close: '"', escapes: true, multiline: false },
    { open: "f'", close: "'", escapes: true, multiline: false },
    { open: '"', close: '"', escapes: true, multiline: false },
    { open: "'", close: "'", escapes: true, multiline: false },
  ],
  // Ruby — double + single. Heredocs NOT tracked (see @cap-risk above).
  '.rb':  [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: false, multiline: false }],
  // Shell — double, single (no escapes in single-quoted), backtick command substitution. Heredocs NOT tracked.
  '.sh':   [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: false, multiline: false }, { open: '`', close: '`', escapes: true, multiline: false }],
  '.bash': [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: false, multiline: false }, { open: '`', close: '`', escapes: true, multiline: false }],
  '.zsh':  [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: false, multiline: false }, { open: '`', close: '`', escapes: true, multiline: false }],
  // Go — double, single (rune literal), backtick raw string.
  '.go':  [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }, { open: '`', close: '`', escapes: false, multiline: true }],
  // Rust — raw strings with hash counts handled specially. r#"..."#, r##"..."##, etc.
  '.rs':  [
    { open: 'r#"', close: '"#', escapes: false, multiline: true, rustRaw: true },
    { open: 'r"', close: '"', escapes: false, multiline: true, isRaw: true },
    { open: 'b"', close: '"', escapes: true, multiline: false },
    { open: '"', close: '"', escapes: true, multiline: true },
    // Char literals 'x' — single quotes in Rust are char literals, but treating them as 1-char strings is fine for our purposes.
    { open: "'", close: "'", escapes: true, multiline: false },
  ],
  // HTML — attribute strings inside tags. Treat anywhere as string for our purposes (over-flag is acceptable).
  '.html': [{ open: '"', close: '"', escapes: false, multiline: false }, { open: "'", close: "'", escapes: false, multiline: false }],
  '.htm':  [{ open: '"', close: '"', escapes: false, multiline: false }, { open: "'", close: "'", escapes: false, multiline: false }],
  // Markdown — no string literals natively; leave empty so prose is not treated as string.
  '.md':   [],
  // CSS / SCSS — both quote styles.
  '.css':  [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }],
  '.scss': [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }],
  // YAML — both quote styles. Single-quote escape via doubling NOT tracked exactly; over-flag is acceptable.
  '.yaml': [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: false, multiline: false }],
  '.yml':  [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: false, multiline: false }],
  // TOML — triple-quote multiline first, then plain.
  '.toml': [
    { open: '"""', close: '"""', escapes: true, multiline: true },
    { open: "'''", close: "'''", escapes: false, multiline: true },
    { open: '"', close: '"', escapes: true, multiline: false },
    { open: "'", close: "'", escapes: false, multiline: false },
  ],
  // SQL — single-quote string with doubled-quote escape. Treat as escape-aware for simplicity.
  '.sql':  [{ open: "'", close: "'", escapes: true, multiline: false }, { open: '"', close: '"', escapes: true, multiline: false }],
  // C / C++ / Java — double for string, single for char.
  '.java': [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }],
  '.c':    [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }],
  '.cpp':  [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }],
  '.h':    [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }],
  '.hpp':  [{ open: '"', close: '"', escapes: true, multiline: false }, { open: "'", close: "'", escapes: true, multiline: false }],
};

// @cap-decision Default string-style fallback for unknown extensions: double + single quotes with escape handling. Matches behavior of nearly every C-family language. Files of unknown type are over-flagged rather than under-flagged (safer).
/** @type {StringSyntax[]} */
const STRING_STYLES_DEFAULT = [
  { open: '"', close: '"', escapes: true, multiline: false },
  { open: "'", close: "'", escapes: true, multiline: false },
];

/**
 * Pick the string-syntax table for a file path based on its extension.
 * @param {string} filePath
 * @returns {StringSyntax[]}
 */
function getStringStyle(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  return STRING_STYLES[ext] || STRING_STYLES_DEFAULT;
}

/**
 * Try to match any string-open token at position `i` in `line`.
 * Returns the matched StringSyntax + the actual close token (computed for Rust raw r##"..."##),
 * or null if no string opens at this position.
 *
 * For Rust r##"..."##: counts the run of `#` characters after `r` and computes the close as `"` + same count of `#`.
 *
 * @param {StringSyntax[]} stringStyle
 * @param {string} line
 * @param {number} i
 * @returns {{ syntax: StringSyntax, openLen: number, close: string } | null}
 */
function _matchStringOpen(stringStyle, line, i) {
  for (const syn of stringStyle) {
    if (syn.rustRaw) {
      // Rust r#"..."# / r##"..."## / etc. Match `r` followed by 1+ `#` followed by `"`.
      if (line[i] !== 'r') continue;
      let j = i + 1;
      let hashCount = 0;
      while (j < line.length && line[j] === '#') { hashCount++; j++; }
      if (hashCount === 0) continue; // Need at least one `#` to be the rustRaw form.
      if (line[j] !== '"') continue;
      const openLen = j - i + 1; // r + N# + "
      const close = '"' + '#'.repeat(hashCount);
      return { syntax: syn, openLen, close };
    }
    if (line.startsWith(syn.open, i)) {
      return { syntax: syn, openLen: syn.open.length, close: syn.close };
    }
  }
  return null;
}

/**
 * Find the index where the currently open string closes, starting from `i`.
 * Honors escape rules per syntax. Returns -1 if the string does not close on this line.
 *
 * @param {string} line
 * @param {number} i - Position to start searching (just past the open token)
 * @param {string} close - Close token to find
 * @param {boolean} escapes - Whether backslash escapes the next char
 * @returns {number} - Index of the close token, or -1 if not found on this line
 */
function _findStringClose(line, i, close, escapes) {
  let j = i;
  const n = line.length;
  while (j < n) {
    if (escapes && line[j] === '\\' && j + 1 < n) {
      // Skip escaped character.
      j += 2;
      continue;
    }
    if (line.startsWith(close, j)) {
      return j;
    }
    j++;
  }
  return -1;
}

/**
 * Find the longest matching syntax token at position `i` across {block-comment-open, string-open, line-comment}.
 * Longest-match wins so e.g. Python `"""` (block-comment) beats `"` (string-open).
 * Equal-length ties: block-comment > string > line-comment (block syntax is the more intentional construct).
 *
 * Returns one of:
 *   { kind: 'blockComment', open, close, length }
 *   { kind: 'string', syntax, openLen, close, length }
 *   { kind: 'lineComment', token, length }
 *   null if nothing matches at i.
 *
 * @param {CommentStyle} style
 * @param {StringSyntax[]} stringStyle
 * @param {string} line
 * @param {number} i
 */
function _longestTokenMatch(style, stringStyle, line, i) {
  let best = null;

  // Block-comment open candidates.
  for (const pair of style.block) {
    const [open, close] = pair;
    if (line.startsWith(open, i)) {
      const candidate = { kind: 'blockComment', open, close, length: open.length, priority: 3 };
      if (!best || candidate.length > best.length || (candidate.length === best.length && candidate.priority > best.priority)) {
        best = candidate;
      }
    }
  }

  // String-open candidates.
  const strOpen = _matchStringOpen(stringStyle, line, i);
  if (strOpen) {
    const candidate = { kind: 'string', syntax: strOpen.syntax, openLen: strOpen.openLen, close: strOpen.close, length: strOpen.openLen, priority: 2 };
    if (!best || candidate.length > best.length || (candidate.length === best.length && candidate.priority > best.priority)) {
      best = candidate;
    }
  }

  // Line-comment candidates.
  for (const lt of style.line) {
    if (line.startsWith(lt, i)) {
      const candidate = { kind: 'lineComment', token: lt, length: lt.length, priority: 1 };
      if (!best || candidate.length > best.length || (candidate.length === best.length && candidate.priority > best.priority)) {
        best = candidate;
      }
    }
  }

  return best;
}

/**
 * @typedef {Object} ClassifyResult
 * @property {('comment'|'string'|'code'|'unknown')} context - Where the @cap-* token was found
 * @property {string} reason - Short human-readable reason ("python triple-quote block", "JS line comment", "outside any comment")
 */

// @cap-todo(ac:F-046/AC-3) classifyTagContext returns 'comment' when the tag column is inside a recognized comment, 'string' when inside a string literal, else 'code' (both 'string' and 'code' are warning candidates).
// @cap-feature(feature:F-046) classifyTagContext is string-state aware — at each cursor position it checks string-open BEFORE comment-open so a `// @cap-...` token inside `"..."` is correctly classified as a string-literal context, not a comment.
/**
 * Classify whether `tagColumn` in `lineContent` is inside a comment, a string, or code.
 * The caller maintains `blockState` across lines so multi-line block comments AND multi-line strings
 * (Python triple-quotes, TOML triple-quotes, Rust raw strings) are tracked.
 *
 * Walker order at each position i (in priority order):
 *   1. Carried-over block comment (from a previous line) — look for its close.
 *   2. Carried-over multi-line string (from a previous line) — look for its close.
 *   3. String-open token at i — enter string mode.
 *   4. Line-comment token at i — rest of line is comment.
 *   5. Block-comment open token at i — enter block mode.
 *
 * String-open is checked BEFORE comment-open because a `// @cap-...` inside `"..."` should be
 * classified as string, not comment.
 *
 * @param {CommentStyle} style
 * @param {string} lineContent - Full line text
 * @param {number} tagColumn - 0-based column of the @cap-... match
 * @param {{ open: [string,string]|null, stringClose: string|null, stringEscapes: boolean, stringOpenToken: string|null }} blockState - Mutable block-comment + string state across lines
 * @param {StringSyntax[]} [stringStyle] - Optional string syntax table (defaults derived from style if provided as ['filePath', '...'])
 * @returns {ClassifyResult}
 */
function classifyTagContext(style, lineContent, tagColumn, blockState, stringStyle) {
  // Default string style: empty (no string detection) — preserves backward compat for callers
  // that pre-date AC-3 and pass only 4 args.
  const ss = Array.isArray(stringStyle) ? stringStyle : [];

  let i = 0;
  const n = lineContent.length;

  while (i <= tagColumn && i < n) {
    // 1) Carried-over block comment from a previous line.
    if (blockState.open) {
      const [, close] = blockState.open;
      const closeIdx = lineContent.indexOf(close, i);
      if (closeIdx === -1) {
        if (tagColumn >= i) {
          return { context: 'comment', reason: `inside block comment ${blockState.open[0]}...${blockState.open[1]}` };
        }
        return { context: 'comment', reason: 'inside multi-line block comment' };
      }
      if (tagColumn < closeIdx) {
        return { context: 'comment', reason: `inside block comment ${blockState.open[0]}...${blockState.open[1]}` };
      }
      i = closeIdx + close.length;
      blockState.open = null;
      continue;
    }

    // 2) Carried-over multi-line string from a previous line.
    if (blockState.stringClose) {
      const close = blockState.stringClose;
      const escapes = !!blockState.stringEscapes;
      const closeIdx = _findStringClose(lineContent, i, close, escapes);
      if (closeIdx === -1) {
        // String stays open through end of line. tagColumn is inside the string.
        if (tagColumn >= i) {
          return { context: 'string', reason: `inside multi-line string literal ${blockState.stringOpenToken || ''}...${close}` };
        }
        return { context: 'string', reason: 'inside multi-line string literal' };
      }
      if (tagColumn < closeIdx) {
        return { context: 'string', reason: `inside multi-line string literal ${blockState.stringOpenToken || ''}...${close}` };
      }
      // String closes before tagColumn. Clear state and continue past the close.
      i = closeIdx + close.length;
      blockState.stringClose = null;
      blockState.stringEscapes = false;
      blockState.stringOpenToken = null;
      continue;
    }

    // 3) Find the longest matching token at i across {block-comment-open, string-open, line-comment}.
    //    Longest-match wins so e.g. Python `"""` (block-comment) beats `"` (string-open).
    //    Equal-length ties prefer block-comment over string over line-comment (block syntax tends to be the more intentional construct).
    const tokenMatch = _longestTokenMatch(style, ss, lineContent, i);

    if (tokenMatch && tokenMatch.kind === 'string') {
      const strOpen = tokenMatch;
      const startCol = i;
      const afterOpen = i + strOpen.openLen;
      const closeIdx = _findStringClose(lineContent, afterOpen, strOpen.close, strOpen.syntax.escapes);
      if (closeIdx === -1) {
        if (strOpen.syntax.multiline) {
          blockState.stringClose = strOpen.close;
          blockState.stringEscapes = strOpen.syntax.escapes;
          blockState.stringOpenToken = strOpen.syntax.open;
        }
        if (tagColumn >= startCol) {
          return { context: 'string', reason: `inside string literal ${strOpen.syntax.open}...${strOpen.close}` };
        }
        return { context: 'string', reason: 'inside string literal' };
      }
      if (tagColumn >= startCol && tagColumn < closeIdx + strOpen.close.length) {
        return { context: 'string', reason: `inside string literal ${strOpen.syntax.open}...${strOpen.close}` };
      }
      i = closeIdx + strOpen.close.length;
      continue;
    }

    if (tokenMatch && tokenMatch.kind === 'lineComment') {
      if (i <= tagColumn) {
        return { context: 'comment', reason: `line comment ${tokenMatch.token}` };
      }
      return { context: 'comment', reason: 'line comment' };
    }

    if (tokenMatch && tokenMatch.kind === 'blockComment') {
      const open = tokenMatch.open;
      const close = tokenMatch.close;
      const closeIdx = lineContent.indexOf(close, i + open.length);
      if (closeIdx === -1) {
        blockState.open = [open, close];
        if (tagColumn >= i) {
          return { context: 'comment', reason: `inside block comment ${open}...${close}` };
        }
        return { context: 'comment', reason: `inside block comment ${open}...${close}` };
      }
      if (tagColumn >= i && tagColumn < closeIdx + close.length) {
        return { context: 'comment', reason: `block comment ${open}...${close}` };
      }
      i = closeIdx + close.length;
      continue;
    }

    // 4) No special token at i. Advance one char.
    i++;
  }

  // Cursor walked past tagColumn without entering any comment or string — tag is in code.
  return { context: 'code', reason: 'outside any comment' };
}

/**
 * @typedef {Object} ScannerWarning
 * @property {string} file - Relative file path
 * @property {number} line - 1-based line number
 * @property {number} column - 0-based column index of the @cap-* token
 * @property {string} reason - Human-readable reason the tag was rejected
 * @property {string} raw - Full original line text
 */

// @cap-todo(ac:F-046/AC-1) extractTagsWithContext is the polylingual entry point — same regex match as legacy extractTags, but each match is verified to land inside a real comment.
// @cap-todo(ac:F-046/AC-3) Tags found outside comments are not parsed; they appear in `warnings` instead so callers (and CI in --strict mode) can surface them.
/**
 * Polylingual extraction. Detects per-line `@cap-...` matches anywhere on the line, then verifies
 * each match sits inside a recognized comment context for the file's extension.
 *
 * Tags inside comments are emitted as CapTag (same shape as `extractTags`).
 * Tags outside any comment are emitted as `warnings` and NOT parsed as tags.
 *
 * @param {string} content
 * @param {string} filePath
 * @returns {{ tags: CapTag[], warnings: ScannerWarning[] }}
 */
function extractTagsWithContext(content, filePath) {
  const style = getCommentStyle(filePath);
  const stringStyle = getStringStyle(filePath);
  const lines = content.split('\n');
  const tags = [];
  const warnings = [];
  // Loose match — `@cap-(feature|todo|risk|decision)` anywhere on the line, with optional metadata block.
  // We keep CAP_TAG_RE intact (it requires a leading comment token) and use this looser regex only here.
  const looseTagRe = /@cap-(feature|todo|risk|decision)(?:\(([^)]*)\))?[ \t]*([^\r\n]*)/g;

  // Persistent state carries across lines: block comments AND multi-line strings.
  // @cap-feature(feature:F-046) blockState now also tracks string-literal state for Python triple-quotes, TOML triple-quotes, Rust raw strings, JS template literals, etc.
  /** @type {{ open: [string,string]|null, stringClose: string|null, stringEscapes: boolean, stringOpenToken: string|null }} */
  const blockState = { open: null, stringClose: null, stringEscapes: false, stringOpenToken: null };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Reset regex state for each line.
    looseTagRe.lastIndex = 0;

    // First, find all candidate @cap-* matches on this line.
    const matches = [];
    let m;
    while ((m = looseTagRe.exec(line)) !== null) {
      matches.push({
        index: m.index,
        type: m[1],
        metadataStr: m[2] || '',
        description: (m[3] || '').trim(),
      });
    }

    // Snapshot block + string state BEFORE we mutate via classifyTagContext.
    // Each match starts the walk at column 0 with a fresh copy.
    const blockStateBeforeLine = {
      open: blockState.open,
      stringClose: blockState.stringClose,
      stringEscapes: blockState.stringEscapes,
      stringOpenToken: blockState.stringOpenToken,
    };

    if (matches.length === 0) {
      // No tags on this line, but we still need to advance the persistent state for the line.
      _advanceBlockState(style, line, blockState, stringStyle);
      continue;
    }

    for (const match of matches) {
      // Use a fresh state copy for each classification (state machine restarts from col 0).
      const localState = {
        open: blockStateBeforeLine.open,
        stringClose: blockStateBeforeLine.stringClose,
        stringEscapes: blockStateBeforeLine.stringEscapes,
        stringOpenToken: blockStateBeforeLine.stringOpenToken,
      };
      const result = classifyTagContext(style, line, match.index, localState, stringStyle);

      if (result.context === 'comment') {
        // Strip subtype if @cap-todo
        let subtype = null;
        if (match.type === 'todo') {
          const sm = match.description.match(SUBTYPE_RE);
          if (sm) subtype = sm[1];
        }
        tags.push({
          type: match.type,
          file: filePath,
          line: i + 1,
          metadata: parseMetadata(match.metadataStr),
          description: match.description,
          raw: line,
          subtype,
        });
      } else if (result.context === 'string') {
        // @cap-feature(feature:F-046) Tag found inside a string literal — emit warning with explicit string-literal reason.
        warnings.push({
          file: filePath,
          line: i + 1,
          column: match.index,
          reason: `@cap-${match.type} found inside a string literal (${result.reason}) — not parsed as tag`,
          raw: line,
        });
      } else {
        // Tag found outside any comment — emit a warning, do NOT parse as a tag.
        warnings.push({
          file: filePath,
          line: i + 1,
          column: match.index,
          reason: `@cap-${match.type} found outside any comment context (${result.reason}) — likely a string literal or code reference`,
          raw: line,
        });
      }
    }

    // Now advance the persistent state through the entire line so the next line picks up correctly.
    _advanceBlockState(style, line, blockState, stringStyle);
  }

  return { tags, warnings };
}

/**
 * Walk the line and update blockState to reflect any block comment open/close OR multi-line
 * string open/close that crossed line boundaries. Internal helper — purely advances state.
 *
 * Walker order matches classifyTagContext: carried block → carried string → string-open → line-comment → block-open.
 *
 * @param {CommentStyle} style
 * @param {string} line
 * @param {{ open: [string,string]|null, stringClose: string|null, stringEscapes: boolean, stringOpenToken: string|null }} blockState
 * @param {StringSyntax[]} [stringStyle] - Optional string syntax table; when omitted, string state is not advanced (back-compat).
 */
function _advanceBlockState(style, line, blockState, stringStyle) {
  const ss = Array.isArray(stringStyle) ? stringStyle : [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    // Carried block comment.
    if (blockState.open) {
      const [, close] = blockState.open;
      const closeIdx = line.indexOf(close, i);
      if (closeIdx === -1) {
        return;
      }
      i = closeIdx + close.length;
      blockState.open = null;
      continue;
    }
    // Carried multi-line string.
    if (blockState.stringClose) {
      const close = blockState.stringClose;
      const escapes = !!blockState.stringEscapes;
      const closeIdx = _findStringClose(line, i, close, escapes);
      if (closeIdx === -1) {
        return;
      }
      i = closeIdx + close.length;
      blockState.stringClose = null;
      blockState.stringEscapes = false;
      blockState.stringOpenToken = null;
      continue;
    }

    // Longest-match across {block-comment-open, string-open, line-comment}.
    const tokenMatch = _longestTokenMatch(style, ss, line, i);

    if (tokenMatch && tokenMatch.kind === 'string') {
      const afterOpen = i + tokenMatch.openLen;
      const closeIdx = _findStringClose(line, afterOpen, tokenMatch.close, tokenMatch.syntax.escapes);
      if (closeIdx === -1) {
        if (tokenMatch.syntax.multiline) {
          blockState.stringClose = tokenMatch.close;
          blockState.stringEscapes = tokenMatch.syntax.escapes;
          blockState.stringOpenToken = tokenMatch.syntax.open;
        }
        return;
      }
      i = closeIdx + tokenMatch.close.length;
      continue;
    }

    if (tokenMatch && tokenMatch.kind === 'lineComment') {
      // Line-comment consumes the rest of the line.
      return;
    }

    if (tokenMatch && tokenMatch.kind === 'blockComment') {
      const closeIdx = line.indexOf(tokenMatch.close, i + tokenMatch.open.length);
      if (closeIdx === -1) {
        blockState.open = [tokenMatch.open, tokenMatch.close];
        return;
      }
      i = closeIdx + tokenMatch.close.length;
      continue;
    }

    i++;
  }
}

// @cap-todo(ac:F-046/AC-4) scanFileWithContext + scanDirectoryWithContext expose the new {tags, warnings} shape and support a strict mode that throws on any warning.
/**
 * Polylingual single-file scan. Returns {tags, warnings}.
 * @param {string} filePath - Absolute path
 * @param {string} projectRoot - Absolute project root
 * @returns {{ tags: CapTag[], warnings: ScannerWarning[] }}
 */
function scanFileWithContext(filePath, projectRoot) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return { tags: [], warnings: [] };
  }
  const relativePath = path.relative(projectRoot, filePath);
  return extractTagsWithContext(content, relativePath);
}

/**
 * Polylingual directory scan. Returns {tags, warnings}.
 *
 * @param {string} dirPath
 * @param {Object} [options]
 * @param {string[]} [options.extensions]
 * @param {string[]} [options.exclude]
 * @param {string} [options.projectRoot]
 * @param {boolean} [options.strict] - When true, throws an Error if any warnings are emitted.
 * @returns {{ tags: CapTag[], warnings: ScannerWarning[] }}
 */
function scanDirectoryWithContext(dirPath, options = {}) {
  const extensions = options.extensions || Object.keys(COMMENT_STYLES);
  const exclude = options.exclude || DEFAULT_EXCLUDE;
  const projectRoot = options.projectRoot || dirPath;
  const tags = [];
  const warnings = [];

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
        const result = scanFileWithContext(fullPath, projectRoot);
        tags.push(...result.tags);
        warnings.push(...result.warnings);
      }
    }
  }

  walk(dirPath);

  if (options.strict && warnings.length > 0) {
    const summary = warnings.slice(0, 5).map(w => `  ${w.file}:${w.line}:${w.column} - ${w.reason}`).join('\n');
    const more = warnings.length > 5 ? `\n  ... and ${warnings.length - 5} more` : '';
    const err = new Error(`cap-tag-scanner --strict: found ${warnings.length} tag(s) outside comment context\n${summary}${more}`);
    err.warnings = warnings;
    err.code = 'CAP_STRICT_TAG_VIOLATION';
    throw err;
  }

  return { tags, warnings };
}

// =====================================================================
// End F-046 polylingual extension
// =====================================================================

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
  // F-063 design tag recognition — additive, separate from CAP_TAG_TYPES to preserve F-001 regression tests.
  CAP_DESIGN_TAG_TYPES,
  CAP_DESIGN_TAG_RE,
  SUPPORTED_EXTENSIONS,
  DEFAULT_EXCLUDE,
  LEGACY_TAG_RE,
  isUnifiedAnchorsEnabled,
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
  // F-046 polylingual extension
  COMMENT_STYLES,
  COMMENT_STYLES_DEFAULT,
  STRING_STYLES,
  STRING_STYLES_DEFAULT,
  getCommentStyle,
  getStringStyle,
  classifyTagContext,
  extractTagsWithContext,
  scanFileWithContext,
  scanDirectoryWithContext,
};
