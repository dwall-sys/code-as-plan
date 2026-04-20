// @cap-context CAP v2.0 Feature Map reader/writer -- FEATURE-MAP.md is the single source of truth for all features, ACs, status, and dependencies.
// @cap-decision Markdown format for Feature Map (not JSON/YAML) -- human-readable, diffable in git, editable in any text editor. Machine-readable via regex parsing of structured table rows.
// @cap-decision Read and write are separate operations -- no in-memory mutation API. Read returns structured data, write takes structured data and serializes to markdown.
// @cap-constraint Zero external dependencies -- uses only Node.js built-ins (fs, path).
// @cap-pattern Feature Map is the bridge between all CAP workflows. Brainstorm writes entries, scan updates status, status reads for dashboard.

'use strict';

// @cap-feature(feature:F-002) Feature Map Management — read/write/enrich FEATURE-MAP.md as single source of truth

const fs = require('node:fs');
const path = require('node:path');

const FEATURE_MAP_FILE = 'FEATURE-MAP.md';

// @cap-todo(ref:AC-9) Feature state lifecycle: planned -> prototyped -> tested -> shipped
const VALID_STATES = ['planned', 'prototyped', 'tested', 'shipped'];
const STATE_TRANSITIONS = {
  planned: ['prototyped'],
  prototyped: ['tested'],
  tested: ['shipped'],
  shipped: [],
};

/**
 * @typedef {Object} AcceptanceCriterion
 * @property {string} id - AC identifier (e.g., "AC-1")
 * @property {string} description - Imperative description text
 * @property {'pending'|'implemented'|'tested'|'reviewed'} status - Current status
 */

/**
 * @typedef {Object} Feature
 * @property {string} id - Feature ID (e.g., "F-001")
 * @property {string} title - Feature title (verb+object format)
 * @property {'planned'|'prototyped'|'tested'|'shipped'} state - Feature lifecycle state
 * @property {AcceptanceCriterion[]} acs - Acceptance criteria
 * @property {string[]} files - File references linked to this feature
 * @property {string[]} dependencies - Feature IDs this depends on
 * @property {Object<string,string>} metadata - Additional key-value metadata
 */

/**
 * @typedef {Object} FeatureMap
 * @property {Feature[]} features - All features
 * @property {string} lastScan - ISO timestamp of last scan
 */

// @cap-todo(ref:AC-7) Feature Map is a single Markdown file at the project root named FEATURE-MAP.md

// @cap-todo(ref:AC-1) Generate empty FEATURE-MAP.md template with section headers (Features, Legend) and no feature entries
/**
 * Generate the empty FEATURE-MAP.md template for /cap:init.
 * @returns {string}
 */
function generateTemplate() {
  return `# Feature Map

> Single source of truth for feature identity, state, acceptance criteria, and relationships.
> Auto-enriched by \`@cap-feature\` tags and dependency analysis.

## Features

<!-- No features yet. Run /cap:brainstorm or add features with addFeature(). -->

## Legend

| State | Meaning |
|-------|---------|
| planned | Feature identified, not yet implemented |
| prototyped | Initial implementation exists |
| tested | Tests written and passing |
| shipped | Deployed / merged to main |

---
*Last updated: ${new Date().toISOString()}*
`;
}

// @cap-api readFeatureMap(projectRoot, appPath) -- Reads and parses FEATURE-MAP.md from project root or app subdirectory.
// Returns: FeatureMap object with features and lastScan timestamp.
// @cap-todo(ref:AC-10) Feature Map is the single source of truth for feature identity, state, ACs, and relationships
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string|null} [appPath=null] - Relative app path (e.g., "apps/flow"). If null, reads from projectRoot.
 * @returns {FeatureMap}
 */
function readFeatureMap(projectRoot, appPath) {
  const baseDir = appPath ? path.join(projectRoot, appPath) : projectRoot;
  const filePath = path.join(baseDir, FEATURE_MAP_FILE);
  if (!fs.existsSync(filePath)) {
    return { features: [], lastScan: null };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return parseFeatureMapContent(content);
}

// @cap-todo(ref:AC-8) Each feature entry contains: feature ID, title, state, ACs, and file references
// @cap-todo(ref:AC-14) Feature Map scales to 80-120 features in a single file
// @cap-feature(feature:F-041) Fix Feature Map Parser Roundtrip Symmetry — parser is the read half of a
// symmetric pair with serializeFeatureMap. Parser must accept every format the serializer can write,
// without dropping ACs or transforming status case beyond what the serializer can re-emit.
/**
 * Parse FEATURE-MAP.md content into structured data.
 * @param {string} content - Raw markdown content
 * @returns {FeatureMap}
 */
function parseFeatureMapContent(content) {
  const features = [];
  const lines = content.split('\n');

  // Match feature headers: ### F-001: Title text [state]
  // Also accepts:          ### F-001: Title text          (no [state] — state comes from separate line)
  const featureHeaderRE = /^###\s+(F-\d{3}):\s+(.+?)\s*$/;
  // Match AC rows: | AC-N | status | description |
  const acRowRE = /^\|\s*(AC-\d+)\s*\|\s*(\w+)\s*\|\s*(.+?)\s*\|/;
  // @cap-todo(ac:F-041/AC-4) Strict header detector: only match the literal table header
  // "| AC | Status | Description |" so AC-N rows whose description contains the word "Status"
  // (e.g. F-041/AC-6) are not misclassified as table headers, which previously truncated the
  // table and silently dropped subsequent AC rows.
  const acTableHeaderRE = /^\|\s*AC\s*\|\s*Status\s*\|\s*Description\s*\|/i;
  // Match AC checkboxes: - [x] description  or  - [ ] description
  const acCheckboxRE = /^[\s]*-\s+\[(x| )\]\s+(.+)/;
  // Match file refs: - `path/to/file`
  const fileRefRE = /^-\s+`(.+?)`/;
  // Match dependencies: **Depends on:** F-001, F-002  or  - **Dependencies:** F-001
  const depsRE = /^-?\s*\*\*Depend(?:s on|encies):\*\*\s*(.+)/;
  // Match status line: - **Status:** shipped  or  **Status:** shipped
  const statusLineRE = /^-?\s*\*\*Status:\*\*\s*(\w+)/;
  // File refs detected inline via regex test (not a stored RE)
  // Match AC section header: - **AC:**
  const acSectionRE = /^-?\s*\*\*AC:\*\*/;
  // Match lastScan in footer
  const lastScanRE = /^\*Last updated:\s*(.+?)\*$/;

  let currentFeature = null;
  let inAcTable = false;
  let inAcCheckboxes = false;
  let inFileRefs = false;
  let acCounter = 0;
  let lastScan = null;

  for (const line of lines) {
    const headerMatch = line.match(featureHeaderRE);
    if (headerMatch) {
      if (currentFeature) features.push(currentFeature);
      // Extract [state] from end of title if present, otherwise state is null (set from status line)
      let title = headerMatch[2];
      let state = null;
      const stateInTitle = title.match(/^(.+?)\s+\[(\w+)\]\s*$/);
      if (stateInTitle) {
        title = stateInTitle[1];
        state = stateInTitle[2];
      }
      currentFeature = {
        id: headerMatch[1],
        title,
        state: state || 'planned',
        acs: [],
        files: [],
        dependencies: [],
        metadata: {},
      };
      inAcTable = false;
      inAcCheckboxes = false;
      inFileRefs = false;
      acCounter = 0;
      continue;
    }

    if (!currentFeature) {
      const scanMatch = line.match(lastScanRE);
      if (scanMatch) lastScan = scanMatch[1].trim();
      continue;
    }

    // Status line: - **Status:** shipped
    // @cap-todo(ac:F-041/AC-3) Preserve case of status as written so a roundtrip
    // (parse -> serialize -> parse) does not transform the value. Canonical
    // lifecycle values are lowercase; this only matters for non-canonical inputs.
    const statusMatch = line.match(statusLineRE);
    if (statusMatch) {
      currentFeature.state = statusMatch[1];
      continue;
    }

    // Detect AC table start using the strict header detector (see acTableHeaderRE above).
    // @cap-todo(ac:F-041/AC-4) Use strict header regex instead of substring "Status" check
    // so AC-N data rows whose description contains the word "Status" do not falsely trigger
    // a "new table" reset that drops subsequent AC entries.
    if (acTableHeaderRE.test(line)) {
      inAcTable = true;
      inAcCheckboxes = false;
      inFileRefs = false;
      continue;
    }
    // Skip table separator
    if (line.match(/^\|[\s-]+\|/)) continue;

    const acMatch = line.match(acRowRE);
    if (acMatch && inAcTable) {
      // @cap-todo(ac:F-041/AC-3) Preserve case of AC status so roundtrip is lossless.
      currentFeature.acs.push({
        id: acMatch[1],
        description: acMatch[3].trim(),
        status: acMatch[2],
      });
      continue;
    }

    // AC section header: - **AC:**
    if (line.match(acSectionRE)) {
      inAcCheckboxes = true;
      inAcTable = false;
      inFileRefs = false;
      continue;
    }

    // AC checkboxes: - [x] description  or  - [ ] description
    const checkboxMatch = line.match(acCheckboxRE);
    if (checkboxMatch && (inAcCheckboxes || !inFileRefs)) {
      acCounter++;
      const checked = checkboxMatch[1] === 'x';
      currentFeature.acs.push({
        id: `AC-${acCounter}`,
        description: checkboxMatch[2].trim(),
        status: checked ? 'tested' : 'pending',
      });
      inAcCheckboxes = true;
      inAcTable = false;
      inFileRefs = false;
      continue;
    }

    // File references — inline on **Files:** line or as separate section
    // Matches: **Files:**  or  - **Files:** `path`, `path2`
    if (/^-?\s*\*\*Files:\*\*/.test(line)) {
      // Extract any backtick-quoted paths on this same line
      const pathMatches = line.matchAll(/`([^`]+)`/g);
      for (const m of pathMatches) {
        currentFeature.files.push(m[1]);
      }
      inFileRefs = true;
      inAcTable = false;
      inAcCheckboxes = false;
      continue;
    }

    if (inFileRefs) {
      const refMatch = line.match(fileRefRE);
      if (refMatch) {
        currentFeature.files.push(refMatch[1]);
        continue;
      } else if (line.trim() === '') {
        inFileRefs = false;
      }
    }

    // Dependencies
    const depsMatch = line.match(depsRE);
    if (depsMatch) {
      currentFeature.dependencies = depsMatch[1].split(',').map(d => d.trim()).filter(Boolean);
      continue;
    }

    const scanMatch = line.match(lastScanRE);
    if (scanMatch) lastScan = scanMatch[1].trim();
  }

  if (currentFeature) features.push(currentFeature);

  return { features, lastScan };
}

// @cap-api writeFeatureMap(projectRoot, featureMap, appPath, options) -- Serializes FeatureMap to FEATURE-MAP.md.
// Side effect: overwrites FEATURE-MAP.md at project root or app subdirectory.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {FeatureMap} featureMap - Structured feature map data
 * @param {string|null} [appPath=null] - Relative app path (e.g., "apps/flow"). If null, writes to projectRoot.
 * @param {{ legacyStatusLine?: boolean }} [options] - Serialization options forwarded to serializeFeatureMap.
 */
function writeFeatureMap(projectRoot, featureMap, appPath, options) {
  const baseDir = appPath ? path.join(projectRoot, appPath) : projectRoot;
  const filePath = path.join(baseDir, FEATURE_MAP_FILE);
  const content = serializeFeatureMap(featureMap, options);
  fs.writeFileSync(filePath, content, 'utf8');
}

// @cap-feature(feature:F-041) Serializer is the write half of the symmetric pair.
// It must preserve every status value the parser accepted (AC-1) and offer a legacy
// **Status:** line emission mode (AC-6) so the legacy non-table input format is not
// forcibly upgraded to bracketed-header format on the first roundtrip.
/**
 * Serialize FeatureMap to markdown string.
 * @param {FeatureMap} featureMap
 * @param {{ legacyStatusLine?: boolean }} [options]
 *   - legacyStatusLine: when true, emit `### F-NNN: Title` followed by `- **Status:** state`
 *     instead of `### F-NNN: Title [state]`. Default false (canonical bracket-header form).
 * @returns {string}
 */
function serializeFeatureMap(featureMap, options = {}) {
  // @cap-todo(ac:F-041/AC-6) Optional legacy emission keeps non-table input shape stable.
  const legacyStatusLine = Boolean(options && options.legacyStatusLine);
  const lines = [
    '# Feature Map',
    '',
    '> Single source of truth for feature identity, state, acceptance criteria, and relationships.',
    '> Auto-enriched by `@cap-feature` tags and dependency analysis.',
    '',
    '## Features',
    '',
  ];

  for (const feature of featureMap.features) {
    // @cap-todo(ac:F-041/AC-1) feature.state is emitted verbatim — no case mutation,
    // so any value the parser accepted survives the roundtrip unchanged.
    if (legacyStatusLine) {
      lines.push(`### ${feature.id}: ${feature.title}`);
      lines.push('');
      lines.push(`- **Status:** ${feature.state}`);
    } else {
      lines.push(`### ${feature.id}: ${feature.title} [${feature.state}]`);
    }
    lines.push('');

    if (feature.dependencies.length > 0) {
      lines.push(`**Depends on:** ${feature.dependencies.join(', ')}`);
      lines.push('');
    }

    if (feature.acs.length > 0) {
      lines.push('| AC | Status | Description |');
      lines.push('|----|--------|-------------|');
      for (const ac of feature.acs) {
        // @cap-todo(ac:F-041/AC-1) ac.status emitted verbatim for lossless roundtrip.
        lines.push(`| ${ac.id} | ${ac.status} | ${ac.description} |`);
      }
      lines.push('');
    }

    if (feature.files.length > 0) {
      lines.push('**Files:**');
      for (const file of feature.files) {
        lines.push(`- \`${file}\``);
      }
      lines.push('');
    }
  }

  if (featureMap.features.length === 0) {
    lines.push('<!-- No features yet. Run /cap:brainstorm or add features with addFeature(). -->');
    lines.push('');
  }

  lines.push('## Legend');
  lines.push('');
  lines.push('| State | Meaning |');
  lines.push('|-------|---------|');
  lines.push('| planned | Feature identified, not yet implemented |');
  lines.push('| prototyped | Initial implementation exists |');
  lines.push('| tested | Tests written and passing |');
  lines.push('| shipped | Deployed / merged to main |');
  lines.push('');
  lines.push('---');
  lines.push(`*Last updated: ${new Date().toISOString()}*`);
  lines.push('');

  return lines.join('\n');
}

// @cap-api addFeature(projectRoot, feature, appPath) -- Add a new feature entry to FEATURE-MAP.md.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {{ title: string, acs?: AcceptanceCriterion[], dependencies?: string[], metadata?: Object }} feature - Feature data (ID auto-generated)
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {Feature} - The added feature with generated ID
 */
function addFeature(projectRoot, feature, appPath) {
  const featureMap = readFeatureMap(projectRoot, appPath);
  const id = getNextFeatureId(featureMap.features);
  const newFeature = {
    id,
    title: feature.title,
    state: 'planned',
    acs: feature.acs || [],
    files: [],
    dependencies: feature.dependencies || [],
    metadata: feature.metadata || {},
  };
  featureMap.features.push(newFeature);
  writeFeatureMap(projectRoot, featureMap, appPath);
  return newFeature;
}

// @cap-api updateFeatureState(projectRoot, featureId, newState, appPath) -- Transition feature state.
// @cap-todo(ref:AC-9) Enforce valid state transitions: planned->prototyped->tested->shipped
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} featureId - Feature ID (e.g., "F-001")
 * @param {string} newState - Target state
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {boolean} - True if transition was valid and applied
 */
function updateFeatureState(projectRoot, featureId, newState, appPath) {
  if (!VALID_STATES.includes(newState)) return false;

  const featureMap = readFeatureMap(projectRoot, appPath);
  const feature = featureMap.features.find(f => f.id === featureId);
  if (!feature) return false;

  const allowed = STATE_TRANSITIONS[feature.state];
  if (!allowed || !allowed.includes(newState)) return false;

  feature.state = newState;
  writeFeatureMap(projectRoot, featureMap, appPath);
  return true;
}

// @cap-api enrichFromTags(projectRoot, scanResults, appPath) -- Update file references from tag scan.
// @cap-todo(ref:AC-12) Feature Map auto-enriched from @cap-feature tags found in source code
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} scanResults - Tags from cap-tag-scanner
 * @param {string|null} [appPath=null] - Relative app path for monorepo scoping
 * @returns {FeatureMap}
 */
function enrichFromTags(projectRoot, scanResults, appPath) {
  const featureMap = readFeatureMap(projectRoot, appPath);

  for (const tag of scanResults) {
    if (tag.type !== 'feature') continue;
    const featureId = tag.metadata.feature;
    if (!featureId) continue;

    const feature = featureMap.features.find(f => f.id === featureId);
    if (!feature) continue;

    // Add file reference if not already present
    if (!feature.files.includes(tag.file)) {
      feature.files.push(tag.file);
    }
  }

  writeFeatureMap(projectRoot, featureMap, appPath);
  return featureMap;
}

// @cap-api enrichFromDeps(projectRoot) -- Read package.json, detect imports, add dependency info to features.
// @cap-todo(ref:AC-13) Feature Map auto-enriched from dependency graph analysis, env vars, package.json
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {{ dependencies: string[], devDependencies: string[], envVars: string[] }}
 */
function enrichFromDeps(projectRoot) {
  const result = { dependencies: [], devDependencies: [], envVars: [] };

  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.dependencies) result.dependencies = Object.keys(pkg.dependencies);
      if (pkg.devDependencies) result.devDependencies = Object.keys(pkg.devDependencies);
    } catch (_e) {
      // Malformed package.json
    }
  }

  // Scan for .env file to detect environment variables
  const envPath = path.join(projectRoot, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envRE = /^([A-Z_][A-Z0-9_]*)=/gm;
      let match;
      while ((match = envRE.exec(envContent)) !== null) {
        result.envVars.push(match[1]);
      }
    } catch (_e) {
      // Ignore
    }
  }

  return result;
}

// @cap-api getNextFeatureId(features) -- Generate next F-NNN ID.
/**
 * @param {Feature[]} features - Existing features
 * @returns {string} - Next feature ID (e.g., "F-001")
 */
function getNextFeatureId(features) {
  if (!features || features.length === 0) return 'F-001';

  let maxNum = 0;
  for (const f of features) {
    const match = f.id.match(/^F-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `F-${String(maxNum + 1).padStart(3, '0')}`;
}

// @cap-api enrichFromScan(featureMap, tags) -- Updates Feature Map status from tag scan results.
// Returns: updated FeatureMap with AC statuses reflecting code annotations.
/**
 * @param {FeatureMap} featureMap - Current feature map data
 * @param {import('./cap-tag-scanner.cjs').CapTag[]} tags - Tags from cap-tag-scanner
 * @returns {FeatureMap}
 */
function enrichFromScan(featureMap, tags) {
  for (const tag of tags) {
    if (tag.type !== 'feature') continue;
    const featureId = tag.metadata.feature;
    if (!featureId) continue;

    const feature = featureMap.features.find(f => f.id === featureId);
    if (!feature) continue;

    // Add file reference
    if (!feature.files.includes(tag.file)) {
      feature.files.push(tag.file);
    }

    // If AC reference in metadata, mark it as implemented
    const acRef = tag.metadata.ac;
    if (acRef) {
      const ac = feature.acs.find(a => a.id === acRef);
      if (ac && ac.status === 'pending') {
        ac.status = 'implemented';
      }
    }
  }

  return featureMap;
}

// @cap-api addFeatures(featureMap, newFeatures) -- Adds new features to an existing Feature Map (from brainstorm).
// @cap-todo(ref:AC-11) Feature Map supports auto-derivation from brainstorm output
/**
 * @param {FeatureMap} featureMap - Current feature map data
 * @param {Feature[]} newFeatures - Features to add
 * @returns {FeatureMap}
 */
function addFeatures(featureMap, newFeatures) {
  const existingIds = new Set(featureMap.features.map(f => f.id));
  const existingTitles = new Set(featureMap.features.map(f => f.title.toLowerCase()));

  for (const nf of newFeatures) {
    // Skip duplicates by ID or title
    if (existingIds.has(nf.id)) continue;
    if (existingTitles.has(nf.title.toLowerCase())) continue;

    featureMap.features.push(nf);
    existingIds.add(nf.id);
    existingTitles.add(nf.title.toLowerCase());
  }

  return featureMap;
}

// @cap-api getStatus(featureMap) -- Computes aggregate project status from Feature Map.
/**
 * @param {FeatureMap} featureMap
 * @returns {{ totalFeatures: number, completedFeatures: number, totalACs: number, implementedACs: number, testedACs: number, reviewedACs: number }}
 */
function getStatus(featureMap) {
  let totalFeatures = featureMap.features.length;
  let completedFeatures = featureMap.features.filter(f => f.state === 'shipped').length;
  let totalACs = 0;
  let implementedACs = 0;
  let testedACs = 0;
  let reviewedACs = 0;

  for (const f of featureMap.features) {
    totalACs += f.acs.length;
    for (const ac of f.acs) {
      if (ac.status === 'implemented') implementedACs++;
      if (ac.status === 'tested') testedACs++;
      if (ac.status === 'reviewed') reviewedACs++;
    }
  }

  return { totalFeatures, completedFeatures, totalACs, implementedACs, testedACs, reviewedACs };
}

// @cap-api initAppFeatureMap(projectRoot, appPath) -- Create FEATURE-MAP.md for a specific app in a monorepo.
// Idempotent: does not overwrite existing FEATURE-MAP.md.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} appPath - Relative app path (e.g., "apps/flow")
 * @returns {boolean} - True if created, false if already existed
 */
function initAppFeatureMap(projectRoot, appPath) {
  const baseDir = path.join(projectRoot, appPath);
  const filePath = path.join(baseDir, FEATURE_MAP_FILE);
  if (fs.existsSync(filePath)) return false;
  // Ensure directory exists
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  fs.writeFileSync(filePath, generateTemplate(), 'utf8');
  return true;
}

// @cap-api listAppFeatureMaps(projectRoot) -- Find all FEATURE-MAP.md files in a monorepo.
// Returns array of relative paths to directories containing FEATURE-MAP.md.
/**
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string[]} - Relative directory paths that contain FEATURE-MAP.md (e.g., [".", "apps/flow", "packages/ui"])
 */
function listAppFeatureMaps(projectRoot) {
  const results = [];

  // Check root
  if (fs.existsSync(path.join(projectRoot, FEATURE_MAP_FILE))) {
    results.push('.');
  }

  // Walk subdirectories (max depth 3, skip excluded dirs)
  const excludeDirs = new Set(['node_modules', '.git', '.cap', 'dist', 'build', 'coverage', '.planning']);

  function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (excludeDirs.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const fmPath = path.join(fullPath, FEATURE_MAP_FILE);
      if (fs.existsSync(fmPath)) {
        results.push(path.relative(projectRoot, fullPath));
      }
      walk(fullPath, depth + 1);
    }
  }

  walk(projectRoot, 0);
  return results;
}

/**
 * Rescope a root FEATURE-MAP.md into per-app Feature Maps in a monorepo.
 * Distributes features to apps based on file references (feature.files paths).
 * Features with no file refs or cross-app refs stay at root.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {string[]} appPaths - List of app relative paths (e.g., ["apps/flow", "apps/hub"])
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - If true, report changes without writing
 * @returns {{ appsCreated: number, featuresDistributed: number, featuresKeptAtRoot: number, distribution: Object }}
 */
function rescopeFeatures(projectRoot, appPaths, options = {}) {
  const rootMap = readFeatureMap(projectRoot);
  if (!rootMap.features || rootMap.features.length === 0) {
    return { appsCreated: 0, featuresDistributed: 0, featuresKeptAtRoot: 0, distribution: {} };
  }

  // Build distribution: which features belong to which app
  const distribution = {}; // appPath -> features[]
  const rootFeatures = []; // features that stay at root (no refs or cross-app)

  for (const feature of rootMap.features) {
    if (!feature.files || feature.files.length === 0) {
      rootFeatures.push(feature);
      continue;
    }

    // Determine which app this feature belongs to based on file paths
    const appCounts = {}; // appPath -> count of matching files
    for (const file of feature.files) {
      for (const appPath of appPaths) {
        if (file.startsWith(appPath + '/') || file.startsWith(appPath + path.sep)) {
          appCounts[appPath] = (appCounts[appPath] || 0) + 1;
        }
      }
    }

    const entries = Object.entries(appCounts);
    if (entries.length === 0) {
      // Files don't match any app — keep at root
      rootFeatures.push(feature);
    } else if (entries.length === 1) {
      // All files in one app — distribute there
      const [appPath] = entries[0];
      if (!distribution[appPath]) distribution[appPath] = [];
      distribution[appPath].push(feature);
    } else {
      // Files across multiple apps — assign to the app with most refs
      entries.sort((a, b) => b[1] - a[1]);
      const primaryApp = entries[0][0];
      if (!distribution[primaryApp]) distribution[primaryApp] = [];
      distribution[primaryApp].push(feature);
    }
  }

  if (options.dryRun) {
    let totalDistributed = 0;
    for (const features of Object.values(distribution)) {
      totalDistributed += features.length;
    }
    return {
      appsCreated: Object.keys(distribution).length,
      featuresDistributed: totalDistributed,
      featuresKeptAtRoot: rootFeatures.length,
      distribution: Object.fromEntries(
        Object.entries(distribution).map(([app, features]) => [app, features.map(f => f.id)])
      ),
    };
  }

  // Write per-app Feature Maps
  let appsCreated = 0;
  let featuresDistributed = 0;

  for (const [appPath, features] of Object.entries(distribution)) {
    const appDir = path.join(projectRoot, appPath);
    if (!fs.existsSync(appDir)) continue;

    // Read existing app Feature Map (or create new)
    const existingMap = readFeatureMap(projectRoot, appPath);
    const existingIds = new Set(existingMap.features.map(f => f.id));

    // Re-number features for the app (F-001, F-002, ...)
    let nextId = existingMap.features.length + 1;
    for (const feature of features) {
      if (existingIds.has(feature.id)) continue; // skip duplicates

      // Rewrite file paths to be relative to app
      const appRelativeFiles = feature.files
        .filter(f => f.startsWith(appPath + '/'))
        .map(f => f.slice(appPath.length + 1));
      const otherFiles = feature.files.filter(f => !f.startsWith(appPath + '/'));

      const appFeature = {
        ...feature,
        id: `F-${String(nextId).padStart(3, '0')}`,
        files: [...appRelativeFiles, ...otherFiles],
        metadata: { ...feature.metadata, originalId: feature.id },
      };
      existingMap.features.push(appFeature);
      nextId++;
      featuresDistributed++;
    }

    writeFeatureMap(projectRoot, existingMap, appPath);
    appsCreated++;
  }

  // Rewrite root Feature Map with only root features
  const newRootMap = { features: rootFeatures, lastScan: rootMap.lastScan };
  writeFeatureMap(projectRoot, newRootMap);

  return {
    appsCreated,
    featuresDistributed,
    featuresKeptAtRoot: rootFeatures.length,
    distribution: Object.fromEntries(
      Object.entries(distribution).map(([app, features]) => [app, features.map(f => f.id)])
    ),
  };
}

module.exports = {
  FEATURE_MAP_FILE,
  VALID_STATES,
  STATE_TRANSITIONS,
  generateTemplate,
  readFeatureMap,
  writeFeatureMap,
  parseFeatureMapContent,
  serializeFeatureMap,
  addFeature,
  updateFeatureState,
  enrichFromTags,
  enrichFromDeps,
  getNextFeatureId,
  enrichFromScan,
  addFeatures,
  getStatus,
  initAppFeatureMap,
  listAppFeatureMaps,
  rescopeFeatures,
};
